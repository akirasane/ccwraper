import { describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs, type AutoResumeReport } from '../../shared/app'
import { AutoResumeMain } from './autoresume-main'
import { decideAutoResume, NotificationService } from './notification-service'

const P = { ...DEFAULT_PREFS.notifications }
const NOW = new Date(2026, 9, 30, 12, 0, 0).getTime()
const at = (h: number, m = 0): number => new Date(2026, 9, 30, h, m, 0).getTime()

describe('decideAutoResume', () => {
  it('paused: tab title and time only', () => {
    const d = decideAutoResume({ kind: 'paused', pending: 1, title: 'Fix login bug', resetAt: at(16, 10) }, P, NOW)
    expect(d?.kind).toBe('autoResume')
    expect(d?.title).toContain('Fix login bug')
    expect(d?.title).toMatch(/4:10/)
    expect(d?.body).toBe('Usage limit reached. This tab resumes automatically after the reset.')
  })
  it('resumed: tab title and the reset time', () => {
    const d = decideAutoResume({ kind: 'resumed', pending: 0, title: 'Fix login bug', resetAt: at(16, 10) }, P, NOW)
    expect(d?.title).toBe('Resumed · Fix login bug')
    expect(d?.body).toMatch(/4:10/)
  })
  it('a date is added when the reset is not today', () => {
    const d = decideAutoResume({ kind: 'paused', pending: 1, resetAt: new Date(2026, 10, 2, 15, 0).getTime() }, P, NOW)
    expect(d?.title).toMatch(/Nov/)
  })
  it('update shows nothing; master switch off shows nothing', () => {
    expect(decideAutoResume({ kind: 'update', pending: 0 }, P, NOW)).toBeUndefined()
    expect(decideAutoResume({ kind: 'paused', pending: 1, resetAt: NOW }, { ...P, enabled: false }, NOW)).toBeUndefined()
  })
  it('privacy: nothing but the title field and times can reach the toast', () => {
    const r = { kind: 'paused', pending: 1, title: 'T', resetAt: NOW, prompt: 'SENTINEL_PROMPT', text: 'SENTINEL_TEXT' } as unknown as AutoResumeReport
    const d = decideAutoResume(r, P, NOW)
    expect(JSON.stringify(d)).not.toContain('SENTINEL')
  })
})

describe('NotificationService.announce', () => {
  function setup(focused: boolean) {
    const win = {
      focused,
      isDestroyed: () => false,
      isFocused: () => win.focused,
      isMinimized: () => false,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      on: vi.fn(),
      flashFrame: vi.fn(),
      setOverlayIcon: vi.fn(),
      webContents: { send: vi.fn() }
    }
    const toasts: { title: string; body: string; onClick: () => void }[] = []
    const prefs: AppPrefs = { ...DEFAULT_PREFS }
    const svc = new NotificationService({
      getWindow: () => win as never,
      prefs: { get: () => prefs },
      manager: { info: () => undefined },
      notify: (o) => {
        toasts.push(o)
        return { close: vi.fn() }
      },
      now: () => NOW,
      overlayIcon: () => ({})
    })
    return { svc, win, toasts }
  }
  it('toasts while the window is unfocused and click focuses the window', () => {
    const s = setup(false)
    s.svc.announce({ kind: 'paused', pending: 1, title: 'Tab A', resetAt: at(16, 10) })
    expect(s.toasts).toHaveLength(1)
    s.toasts[0]!.onClick()
    expect(s.win.focus).toHaveBeenCalled()
  })
  it('stays quiet while focused (the tab countdown is visible)', () => {
    const s = setup(true)
    s.svc.announce({ kind: 'paused', pending: 1, title: 'Tab A', resetAt: at(16, 10) })
    expect(s.toasts).toHaveLength(0)
  })
})

describe('AutoResumeMain', () => {
  function make() {
    const start = vi.fn(() => 7)
    const stop = vi.fn()
    const announce = vi.fn()
    const m = new AutoResumeMain({ powerSave: { start, stop }, announce })
    return { m, start, stop, announce }
  }
  it('holds prevent-app-suspension only while a pause is pending', () => {
    const { m, start, stop } = make()
    m.report({ kind: 'paused', pending: 1, resetAt: NOW })
    m.report({ kind: 'paused', pending: 2, resetAt: NOW })
    expect(start).toHaveBeenCalledTimes(1)
    expect(start).toHaveBeenCalledWith('prevent-app-suspension')
    expect(m.holdingAwake).toBe(true)
    m.report({ kind: 'resumed', pending: 1 })
    expect(stop).not.toHaveBeenCalled()
    m.report({ kind: 'resumed', pending: 0 })
    expect(stop).toHaveBeenCalledWith(7)
    expect(m.holdingAwake).toBe(false)
  })
  it('a pending-count update releases the lock without a toast', () => {
    const { m, stop, announce } = make()
    m.report({ kind: 'paused', pending: 1, resetAt: NOW })
    announce.mockClear()
    m.report({ kind: 'update', pending: 0 })
    expect(stop).toHaveBeenCalled()
    expect(announce).not.toHaveBeenCalled()
  })
  it('dispose releases the lock', () => {
    const { m, stop } = make()
    m.report({ kind: 'paused', pending: 1, resetAt: NOW })
    m.dispose()
    expect(stop).toHaveBeenCalledWith(7)
  })
  it('announces paused and resumed only', () => {
    const { m, announce } = make()
    m.report({ kind: 'paused', pending: 1 })
    m.report({ kind: 'resumed', pending: 0 })
    m.report({ kind: 'update', pending: 0 })
    expect(announce).toHaveBeenCalledTimes(2)
  })
  it('survives a failing blocker or toast', () => {
    const m = new AutoResumeMain({
      powerSave: { start: () => { throw new Error('x') }, stop: () => { throw new Error('y') } },
      announce: () => { throw new Error('z') }
    })
    expect(() => m.report({ kind: 'paused', pending: 1 })).not.toThrow()
    expect(() => m.dispose()).not.toThrow()
  })
})
