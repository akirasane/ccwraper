import type { AutoResumeReport } from '@shared/app'
import { DEFAULT_AUTO_RESUME_PROMPT } from '@shared/app'

/** Wait this long after the stated reset before sending (clock skew; the limit window may roll a moment late). */
export const RESET_MARGIN_MS = 15_000
/** At most this many automatic resumes per session per rolling hour (loop guard). */
export const MAX_AUTO_RESUMES = 3
export const GUARD_WINDOW_MS = 3600_000
/** A pause whose reset passed this long ago (app was closed for days) is not auto-resumed. */
export const STALE_MS = 24 * 3600_000
export const TICK_MS = 1000

export interface Pause {
  convId: string
  sessionId?: string
  /** Epoch ms the limit resets; undefined = unknown (manual resume only). */
  resetAt?: number
  limitType?: string
  /** The user pressed Cancel. */
  cancelled: boolean
  /** Why automatic resume gave up on this pause. */
  blocked?: 'loop' | 'stale'
  /** A 'paused' report was already sent for it. */
  announced: boolean
}

export interface PersistedPause {
  convId: string
  sessionId: string
  resetAt: number
  limitType?: string
  cancelled?: boolean
}

export interface PersistedAutoResume {
  pauses: PersistedPause[]
  /** session key -> timestamps of automatic resumes */
  history: Record<string, number[]>
}

export interface ControllerDeps {
  now: () => number
  setInterval: (fn: () => void, ms: number) => unknown
  clearInterval: (h: unknown) => void
  getPrefs: () => { enabled: boolean; prompt: string }
  /** Send the continuation prompt to the conversation (resumes its session if needed). */
  resume: (convId: string, prompt: string) => Promise<void>
  titleOf: (convId: string) => string | undefined
  report: (r: AutoResumeReport) => void
  load: () => PersistedAutoResume | undefined
  save: (p: PersistedAutoResume) => void
  /** View update (pauses by conversation). */
  onChange: (pauses: Record<string, Pause>) => void
}

export interface LimitInfo {
  resetsAt?: number
  limitType?: string
  sessionId?: string
}

/**
 * Pauses and the auto-resume decision (WP14). Pure logic over injected clock/timers so it is testable with fake
 * timers. One 1 s tick compares the wall clock with each target instead of one long setTimeout, so a system
 * sleep or a clock change cannot make it fire early or miss the reset.
 */
export class AutoResumeController {
  private pauses = new Map<string, Pause>()
  private history: Record<string, number[]> = {}
  private timer: unknown
  private lastPending = 0
  private ticking = false

  constructor(private deps: ControllerDeps) {}

  /** Rebuild pauses saved by a previous run. Returns them so the caller can show the limit state on the tabs. */
  /** `resolve` maps a saved (convId, sessionId) to the conversation that exists now (a restored tab is `hist-<sessionId>`). */
  restore(resolve: (convId: string, sessionId: string) => string | undefined): Pause[] {
    const saved = this.deps.load()
    if (!saved) return []
    this.history = pruneHistory(saved.history, this.deps.now())
    const out: Pause[] = []
    for (const p of saved.pauses) {
      const convId = resolve(p.convId, p.sessionId)
      if (!convId || this.pauses.has(convId)) continue
      const pause: Pause = {
        convId,
        sessionId: p.sessionId,
        resetAt: p.resetAt,
        ...(p.limitType ? { limitType: p.limitType } : {}),
        cancelled: p.cancelled === true,
        announced: false
      }
      this.pauses.set(convId, pause)
      out.push(pause)
    }
    this.afterChange()
    return out
  }

  get(convId: string): Pause | undefined {
    return this.pauses.get(convId)
  }

  /** A turn was stopped by a usage limit. Idempotent for the same reset time. */
  noteLimit(convId: string, info: LimitInfo): void {
    const old = this.pauses.get(convId)
    if (old && old.resetAt === info.resetsAt) {
      if (info.sessionId && !old.sessionId) old.sessionId = info.sessionId
      return
    }
    this.pauses.set(convId, {
      convId,
      ...(info.sessionId ? { sessionId: info.sessionId } : {}),
      ...(info.resetsAt !== undefined ? { resetAt: info.resetsAt } : {}),
      ...(info.limitType ? { limitType: info.limitType } : {}),
      cancelled: false,
      announced: false
    })
    this.afterChange()
  }

  /** The limit state ended (a new turn started, or the tab closed). Nothing is sent. */
  drop(convId: string): void {
    if (this.pauses.delete(convId)) this.afterChange()
  }

  cancel(convId: string): void {
    const p = this.pauses.get(convId)
    if (!p || p.cancelled) return
    p.cancelled = true
    this.afterChange()
  }

  /** Manual "Resume now": sends the continuation prompt immediately (not counted by the loop guard). */
  async resumeNow(convId: string): Promise<void> {
    this.pauses.delete(convId)
    this.afterChange()
    await this.deps.resume(convId, this.prompt())
  }

