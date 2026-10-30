import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistorySessionInfo, SessionEvent } from '@shared/events'
import { AppShell } from '@/app/shell/AppShell'
import { TitleBar } from '@/app/shell/TitleBar'
import { toast } from '@/components/ui/toaster'
import { initIpcBridge } from '@/lib/ipc-bridge'
import { queryClient } from '@/lib/query-client'
import { flushChatEvents, useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { parseTabs, readPersistedTabs, serializeTabs, startTabPersistence, TABS_KEY } from './tab-persist'
import { tabStatus } from './tab-status'
import { TabStrip } from './TabStrip'

vi.mock('@/components/ui/toaster', async (orig) => ({
  ...(await orig<typeof import('@/components/ui/toaster')>()),
  toast: vi.fn()
}))

const CWD = 'C:\\fixture\\alpha'
const hist = (id: string, title = id): HistorySessionInfo => ({ sessionId: id, title, cwd: CWD, lastModified: 1 })
const replay: SessionEvent[] = [{ t: 'user_message', text: 'hello' }]

let api: ReturnType<typeof makeApi>
let onEvent: (p: { localId: string; event: SessionEvent }) => void = () => {}
let onFocus: (p: { localId: string }) => void = () => {}
let seq = 0

function makeApi() {
  return {
    session: {
      start: vi.fn(async () => ({ localId: `L${++seq}` })),
      send: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      permissionReply: vi.fn(async () => {}),
      supportedModels: vi.fn(async () => []),
      onEvent: vi.fn((cb: typeof onEvent) => {
        onEvent = cb
        return () => {}
      })
    },
    dialog: { pickDirectory: vi.fn(async () => null) },
    history: {
      listProjects: vi.fn(async () => []),
      list: vi.fn(async () => []),
      load: vi.fn(async () => replay)
    },
    app: {
      info: vi.fn(async () => ({ claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' })),
      setActiveSession: vi.fn(),
      onFocusSession: vi.fn((cb: typeof onFocus) => {
        onFocus = cb
        return () => {}
      })
    },
    config: { watchProject: vi.fn(async () => {}), onChanged: vi.fn(() => () => {}) }
  }
}

// Full-tree renders and many simulated keystrokes: well under 5 s idle, but they approach it under parallel CPU load.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  seq = 0
  queryClient.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, drafts: {}, lastActive: {}, draftModels: {} })
  useWorkspaceStore.setState({
    cwd: CWD,
    extraCwds: [],
    activeConvId: undefined,
    activeTitle: undefined,
    activeBranch: undefined,
    loadingSession: false,
    view: 'chat',
    terminalOpen: false,
    tabs: [],
    unread: {},
    pendingClose: undefined
  })
  window.localStorage.clear()
  vi.mocked(toast).mockClear()
  api = makeApi()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})

const ws = (): ReturnType<typeof useWorkspaceStore.getState> => useWorkspaceStore.getState()
const chat = (): ReturnType<typeof useChatStore.getState> => useChatStore.getState()
const emit = (localId: string, event: SessionEvent): void => {
  chat().applyEvent(localId, event)
  flushChatEvents()
}
const result = (): SessionEvent => ({
  t: 'result',
  costUsd: 0.01,
  durationMs: 10,
  turns: 1,
  usage: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 },
  isError: false
})

describe('opening and switching', () => {
  it('opening a history session twice activates the same tab', async () => {
    await ws().openSession(hist('s-1'))
    await ws().newTab()
    expect(ws().tabs).toHaveLength(2)
    await ws().openSession(hist('s-1'))
    expect(ws().tabs).toHaveLength(2)
    expect(ws().activeConvId).toBe('hist-s-1')
    expect(api.history.load).toHaveBeenCalledTimes(1)
  })

  it('a draft typed in tab A survives a switch to B and back', async () => {
    const user = userEvent.setup()
    render(<AppShell />)
    await ws().openSession(hist('s-1'))
    await ws().openSession(hist('s-2'))
    await user.click(await screen.findByRole('tab', { name: /s-1/ }))
    const box = await screen.findByLabelText('Message')
    await user.type(box, 'half a thought')
    await user.click(screen.getByRole('tab', { name: /s-2/ }))
    expect(await screen.findByLabelText('Message')).toHaveValue('')
    await user.click(screen.getByRole('tab', { name: /s-1/ }))
    expect(await screen.findByLabelText('Message')).toHaveValue('half a thought')
  })

  it('newTab reuses an empty draft tab of the same project', () => {
    ws().newTab()
    ws().newTab()
    expect(ws().tabs).toHaveLength(1)
    chat().setDraft(ws().activeConvId!, 'typing')
    ws().newTab()
    expect(ws().tabs).toHaveLength(2)
  })

  it('selectProject activates the most recent tab of that project', async () => {
    await ws().openSession(hist('s-1'))
    await ws().openSession(hist('s-2'))
    ws().selectProject(CWD)
    expect(ws().activeConvId).toBe('hist-s-2')
    expect(ws().tabs).toHaveLength(2)
  })
})

