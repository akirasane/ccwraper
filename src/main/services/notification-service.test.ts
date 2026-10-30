import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs, type NotificationPrefs } from '../../shared/app'
import type { SessionEvent } from '../../shared/events'
import { baseName, decide, NotificationService } from './notification-service'

const P: NotificationPrefs = { ...DEFAULT_PREFS.notifications }
const usage = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
const result = (durationMs: number, isError = false): SessionEvent => ({
  t: 'result', costUsd: 0, durationMs, turns: 1, usage, isError
})

describe('decide', () => {
  it('permission: names the tool and project only', () => {
    const d = decide({ t: 'permission_request', reqId: 'r', toolName: 'Bash', input: { command: 'x' } }, { prefs: P, project: 'proj' })
    expect(d).toEqual({ kind: 'permission', title: 'Approval needed · proj', body: 'Claude wants to use Bash' })
  })
  it('turnDone: 15 s threshold (14.9 no, 15 yes)', () => {
    expect(decide(result(14_999), { prefs: P })).toBeUndefined()
    expect(decide(result(15_000), { prefs: P })?.body).toBe('Turn finished in 15s')
    expect(decide(result(42_000), { prefs: P })?.body).toBe('Turn finished in 42s')
    expect(decide(result(125_000), { prefs: P })?.body).toBe('Turn finished in 2m 5s')
  })
  it('turnDone: error body, threshold from prefs', () => {
    expect(decide(result(20_000, true), { prefs: P })?.body).toBe('Turn ended with an error')
    expect(decide(result(20_000), { prefs: { ...P, turnDoneMinSeconds: 40 } })).toBeUndefined()
  })
  it('background agent finished/failed/stopped, unless hidden or ambient', () => {
    for (const status of ['completed', 'failed', 'stopped'] as const) {
      const d = decide({ t: 'task_ended', taskId: 't', status }, { prefs: P, task: { subagentType: 'reviewer' } })
      expect(d?.body).toBe(`reviewer ${status}`)
    }
    expect(decide({ t: 'task_ended', taskId: 't', status: 'completed' }, { prefs: P })?.body).toBe('Agent completed')
    expect(decide({ t: 'task_ended', taskId: 't', status: 'completed' }, { prefs: P, task: { hidden: true } })).toBeUndefined()
    expect(decide({ t: 'task_ended', taskId: 't', status: 'completed' }, { prefs: P, task: { ambient: true } })).toBeUndefined()
  })
  it('per-kind toggles and master switch', () => {
    const perm: SessionEvent = { t: 'permission_request', reqId: 'r', toolName: 'Bash', input: {} }
    expect(decide(perm, { prefs: { ...P, permission: false } })).toBeUndefined()
    expect(decide(result(60_000), { prefs: { ...P, turnDone: false } })).toBeUndefined()
    expect(decide({ t: 'task_ended', taskId: 't', status: 'completed' }, { prefs: { ...P, backgroundTask: false } })).toBeUndefined()
    expect(decide(perm, { prefs: { ...P, enabled: false } })).toBeUndefined()
    expect(decide(result(60_000), { prefs: { ...P, enabled: false } })).toBeUndefined()
  })
  it('ignores other events', () => {
    expect(decide({ t: 'status', state: 'running' }, { prefs: P })).toBeUndefined()
    expect(decide({ t: 'error', message: 'boom' }, { prefs: P })).toBeUndefined()
    expect(decide({ t: 'tool_use', toolUseId: 'u', name: 'Bash', input: {} }, { prefs: P })).toBeUndefined()
  })
  it('privacy: sentinels in prompt, description, input and result text never reach title or body', () => {
    const S = ['SENTINEL_PROMPT', 'SENTINEL_DESC', 'SENTINEL_INPUT', 'SENTINEL_RESULT', 'SENTINEL_SUMMARY', 'SENTINEL_ERR'] as const
    const events: SessionEvent[] = [
      { t: 'user_message', text: S[0] },
      { t: 'permission_request', reqId: 'r', toolName: 'Edit', input: { file: S[2], c: S[2] }, title: S[2], ruleLabel: S[2] },
      { t: 'result', costUsd: 1, durationMs: 99_000, turns: 1, usage, isError: false, resultText: S[3] },
      { t: 'result', costUsd: 1, durationMs: 99_000, turns: 1, usage, isError: true, resultText: S[3] },
      { t: 'task_started', taskId: 't', description: S[1] },
      { t: 'task_ended', taskId: 't', status: 'failed', summary: S[4] },
      { t: 'error', message: S[5] }
    ]
    let seen = 0
    for (const e of events) {
      const d = decide(e, { prefs: P, project: 'proj' })
      if (!d) continue
      seen++
      const text = `${d.title}\n${d.body}`
      for (const s of S) expect(text).not.toContain(s)
    }
    expect(seen).toBe(4)
  })
})

