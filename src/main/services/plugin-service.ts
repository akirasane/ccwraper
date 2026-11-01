import { tmpdir } from 'node:os'
import type {
  AvailablePlugin,
  InstalledPlugin,
  MarketplaceInfo,
  PluginScope,
  PluginsBrowseResult,
  PluginsListResult,
  PluginsMutationResult
} from '../../shared/plugins'
import type { PluginsMutateArgs } from '../../shared/ipc'
import { runClaude, type CliRunner } from './claude-cli'

// Thin wrapper over `claude plugin ...`. Like MCP, the CLI owns the files (settings.json,
// installed_plugins.json, the marketplace clones); the app never edits them by hand.

export const AVAILABLE_TTL_MS = 60_000
const READ_TIMEOUT_MS = 30_000
const INSTALL_TIMEOUT_MS = 180_000
const FAST_TIMEOUT_MS = 30_000

export interface PluginServiceDeps {
  run?: CliRunner
  now?: () => number
  env?: NodeJS.ProcessEnv
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const SCOPES = new Set<string>(['user', 'project', 'local'])

export function parseInstalled(v: unknown): InstalledPlugin[] {
  if (!Array.isArray(v)) return []
  const out: InstalledPlugin[] = []
  for (const raw of v) {
    if (!isRecord(raw) || !str(raw['id'])) continue
    const scope = str(raw['scope'])
    out.push({
      id: str(raw['id']),
      version: str(raw['version']),
      scope: (SCOPES.has(scope) ? scope : 'user') as PluginScope,
      enabled: raw['enabled'] === true,
      ...(str(raw['installedAt']) ? { installedAt: str(raw['installedAt']) } : {}),
      ...(str(raw['lastUpdated']) ? { lastUpdated: str(raw['lastUpdated']) } : {})
    })
  }
  return out
}

export function parseMarketplaces(v: unknown): MarketplaceInfo[] {
  if (!Array.isArray(v)) return []
  const out: MarketplaceInfo[] = []
  for (const raw of v) {
    if (!isRecord(raw) || !str(raw['name'])) continue
    out.push({
      name: str(raw['name']),
      source: str(raw['source']) || 'unknown',
      origin: str(raw['repo']) || str(raw['url']) || str(raw['path']) || str(raw['installLocation'])
    })
  }
  return out
}

type RawAvailable = Omit<AvailablePlugin, 'installed'>

export function parseAvailable(v: unknown): RawAvailable[] {
  if (!Array.isArray(v)) return []
  const out: RawAvailable[] = []
  for (const raw of v) {
    if (!isRecord(raw) || !str(raw['pluginId'])) continue
    out.push({
      pluginId: str(raw['pluginId']),
      name: str(raw['name']) || str(raw['pluginId']),
      description: str(raw['description']),
      marketplaceName: str(raw['marketplaceName']),
      installCount: typeof raw['installCount'] === 'number' ? raw['installCount'] : 0
    })
  }
  return out
}

/** Rank by where the query hits (name prefix > name > id > description), then by install count. */
export function filterAvailable(items: RawAvailable[], installed: ReadonlySet<string>, query: string, limit: number): PluginsBrowseResult {
  const q = query.trim().toLowerCase()
  const terms = q.split(/\s+/).filter(Boolean)
  const scored: Array<{ p: RawAvailable; s: number }> = []
  for (const p of items) {
    let s = 0
    if (terms.length) {
      const name = p.name.toLowerCase()
      const id = p.pluginId.toLowerCase()
      const desc = p.description.toLowerCase()
      let ok = true
      for (const t of terms) {
        if (name.startsWith(t)) s += 100
        else if (name.includes(t)) s += 60
        else if (id.includes(t)) s += 30
        else if (desc.includes(t)) s += 10
        else {
          ok = false
          break
        }
      }
      if (!ok) continue
    }
    scored.push({ p, s })
  }
  scored.sort((a, b) => b.s - a.s || b.p.installCount - a.p.installCount || a.p.name.localeCompare(b.p.name))
  return {
    total: scored.length,
    items: scored.slice(0, limit).map(({ p }) => ({ ...p, installed: installed.has(p.pluginId) }))
  }
}

function firstLine(r: { stdout: string; stderr: string }): string {
  const text = (r.stderr.trim() || r.stdout.trim()).split(/\r?\n/).find((l) => l.trim()) ?? ''
  return text.length > 300 ? `${text.slice(0, 297)}...` : text
}

/** Build the CLI argument list for a mutation. Inputs are already schema-validated (no leading dash). */
export function mutationArgs(a: PluginsMutateArgs): string[] {
  switch (a.op) {
    case 'install':
      return ['plugin', 'install', '-s', a.scope, a.plugin]
    case 'uninstall':
      return ['plugin', 'uninstall', '-s', a.scope, a.plugin]
    case 'enable':
    case 'disable':
      return ['plugin', a.op, '-s', a.scope, a.plugin]
    case 'update':
      return ['plugin', 'update', a.plugin]
    case 'marketplaceAdd':
      return ['plugin', 'marketplace', 'add', a.source]
    case 'marketplaceRemove':
      return ['plugin', 'marketplace', 'remove', a.name]
    case 'marketplaceUpdate':
      return a.name ? ['plugin', 'marketplace', 'update', a.name] : ['plugin', 'marketplace', 'update']
  }
}

export class PluginService {
  private readonly run: CliRunner
  private readonly now: () => number
  private readonly env: NodeJS.ProcessEnv | undefined
  private queue: Promise<unknown> = Promise.resolve()
  private available?: { at: number; items: RawAvailable[]; installed: Set<string> }

