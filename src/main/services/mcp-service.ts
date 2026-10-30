import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type {
  McpListResult,
  McpMutationResult,
  McpScope,
  McpServerEntry,
  McpTestResult,
  McpTransport
} from '../../shared/config'
import { normalizeCwdKey } from '../paths'
import type { ConfigPaths } from '../paths'
import { runClaude } from './claude-cli'
import type { CliResult, CliRunner } from './claude-cli'

type Cfg = Record<string, unknown>

/** Approval inputs for project (.mcp.json) servers, merged across settings files. */
export interface ApprovalSettings {
  enableAll?: boolean
  enabled: string[]
  disabled: string[]
}

export interface McpServiceDeps {
  paths: ConfigPaths
  run?: CliRunner
  /** Default reads user/project/local settings files directly. */
  approvalSettings?: (cwd: string | undefined) => Promise<ApprovalSettings>
  env?: NodeJS.ProcessEnv
}

const MUTATE_TIMEOUT = 30_000
const TEST_TIMEOUT = 45_000
const PRIORITY: Record<McpScope, number> = { local: 3, project: 2, user: 1 }

const isObj = (v: unknown): v is Cfg => typeof v === 'object' && v !== null && !Array.isArray(v)
const strArr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

async function readJson(file: string): Promise<{ data?: Cfg; error?: string }> {
  let text: string
  try {
    text = await readFile(file, 'utf8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {}
    return { error: `${file}: ${(err as Error).message}` }
  }
  try {
    const v: unknown = JSON.parse(text.replace(/^﻿/, ''))
    return isObj(v) ? { data: v } : { error: `${file}: not a JSON object` }
  } catch {
    return { error: `${file}: invalid JSON` }
  }
}

function transportOf(c: Cfg): McpTransport {
  const t = c['type']
  if (t === 'stdio' || t === 'sse' || t === 'http' || t === 'ws') return t
  if (typeof c['command'] === 'string') return 'stdio'
  return 'unknown'
}

/** Replace every env / header value of `config` found in `text` with `***`. */
export function maskSecrets(text: string, config?: Cfg): string {
  if (!config) return text
  let out = text
  for (const key of ['env', 'headers']) {
    const m = config[key]
    if (!isObj(m)) continue
    for (const v of Object.values(m)) {
      if (typeof v === 'string' && v.length >= 3) out = out.split(v).join('***')
    }
  }
  return out
}

/** Parse the `Status:` line of `claude mcp get`. */
export function parseStatus(output: string): Pick<McpTestResult, 'status' | 'detail'> {
  const clean = output.replace(/\u001b\[[0-9;]*m/g, '')
  const m = /^\s*Status:\s*(.*?)\s*$/m.exec(clean)
  const issue = /^\s*Issue:\s*(.*?)\s*$/m.exec(clean)?.[1]
  const detail = issue ?? m?.[1]
  const withDetail = (status: McpTestResult['status']): Pick<McpTestResult, 'status' | 'detail'> =>
    detail ? { status, detail } : { status }
  if (!m) return { status: 'unknown' }
  const s = m[1]!.toLowerCase()
  if (/needs?\s+auth|authenticat/.test(s)) return withDetail('needs_auth')
  if (/fail|error/.test(s)) return withDetail('failed')
  if (/pending|approval/.test(s)) return withDetail('pending')
  if (/connected/.test(s)) return withDetail('connected')
  return withDetail('unknown')
}

export class McpService {
  private readonly run: CliRunner
  private readonly paths: ConfigPaths
  private readonly approvalFn: (cwd: string | undefined) => Promise<ApprovalSettings>
  private readonly env: NodeJS.ProcessEnv | undefined
  private queue: Promise<unknown> = Promise.resolve()

  constructor(deps: McpServiceDeps) {
    this.paths = deps.paths
    this.run = deps.run ?? runClaude
    this.env = deps.env
    this.approvalFn = deps.approvalSettings ?? ((cwd) => this.readApprovalSettings(cwd))
  }

  // ---- reading (D6: files only; nothing but the MCP slices leaves this method) ----

  private async readApprovalSettings(cwd: string | undefined): Promise<ApprovalSettings> {
    const files = [this.paths.settingsFile('user')]
    if (cwd) files.push(this.paths.settingsFile('project', cwd), this.paths.settingsFile('local', cwd))
    const out: ApprovalSettings = { enabled: [], disabled: [] }
    for (const f of files) {
      const { data } = await readJson(f)
      if (!data) continue
      if (typeof data['enableAllProjectMcpServers'] === 'boolean') out.enableAll = data['enableAllProjectMcpServers']
      out.enabled.push(...strArr(data['enabledMcpjsonServers']))
      out.disabled.push(...strArr(data['disabledMcpjsonServers']))
    }
    return out
  }

  private async readSlices(cwd: string | undefined): Promise<{
    user: Record<string, Cfg>
    local: Record<string, Cfg>
    project: Record<string, Cfg>
    projEnabled: string[]
    projDisabled: string[]
    projectFile?: string
    errors: string[]
  }> {
    const errors: string[] = []
    const res = {
      user: {} as Record<string, Cfg>,
      local: {} as Record<string, Cfg>,
      project: {} as Record<string, Cfg>,
      projEnabled: [] as string[],
      projDisabled: [] as string[],
      errors
    } as Awaited<ReturnType<McpService['readSlices']>>
    const servers = (v: unknown): Record<string, Cfg> => {
      const o: Record<string, Cfg> = {}
      if (isObj(v)) for (const [k, c] of Object.entries(v)) if (isObj(c)) o[k] = c
      return o
    }
    const g = await readJson(this.paths.globalConfigPath)
    if (g.error) errors.push(g.error)
    if (g.data) {
      res.user = servers(g.data['mcpServers'])
      if (cwd && isObj(g.data['projects'])) {
        const want = normalizeCwdKey(cwd)
        for (const [key, entry] of Object.entries(g.data['projects'])) {
          if (!isObj(entry) || normalizeCwdKey(key) !== want) continue
          res.local = { ...res.local, ...servers(entry['mcpServers']) }
          res.projEnabled.push(...strArr(entry['enabledMcpjsonServers']))
          res.projDisabled.push(...strArr(entry['disabledMcpjsonServers']))
        }
      }
    }
    if (cwd) {
      const file = join(cwd, '.mcp.json')
      res.projectFile = file
      const p = await readJson(file)
      if (p.error) errors.push(p.error)
      if (p.data) res.project = servers(p.data['mcpServers'])
    }
    return res
  }

  async list(cwd?: string): Promise<McpListResult> {
    const s = await this.readSlices(cwd)
    const ap = cwd ? await this.approvalFn(cwd).catch((): ApprovalSettings => ({ enabled: [], disabled: [] })) : undefined
    const disabled = new Set([...s.projDisabled, ...(ap?.disabled ?? [])])
    const enabled = new Set([...s.projEnabled, ...(ap?.enabled ?? [])])
    const entries: McpServerEntry[] = []
    const add = (scope: McpScope, map: Record<string, Cfg>): void => {
      for (const [name, config] of Object.entries(map)) {
        const e: McpServerEntry = { name, scope, transport: transportOf(config), config }
        if (scope === 'project') {
          e.approval = disabled.has(name) ? 'rejected' : ap?.enableAll || enabled.has(name) ? 'approved' : 'pending'
        }
        entries.push(e)
      }
    }
    add('local', s.local)
    add('project', s.project)
    add('user', s.user)
    for (const e of entries) {
      let best: McpScope | undefined
      for (const o of entries) {
        if (o.name === e.name && PRIORITY[o.scope] > PRIORITY[e.scope] && (!best || PRIORITY[o.scope] > PRIORITY[best]))
          best = o.scope
      }
      if (best) e.shadowedBy = best
    }
    return {
      servers: entries,
      ...(s.projectFile ? { projectFile: s.projectFile } : {}),
      ...(s.errors.length ? { error: s.errors.join('; ') } : {})
    }
  }

  private async readOne(scope: McpScope, name: string, cwd: string | undefined): Promise<Cfg | undefined> {
    const s = await this.readSlices(cwd)
    return s[scope][name]
  }

  // ---- mutations (CLI) ----

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const p = this.queue.then(fn, fn)
    this.queue = p.catch(() => undefined)
    return p
  }

  private cliCwd(cwd: string | undefined): string {
    return cwd ?? dirname(this.paths.globalConfigPath)
  }

  private cli(args: string[], cwd: string | undefined, timeoutMs: number): Promise<CliResult> {
    return this.run(args, { cwd: this.cliCwd(cwd), ...(this.env ? { env: this.env } : {}), timeoutMs })
  }

  private checkArgs(scope: McpScope, cwd: string | undefined, ...names: string[]): string | undefined {
    if (scope !== 'user' && !cwd) return 'cwd is required for project and local scopes'
    for (const n of names) if (n.startsWith('-')) return `invalid server name: ${n}`
    return undefined
  }

  private text(r: CliResult, config?: Cfg): string {
    return maskSecrets([r.stdout.trim(), r.stderr.trim()].filter(Boolean).join('\n'), config)
  }

  private async addRaw(scope: McpScope, cwd: string | undefined, name: string, config: Cfg): Promise<McpMutationResult> {
    const r = await this.cli(['mcp', 'add-json', name, JSON.stringify(config), '-s', scope], cwd, MUTATE_TIMEOUT)
    const output = this.text(r, config)
    if (r.code === 0) return { ok: true, output }
    return { ok: false, message: output || `claude exited with code ${r.code}`, output }
  }

  private async removeRaw(scope: McpScope, cwd: string | undefined, name: string): Promise<McpMutationResult> {
    const r = await this.cli(['mcp', 'remove', name, '-s', scope], cwd, MUTATE_TIMEOUT)
    const output = this.text(r)
    if (r.code === 0) return { ok: true, output }
    return { ok: false, message: output || `claude exited with code ${r.code}`, output }
  }

  add(a: { scope: McpScope; cwd?: string | undefined; name: string; config: Cfg }): Promise<McpMutationResult> {
    const bad = this.checkArgs(a.scope, a.cwd, a.name)
    if (bad) return Promise.resolve({ ok: false, message: bad })
    // The CLI reports duplicates itself ("already exists"); its message is passed through.
    return this.serialize(() => this.addRaw(a.scope, a.cwd, a.name, a.config))
  }

  remove(a: { scope: McpScope; cwd?: string | undefined; name: string }): Promise<McpMutationResult> {
    const bad = this.checkArgs(a.scope, a.cwd, a.name)
    if (bad) return Promise.resolve({ ok: false, message: bad })
    return this.serialize(() => this.removeRaw(a.scope, a.cwd, a.name))
  }

  update(a: {
    scope: McpScope
    cwd?: string | undefined
    name: string
    newName?: string | undefined
    config: Cfg
  }): Promise<McpMutationResult> {
    const newName = a.newName ?? a.name
    const bad = this.checkArgs(a.scope, a.cwd, a.name, newName)
    if (bad) return Promise.resolve({ ok: false, message: bad })
    return this.serialize(async () => {
      const old = await this.readOne(a.scope, a.name, a.cwd)
      if (!old) return { ok: false, message: `No MCP server named "${a.name}" in ${a.scope} scope` }
      if (newName !== a.name && (await this.readOne(a.scope, newName, a.cwd)))
        return { ok: false, message: `MCP server ${newName} already exists in ${a.scope} config` }
      const rm = await this.removeRaw(a.scope, a.cwd, a.name)
      if (!rm.ok) return rm
      const added = await this.addRaw(a.scope, a.cwd, newName, a.config)
      if (added.ok) return { ok: true, output: [rm.output, added.output].filter(Boolean).join('\n') }
      const back = await this.addRaw(a.scope, a.cwd, a.name, old)
      const restored = back.ok ? 'The previous configuration was restored.' : `Rollback FAILED: ${back.ok ? '' : back.message}`
      return {
        ok: false,
        message: `${added.message}\n${restored}`,
        output: [added.output, back.output].filter(Boolean).join('\n')
      }
    })
  }

  async test(a: { cwd?: string | undefined; name: string }): Promise<McpTestResult> {
    const t0 = Date.now()
    const done = (r: Omit<McpTestResult, 'durationMs' | 'name'>): McpTestResult => ({
      name: a.name,
      ...r,
      durationMs: Date.now() - t0
    })
    if (a.name.startsWith('-')) return done({ status: 'unknown', detail: 'invalid server name', output: '' })
    const r = await this.cli(['mcp', 'get', a.name], a.cwd, TEST_TIMEOUT)
    // Exit 0 even when the connection fails; exit 1 means the name does not exist.
    const output = this.text(r)
    if (r.code !== 0) return done({ status: 'unknown', detail: output.split('\n')[0] || `exit ${r.code}`, output })
    return done({ ...parseStatus(output), output })
  }
}
