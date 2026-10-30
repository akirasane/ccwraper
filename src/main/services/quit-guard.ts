import type { BrowserWindow } from 'electron'
import type { AppPrefs } from '../../shared/app'
import type { Disposer } from '../ipc/dispose'

// WP1 implements this file (D11). WP0 freezes the signature; the stub is inert.

export interface QuitGuardDeps {
  /** SessionManager.busyCount */
  busyCount: () => number
  prefs: { get(): AppPrefs }
}

/** On window close: when busy and `confirmQuitWhileRunning`, ask first (Cancel default). Stub: never blocks. */
export function installQuitGuard(_win: BrowserWindow, _deps: QuitGuardDeps): Disposer {
  return () => {}
}
