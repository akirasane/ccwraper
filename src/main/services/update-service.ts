import type { AppPrefs, UpdateState } from '../../shared/app'

/** The slice of electron-updater's AppUpdater this service uses (a fake in tests). */
export interface UpdaterLike {
  autoDownload: boolean
  autoInstallOnAppQuit: boolean
  allowPrerelease: boolean
  on(event: string, listener: (...args: any[]) => void): unknown
  checkForUpdates(): Promise<unknown>
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void
}

export interface UpdateServiceDeps {
  /** electron-updater's autoUpdater. Left undefined when the app is not packaged (never touched then). */
  updater?: UpdaterLike
  isPackaged: boolean
  prefs: { get(): Pick<AppPrefs, 'autoUpdate'> }
  /** Pushes every state change to the renderer window(s). */
  broadcast: (state: UpdateState) => void
  /** First background check after start. Default 10 s. */
  startDelayMs?: number
  /** Background check interval. Default 6 h. */
  intervalMs?: number
  log?: (msg: string) => void
}

export const UPDATE_START_DELAY_MS = 10_000
export const UPDATE_INTERVAL_MS = 6 * 60 * 60_000

/** Turn whatever electron-updater / the network threw into one short, user-presentable line. */
export function shortUpdateError(err: unknown): string {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const text = raw.trim()
  if (/\b(404|401|403)\b|not found|unauthori[sz]ed|forbidden/i.test(text) && !/ENOTFOUND/.test(text)) {
    return 'Release feed is not accessible (the repository may be private)'
  }
  if (/ENOTFOUND|ECONNREFUSED|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ERR_INTERNET_DISCONNECTED|ERR_NETWORK|net::|getaddrinfo|offline/i.test(text)) {
    return 'Could not reach the update server (offline?)'
  }
  const first = text.split(/\r?\n/)[0] ?? ''
  if (!first) return 'Update check failed'
  return first.length > 120 ? `${first.slice(0, 117)}...` : first
}

/**
 * In-app auto-update on top of electron-updater. Only active in a packaged build; every failure (private repo,
 * offline, bad feed) is folded into the 'error' state and never thrown, shown as a dialog or allowed to crash.
 */
export class UpdateService {
  private state: UpdateState
  private startTimer: ReturnType<typeof setTimeout> | undefined
  private interval: ReturnType<typeof setInterval> | undefined
  private started = false
  private inFlight: Promise<void> | undefined
  private readonly active: boolean

  constructor(private deps: UpdateServiceDeps) {
    this.active = deps.isPackaged && !!deps.updater
    this.state = this.active ? { kind: 'idle' } : { kind: 'disabled' }
  }

  getState(): UpdateState {
    return this.state
  }

  /** Wire the updater and schedule the background checks. Safe to call once; a no-op when disabled. */
  start(): void {
    if (this.started || !this.active) return
    this.started = true
    const u = this.deps.updater!
    try {
      u.autoDownload = true
      u.autoInstallOnAppQuit = true
      u.allowPrerelease = false
      u.on('checking-for-update', () => {
        if (this.state.kind !== 'ready' && this.state.kind !== 'downloading') this.set({ kind: 'checking' })
      })
      u.on('update-available', (info: { version?: string }) => {
        this.set({ kind: 'available', version: String(info?.version ?? '') })
      })
      u.on('update-not-available', () => {
        if (this.state.kind !== 'ready') this.set({ kind: 'uptodate' })
      })
      u.on('download-progress', (p: { percent?: number }) => {
        const version = 'version' in this.state ? this.state.version : ''
        const percent = Math.max(0, Math.min(100, Math.round(Number(p?.percent ?? 0))))
        this.set({ kind: 'downloading', version, percent })
      })
      u.on('update-downloaded', (info: { version?: string }) => {
        const version = String(info?.version ?? ('version' in this.state ? this.state.version : ''))
        this.set({ kind: 'ready', version })
      })
      u.on('error', (err: unknown) => this.fail(err))
    } catch (err) {
      this.fail(err)
      return
    }
    const background = (): void => {
      if (this.deps.prefs.get().autoUpdate) void this.check()
    }
    this.startTimer = setTimeout(background, this.deps.startDelayMs ?? UPDATE_START_DELAY_MS)
    this.interval = setInterval(background, this.deps.intervalMs ?? UPDATE_INTERVAL_MS)
    // Never keep the process alive just for the update schedule.
    this.startTimer.unref?.()
    this.interval.unref?.()
  }

  /** Manual or scheduled check. Resolves with the resulting state; never rejects. */
  check(): Promise<UpdateState> {
    if (!this.active) return Promise.resolve(this.state)
    // Nothing to do while a check or download is running, or once an update is waiting to be installed.
    if (this.inFlight) return this.inFlight.then(() => this.state)
    if (this.state.kind === 'ready' || this.state.kind === 'downloading') return Promise.resolve(this.state)
    const run = (async (): Promise<void> => {
      try {
        await this.deps.updater!.checkForUpdates()
      } catch (err) {
        this.fail(err)
      }
    })().finally(() => {
      this.inFlight = undefined
    })
    this.inFlight = run
    return run.then(() => this.state)
  }

  /** Quit and install. Only meaningful in the 'ready' state; returns whether it was started. */
  installNow(): boolean {
    if (!this.active || this.state.kind !== 'ready') return false
    try {
      this.deps.updater!.quitAndInstall(false, true)
      return true
    } catch (err) {
      this.fail(err)
      return false
    }
  }

  dispose(): void {
    if (this.startTimer) clearTimeout(this.startTimer)
    if (this.interval) clearInterval(this.interval)
    this.startTimer = undefined
    this.interval = undefined
  }

  private fail(err: unknown): void {
    const message = shortUpdateError(err)
    this.deps.log?.(`update error: ${err instanceof Error ? err.message : String(err)}`)
    // A downloaded update stays installable even if a later check fails.
    if (this.state.kind === 'ready') return
    this.set({ kind: 'error', message })
  }

  private set(next: UpdateState): void {
    this.state = next
    try {
      this.deps.broadcast(next)
    } catch {
      /* the window may be gone */
    }
  }
}
