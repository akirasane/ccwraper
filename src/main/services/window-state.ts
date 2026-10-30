import type { BrowserWindow, BrowserWindowConstructorOptions } from 'electron'
import type { Disposer } from '../ipc/dispose'

// WP1 implements this file (D11). WP0 freezes the signatures; the stubs are inert.

/** A connected display's usable area. */
export interface ScreenRect {
  x: number
  y: number
  width: number
  height: number
}

export type RestoredWindowState = Partial<BrowserWindowConstructorOptions> & { maximized?: boolean }

/** Saved bounds, only when they still fit a connected display. Stub: nothing restored. */
export function loadWindowState(_file: string, _screens: ScreenRect[]): RestoredWindowState {
  return {}
}

/** Saves bounds and the maximized flag (debounced) until disposed. Stub: no-op. */
export function trackWindowState(_win: BrowserWindow, _file: string): Disposer {
  return () => {}
}
