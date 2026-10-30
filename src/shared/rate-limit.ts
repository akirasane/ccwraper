// Usage-limit signal helpers (P4 WP14). Pure, zod-free, no SDK imports.
//
// Facts (SDK 0.x typings, node_modules/@anthropic-ai/claude-agent-sdk/sdk.d.ts):
//  - `SDKRateLimitEvent { type: 'rate_limit_event', rate_limit_info: SDKRateLimitInfo }` is emitted when limit info changes.
//    `SDKRateLimitInfo.status` is 'allowed' | 'allowed_warning' | 'rejected'; `resetsAt?: number` (unix epoch SECONDS);
//    `rateLimitType?: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'seven_day_overage_included' | 'overage'`.
//  - A turn stopped by a limit ends with an assistant message carrying `error: 'rate_limit'` (the same code is used for a
//    plain API 429, so it is NOT enough on its own) and a `result` with `is_error: true`. The human text the CLI prints is
//    like "5-hour limit reached ∙ resets 4:10pm (Asia/Bangkok)".
//  - Where `resetsAt` is missing the reset time exists only as that text, which `parseLimitReset` reads.

export type LimitType = 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet' | 'other'

/** Unix epoch seconds (SDK) or milliseconds -> milliseconds. Anything implausible gives undefined. */
export function normalizeResetsAt(n: unknown): number | undefined {
  if (typeof n !== 'number' || !Number.isFinite(n) || n <= 0) return undefined
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n)
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const MAX_AHEAD_MS = 8 * 24 * 3600 * 1000

/** Does this text read like a subscription-limit stop (as opposed to a transient 429)? */
export function looksLikeUsageLimit(text: string | undefined): boolean {
  if (!text) return false
  return /(usage|hour|weekly|week|daily|monthly|opus|sonnet)?\s*limit\s+(reached|hit|exceeded)|hit your (\w+\s+)?limit|usage limit|limit will reset|\bresets?\b.*\d/i.test(
    text
  )
}

/** Best-effort limit kind from the text ("5-hour limit", "weekly limit", "Opus limit"). */
export function limitTypeFromText(text: string | undefined): LimitType | undefined {
  if (!text) return undefined
  if (/opus/i.test(text) && /week|7|seven/i.test(text)) return 'seven_day_opus'
  if (/sonnet/i.test(text) && /week|7|seven/i.test(text)) return 'seven_day_sonnet'
  if (/5[-\s]?hour|five[-\s]?hour/i.test(text)) return 'five_hour'
  if (/week|7[-\s]?day|seven[-\s]?day/i.test(text)) return 'seven_day'
  return undefined
}

interface Wall {
  y: number
  m: number // 0-based
  d: number
  h: number
  mi: number
  s: number
}

function dtf(tz: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric'
  })
}

function wallOf(ts: number, fmt: Intl.DateTimeFormat): Wall {
  const p: Record<string, number> = {}
  for (const part of fmt.formatToParts(new Date(ts))) if (part.type !== 'literal') p[part.type] = Number(part.value)
  return { y: p['year']!, m: p['month']! - 1, d: p['day']!, h: p['hour']! % 24, mi: p['minute']!, s: p['second']! }
}

const asUtc = (w: Wall): number => Date.UTC(w.y, w.m, w.d, w.h, w.mi, w.s)

/** Wall-clock time in `tz` -> epoch ms (handles DST by re-checking the offset once). */
function zonedToEpoch(w: Wall, fmt: Intl.DateTimeFormat): number {
  let guess = asUtc(w)
  for (let i = 0; i < 2; i++) {
    const offset = asUtc(wallOf(guess, fmt)) - guess
    guess = asUtc(w) - offset
  }
  return guess
}

interface ParsedClock {
  month?: number
  day?: number
  hour: number
  minute: number
}

