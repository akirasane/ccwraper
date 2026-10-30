import type { BrowserWindow } from 'electron'
import type { AppPrefs, HotkeyStatus } from '../../shared/app'

// D4: global hotkey, off by default. Focused -> minimize; otherwise restore, show, focus.
// A conflict (register returns false) or an invalid accelerator (throws) becomes HotkeyStatus.error;
// the prefs save itself still succeeds.

export interface HotkeyServiceDeps {
  getWindow: () => BrowserWindow | null
  /** Injected globalShortcut.register; returns false on conflict, throws on an invalid accelerator. */
  register?: (accelerator: string, handler: () => void) => boolean
  /** Injected globalShortcut.unregister. */
  unregister?: (accelerator: string) => void
}

export class HotkeyService {
  private last: HotkeyStatus = { enabled: false, registered: false, accelerator: '' }
  private current: string | null = null

  constructor(private deps: HotkeyServiceDeps) {}

  apply(h: AppPrefs['hotkey']): HotkeyStatus {
    this.release()
    if (!h.enabled) {
      this.last = { enabled: false, registered: false, accelerator: h.accelerator }
      return this.last
    }
    const register = this.deps.register ?? defaultRegister
    let ok = false
    try {
      ok = register(h.accelerator, () => this.toggle())
    } catch {
      this.last = { enabled: true, registered: false, accelerator: h.accelerator, error: 'Not a valid shortcut' }
      return this.last
    }
    if (!ok) {
      this.last = { enabled: true, registered: false, accelerator: h.accelerator, error: 'Already used by another app' }
      return this.last
    }
    this.current = h.accelerator
    this.last = { enabled: true, registered: true, accelerator: h.accelerator }
    return this.last
  }

  status(): HotkeyStatus {
    return this.last
  }

  dispose(): void {
    this.release()
    this.last = { ...this.last, registered: false }
  }

  private release(): void {
    if (this.current === null) return
    const acc = this.current
    this.current = null
    try {
      ;(this.deps.unregister ?? defaultUnregister)(acc)
    } catch {
      /* ignore */
    }
  }

  private toggle(): void {
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isFocused()) {
      win.minimize()
      return
    }
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  }
}

function defaultRegister(accelerator: string, handler: () => void): boolean {
  const { globalShortcut } = require('electron') as typeof import('electron')
  return globalShortcut.register(accelerator, handler)
}

function defaultUnregister(accelerator: string): void {
  const { globalShortcut } = require('electron') as typeof import('electron')
  globalShortcut.unregister(accelerator)
}