  constructor(deps: PluginServiceDeps = {}) {
    this.run = deps.run ?? runClaude
    this.now = deps.now ?? Date.now
    this.env = deps.env
  }

  /** No project given: run from a neutral folder so no project-level settings leak into user-scope results. */
  private cli(args: string[], cwd: string | undefined, timeoutMs: number): ReturnType<CliRunner> {
    return this.run(args, { cwd: cwd ?? tmpdir(), timeoutMs, ...(this.env ? { env: this.env } : {}) })
  }

  private async json(args: string[], cwd: string | undefined): Promise<{ ok: true; data: unknown } | { ok: false; error: string }> {
    const r = await this.cli(args, cwd, READ_TIMEOUT_MS)
    if (r.code !== 0) return { ok: false, error: firstLine(r) || `claude exited with code ${r.code}` }
    try {
      return { ok: true, data: JSON.parse(r.stdout) as unknown }
    } catch {
      return { ok: false, error: 'Could not read the claude plugin output.' }
    }
  }

  async list(cwd?: string): Promise<PluginsListResult> {
    const [inst, mk] = await Promise.all([
      this.json(['plugin', 'list', '--json'], cwd),
      this.json(['plugin', 'marketplace', 'list', '--json'], cwd)
    ])
    const error = !inst.ok ? inst.error : !mk.ok ? mk.error : undefined
    return {
      installed: inst.ok ? parseInstalled(inst.data) : [],
      marketplaces: mk.ok ? parseMarketplaces(mk.data) : [],
      ...(error ? { error } : {})
    }
  }

  async browse(args: { query: string; limit: number; cwd?: string }): Promise<PluginsBrowseResult> {
    if (!this.available || this.now() - this.available.at > AVAILABLE_TTL_MS) {
      const r = await this.json(['plugin', 'list', '--available', '--json'], args.cwd)
      if (!r.ok) return { items: [], total: 0, error: r.error }
      const d = isRecord(r.data) ? r.data : {}
      this.available = {
        at: this.now(),
        items: parseAvailable(d['available']),
        installed: new Set(parseInstalled(d['installed']).map((p) => p.id))
      }
    }
    return filterAvailable(this.available.items, this.available.installed, args.query, args.limit)
  }

  /** Mutations run one at a time: two `claude plugin` writes racing on installed_plugins.json would lose one. */
  mutate(a: PluginsMutateArgs, cwd?: string): Promise<PluginsMutationResult> {
    const job = this.queue.then(() => this.doMutate(a, cwd))
    this.queue = job.catch(() => undefined)
    return job
  }

  private async doMutate(a: PluginsMutateArgs, cwd: string | undefined): Promise<PluginsMutationResult> {
    const needsProject = 'scope' in a && a.scope !== 'user'
    if (needsProject && !cwd) return { ok: false, message: 'Select a project to use project or local scope.' }
    const slow = a.op === 'install' || a.op === 'update' || a.op === 'marketplaceAdd' || a.op === 'marketplaceUpdate'
    const r = await this.cli(mutationArgs(a), cwd, slow ? INSTALL_TIMEOUT_MS : FAST_TIMEOUT_MS)
    this.available = undefined // installed flags and catalogs may have changed
    const output = [r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n')
    if (r.code !== 0) return { ok: false, message: firstLine(r) || `claude exited with code ${r.code}`, ...(output ? { output } : {}) }
    return { ok: true, output }
  }
}
