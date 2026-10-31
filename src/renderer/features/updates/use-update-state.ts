import { useEffect, useState } from 'react'
import type { UpdateState } from '@shared/app'

/** Live auto-update state from main (initial fetch + push). 'disabled' when the bridge is missing. */
export function useUpdateState(): UpdateState {
  const [state, setState] = useState<UpdateState>({ kind: 'disabled' })
  useEffect(() => {
    const api = window.ccwrap?.update
    if (!api) return
    let alive = true
    void api
      .getState()
      .then((s) => alive && setState(s))
      .catch(() => {})
    const off = api.onState((s) => setState(s))
    return () => {
      alive = false
      off?.()
    }
  }, [])
  return state
}

/** Human text for the Preferences section. */
export function describeUpdate(s: UpdateState): string {
  switch (s.kind) {
    case 'disabled':
      return 'Updates are only available in the installed app.'
    case 'idle':
      return 'Not checked yet.'
    case 'checking':
      return 'Checking for updates...'
    case 'available':
      return `Version ${s.version} is available.`
    case 'downloading':
      return `Downloading version ${s.version} (${s.percent}%)...`
    case 'ready':
      return `Version ${s.version} is ready. Restart to install it.`
    case 'uptodate':
      return 'You are on the latest version.'
    case 'error':
      return `Update check failed: ${s.message}`
  }
}
