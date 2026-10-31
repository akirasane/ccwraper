import * as React from 'react'
import { create } from 'zustand'

interface ModePrefsState {
  allowBypass: boolean
  set: (v: boolean) => void
}

/** The allowBypassMode preference mirrored for the renderer. Off until the real value is read. */
export const useModePrefs = create<ModePrefsState>((set) => ({ allowBypass: false, set: (allowBypass) => set({ allowBypass }) }))

let started = false

/** Reads the preference once and follows changes. Safe without window.ccwrap (stays off). */
export function useAllowBypass(): boolean {
  const v = useModePrefs((s) => s.allowBypass)
  React.useEffect(() => {
    if (started) return
    started = true
    const api = window.ccwrap?.prefs
    if (!api) {
      started = false
      return
    }
    void Promise.resolve(api.get?.())
      .then((p) => useModePrefs.getState().set(p?.allowBypassMode === true))
      .catch(() => undefined)
    api.onChanged?.((p) => useModePrefs.getState().set(p?.allowBypassMode === true))
  }, [])
  return v
}

/** Test seam. */
export function resetModePrefsForTest(): void {
  started = false
  useModePrefs.getState().set(false)
}
