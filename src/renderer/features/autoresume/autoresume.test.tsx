import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_PREFS, type AppPrefs, type AutoResumeReport } from '@shared/app'
import type { SessionEvent } from '@shared/events'
import { tabStatus } from '@/features/tabs/tab-status'
import { TabStrip } from '@/features/tabs/TabStrip'
import { flushChatEvents, useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { AutoResumeBanner } from './AutoResumeBanner'
import { AutoResumeCard } from './AutoResumeCard'
import { AUTORESUME_KEY, startAutoResume, useAutoResumeStore } from './autoresume'
import { RESET_MARGIN_MS } from './controller'

const T0 = Date.parse('2026-10-30T08:00:00Z')
const CWD = 'C:\\fixture\\alpha'
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }

let reports: AutoResumeReport[]
let prefs: AppPrefs
let api: ReturnType<typeof makeApi>
let stop: (() => void) | undefined
// chat-store remembers retired handles for the whole run, so every test gets its own.
let LID = 'L0'
let lidSeq = 0

function makeApi() {
  return {
    session: {
      start: vi.fn(async () => ({ localId: 'L2' })),
      send: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {})
    },
    prefs: {
      get: vi.fn(async () => prefs),
      set: vi.fn(async (patch: { autoResume?: Partial<AppPrefs['autoResume']> }) => {
        prefs = { ...prefs, autoResume: { ...prefs.autoResume, ...patch.autoResume } }
        return { prefs, hotkey: {} }
      }),
      onChanged: vi.fn(() => () => {})
    },
    autoResume: { report: vi.fn((r: AutoResumeReport) => void reports.push(r)) },
    history: { load: vi.fn(async () => []) }
  }
}

const emit = (localId: string, e: SessionEvent): void => {
  useChatStore.getState().applyEvent(localId, e)
  flushChatEvents()
}

function openLive(): void {
  useChatStore.getState().createConv({ convId: 'c1', cwd: CWD, localId: LID })
  useWorkspaceStore.setState({
    tabs: [{ convId: 'c1', cwd: CWD, sessionId: 'sess-1', openedAt: 1, lastActiveAt: 1 }],
    activeConvId: 'c1'
  })
  emit(LID, { t: 'init', sessionId: 'sess-1', model: 'm', tools: [], mcp: [], slashCommands: [], cwd: CWD })
}

/** What the adapter emits for a turn stopped by the limit. */
function hitLimit(resetsAt?: number): void {
  emit(LID, { t: 'status', state: 'running' })
  emit(LID, { t: 'rate_limited', source: resetsAt ? 'event' : 'none', ...(resetsAt ? { resetsAt, limitType: 'five_hour' } : {}) })
  emit(LID, { t: 'result', costUsd: 0, durationMs: 5, turns: 1, usage, isError: true })
  emit(LID, { t: 'status', state: 'error' })
}

beforeEach(async () => {
  vi.useFakeTimers({ shouldAdvanceTime: false })
  vi.setSystemTime(T0)
  LID = `L${++lidSeq}`
  reports = []
  prefs = { ...DEFAULT_PREFS, autoResume: { enabled: true, prompt: '' } }
  api = makeApi()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
  window.localStorage.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, drafts: {}, lastActive: {}, draftModels: {} })
  useWorkspaceStore.setState({ tabs: [], unread: {}, activeConvId: undefined, cwd: CWD, view: 'chat' })
  useAutoResumeStore.setState({ pauses: {}, prefs: { enabled: false, prompt: '' } })
})
afterEach(() => {
  stop?.()
  stop = undefined
  vi.useRealTimers()
})

async function boot(): Promise<void> {
  stop = startAutoResume()
  await act(async () => {
    await vi.advanceTimersByTimeAsync(0)
  })
}