describe('the 5-session cap', () => {
  const bindLive = (n: number): void => {
    for (let i = 1; i <= n; i++) {
      chat().createConv({ convId: `c${i}`, cwd: CWD, localId: `Lx${i}` })
      chat().applyEvent(`Lx${i}`, { t: 'init', sessionId: `sess${i}`, model: 'm', tools: [], mcp: [], slashCommands: [], cwd: CWD })
      chat().touchConv(`c${i}`)
    }
    flushChatEvents()
  }

  it('the 6th start suspends the least recently used idle conversation, and its next submit resumes', async () => {
    bindLive(5)
    useChatStore.setState((s) => ({ lastActive: { ...s.lastActive, c3: 1 } })) // oldest
    chat().createConv({ convId: 'c6', cwd: CWD })
    await chat().submit('c6', 'go')
    expect(api.session.close).toHaveBeenCalledWith('Lx3')
    expect(chat().convs['c3']!.localId).toBeUndefined()
    expect(chat().convs['c3']!.resumeSessionId).toBe('sess3')
    expect(api.session.start).toHaveBeenCalledWith({ cwd: CWD, prompt: 'go' })
    // Resume on demand: the suspended conversation's next submit starts with resumeId.
    await chat().submit('c3', 'again')
    expect(api.session.start).toHaveBeenLastCalledWith({ cwd: CWD, prompt: 'again', resumeId: 'sess3' })
  })

  it('with 5 busy conversations the start fails with the D2 message', async () => {
    bindLive(5)
    for (let i = 1; i <= 5; i++) emit(`Lx${i}`, { t: 'status', state: 'running' })
    chat().createConv({ convId: 'c6', cwd: CWD })
    await chat().submit('c6', 'go')
    expect(api.session.start).not.toHaveBeenCalled()
    expect(api.session.close).not.toHaveBeenCalled()
    const last = chat().convs['c6']!.items.at(-1)
    expect(last).toMatchObject({ kind: 'error', message: '5 sessions are active. Stop or close one to start another.' })
    expect(chat().drafts['c6']).toBe('go')
  })

  it('events from a suspended session are ignored', async () => {
    bindLive(5)
    chat().createConv({ convId: 'c6', cwd: CWD })
    await chat().submit('c6', 'go')
    const victim = Object.values(chat().convs).find((c) => !c.localId && c.convId !== 'c6')!
    emit(`Lx${victim.convId.slice(1)}`, { t: 'session_closed' })
    expect(chat().convs[victim.convId]!.closed).toBeUndefined()
  })
})

describe('closing', () => {
  it('closing a running tab asks first, then interrupts and closes', async () => {
    render(<AppShell />)
    ws().newTab()
    const id = ws().activeConvId!
    await chat().submit(id, 'work')
    emit('L1', { t: 'status', state: 'running' })
    await act(async () => {
      await ws().closeTab(id)
    })
    expect(api.session.close).not.toHaveBeenCalled()
    expect(await screen.findByTestId('close-tab-dialog')).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Stop and close' }))
    await waitFor(() => expect(api.session.close).toHaveBeenCalledWith('L1'))
    expect(api.session.interrupt).toHaveBeenCalledWith('L1')
    expect(api.session.interrupt.mock.invocationCallOrder[0]).toBeLessThan(api.session.close.mock.invocationCallOrder[0]!)
    expect(ws().tabs.find((t) => t.convId === id)).toBeUndefined()
  })

  it('an idle tab closes without asking; the neighbour becomes active', async () => {
    await ws().openSession(hist('s-1'))
    await ws().openSession(hist('s-2'))
    await ws().closeTab('hist-s-2')
    expect(ws().pendingClose).toBeUndefined()
    expect(ws().activeConvId).toBe('hist-s-1')
    expect(chat().convs['hist-s-2']).toBeUndefined()
  })
})

