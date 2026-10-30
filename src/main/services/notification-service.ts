import type { BrowserWindow } from 'electron'
import type { AppPrefs, AutoResumeReport, NotificationPrefs } from '../../shared/app'
import { IpcChannels } from '../../shared/channels'
import type { SessionEvent } from '../../shared/events'
import type { SessionManager } from './session-manager'

// D3: notifications are decided in main, only while the window is unfocused.
// Privacy: titles and bodies contain only tool names, agent types, the project folder's base name and durations.
// Never a prompt, response, tool input, task description or file content (Windows keeps toasts in the Action Center).

export type NotifyFn = (opts: { title: string; body: string; onClick: () => void }) => { close(): void } | void

export interface NotificationServiceDeps {
  getWindow: () => BrowserWindow | null
  prefs: { get(): AppPrefs }
  manager: Pick<SessionManager, 'info'>
  notify?: NotifyFn
  /** Injected clock (tests). */
  now?: () => number
  /** Injected timers (tests). */
  setTimer?: (fn: () => void, ms: number) => unknown
  clearTimer?: (h: unknown) => void
  /** Overlay badge image factory; default draws a red dot with nativeImage. */
  overlayIcon?: () => unknown
}

export type NotificationKind = 'permission' | 'turnDone' | 'backgroundTask' | 'autoResume'

export interface NotificationDecision {
  kind: NotificationKind
  title: string
  body: string
}

export interface TaskFlags {
  subagentType?: string
  hidden?: boolean
  ambient?: boolean
}

export interface DecideContext {
  prefs: NotificationPrefs
  /** Base name of the session's project folder. */
  project?: string
  /** Flags remembered from task_started for the ended task. */
  task?: TaskFlags
}

export const THROTTLE_MS = 5000

function clip(s: string, n = 60): string {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s
}

export function baseName(p: string | undefined): string | undefined {
  if (!p) return undefined
  const parts = p.split(/[\\/]+/).filter(Boolean)
  const last = parts[parts.length - 1]
  return last ? clip(last, 40) : undefined
}

function formatDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  const r = s % 60
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

/** Pure: which notification (if any) an event deserves. Focus gating and throttling live in the service. */
export function decide(e: SessionEvent, ctx: DecideContext): NotificationDecision | undefined {
  const n = ctx.prefs
  if (!n.enabled) return undefined
  switch (e.t) {
    case 'permission_request': {
      if (!n.permission) return undefined
      return {
        kind: 'permission',
        title: ctx.project ? `Approval needed · ${ctx.project}` : 'Approval needed',
        body: `Claude wants to use ${clip(String(e.toolName))}`
      }
    }
    case 'result': {
      if (!n.turnDone) return undefined
      if (e.durationMs < n.turnDoneMinSeconds * 1000) return undefined
      return {
        kind: 'turnDone',
        title: ctx.project ? `Turn finished · ${ctx.project}` : 'Turn finished',
        body: e.isError ? 'Turn ended with an error' : `Turn finished in ${formatDuration(e.durationMs)}`
      }
    }
    case 'task_ended': {
      if (!n.backgroundTask) return undefined
      if (ctx.task?.hidden || ctx.task?.ambient) return undefined
      const who = ctx.task?.subagentType ? clip(ctx.task.subagentType) : 'Agent'
      return {
        kind: 'backgroundTask',
        title: ctx.project ? `Agent finished · ${ctx.project}` : 'Agent finished',
        body: `${who} ${e.status}`
      }
    }
    default:
      return undefined
  }
}

