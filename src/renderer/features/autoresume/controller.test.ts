import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AutoResumeReport } from '@shared/app'
import {
  AutoResumeController,
  GUARD_WINDOW_MS,
  RESET_MARGIN_MS,
  STALE_MS,
  type ControllerDeps,
  type PersistedAutoResume
} from './controller'

const T0 = Date.parse('2026-10-30T08:00:00Z')

interface Harness {
  c: AutoResumeController
  reports: AutoResumeReport[]
  resumes: Array<{ convId: string; prompt: string }>
  prefs: { enabled: boolean; prompt: string }
  saved: { current?: PersistedAutoResume }
  titles: Record<string, string>
}

function make(over: Partial<ControllerDeps> = {}, seed?: PersistedAutoResume): Harness {
  const h: Harness = {
    reports: [],
    resumes: [],
    prefs: { enabled: true, prompt: '' },
    saved: seed ? { current: seed } : {},
    titles: { a: 'Tab A', b: 'Tab B' },
    c: undefined as never
  }
  h.c = new AutoResumeController({
    now: () => Date.now(),
    setInterval: (fn, ms) => setInterval(fn, ms),
    clearInterval: (x) => clearInterval(x as ReturnType<typeof setInterval>),
    getPrefs: () => h.prefs,
    resume: async (convId, prompt) => {
      h.resumes.push({ convId, prompt })
    },
    titleOf: (id) => h.titles[id],
    report: (r) => h.reports.push(r),
    load: () => h.saved.current,
    save: (p) => {
      h.saved.current = p
    },
    onChange: () => {},
    ...over
  })
  return h
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(T0)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('AutoResumeController scheduling', () => {
  it('does not fire before reset + margin, then fires once with the default prompt', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 60_000, sessionId: 's1' })
    vi.advanceTimersByTime(60_000 + RESET_MARGIN_MS - 1000)
    expect(h.resumes).toEqual([])
    vi.advanceTimersByTime(2000)
    expect(h.resumes).toEqual([{ convId: 'a', prompt: 'Continue where you left off.' }])
    vi.advanceTimersByTime(10 * 60_000)
    expect(h.resumes).toHaveLength(1)
    expect(h.c.get('a')).toBeUndefined()
  })

  it('uses the custom prompt, trimmed', () => {
    const h = make()
    h.prefs.prompt = '  keep going  '
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes[0]?.prompt).toBe('keep going')
  })

  it('opt-out: with the preference off nothing is sent and no toast is requested', () => {
    const h = make()
    h.prefs.enabled = false
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(24 * 3600_000)
    expect(h.resumes).toEqual([])
    expect(h.reports.filter((r) => r.kind === 'paused')).toEqual([])
    expect(h.c.get('a')).toBeDefined()
  })

  it('arms an existing pause when the preference is switched on later', () => {
    const h = make()
    h.prefs.enabled = false
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    h.prefs.enabled = true
    h.c.refresh()
    expect(h.reports.some((r) => r.kind === 'paused' && r.title === 'Tab A')).toBe(true)
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes).toHaveLength(1)
  })

  it('cancel stops the automatic resume and keeps the pause for a manual one', async () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    h.c.cancel('a')
    vi.advanceTimersByTime(3600_000)
    expect(h.resumes).toEqual([])
    expect(h.c.get('a')?.cancelled).toBe(true)
    await h.c.resumeNow('a')
    expect(h.resumes).toEqual([{ convId: 'a', prompt: 'Continue where you left off.' }])
  })

  it('unknown reset time never auto-resumes (fail safe) but can resume manually', async () => {
    const h = make()
    h.c.noteLimit('a', { sessionId: 's1' })
    vi.advanceTimersByTime(48 * 3600_000)
    expect(h.resumes).toEqual([])
    expect(h.reports.filter((r) => r.kind === 'paused')).toEqual([])
    await h.c.resumeNow('a')
    expect(h.resumes).toHaveLength(1)
  })

  it('drop (new turn started / tab closed) removes the pause silently', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    h.c.drop('a')
    vi.advanceTimersByTime(3600_000)
    expect(h.resumes).toEqual([])
  })

  it('noteLimit with the same reset is idempotent (restore + event)', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    h.c.cancel('a')
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    expect(h.c.get('a')?.cancelled).toBe(true)
  })

  it('schedules again from the new reset when the resumed turn hits the limit again', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes).toHaveLength(1)
    const second = Date.now() + 2 * 3600_000
    h.c.noteLimit('a', { resetsAt: second, sessionId: 's1' })
    vi.advanceTimersByTime(2 * 3600_000 + RESET_MARGIN_MS - 1000)
    expect(h.resumes).toHaveLength(1)
    vi.advanceTimersByTime(2000)
    expect(h.resumes).toHaveLength(2)
  })

  it('loop guard: at most 3 automatic resumes per session per hour, then manual only', () => {
    const h = make()
    for (let i = 0; i < 3; i++) {
      h.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
      vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    }
    expect(h.resumes).toHaveLength(3)
    h.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(60_000)
    expect(h.resumes).toHaveLength(3)
    expect(h.c.get('a')?.blocked).toBe('loop')
    expect(h.reports.filter((r) => r.kind === 'resumed')).toHaveLength(3)
  })

  it('loop guard is per session and rolls off after an hour', () => {
    const h = make()
    for (let i = 0; i < 3; i++) {
      h.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
      vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    }
    h.c.noteLimit('b', { resetsAt: Date.now() + 1000, sessionId: 's2' })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes.filter((r) => r.convId === 'b')).toHaveLength(1)
    vi.advanceTimersByTime(GUARD_WINDOW_MS)
    h.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes.filter((r) => r.convId === 'a')).toHaveLength(4)
  })

  it('a manual Resume now does not count against the guard', async () => {
    const h = make()
    for (let i = 0; i < 5; i++) {
      h.c.noteLimit('a', { resetsAt: Date.now() + 100_000, sessionId: 's1' })
      await h.c.resumeNow('a')
    }
    h.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.resumes).toHaveLength(6)
  })

  it('a failing resume does not break the scheduler', () => {
    const h = make({ resume: () => Promise.reject(new Error('boom')) })
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    expect(() => vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)).not.toThrow()
  })

  it('stops the timer when nothing is pending', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    expect(vi.getTimerCount()).toBe(1)
    h.c.drop('a')
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('AutoResumeController reports (notification and keep-awake inputs)', () => {
  it('reports paused with the tab title and reset time only, then resumed, with the pending count', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    expect(h.reports[0]).toEqual({ kind: 'paused', pending: 1, title: 'Tab A', resetAt: T0 + 1000 })
    vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    expect(h.reports.at(-1)).toEqual({ kind: 'resumed', pending: 0, title: 'Tab A', resetAt: T0 + 1000 })
    for (const r of h.reports) expect(Object.keys(r).sort()).toEqual(expect.arrayContaining(['kind', 'pending']))
    for (const r of h.reports) expect(Object.keys(r).every((k) => ['kind', 'pending', 'title', 'resetAt'].includes(k))).toBe(true)
  })

  it('cancel and drop send a pending-count update (releases keep-awake) without a toast kind', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    h.c.cancel('a')
    expect(h.reports.at(-1)).toEqual({ kind: 'update', pending: 0 })
  })
})