describe('baseName', () => {
  it('handles windows and posix paths', () => {
    expect(baseName('D:\\a\\b\\proj\\')).toBe('proj')
    expect(baseName('/a/b/proj')).toBe('proj')
    expect(baseName(undefined)).toBeUndefined()
  })
})

function fakeWindow(focused = false) {
  const handlers: Record<string, () => void> = {}
  const win = {
    focused,
    minimized: false,
    isFocused: () => win.focused,
    isDestroyed: () => false,
    isMinimized: () => win.minimized,
    restore: vi.fn(() => { win.minimized = false }),
    show: vi.fn(),
    focus: vi.fn(),
    flashFrame: vi.fn(),
    setOverlayIcon: vi.fn(),
    on: vi.fn((ev: string, fn: () => void) => { handlers[ev] = fn }),
    webContents: { send: vi.fn() },
    fire: (ev: string) => handlers[ev]?.()
  }
  return win
}

function setup(opts: { focused?: boolean; prefs?: Partial<NotificationPrefs> } = {}) {
  const win = fakeWindow(opts.focused ?? false)
  let t = 1_000_000
  const timers: { fn: () => void; at: number; h: number }[] = []
  let hid = 0
  const toasts: { title: string; body: string; onClick: () => void; close: ReturnType<typeof vi.fn> }[] = []
  const prefs: AppPrefs = { ...DEFAULT_PREFS, notifications: { ...P, ...opts.prefs } }
  const svc = new NotificationService({
    getWindow: () => win as never,
    prefs: { get: () => prefs },
    manager: { info: () => ({ cwd: 'D:\\work\\myproj' }) },
    notify: (o) => {
      const close = vi.fn()
      toasts.push({ ...o, close })
      return { close }
    },
    now: () => t,
    setTimer: (fn, ms) => { const h = ++hid; timers.push({ fn, at: t + ms, h }); return h },
    clearTimer: (h) => { const i = timers.findIndex((x) => x.h === h); if (i >= 0) timers.splice(i, 1) },
    overlayIcon: () => ({ fake: true })
  })
  const advance = (ms: number) => {
    t += ms
    for (const x of timers.filter((x) => x.at <= t)) { timers.splice(timers.indexOf(x), 1); x.fn() }
  }
  return { svc, win, toasts, advance, timers }
}

const perm: SessionEvent = { t: 'permission_request', reqId: 'r', toolName: 'Bash', input: {} }