/** Clock time of `ms`; with the date when it is not today (a weekly limit). */
export function formatResetTime(ms: number, now: number): string {
  const d = new Date(ms)
  const sameDay = d.toDateString() === new Date(now).toDateString()
  return sameDay
    ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
    : d.toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/**
 * Pure: the toast for an auto-resume report. Content is the tab title and times only, never message text.
 * 'update' (a pending-count change only, and anything with the notification switches off) shows nothing.
 */
export function decideAutoResume(
  r: AutoResumeReport,
  prefs: NotificationPrefs,
  now: number
): NotificationDecision | undefined {
  if (!prefs.enabled) return undefined
  const tab = r.title ? clip(r.title, 40) : undefined
  const at = r.resetAt !== undefined ? formatResetTime(r.resetAt, now) : undefined
  if (r.kind === 'paused') {
    return {
      kind: 'autoResume',
      title: tab ? `Paused until ${at ?? 'reset'} · ${tab}` : `Paused until ${at ?? 'reset'}`,
      body: 'Usage limit reached. This tab resumes automatically after the reset.'
    }
  }
  if (r.kind === 'resumed') {
    return {
      kind: 'autoResume',
      title: tab ? `Resumed · ${tab}` : 'Resumed',
      body: at ? `The usage limit reset at ${at}. Continuing.` : 'The usage limit reset. Continuing.'
    }
  }
  return undefined
}

interface Pending {
  decision: NotificationDecision
  timer: unknown
}

export class NotificationService {
  private active: string | null = null
  private tasks = new Map<string, TaskFlags>()
  private lastShown = new Map<string, number>()
  private pending = new Map<string, Pending>()
  private live = new Set<{ close(): void }>()
  private wired = new WeakSet<object>()
  private badged = false
  private disposed = false

  constructor(private deps: NotificationServiceDeps) {}

  /** Called for every session event before it goes to the renderer. */
  onSessionEvent(localId: string, e: SessionEvent): void {
    if (this.disposed) return
    if (e.t === 'task_started') {
      this.tasks.set(`${localId}:${e.taskId}`, { subagentType: e.subagentType, hidden: e.hidden, ambient: e.ambient })
      return
    }
    if (e.t === 'session_closed') {
      this.forget(localId)
      return
    }
    const key = e.t === 'task_ended' ? `${localId}:${e.taskId}` : ''
    const task = e.t === 'task_ended' ? this.tasks.get(key) : undefined
    if (e.t === 'task_ended') this.tasks.delete(key)
    if (e.t !== 'permission_request' && e.t !== 'result' && e.t !== 'task_ended') return

    const prefs = this.deps.prefs.get().notifications
    const d = decide(e, { prefs, project: baseName(this.deps.manager.info(localId)?.cwd), task })
    if (!d) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    this.wire(win)
    if (win.isFocused()) return
    this.dispatch(localId, d, win, prefs)
  }

  /** Auto-resume pause/resume toast (WP14). Same gating as the others: only while the window is unfocused. */
  announce(r: AutoResumeReport): void {
    if (this.disposed) return
    const d = decideAutoResume(r, this.deps.prefs.get().notifications, this.now())
    if (!d) return
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    this.wire(win)
    if (win.isFocused()) return
    this.setBadge(win, true)
    const notify = this.deps.notify ?? defaultNotify
    let handle: { close(): void } | void
    const onClick = (): void => {
      if (handle) this.live.delete(handle)
      const w = this.deps.getWindow()
      if (!w || w.isDestroyed()) return
      if (w.isMinimized()) w.restore()
      w.show()
      w.focus()
    }
    try {
      handle = notify({ title: d.title, body: d.body, onClick })
    } catch {
      return
    }
    if (handle) this.live.add(handle)
  }

  /** The renderer's active session (app:setActiveSession). */
  setActive(localId: string | null): void {
    this.active = localId
  }

  /** The tab the user last reported as active; exposed for diagnostics. */
  activeSession(): string | null {
    return this.active
  }

  dispose(): void {
    this.disposed = true
    for (const p of this.pending.values()) this.clearTimer(p.timer)
    this.pending.clear()
    for (const n of this.live) {
      try {
        n.close()
      } catch {
        /* ignore */
      }
    }
    this.live.clear()
    this.tasks.clear()
    this.lastShown.clear()
  }

  private forget(localId: string): void {
    const prefix = `${localId}:`
    for (const k of this.tasks.keys()) if (k.startsWith(prefix)) this.tasks.delete(k)
    const p = this.pending.get(localId)
    if (p) this.clearTimer(p.timer)
    this.pending.delete(localId)
    this.lastShown.delete(localId)
  }

  private now(): number {
    return (this.deps.now ?? Date.now)()
  }

  private clearTimer(h: unknown): void {
    if (this.deps.clearTimer) this.deps.clearTimer(h)
    else clearTimeout(h as ReturnType<typeof setTimeout>)
  }

  private dispatch(localId: string, d: NotificationDecision, win: BrowserWindow, prefs: NotificationPrefs): void {
    // Fallbacks first: they always work even when Windows hides toasts from an unregistered AUMID.
    if (d.kind === 'permission' && prefs.flashTaskbar) {
      try {
        win.flashFrame(true)
      } catch {
        /* ignore */
      }
    }
    this.setBadge(win, true)

    // At most one toast per session per THROTTLE_MS; the latest suppressed one is shown when the window opens.
    const last = this.lastShown.get(localId)
    const t = this.now()
    if (last !== undefined && t - last < THROTTLE_MS) {
      const old = this.pending.get(localId)
      if (old) this.clearTimer(old.timer)
      const wait = THROTTLE_MS - (t - last)
      const timer = (this.deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms)))(() => {
        this.pending.delete(localId)
        const w = this.deps.getWindow()
        if (this.disposed || !w || w.isDestroyed() || w.isFocused()) return
        this.show(localId, d)
      }, wait)
      this.pending.set(localId, { decision: d, timer })
      return
    }
    this.show(localId, d)
  }

  private show(localId: string, d: NotificationDecision): void {
    this.lastShown.set(localId, this.now())
    const notify = this.deps.notify ?? defaultNotify
    let handle: { close(): void } | void
    const onClick = (): void => {
      if (handle) this.live.delete(handle)
      this.focusSession(localId)
    }
    try {
      handle = notify({ title: d.title, body: d.body, onClick })
    } catch {
      return
    }
    // Hold a reference: a garbage-collected Notification loses its click handler.
    if (handle) this.live.add(handle)
  }

  private focusSession(localId: string): void {
    const win = this.deps.getWindow()
    if (!win || win.isDestroyed()) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
    win.webContents.send(IpcChannels.appFocusSession, { localId })
  }

  /** Clear flash and the overlay badge when the window gains focus. */
  private wire(win: BrowserWindow): void {
    if (this.wired.has(win)) return
    this.wired.add(win)
    win.on('focus', () => {
      this.setBadge(win, false)
      for (const p of this.pending.values()) this.clearTimer(p.timer)
      this.pending.clear()
      // Held toasts are left to the OS; they stay in the Action Center until dismissed.
      this.live.clear()
    })
  }

  private setBadge(win: BrowserWindow, on: boolean): void {
    if (this.badged === on) return
    this.badged = on
    try {
      if (on) win.setOverlayIcon((this.deps.overlayIcon ?? defaultOverlay)() as never, 'Needs attention')
      else win.setOverlayIcon(null, '')
    } catch {
      /* overlay is best effort */
    }
  }
}

function defaultNotify(opts: { title: string; body: string; onClick: () => void }): { close(): void } | void {
  const { Notification } = require('electron') as typeof import('electron')
  if (!Notification.isSupported()) return
  const n = new Notification({ title: opts.title, body: opts.body, silent: false })
  n.on('click', opts.onClick)
  n.show()
  return n
}

/** A 16x16 red dot with a transparent surround (BGRA bitmap, no PNG encoding needed). */
function defaultOverlay(): unknown {
  const { nativeImage } = require('electron') as typeof import('electron')
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 <= 6.5 ** 2) {
        const i = (y * size + x) * 4
        buf[i] = 0x44 // B
        buf[i + 1] = 0x44 // G
        buf[i + 2] = 0xef // R
        buf[i + 3] = 0xff
      }
    }
  }
  return nativeImage.createFromBitmap(buf, { width: size, height: size })
}
