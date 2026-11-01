import { tmpdir } from 'node:os'
import { resolveClaudeExecutable } from '../paths'
import { limitsFromUsage, type IngestableLimit } from './usage-limits'

// Keeps the 5h / weekly status bars current without any chat. One idle SDK session (no prompt is ever sent, so no
// model call, no transcript, no cost) answers the structured `get_usage` request on a timer. Verified: an idle
// query answers in under a second and writes nothing under ~/.claude/projects.

export const DEFAULT_INTERVAL_MS = 30_000
const MAX_BACKOFF_MS = 5 * 60_000
/** Focus / pref changes cannot trigger fetches closer together than this. */
const MIN_GAP_MS = 5_000

type UsageQuery = {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (o: { skipBehaviors: boolean }) => Promise<unknown>
  close?: () => void
}
export type ProbeQueryFn = (args: { prompt: AsyncIterable<never>; options: Record<string, unknown> }) => UsageQuery

export interface UsageProbeDeps {
  ingest: (l: IngestableLimit) => void
  /** Read on every tick: the probe closes its session while this is false (status bar limits turned off). */
  enabled: () => boolean
  intervalMs?: number
  /** Test seam: replaces the SDK's query(). */
  queryImpl?: ProbeQueryFn
  claudePath?: string
  log?: (msg: string) => void
}

export class UsageProbe {
  private q: UsageQuery | undefined
  private release: (() => void) | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private disposed = false
  private failures = 0
  private lastAt = 0

  constructor(private deps: UsageProbeDeps) {}

  /** First fetch right away, then every interval. */
  start(): void {
    this.schedule(0)
  }

  /** Fetch now (e.g. the window regained focus); no-op while a fetch is running. */
  refreshNow(): void {
    if (this.disposed || this.running || Date.now() - this.lastAt < MIN_GAP_MS) return
    this.schedule(0)
  }

  dispose(): void {
    this.disposed = true
    if (this.timer) clearTimeout(this.timer)
    this.closeQuery()
  }

  private schedule(ms: number): void {
    if (this.disposed) return
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => void this.tick(), ms)
    this.timer.unref?.()
  }

  private closeQuery(): void {
    this.release?.()
    this.release = undefined
    try {
      this.q?.close?.()
    } catch {
      /* already gone */
    }
    this.q = undefined
  }

  private async open(): Promise<UsageQuery> {
    const hold = new Promise<void>((r) => (this.release = r))
    async function* idle(): AsyncGenerator<never> {
      await hold
    }
    const queryFn = this.deps.queryImpl ?? ((await import('@anthropic-ai/claude-agent-sdk')).query as unknown as ProbeQueryFn)
    const claudePath = this.deps.claudePath ?? (this.deps.queryImpl ? undefined : resolveClaudeExecutable())
    return queryFn({
      prompt: idle(),
      options: {
        cwd: tmpdir(), // no project settings
        permissionMode: 'plan',
        settingSources: [], // no hooks, plugins or MCP servers: this session only reports usage
        tools: [],
        persistSession: false,
        ...(claudePath ? { pathToClaudeCodeExecutable: claudePath } : {})
      }
    })
  }

  private async tick(): Promise<void> {
    if (this.running || this.disposed) return
    this.running = true
    try {
      if (!this.deps.enabled()) {
        this.closeQuery()
        this.failures = 0
        return
      }
      this.q ??= await this.open()
      const fn = this.q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET
      if (typeof fn !== 'function') throw new Error('this Claude Code version has no usage API')
      const resp = await fn.call(this.q, { skipBehaviors: true })
      for (const l of limitsFromUsage(resp)) this.deps.ingest(l)
      this.failures = 0
    } catch (err) {
      this.failures += 1
      this.closeQuery() // a dead process is replaced on the next attempt
      this.deps.log?.(`usage probe failed (${this.failures}): ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      this.running = false
      this.lastAt = Date.now()
      const base = this.deps.intervalMs ?? DEFAULT_INTERVAL_MS
      this.schedule(Math.min(MAX_BACKOFF_MS, base * 2 ** Math.min(this.failures, 4)))
    }
  }
}
