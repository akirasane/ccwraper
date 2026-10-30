import type { BrowserWindow } from 'electron'
import type { AppPrefs } from '../../shared/app'
import type { SessionEvent } from '../../shared/events'
import type { SessionManager } from './session-manager'

// WP2 implements this file (D3). WP0 freezes the constructor and method signatures; the stub is inert.

/** Injected so tests never create real OS notifications. WP2 may widen the options. */
export type NotifyFn = (opts: { title: string; body: string; onClick: () => void }) => { close(): void } | void

export interface NotificationServiceDeps {
  getWindow: () => BrowserWindow | null
  prefs: { get(): AppPrefs }
  manager: Pick<SessionManager, 'info'>
  notify?: NotifyFn
}

export class NotificationService {
  constructor(private deps: NotificationServiceDeps) {
    void this.deps
  }
  /** Called for every session event before it goes to the renderer. */
  onSessionEvent(_localId: string, _e: SessionEvent): void {}
  /** The renderer's active session (app:setActiveSession). */
  setActive(_localId: string | null): void {}
  dispose(): void {}
}
