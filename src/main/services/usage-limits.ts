// Turns the SDK's structured usage reply (`get_usage`) into the rate-limit infos LimitsService ingests.
//
// Why: the SDK only emits `rate_limit_event` occasionally (near a threshold), so the status bar sat on "--" for
// most of a session. The usage reply carries the real 5-hour and weekly windows every time it is asked.

export interface IngestableLimit {
  rateLimitType: 'five_hour' | 'seven_day' | 'seven_day_opus' | 'seven_day_sonnet'
  status: 'allowed' | 'allowed_warning' | 'rejected'
  /** Fraction 0..1. The usage endpoint reports a percent; LimitsService reads values <= 1 as fractions. */
  utilization: number
  /** Epoch ms. */
  resetsAt?: number
}

const WINDOWS = [
  ['five_hour', 'five_hour'],
  ['seven_day', 'seven_day'],
  ['seven_day_opus', 'seven_day_opus'],
  ['seven_day_sonnet', 'seven_day_sonnet']
] as const

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

export function limitsFromUsage(resp: unknown): IngestableLimit[] {
  if (!isRecord(resp) || resp['rate_limits_available'] === false) return []
  const rl = resp['rate_limits']
  if (!isRecord(rl)) return []
  const out: IngestableLimit[] = []
  for (const [key, type] of WINDOWS) {
    const w = rl[key]
    if (!isRecord(w)) continue
    const u = w['utilization']
    if (typeof u !== 'number' || !Number.isFinite(u) || u < 0) continue
    const percent = Math.min(100, u)
    const at = typeof w['resets_at'] === 'string' ? Date.parse(w['resets_at']) : NaN
    out.push({
      rateLimitType: type,
      status: percent >= 100 ? 'rejected' : percent >= 80 ? 'allowed_warning' : 'allowed',
      utilization: percent / 100,
      ...(Number.isFinite(at) ? { resetsAt: at } : {})
    })
  }
  return out
}

/** Calls `fetchUsage` at most once per `minIntervalMs` and never concurrently; failures are swallowed (best effort). */
export function createUsageRefresher(
  fetchUsage: () => Promise<unknown>,
  onLimits: (l: IngestableLimit) => void,
  opts: { minIntervalMs?: number; now?: () => number } = {}
): () => Promise<void> {
  const minInterval = opts.minIntervalMs ?? 30_000
  const now = opts.now ?? Date.now
  let last = -Infinity
  let inFlight = false
  return async () => {
    if (inFlight || now() - last < minInterval) return
    inFlight = true
    last = now()
    try {
      for (const l of limitsFromUsage(await fetchUsage())) onLimits(l)
    } catch {
      /* experimental API: the bar just keeps its last value */
    } finally {
      inFlight = false
    }
  }
}
