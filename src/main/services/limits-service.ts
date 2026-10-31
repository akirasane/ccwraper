import { readFileSync } from 'node:fs'
import { z } from 'zod'
import { isLimitKind, normalizeUtilization } from '../../shared/limits'
import type { LimitEntry, LimitKind, LimitStatus, LimitsState } from '../../shared/limits'
import { LIMIT_KINDS } from '../../shared/limits'
import { normalizeResetsAt } from '../../shared/rate-limit'
import { writeFileAtomic } from './atomic-write'

const STATUSES: readonly LimitStatus[] = ['allowed', 'allowed_warning', 'rejected']

const FileSchema = z.object({
  version: z.literal(1),
  limits: z.array(
    z.object({
      type: z.string(),
      usedPercent: z.number().finite().min(0).max(100).optional(),
      resetsAt: z.number().finite().positive().optional(),
      status: z.enum(['allowed', 'allowed_warning', 'rejected']),
      seenAt: z.number().finite().positive()
    })
  )
})

export interface LimitsServiceDeps {
  /** `<userData>/limits.json`. */
  file: string
  /** Pushes every change to the renderer. */
  broadcast: (state: LimitsState) => void
  now?: () => number
  log?: (msg: string) => void
}

/** A reset time that differs by less than this is the same window. */
const SAME_WINDOW_MS = 60_000

/**
 * Latest known subscription limits per type, aggregated over every session (latest event wins per type) and persisted
 * so the status bar has numbers right after a launch (marked stale until a fresh event arrives). Never throws.
 */
export class LimitsService {
  private entries = new Map<LimitKind, Omit<LimitEntry, 'stale'>>()
  private fresh = new Set<LimitKind>()
  private writeChain: Promise<unknown> = Promise.resolve()
  private readonly now: () => number

  constructor(private deps: LimitsServiceDeps) {
    this.now = deps.now ?? Date.now
    this.load()
  }

  private load(): void {
    try {
      const parsed = FileSchema.safeParse(JSON.parse(readFileSync(this.deps.file, 'utf8')))
      if (!parsed.success) return
      for (const e of parsed.data.limits) {
        if (!isLimitKind(e.type)) continue
        this.entries.set(e.type, {
          type: e.type,
          status: e.status,
          seenAt: e.seenAt,
          ...(e.usedPercent !== undefined ? { usedPercent: e.usedPercent } : {}),
          ...(e.resetsAt !== undefined ? { resetsAt: e.resetsAt } : {})
        })
      }
    } catch {
      /* missing or unreadable: start empty */
    }
  }

  getState(): LimitsState {
    const limits: LimitEntry[] = []
    for (const type of LIMIT_KINDS) {
      const e = this.entries.get(type)
      if (e) limits.push({ ...e, stale: !this.fresh.has(type) })
    }
    return { limits }
  }

  /** Feed an SDKRateLimitInfo-shaped object. Unknown shapes and types the bars do not use are ignored. */
  ingest(info: unknown): boolean {
    if (!info || typeof info !== 'object') return false
    const i = info as Record<string, unknown>
    const type = i['rateLimitType']
    if (!isLimitKind(type)) return false
    const status = STATUSES.find((s) => s === i['status'])
    if (!status) return false
    const resetsAt = normalizeResetsAt(i['resetsAt'])
    const prev = this.entries.get(type)
    const sameWindow = !prev || prev.resetsAt === undefined || resetsAt === undefined || Math.abs(prev.resetsAt - resetsAt) < SAME_WINDOW_MS
    let usedPercent = normalizeUtilization(i['utilization'])
    if (usedPercent === undefined && status === 'rejected') usedPercent = 100
    if (usedPercent === undefined && sameWindow) usedPercent = prev?.usedPercent
    const resetOut = resetsAt ?? prev?.resetsAt
    const next: Omit<LimitEntry, 'stale'> = {
      type,
      status,
      seenAt: this.now(),
      ...(usedPercent !== undefined ? { usedPercent } : {}),
      ...(resetOut !== undefined ? { resetsAt: resetOut } : {})
    }
    this.entries.set(type, next)
    this.fresh.add(type)
    this.persist()
    this.deps.broadcast(this.getState())
    return true
  }

  private persist(): void {
    const body = { version: 1, limits: [...this.entries.values()] }
    const write = this.writeChain.then(() => writeFileAtomic(this.deps.file, JSON.stringify(body) + '\n'))
    this.writeChain = write.catch((err) => this.deps.log?.(`limits.json not saved: ${err instanceof Error ? err.message : String(err)}`))
  }

  /** Resolves when every queued write finished (tests, quit). */
  flush(): Promise<void> {
    return this.writeChain.then(() => undefined)
  }
}