describe('status and attention', () => {
  it('derives running / waiting / error / unread, and unread clears on activation', async () => {
    await ws().openSession(hist('s-1'))
    await ws().openSession(hist('s-2'))
    chat().bindLocalId('hist-s-1', 'LA')
    render(<TabStrip />)
    const statusOf = (id: string): string | null =>
      document.querySelector(`[data-conv-id="${id}"]`)!.getAttribute('data-status')
    expect(statusOf('hist-s-1')).toBe('idle')
    act(() => emit('LA', { t: 'status', state: 'running' }))
    expect(statusOf('hist-s-1')).toBe('running')
    act(() => emit('LA', { t: 'permission_request', reqId: 'r1', toolName: 'Bash', input: {} }))
    act(() => emit('LA', { t: 'status', state: 'waiting_permission' }))
    expect(statusOf('hist-s-1')).toBe('waiting')
    act(() => emit('LA', { t: 'status', state: 'error' }))
    expect(tabStatus(chat().convs['hist-s-1'], false)).not.toBe('running')
    act(() => emit('LA', { t: 'status', state: 'idle' }))
    act(() => emit('LA', result()))
    expect(ws().unread['hist-s-1']).toBe(true)
    expect(statusOf('hist-s-1')).toBe('unread')
    act(() => ws().activateTab('hist-s-1'))
    expect(ws().unread['hist-s-1']).toBeUndefined()
    expect(statusOf('hist-s-1')).toBe('idle')
  })

  it('a background permission_request raises the toast, and Show activates the tab', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<AppShell />)
    await ws().openSession(hist('s-1', 'Parser work'))
    chat().bindLocalId('hist-s-1', 'LB')
    await ws().openSession(hist('s-2'))
    act(() => emit('LB', { t: 'permission_request', reqId: 'r9', toolName: 'Bash', input: {} }))
    expect(toast).toHaveBeenCalledTimes(1)
    const [msg, opts] = vi.mocked(toast).mock.calls[0]!
    expect(msg).toBe('Parser work needs approval')
    const action = opts!.action as unknown as { onClick: () => void }
    act(() => action.onClick())
    expect(ws().activeConvId).toBe('hist-s-1')
  })

  it('no toast for the active tab', async () => {
    vi.spyOn(document, 'hasFocus').mockReturnValue(true)
    render(<AppShell />)
    await ws().openSession(hist('s-1'))
    chat().bindLocalId('hist-s-1', 'LB')
    act(() => emit('LB', { t: 'permission_request', reqId: 'r9', toolName: 'Bash', input: {} }))
    expect(toast).not.toHaveBeenCalled()
  })
})

describe('tabs.v1 persistence', () => {
  it('serializes only tabs with sessions and round-trips', () => {
    const now = Date.now()
    const raw = serializeTabs(
      [
        { convId: 'new-1', cwd: CWD, openedAt: now, lastActiveAt: now },
        { convId: 'new-2', cwd: CWD, sessionId: 'sx', title: 'T', openedAt: now, lastActiveAt: now }
      ],
      'new-2'
    )
    expect(raw).toEqual({ tabs: [{ convId: 'hist-sx', cwd: CWD, sessionId: 'sx', title: 'T' }], activeConvId: 'hist-sx' })
    expect(parseTabs(JSON.stringify(raw))).toEqual(raw)
    expect(parseTabs('{nope')).toBeUndefined()
    expect(parseTabs(JSON.stringify({ tabs: 5 }))).toBeUndefined()
  })

  it('writes debounced, and restore creates history tabs without loading transcripts until activated', async () => {
    vi.useFakeTimers()
    const off = startTabPersistence()
    await ws().openSession(hist('s-1', 'One'))
    await ws().openSession(hist('s-2', 'Two'))
    expect(window.localStorage.getItem(TABS_KEY)).toBeNull()
    vi.advanceTimersByTime(300)
    off()
    vi.useRealTimers()
    const saved = readPersistedTabs()!
    expect(saved.tabs.map((t) => t.sessionId)).toEqual(['s-1', 's-2'])
    expect(saved.activeConvId).toBe('hist-s-2')

    // A new window: empty stores, same localStorage.
    useChatStore.setState({ convs: {}, localToConv: {} })
    useWorkspaceStore.setState({ tabs: [], activeConvId: undefined })
    api.history.load.mockClear()
    // Mark s-1 as the active one to be restored.
    ws().restoreTabs({ ...saved, activeConvId: 'hist-s-1' })
    expect(ws().tabs).toHaveLength(2)
    await waitFor(() => expect(api.history.load).toHaveBeenCalledTimes(1))
    expect(api.history.load).toHaveBeenCalledWith({ sessionId: 's-1', cwd: CWD })
    expect(chat().convs['hist-s-2']!.items).toHaveLength(0)
    ws().activateTab('hist-s-2')
    await waitFor(() => expect(api.history.load).toHaveBeenCalledTimes(2))
    ws().activateTab('hist-s-1')
    expect(api.history.load).toHaveBeenCalledTimes(2)
  })
})

