import { useEffect, useState } from 'react'
import type { CavemanState, LimitsState } from '@shared/limits'
import { EMPTY_CAVEMAN, EMPTY_LIMITS } from '@shared/limits'

/** Initial fetch + push of a main-process state; the empty value when the bridge is missing. */
function useBridgeState<T>(
  pick: () => { getState(): Promise<T>; onState(cb: (s: T) => void): () => void } | undefined,
  empty: T
): T {
  const [state, setState] = useState<T>(empty)
  useEffect(() => {
    const api = pick()
    if (!api) return
    let alive = true
    void Promise.resolve(api.getState())
      .then((s) => alive && s && setState(s))
      .catch(() => {})
    const off = api.onState((s) => setState(s))
    return () => {
      alive = false
      off?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return state
}

/** Latest subscription limits (5-hour, 7-day, ...) aggregated by main over every session. */
export function useLimitsState(): LimitsState {
  return useBridgeState(() => window.ccwrap?.limits, EMPTY_LIMITS)
}

/** The caveman plugin's mode + savings suffix (mode null = hidden). */
export function useCavemanState(): CavemanState {
  return useBridgeState(() => window.ccwrap?.caveman, EMPTY_CAVEMAN)
}