describe('end to end in the stores', () => {
  it('limit -> paused tab with countdown -> sends the continuation prompt after reset -> normal again', async () => {
    openLive()
    await boot()
    hitLimit(T0 + 60_000)

    const c = useChatStore.getState().convs['c1']!
    expect(c.limit?.resetsAt).toBe(T0 + 60_000)
    expect(tabStatus(c, false)).toBe('paused')
    expect(useAutoResumeStore.getState().pauses['c1']?.resetAt).toBe(T0 + 60_000)
    expect(reports[0]).toMatchObject({ kind: 'paused', pending: 1, resetAt: T0 + 60_000 })

    render(<TabStrip />)
    expect(screen.getByTestId('tab-countdown').textContent).toMatch(/1m/)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000 + RESET_MARGIN_MS - 2000)
    })
    expect(api.session.send).not.toHaveBeenCalled()
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000)
    })
    expect(api.session.send).toHaveBeenCalledWith({ localId: LID, text: 'Continue where you left off.' })
    expect(reports.some((r) => r.kind === 'resumed' && r.pending === 0)).toBe(true)

    // The CLI starts the turn: the limit state clears, the tab is "running", nothing is scheduled any more.
    emit(LID, { t: 'status', state: 'running' })
    expect(useChatStore.getState().convs['c1']!.limit).toBeUndefined()
    expect(tabStatus(useChatStore.getState().convs['c1']!, false)).toBe('running')
    expect(useAutoResumeStore.getState().pauses['c1']).toBeUndefined()
  })

  it('opted out: shows the limit state but never sends', async () => {
    prefs = { ...prefs, autoResume: { enabled: false, prompt: '' } }
    openLive()
    await boot()
    hitLimit(T0 + 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3 * 3600_000)
    })
    expect(api.session.send).not.toHaveBeenCalled()
    expect(reports.filter((r) => r.kind === 'paused')).toEqual([])
    render(<AutoResumeBanner convId="c1" />)
    expect(screen.getByTestId('autoresume-banner').textContent).toMatch(/Auto-resume is off/)
    expect(screen.getByRole('button', { name: 'Resume now' })).toBeTruthy()
  })

  it('unknown reset time: limit state with manual Resume now only', async () => {
    openLive()
    await boot()
    hitLimit(undefined)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(48 * 3600_000)
    })
    expect(api.session.send).not.toHaveBeenCalled()
    render(<AutoResumeBanner convId="c1" />)
    expect(screen.getByTestId('autoresume-banner').textContent).toMatch(/reset time is unknown/)
    await act(async () => {
      screen.getByRole('button', { name: 'Resume now' }).click()
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(api.session.send).toHaveBeenCalledWith({ localId: LID, text: 'Continue where you left off.' })
  })

  it('banner: Paused until + Cancel stops the automatic resume', async () => {
    openLive()
    await boot()
    hitLimit(T0 + 60_000)
    render(<AutoResumeBanner convId="c1" />)
    const banner = screen.getByTestId('autoresume-banner')
    expect(banner.textContent).toMatch(/Paused until/)
    expect(banner.textContent).toMatch(/Resumes automatically in/)
    await act(async () => {
      screen.getByRole('button', { name: 'Cancel' }).click()
    })
    expect(screen.getByTestId('autoresume-banner').textContent).toMatch(/Auto-resume cancelled/)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3600_000)
    })
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('a message the user sends meanwhile ends the pause without a second send', async () => {
    openLive()
    await boot()
    hitLimit(T0 + 60_000)
    emit(LID, { t: 'status', state: 'running' }) // user typed something, session started a turn
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3600_000)
    })
    expect(api.session.send).not.toHaveBeenCalled()
  })

  it('a session whose query loop ended resumes through the saved session id (resume path)', async () => {
    openLive()
    await boot()
    hitLimit(T0 + 1000)
    emit(LID, { t: 'session_closed' })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + RESET_MARGIN_MS)
    })
    expect(api.session.send).not.toHaveBeenCalled()
    expect(api.session.start).toHaveBeenCalledWith(
      expect.objectContaining({ cwd: CWD, prompt: 'Continue where you left off.', resumeId: 'sess-1' })
    )
  })

  it('custom prompt from prefs is what gets sent', async () => {
    prefs = { ...prefs, autoResume: { enabled: true, prompt: 'Carry on with the plan.' } }
    openLive()
    await boot()
    hitLimit(T0 + 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + RESET_MARGIN_MS)
    })
    expect(api.session.send).toHaveBeenCalledWith({ localId: LID, text: 'Carry on with the plan.' })
  })

  it('app restart before the reset: the pause is restored on its history tab and resumes the saved session', async () => {
    // Run 1: pause persisted.
    openLive()
    await boot()
    hitLimit(T0 + 120_000)
    expect(JSON.parse(window.localStorage.getItem(AUTORESUME_KEY)!).pauses[0]).toMatchObject({
      sessionId: 'sess-1',
      resetAt: T0 + 120_000
    })
    stop?.()
    stop = undefined

    // Run 2: fresh stores, the tab comes back as a history tab, the controller restores the pause.
    useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, drafts: {}, lastActive: {}, draftModels: {} })
    useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
    useWorkspaceStore.getState().restoreTabs({
      tabs: [{ convId: 'hist-sess-1', cwd: CWD, sessionId: 'sess-1' }],
      activeConvId: 'hist-sess-1'
    })
    api.session.send.mockClear()
    await boot()
    expect(useChatStore.getState().convs['hist-sess-1']!.limit?.resetsAt).toBe(T0 + 120_000)
    expect(tabStatus(useChatStore.getState().convs['hist-sess-1']!, false)).toBe('paused')

    await act(async () => {
      await vi.advanceTimersByTimeAsync(120_000 + RESET_MARGIN_MS + 1000)
    })
    expect(api.session.start).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'Continue where you left off.', resumeId: 'sess-1' })
    )
  })

  it('loop guard: the 4th limit within an hour is left for the user', async () => {
    openLive()
    await boot()
    for (let i = 0; i < 3; i++) {
      hitLimit(Date.now() + 1000)
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1000 + RESET_MARGIN_MS + 100)
      })
    }
    expect(api.session.send).toHaveBeenCalledTimes(3)
    hitLimit(Date.now() + 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + RESET_MARGIN_MS + 100)
    })
    expect(api.session.send).toHaveBeenCalledTimes(3)
    render(<AutoResumeBanner convId="c1" />)
    expect(screen.getByTestId('autoresume-banner').textContent).toMatch(/3 resumes this hour/)
  })

  it('every report carries only the tab title and times', async () => {
    openLive()
    useChatStore.getState().applyEvent(LID, { t: 'user_message', text: 'SECRET prompt' })
    flushChatEvents()
    useWorkspaceStore.setState((s) => ({ tabs: s.tabs.map((t) => ({ ...t, title: 'My tab' })) }))
    await boot()
    emit(LID, { t: 'assistant_message', msgId: 'm', blocks: [{ type: 'text', text: 'SECRET reply' }] })
    hitLimit(T0 + 1000)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000 + RESET_MARGIN_MS + 100)
    })
    expect(reports.length).toBeGreaterThan(1)
    expect(JSON.stringify(reports)).not.toContain('SECRET')
    expect(reports[0]?.title).toBe('My tab')
  })
})

describe('AutoResumeCard', () => {
  it('toggles the preference and saves a custom prompt', async () => {
    vi.useRealTimers()
    prefs = { ...DEFAULT_PREFS }
    render(<AutoResumeCard />)
    const sw = await screen.findByRole('switch', { name: 'Auto-resume after usage limit' })
    expect(sw.getAttribute('aria-checked')).toBe('false')
    const user = userEvent.setup()
    await user.click(sw)
    expect(api.prefs.set).toHaveBeenCalledWith({ autoResume: { enabled: true } })
    const box = await screen.findByLabelText('Continuation message')
    await user.clear(box)
    await user.type(box, 'Keep going')
    await user.tab()
    expect(api.prefs.set).toHaveBeenLastCalledWith({ autoResume: { prompt: 'Keep going' } })
  })
})
