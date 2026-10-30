import type { SessionStatus } from '@shared/events'
import type { TaskView } from '../model/types'

/** 842 -> "842", 1234 -> "1.2k", 20726 -> "20.7k", 123456 -> "123k", 1.5M -> "1.5M". */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n))
  if (v < 1000) return String(v)
  if (v < 100_000) return `${(Math.floor(v / 100) / 10).toFixed(1)}k`
  if (v < 1_000_000) return `${Math.round(v / 1000)}k`
  return `${(Math.floor(v / 100_000) / 10).toFixed(1)}M`
}

/** Whole seconds: "12s", "1m 05s", "1h 02m". */
export function formatElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${String(s % 60).padStart(2, '0')}s`
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`
}

export const TOKEN_ESTIMATE_TIP =
  'Estimated from streamed text (about 4 characters per token). The exact count arrives when the message completes.'

export const isLiveTask = (t: TaskView): boolean =>
  t.status === 'running' || t.status === 'pending' || t.status === 'stopping' || t.status === 'paused'

/**
 * A task the session can no longer be running: the session errored out, so no task event will ever arrive.
 * Renderer-side rule (there is no explicit "session closed" event): derived, so a later `running` status
 * brings the card back to running.
 */
export const isLostTask = (convStatus: SessionStatus | undefined, t: TaskView): boolean =>
  convStatus === 'error' && isLiveTask(t)