describe('NotificationService', () => {
  it('unfocused only: nothing while the window is focused', () => {
    const s = setup({ focused: true })
    s.svc.onSessionEvent('a', perm)
    s.svc.onSessionEvent('a', result(60_000))
    expect(s.toasts).toHaveLength(0)
    expect(s.win.flashFrame).not.toHaveBeenCalled()
  })

  it('permission when unfocused: toast, flashFrame, overlay badge', () => {
    const s = setup()
    s.svc.onSessionEvent('a', perm)
    expect(s.toasts).toHaveLength(1)
    expect(s.toasts[0]!.title).toBe('Approval needed · myproj')
    expect(s.win.flashFrame).toHaveBeenCalledWith(true)
    expect(s.win.setOverlayIcon).toHaveBeenCalledTimes(1)
  })

  it('flashTaskbar off: no flash; master off: nothing at all', () => {
    const a = setup({ prefs: { flashTaskbar: false } })
    a.svc.onSessionEvent('a', perm)
    expect(a.toasts).toHaveLength(1)
    expect(a.win.flashFrame).not.toHaveBeenCalled()
    const b = setup({ prefs: { enabled: false } })
    b.svc.onSessionEvent('a', perm)
    expect(b.toasts).toHaveLength(0)
    expect(b.win.setOverlayIcon).not.toHaveBeenCalled()
  })

  it('turn under 15 s is silent, 15 s notifies', () => {
    const s = setup()
    s.svc.onSessionEvent('a', result(14_000))
    expect(s.toasts).toHaveLength(0)
    s.svc.onSessionEvent('a', result(15_000))
    expect(s.toasts).toHaveLength(1)
    expect(s.win.flashFrame).not.toHaveBeenCalled()
  })

  it('background agent finished uses the remembered type; hidden/ambient are skipped', () => {
    const s = setup()
    s.svc.onSessionEvent('a', { t: 'task_started', taskId: '1', description: 'SECRET', subagentType: 'explorer' })
    s.svc.onSessionEvent('a', { t: 'task_started', taskId: '2', description: 'x', hidden: true })
    s.svc.onSessionEvent('a', { t: 'task_started', taskId: '3', description: 'x', ambient: true })
    s.svc.onSessionEvent('a', { t: 'task_ended', taskId: '2', status: 'completed' })
    s.svc.onSessionEvent('a', { t: 'task_ended', taskId: '3', status: 'completed' })
    expect(s.toasts).toHaveLength(0)
    s.svc.onSessionEvent('a', { t: 'task_ended', taskId: '1', status: 'completed' })
    expect(s.toasts).toHaveLength(1)
    expect(s.toasts[0]!.body).toBe('explorer completed')
    expect(JSON.stringify(s.toasts)).not.toContain('SECRET')
  })

  it('throttle: one toast per session per 5 s, latest wins after the window; other sessions unaffected', () => {
    const s = setup()
    s.svc.onSessionEvent('a', { ...perm, toolName: 'First' })
    s.advance(1000)
    s.svc.onSessionEvent('a', { ...perm, toolName: 'Second' })
    s.advance(1000)
    s.svc.onSessionEvent('a', { ...perm, toolName: 'Third' })
    expect(s.toasts).toHaveLength(1)
    s.svc.onSessionEvent('b', perm)
    expect(s.toasts).toHaveLength(2)
    s.advance(3000)
    expect(s.toasts).toHaveLength(3)
    expect(s.toasts[2]!.body).toBe('Claude wants to use Third')
    s.advance(10_000)
    expect(s.toasts).toHaveLength(3)
  })

  it('a deferred toast is dropped if the window got focus meanwhile', () => {
    const s = setup()
    s.svc.onSessionEvent('a', perm)
    s.advance(100)
    s.svc.onSessionEvent('a', perm)
    s.win.focused = true
    s.win.fire('focus')
    s.advance(6000)
    expect(s.toasts).toHaveLength(1)
  })

  it('focus clears the overlay badge', () => {
    const s = setup()
    s.svc.onSessionEvent('a', perm)
    s.win.fire('focus')
    expect(s.win.setOverlayIcon).toHaveBeenLastCalledWith(null, '')
  })

  it('click restores, shows, focuses and sends app:focusSession', () => {
    const s = setup()
    s.win.minimized = true
    s.svc.onSessionEvent('abc', perm)
    s.toasts[0]!.onClick()
    expect(s.win.restore).toHaveBeenCalled()
    expect(s.win.show).toHaveBeenCalled()
    expect(s.win.focus).toHaveBeenCalled()
    expect(s.win.webContents.send).toHaveBeenCalledWith('app:focusSession', { localId: 'abc' })
  })

  it('dispose closes live toasts and stops further notifications', () => {
    const s = setup()
    s.svc.onSessionEvent('a', perm)
    s.svc.dispose()
    expect(s.toasts[0]!.close).toHaveBeenCalled()
    s.advance(10_000)
    s.svc.onSessionEvent('b', perm)
    expect(s.toasts).toHaveLength(1)
  })

  it('session_closed drops that session\'s state', () => {
    const s = setup()
    s.svc.onSessionEvent('a', { t: 'task_started', taskId: '1', description: 'x', subagentType: 'k' })
    s.svc.onSessionEvent('a', { t: 'session_closed' })
    s.svc.onSessionEvent('a', { t: 'task_ended', taskId: '1', status: 'completed' })
    expect(s.toasts[0]!.body).toBe('Agent completed')
  })
})