describe('shortcuts', () => {
  it('Ctrl+W inside .xterm does nothing; elsewhere it closes the tab', async () => {
    render(
      <>
        <AppShell />
        <div className="xterm">
          <textarea aria-label="term" />
        </div>
      </>
    )
    await ws().openSession(hist('s-1'))
    fireEvent.keyDown(screen.getByLabelText('term'), { key: 'w', ctrlKey: true })
    expect(ws().tabs.some((t) => t.convId === 'hist-s-1')).toBe(true)
    fireEvent.keyDown(document.body, { key: 'w', ctrlKey: true })
    await waitFor(() => expect(ws().tabs.some((t) => t.convId === 'hist-s-1')).toBe(false))
  })

  it('Ctrl+Tab cycles, Ctrl+Shift+Tab goes back, Ctrl+1 and Ctrl+9 jump', async () => {
    render(<AppShell />)
    await ws().openSession(hist('s-1'))
    await ws().openSession(hist('s-2'))
    await ws().openSession(hist('s-3'))
    fireEvent.keyDown(document.body, { key: 'Tab', ctrlKey: true })
    expect(ws().activeConvId).toBe('hist-s-1')
    fireEvent.keyDown(document.body, { key: 'Tab', ctrlKey: true, shiftKey: true })
    expect(ws().activeConvId).toBe('hist-s-3')
    fireEvent.keyDown(document.body, { key: '2', ctrlKey: true })
    expect(ws().activeConvId).toBe('hist-s-2')
    fireEvent.keyDown(document.body, { key: '9', ctrlKey: true })
    expect(ws().activeConvId).toBe('hist-s-3')
  })

  it('Ctrl+T opens a tab', () => {
    render(<AppShell />)
    fireEvent.keyDown(document.body, { key: 't', ctrlKey: true })
    expect(ws().tabs).toHaveLength(1)
  })
})

describe('main integration', () => {
  it('onFocusSession activates the right tab and the chat view', async () => {
    const off = initIpcBridge()
    await ws().openSession(hist('s-1'))
    chat().bindLocalId('hist-s-1', 'LF')
    await ws().openSession(hist('s-2'))
    useWorkspaceStore.setState({ view: 'git' })
    act(() => onFocus({ localId: 'LF' }))
    expect(ws().activeConvId).toBe('hist-s-1')
    expect(ws().view).toBe('chat')
    off()
  })

  it('setActiveSession is sent on activation and on bind', async () => {
    const off = initIpcBridge()
    expect(api.app.setActiveSession).toHaveBeenLastCalledWith(null)
    await ws().openSession(hist('s-1'))
    expect(api.app.setActiveSession).toHaveBeenLastCalledWith(null) // not bound yet: still null, not re-sent
    act(() => chat().bindLocalId('hist-s-1', 'LS'))
    expect(api.app.setActiveSession).toHaveBeenLastCalledWith('LS')
    await ws().openSession(hist('s-2'))
    expect(api.app.setActiveSession).toHaveBeenLastCalledWith(null)
    act(() => ws().activateTab('hist-s-1'))
    expect(api.app.setActiveSession).toHaveBeenLastCalledWith('LS')
    off()
  })
})

describe('title bar layout', () => {
  it('keeps the strip no-drag and a drag gap', () => {
    render(<TitleBar />)
    const strip = screen.getByTestId('tab-strip')
    expect(strip.style.getPropertyValue('-webkit-app-region') || (strip.style as unknown as Record<string, string>)['WebkitAppRegion']).toBe('no-drag')
    const gap = screen.getByTestId('title-drag-gap')
    expect((gap.style as unknown as Record<string, string>)['WebkitAppRegion'] ?? gap.style.getPropertyValue('-webkit-app-region')).toBe('drag')
    expect(within(screen.getByTestId('title-bar')).getByRole('button', { name: 'New tab' })).toBeInTheDocument()
  })
})
