import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { FsChangedPayload, McpScope, MemoryScope, SettingsScope } from '../../shared/config'
import { normalizeCwdKey } from '../paths'
import type { ConfigPaths } from '../paths'
import { sha256 } from './config-service'

/** The slice of chokidar's FSWatcher we use (a fake in unit tests). */
export interface WatcherLike {
  add(paths: string | string[]): unknown
  unwatch(paths: string | string[]): unknown
  on(event: string, cb: (...args: any[]) => void): unknown
  close(): Promise<void>
}
export type WatcherFactory = () => Promise<WatcherLike>

export const defaultWatcherFactory: WatcherFactory = async () => {
  // chokidar 6 is ESM-only; main is bundled CJS, so load it dynamically (same pattern as the SDK).
  const { watch } = await import('chokidar')
  return watch([], { ignoreInitial: true, atomic: true }) as unknown as WatcherLike
}

/** What ConfigService exposes for own-write suppression. */
export interface OwnWrites {
  isOwnWrite(path: string, hash: string | null): boolean
  clearOwnWrite(path: string): void
}

export interface ConfigWatcherOptions {
  factory?: WatcherFactory
  /** Per-path debounce (default 150 ms). */
  debounceMs?: number
  /** Debounce for the CLI's global .claude.json, which is rewritten constantly (default 500 ms). */
  globalDebounceMs?: number
}

type Target =
  | { kind: 'settings'; scope: SettingsScope; cwd?: string }
  | { kind: 'memory'; scope: MemoryScope; cwd?: string }
  | { kind: 'mcp'; scope: McpScope | undefined; cwd?: string; global?: boolean }

