// P4 app-level contracts (prefs, auth status). Zod-free so the sandboxed preload can bundle it.

export interface NotificationPrefs {
  enabled: boolean
  permission: boolean
  turnDone: boolean
  turnDoneMinSeconds: number
  backgroundTask: boolean
  flashTaskbar: boolean
}

export interface AppPrefs {
  version: 1
  notifications: NotificationPrefs
  hotkey: { enabled: boolean; accelerator: string }
  confirmQuitWhileRunning: boolean
}

export const DEFAULT_PREFS: AppPrefs = {
  version: 1,
  notifications: {
    enabled: true,
    permission: true,
    turnDone: true,
    turnDoneMinSeconds: 15,
    backgroundTask: true,
    flashTaskbar: true
  },
  hotkey: { enabled: false, accelerator: 'Control+Alt+Space' },
  confirmQuitWhileRunning: true
}

export type AppPrefsPatch = {
  notifications?: Partial<NotificationPrefs>
  hotkey?: Partial<AppPrefs['hotkey']>
  confirmQuitWhileRunning?: boolean
}

export interface HotkeyStatus {
  enabled: boolean
  registered: boolean
  accelerator: string
  error?: string
}

export interface PrefsSetResult {
  prefs: AppPrefs
  hotkey: HotkeyStatus
}

export interface AuthStatus {
  state: 'signed_in' | 'signed_out' | 'unknown'
  method?: 'subscription' | 'api_key' | 'other'
  checkedAt: number
  /** Short reason for 'unknown' (timeout, binary missing, unparsable). Never account details. */
  reason?: string
}