describe('AutoResumeController persistence', () => {
  it('saves pending pauses with a session id and restores them after a restart, then fires', () => {
    const h1 = make()
    h1.c.noteLimit('hist-s1', { resetsAt: T0 + 60_000, sessionId: 's1', limitType: 'five_hour' })
    h1.c.noteLimit('nosession', { resetsAt: T0 + 60_000 })
    h1.c.dispose()
    expect(h1.saved.current?.pauses.map((p) => p.convId)).toEqual(['hist-s1'])

    const h2 = make({}, h1.saved.current)
    const restored = h2.c.restore((id) => (id === 'hist-s1' ? id : undefined))
    expect(restored.map((p) => p.convId)).toEqual(['hist-s1'])
    vi.advanceTimersByTime(60_000 + RESET_MARGIN_MS)
    expect(h2.resumes).toEqual([{ convId: 'hist-s1', prompt: 'Continue where you left off.' }])
  })

  it('restores the cancelled flag and the loop-guard history', () => {
    const h1 = make()
    for (let i = 0; i < 3; i++) {
      h1.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
      vi.advanceTimersByTime(1000 + RESET_MARGIN_MS)
    }
    h1.c.noteLimit('a', { resetsAt: Date.now() + 1000, sessionId: 's1' })
    const h2 = make({}, h1.saved.current)
    h2.c.restore((id) => id)
    vi.advanceTimersByTime(60_000)
    expect(h2.resumes).toEqual([]) // guard history survived the restart
    expect(h2.c.get('a')?.blocked).toBe('loop')
  })

  it('a pause whose reset passed more than a day ago is not auto-resumed', () => {
    const h = make()
    h.c.noteLimit('a', { resetsAt: T0 - STALE_MS - 60_000, sessionId: 's1' })
    vi.advanceTimersByTime(5000)
    expect(h.resumes).toEqual([])
    expect(h.c.get('a')?.blocked).toBe('stale')
  })

  it('maps a saved live conversation to its restored history tab by session id', () => {
    const h1 = make()
    h1.c.noteLimit('new-123-1', { resetsAt: T0 + 1000, sessionId: 's1' })
    const h2 = make({}, h1.saved.current)
    const restored = h2.c.restore((_id, sid) => `hist-${sid}`)
    expect(restored.map((p) => p.convId)).toEqual(['hist-s1'])
  })

  it('ignores restored pauses whose tab is gone', () => {
    const h1 = make()
    h1.c.noteLimit('a', { resetsAt: T0 + 1000, sessionId: 's1' })
    const h2 = make({}, h1.saved.current)
    expect(h2.c.restore(() => undefined)).toEqual([])
    vi.advanceTimersByTime(60_000)
    expect(h2.resumes).toEqual([])
  })
})