function stableStringify(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(',')}]`
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v) ?? 'null'
}

/**
 * The only parts of the global .claude.json the app cares about: top-level mcpServers plus the active
 * project's mcpServers / enabledMcpjsonServers / disabledMcpjsonServers (key matched with normalizeCwdKey).
 * Returns a stable string; throws on unparsable input.
 */
export function mcpSliceOf(text: string, cwd: string | undefined): string {
  const json = JSON.parse(text) as Record<string, unknown>
  const projects = (json['projects'] && typeof json['projects'] === 'object' ? json['projects'] : {}) as Record<string, unknown>
  let proj: Record<string, unknown> = {}
  if (cwd) {
    const want = normalizeCwdKey(cwd)
    for (const [k, v] of Object.entries(projects)) {
      if (normalizeCwdKey(k) === want && v && typeof v === 'object') {
        proj = v as Record<string, unknown>
        break
      }
    }
  }
  return stableStringify({
    mcpServers: json['mcpServers'] ?? null,
    project: {
      mcpServers: proj['mcpServers'] ?? null,
      enabledMcpjsonServers: proj['enabledMcpjsonServers'] ?? null,
      disabledMcpjsonServers: proj['disabledMcpjsonServers'] ?? null
    }
  })
}

export class ConfigWatcher {
  private watcher: WatcherLike | undefined
  private readonly targets = new Map<string, Target>() // normalized path -> target
  private readonly rawPaths = new Map<string, string>() // normalized path -> path as given
  private projectKeys: string[] = []
  private cwd: string | undefined
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly lastHash = new Map<string, string | null>()
  private lastSlice: string | undefined
  private chain: Promise<unknown> = Promise.resolve()
  private closed = false

  constructor(
    private readonly paths: ConfigPaths,
    private readonly own: OwnWrites,
    private readonly emit: (p: FsChangedPayload) => void,
    private readonly opts: ConfigWatcherOptions = {}
  ) {}

  /** Start watching the always-on files: user settings, user CLAUDE.md, the global .claude.json. */
  start(): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureWatcher()
      this.register(this.paths.settingsFile('user'), { kind: 'settings', scope: 'user' })
      this.register(this.paths.memoryFile('user'), { kind: 'memory', scope: 'user' })
      this.register(this.paths.globalConfigPath, { kind: 'mcp', scope: undefined, global: true })
      this.watcher!.add([...this.rawPaths.values()])
      await this.baselineSlice()
    })
  }

  /** Switch the watched project (null = none). Replaces the previous project's files. */
  setProject(cwd: string | null): Promise<void> {
    return this.enqueue(async () => {
      await this.ensureWatcher()
      if (this.projectKeys.length) {
        this.watcher!.unwatch(this.projectKeys.map((k) => this.rawPaths.get(k)!).filter(Boolean))
        for (const k of this.projectKeys) {
          this.targets.delete(k)
          this.rawPaths.delete(k)
          this.lastHash.delete(k)
          const t = this.timers.get(k)
          if (t) clearTimeout(t)
          this.timers.delete(k)
        }
        this.projectKeys = []
      }
      this.cwd = cwd ?? undefined
      if (cwd) {
        const files: Array<[string, Target]> = [
          [this.paths.settingsFile('project', cwd), { kind: 'settings', scope: 'project', cwd }],
          [this.paths.settingsFile('local', cwd), { kind: 'settings', scope: 'local', cwd }],
          [join(cwd, '.mcp.json'), { kind: 'mcp', scope: 'project', cwd }],
          [this.paths.memoryFile('project', cwd), { kind: 'memory', scope: 'project', cwd }],
          [this.paths.memoryFile('projectDotClaude', cwd), { kind: 'memory', scope: 'projectDotClaude', cwd }],
          [this.paths.memoryFile('local', cwd), { kind: 'memory', scope: 'local', cwd }]
        ]
        for (const [p, t] of files) this.projectKeys.push(this.register(p, t))
        this.watcher!.add(files.map(([p]) => p))
      }
      await this.baselineSlice()
    })
  }

  async close(): Promise<void> {
    this.closed = true
    for (const t of this.timers.values()) clearTimeout(t)
    this.timers.clear()
    await this.chain.catch(() => undefined)
    const w = this.watcher
    this.watcher = undefined
    await w?.close()
  }

  private enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(() => (this.closed ? undefined : fn()))
    this.chain = next.catch(() => undefined)
    return next
  }

  private register(path: string, t: Target): string {
    const key = normalizeCwdKey(path)
    this.targets.set(key, t)
    this.rawPaths.set(key, path)
    return key
  }

  private async ensureWatcher(): Promise<void> {
    if (this.watcher) return
    const w = await (this.opts.factory ?? defaultWatcherFactory)()
    for (const ev of ['add', 'change', 'unlink'] as const) w.on(ev, (p: string) => this.onEvent(p))
    w.on('error', (err: unknown) => console.warn('[ccwrap] config watcher error', err instanceof Error ? err.message : err))
    this.watcher = w
  }

  private async baselineSlice(): Promise<void> {
    try {
      this.lastSlice = mcpSliceOf(await readFile(this.paths.globalConfigPath, 'utf8'), this.cwd)
    } catch {
      this.lastSlice = undefined
    }
  }

  private onEvent(path: string): void {
    if (this.closed) return
    const key = normalizeCwdKey(path)
    const target = this.targets.get(key)
    if (!target) return
    const ms = (target.kind === 'mcp' && target.global ? this.opts.globalDebounceMs : this.opts.debounceMs) ?? (target.kind === 'mcp' && target.global ? 500 : 150)
    const prev = this.timers.get(key)
    if (prev) clearTimeout(prev)
    this.timers.set(
      key,
      setTimeout(() => {
        this.timers.delete(key)
        void this.settle(key, target).catch((err) => console.warn('[ccwrap] watcher settle failed', err instanceof Error ? err.message : err))
      }, ms)
    )
  }

  private async settle(key: string, target: Target): Promise<void> {
    const path = this.rawPaths.get(key)
    if (!path || this.closed) return
    let buf: Buffer | undefined
    try {
      buf = await readFile(path)
    } catch {
      buf = undefined
    }
    const hash = buf ? sha256(buf) : null
    if (this.lastHash.has(key) && this.lastHash.get(key) === hash) return
    if (this.own.isOwnWrite(path, hash)) {
      this.lastHash.set(key, hash)
      return
    }
    this.lastHash.set(key, hash)
    this.own.clearOwnWrite(path)

    if (target.kind === 'mcp' && target.global) {
      if (!buf) return
      let slice: string
      try {
        slice = mcpSliceOf(buf.toString('utf8'), this.cwd)
      } catch {
        return // mid-write / unparsable: wait for the next event
      }
      if (slice === this.lastSlice) return
      this.lastSlice = slice
      this.emit({ kind: 'mcp', ...(this.cwd ? { cwd: this.cwd } : {}), path })
      return
    }
    const payload: FsChangedPayload = {
      kind: target.kind,
      ...(target.scope ? { scope: target.scope } : {}),
      ...(target.cwd ? { cwd: target.cwd } : {}),
      path
    }
    this.emit(payload)
  }
}