  /** Prefs changed: arm or disarm what is waiting. */
  refresh(): void {
    this.afterChange()
  }

  /** Is this pause going to resume by itself right now? */
  isArmed(p: Pause): boolean {
    return this.deps.getPrefs().enabled && !p.cancelled && p.resetAt !== undefined && !p.blocked
  }

  fireAt(p: Pause): number | undefined {
    return p.resetAt === undefined ? undefined : p.resetAt + RESET_MARGIN_MS
  }

  /** Auto-resumes still allowed for this session in the current hour. */
  allowance(key: string): number {
    const now = this.deps.now()
    return Math.max(0, MAX_AUTO_RESUMES - (this.history[key] ?? []).filter((t) => now - t < GUARD_WINDOW_MS).length)
  }

  dispose(): void {
    this.stopTimer()
    this.pauses.clear()
  }

  /** One scheduler step; exported through the timer, callable directly in tests. */
  tick(): void {
    const now = this.deps.now()
    const due: Pause[] = []
    let changed = false
    for (const p of this.pauses.values()) {
      const at = this.fireAt(p)
      if (at === undefined || p.cancelled || p.blocked || now < at) continue
      if (!this.deps.getPrefs().enabled) continue
      if (now - at > STALE_MS) {
        p.blocked = 'stale'
        changed = true
        continue
      }
      const key = p.sessionId ?? p.convId
      if (this.allowance(key) <= 0) {
        p.blocked = 'loop'
        changed = true
        continue
      }
      due.push(p)
    }
    for (const p of due) {
      const key = p.sessionId ?? p.convId
      this.history[key] = [...(this.history[key] ?? []).filter((t) => now - t < GUARD_WINDOW_MS), now]
      this.pauses.delete(p.convId)
      changed = true
      const title = this.deps.titleOf(p.convId)
      this.deps.report({
        kind: 'resumed',
        pending: this.countArmed(),
        ...(title ? { title } : {}),
        ...(p.resetAt !== undefined ? { resetAt: p.resetAt } : {})
      })
      this.lastPending = this.countArmed()
      this.deps.resume(p.convId, this.prompt()).catch(() => {
        /* the chat store shows the failure as an error item */
      })
    }
    if (changed) this.afterChange()
  }

  private prompt(): string {
    return this.deps.getPrefs().prompt.trim() || DEFAULT_AUTO_RESUME_PROMPT
  }

  private countArmed(): number {
    let n = 0
    for (const p of this.pauses.values()) if (this.isArmed(p)) n++
    return n
  }

  private afterChange(): void {
    // Announce what just became armed (a new limit with auto-resume on, or the toggle switched on).
    for (const p of this.pauses.values()) {
      if (!p.announced && this.isArmed(p)) {
        p.announced = true
        const title = this.deps.titleOf(p.convId)
        this.lastPending = this.countArmed()
        this.deps.report({
          kind: 'paused',
          pending: this.lastPending,
          ...(title ? { title } : {}),
          ...(p.resetAt !== undefined ? { resetAt: p.resetAt } : {})
        })
      } else if (p.announced && !this.isArmed(p)) {
        p.announced = false
      }
    }
    const pending = this.countArmed()
    if (pending !== this.lastPending) {
      this.lastPending = pending
      this.deps.report({ kind: 'update', pending })
    }
    this.persist()
    if (this.pauses.size > 0) this.startTimer()
    else this.stopTimer()
    // Copies: a store selector must see a new object when a pause is mutated in place.
    this.deps.onChange(Object.fromEntries([...this.pauses].map(([k, v]) => [k, { ...v }])))
  }

  private persist(): void {
    const pauses: PersistedPause[] = []
    for (const p of this.pauses.values()) {
      if (p.resetAt === undefined || !p.sessionId) continue
      pauses.push({
        convId: p.convId,
        sessionId: p.sessionId,
        resetAt: p.resetAt,
        ...(p.limitType ? { limitType: p.limitType } : {}),
        ...(p.cancelled ? { cancelled: true } : {})
      })
    }
    try {
      this.deps.save({ pauses, history: pruneHistory(this.history, this.deps.now()) })
    } catch {
      /* storage unavailable: pauses just will not survive a restart */
    }
  }

  private startTimer(): void {
    if (this.ticking) return
    this.ticking = true
    this.timer = this.deps.setInterval(() => this.tick(), TICK_MS)
  }

  private stopTimer(): void {
    if (!this.ticking) return
    this.ticking = false
    this.deps.clearInterval(this.timer)
    this.timer = undefined
  }
}

function pruneHistory(h: Record<string, number[]>, now: number): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const [k, v] of Object.entries(h)) {
    const keep = v.filter((t) => typeof t === 'number' && now - t < GUARD_WINDOW_MS)
    if (keep.length) out[k] = keep
  }
  return out
}
