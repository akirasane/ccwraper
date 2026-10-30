import type { BrowserWindow } from 'electron'
import type { AppPrefs, HotkeyStatus } from '../../shared/app'

// WP2 implements this file (D4). WP0 freezes the constructor and method signatures; the stub never registers.

export interface HotkeyServiceDeps {
  getWindow: () => BrowserWindow | null
  /** Injected globalShortcut.register; returns false on conflict, throws on an invalid accelerator. */
  register?: (accelerator: string, handler: () => void) => boolean
}

export class HotkeyService {
  private last: HotkeyStatus = { enabled: false, registered: false, accelerator: '' }
  constructor(private deps: HotkeyServiceDeps) {
    void this.deps
  }
  apply(h: AppPrefs['hotkey']): HotkeyStatus {
    this.last = { enabled: h.enabled, registered: false, accelerator: h.accelerator }
    return this.last
  }
  status(): HotkeyStatus {
    return this.last
  }
  dispose(): void {}
}
