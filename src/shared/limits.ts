// Subscription usage limits shown in the status bar. Pure and zod-free (the sandboxed preload bundles it).
//
// Source: the SDK `rate_limit_event` (SDKRateLimitInfo). Its `utilization` has NO documented unit in sdk.d.ts
// (the /usage endpoint types, in contrast, say "Percentage of the window used, 0-100"). The CLI emits the event with a
// 0..1 fraction, so normalizeUtilization() reads a value <= 1 as a fraction and a value > 1 as an already-percent
// number, then clamps to 0..100. (The only ambiguous input is exactly 1: taken as 100%.)

export type LimitKind = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
export type LimitStatus = 'allowed' | 'allowed_warning' | 'rejected'

export const LIMIT_KINDS: readonly LimitKind[] = ['five_hour', 'seven_day', 'seven_day_opus', 'seven_day_sonnet']

export interface LimitEntry {
  type: LimitKind
  /** 0..100, undefined when the event carried no utilization. */
  usedPercent?: number
  /** Epoch ms of the window reset. */
  resetsAt?: number
  status: LimitStatus
  /** Epoch ms when main last received (or, after a restart, last persisted) this value. */
  seenAt: number
  /** True when the value came from disk and no fresh event has arrived since launch. */
  stale: boolean
}

export interface LimitsState {
  limits: LimitEntry[]
}

export const EMPTY_LIMITS: LimitsState = { limits: [] }

export function isLimitKind(v: unknown): v is LimitKind {
  return typeof v === 'string' && (LIMIT_KINDS as readonly string[]).includes(v)
}

/** SDK utilization (fraction 0..1 or percent 0..100) -> clamped percent; undefined when not a finite number. */
export function normalizeUtilization(u: unknown): number | undefined {
  if (typeof u !== 'number' || !Number.isFinite(u) || u < 0) return undefined
  const pct = u <= 1 ? u * 100 : u
  return Math.min(100, Math.max(0, pct))
}

export type LimitLevel = 'ok' | 'warn' | 'danger'

/** ok < 70, warn 70..<90, danger >= 90. */
export function limitLevel(percent: number): LimitLevel {
  if (percent >= 90) return 'danger'
  if (percent >= 70) return 'warn'
  return 'ok'
}

export interface LimitView {
  type: LimitKind
  /** Rounded 0..100; 0 once the window has reset; undefined when unknown. */
  percent: number | undefined
  resetsAt: number | undefined
  /** The reset time has passed: the old usage no longer applies. */
  expired: boolean
  stale: boolean
  seenAt: number
  status: LimitStatus
  level: LimitLevel
}

/** Applies the clock: a passed reset shows 0% / "reset" instead of the stale usage. */
export function viewLimit(e: LimitEntry, now: number): LimitView {
  const expired = e.resetsAt !== undefined && e.resetsAt <= now
  const percent = expired ? 0 : e.usedPercent === undefined ? undefined : Math.round(e.usedPercent)
  return {
    type: e.type,
    percent,
    resetsAt: e.resetsAt,
    expired,
    stale: e.stale && !expired,
    seenAt: e.seenAt,
    status: expired ? 'allowed' : e.status,
    level: percent === undefined ? 'ok' : limitLevel(percent)
  }
}

/** "1h23m", "23m", "2d4h", "<1m". */
export function formatCountdown(ms: number): string {
  if (ms < 60_000) return '<1m'
  const totalMin = Math.floor(ms / 60_000)
  const d = Math.floor(totalMin / 1440)
  const h = Math.floor((totalMin % 1440) / 60)
  const m = totalMin % 60
  if (d > 0) return `${d}d${h}h`
  if (h > 0) return `${h}h${String(m).padStart(2, '0')}m`
  return `${m}m`
}

/** Local "HH:MM". */
export function formatClock(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// ---- caveman badge ----

export const CAVEMAN_MODES = [
  'off',
  'lite',
  'full',
  'ultra',
  'wenyan-lite',
  'wenyan',
  'wenyan-full',
  'wenyan-ultra',
  'commit',
  'review',
  'compress'
] as const

/** `mode` is null (badge hidden) when the plugin's files are missing, unreadable, unknown or "off". */
export interface CavemanState {
  mode: string | null
  suffix: string | null
}

export const EMPTY_CAVEMAN: CavemanState = { mode: null, suffix: null }
