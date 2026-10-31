// P4 app-level contracts (prefs, auth status). Zod-free so the sandboxed preload can bundle it.

export interface NotificationPrefs {
  enabled: boolean
  permission: boolean
  turnDone: boolean
  turnDoneMinSeconds: number
  backgroundTask: boolean
  flashTaskbar: boolean
}

/** Auto-resume after a subscription usage limit (P4 WP14). Off by default. */
export interface AutoResumePrefs {
  enabled: boolean
  /** Sent to the paused session when the limit resets. Empty means DEFAULT_AUTO_RESUME_PROMPT. */
  prompt: string
}

export const DEFAULT_AUTO_RESUME_PROMPT = 'Continue where you left off.'

export interface AppPrefs {
  version: 1
  notifications: NotificationPrefs
  hotkey: { enabled: boolean; accelerator: string }
  confirmQuitWhileRunning: boolean
  autoResume: AutoResumePrefs
  /** Lets the permission-mode menu offer Bypass (dangerous). Off by default; Bypass itself is never persisted. */
  allowBypassMode: boolean
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
  confirmQuitWhileRunning: true,
  autoResume: { enabled: false, prompt: DEFAULT_AUTO_RESUME_PROMPT },
  allowBypassMode: false
}

export type AppPrefsPatch = {
  notifications?: Partial<NotificationPrefs>
  hotkey?: Partial<AppPrefs['hotkey']>
  confirmQuitWhileRunning?: boolean
  autoResume?: Partial<AutoResumePrefs>
  allowBypassMode?: boolean
}

/** Renderer -> main (fire-and-forget): drives the pause/resume native notifications and the keep-awake lock. */
export interface AutoResumeReport {
  kind: 'paused' | 'resumed' | 'update'
  /** Pauses currently waiting for their reset (powerSaveBlocker is held while > 0). */
  pending: number
  /** Tab title only; never message content. */
  title?: string
  /** Epoch ms: the time the tab is paused until (paused) or the reset that passed (resumed). */
  resetAt?: number
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