function parseClock(raw: string): ParsedClock | undefined {
  let s = raw.trim().replace(/\s+/g, ' ')
  let month: number | undefined
  let day: number | undefined
  // "Oct 9, 3pm" / "Oct 9 at 3pm" / "9 Oct 3pm"
  const md = /^(?:[A-Za-z]{3,9},?\s+)?([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?\b,?\s*(?:at\s+)?/.exec(s)
  const dm = /^(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s*(?:at\s+)?/.exec(s)
  if (md && MONTHS.includes(md[1]!.slice(0, 3).toLowerCase())) {
    month = MONTHS.indexOf(md[1]!.slice(0, 3).toLowerCase())
    day = Number(md[2])
    s = s.slice(md[0].length)
  } else if (dm && MONTHS.includes(dm[2]!.slice(0, 3).toLowerCase())) {
    month = MONTHS.indexOf(dm[2]!.slice(0, 3).toLowerCase())
    day = Number(dm[1])
    s = s.slice(dm[0].length)
  }
  const t = /^(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m?\.?/i.exec(s)
  let hour: number
  let minute: number
  if (t) {
    hour = Number(t[1])
    minute = t[2] ? Number(t[2]) : 0
    if (hour < 1 || hour > 12) return undefined
    const pm = t[3]!.toLowerCase() === 'p'
    hour = (hour % 12) + (pm ? 12 : 0)
  } else {
    const t24 = /^(\d{1,2}):(\d{2})\b/.exec(s)
    if (!t24) return undefined // "resets 4" is ambiguous: fail safe
    hour = Number(t24[1])
    minute = Number(t24[2])
  }
  if (hour > 23 || minute > 59) return undefined
  if (month !== undefined && day !== undefined && (day < 1 || day > 31)) return undefined
  return { ...(month !== undefined ? { month, day } : {}), hour, minute }
}

/**
 * Reset time (epoch ms) from the CLI's limit text, or undefined when it cannot be read with confidence.
 * Accepts "...|1760000000" (epoch seconds), "resets 4:10pm (Asia/Bangkok)", "resets Oct 9, 3pm (America/New_York)",
 * "will reset at 16:10". Without a date the NEXT occurrence of the clock time after `now` is taken; with a date the next
 * occurrence of that date (this year, else next). Results in the past or more than 8 days ahead are rejected.
 * `defaultTz` is used when the text names no zone (default: the runtime's zone).
 */
export function parseLimitReset(text: string | undefined, now: number, defaultTz?: string): number | undefined {
  if (!text) return undefined
  const pipe = /\|\s*(\d{9,13})\b/.exec(text)
  if (pipe) {
    const ms = normalizeResetsAt(Number(pipe[1]))
    return ms !== undefined && ms > now - 60_000 && ms - now <= MAX_AHEAD_MS ? ms : undefined
  }
  const m = /\bresets?(?:\s+(?:at|on))?\s+(.+?)(?:\s*\(([A-Za-z][A-Za-z0-9_+\-/]*)\))?\s*(?:[.;\n]|$)/i.exec(text)
  if (!m) return undefined
  const clock = parseClock(m[1]!)
  if (!clock) return undefined
  const tz = m[2] ?? defaultTz ?? Intl.DateTimeFormat().resolvedOptions().timeZone
  let fmt: Intl.DateTimeFormat
  try {
    fmt = dtf(tz)
  } catch {
    return undefined
  }
  const today = wallOf(now, fmt)
  let at: number
  if (clock.month !== undefined && clock.day !== undefined) {
    at = zonedToEpoch({ y: today.y, m: clock.month, d: clock.day, h: clock.hour, mi: clock.minute, s: 0 }, fmt)
    if (at <= now - 60_000) {
      at = zonedToEpoch({ y: today.y + 1, m: clock.month, d: clock.day, h: clock.hour, mi: clock.minute, s: 0 }, fmt)
    }
  } else {
    at = zonedToEpoch({ ...today, h: clock.hour, mi: clock.minute, s: 0 }, fmt)
    if (at <= now) {
      const next = new Date(Date.UTC(today.y, today.m, today.d + 1))
      at = zonedToEpoch(
        { y: next.getUTCFullYear(), m: next.getUTCMonth(), d: next.getUTCDate(), h: clock.hour, mi: clock.minute, s: 0 },
        fmt
      )
    }
  }
  if (!(at > now - 60_000) || at - now > MAX_AHEAD_MS) return undefined
  return at
}
