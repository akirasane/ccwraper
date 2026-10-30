import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { HistorySessionInfo, ProjectInfo, SessionEvent } from '@shared/events'
import { queryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { AppShell } from './AppShell'

const projects: ProjectInfo[] = [
  { key: 'c:/fixture/alpha', cwd: 'C:\\fixture\\alpha', exists: true, sessionCount: 2, lastModified: 2000 },
  { key: 'c:/fixture/gone', cwd: 'C:\\fixture\\gone', exists: false, sessionCount: 1, lastModified: 1000 }
]
const sessions: HistorySessionInfo[] = [
  { sessionId: 's-1', title: 'Fix the parser', cwd: 'C:\\fixture\\alpha', gitBranch: 'main', lastModified: Date.now() - 3600_000 },
  { sessionId: 's-2', title: 'Add tests', cwd: 'C:\\fixture\\alpha', lastModified: Date.now() - 86_400_000 }
]
const replay: SessionEvent[] = [
  { t: 'user_message', text: 'hello from history' },
  { t: 'assistant_message', msgId: 'm1', blocks: [{ type: 'text', text: 'hi' }] }
]

let onEvent: (p: { localId: string; event: SessionEvent }) => void = () => {}
let api: ReturnType<typeof makeApi>

function makeApi() {
  return {
    session: {
      start: vi.fn(async () => ({ localId: 'L1' })),
      send: vi.fn(async () => {}),
      interrupt: vi.fn(async () => {}),
      close: vi.fn(async () => {}),
      setModel: vi.fn(async () => {}),
      setPermissionMode: vi.fn(async () => {}),
      permissionReply: vi.fn(async () => {}),
      onEvent: vi.fn((cb: typeof onEvent) => {
        onEvent = cb
        return () => {}
      })
    },
    dialog: { pickDirectory: vi.fn(async () => null as string | null) },
    history: {
      listProjects: vi.fn(async () => projects),
      list: vi.fn(async () => sessions),
      load: vi.fn(async () => replay)
    },
    app: { info: vi.fn(async () => ({ claudeVersion: '2.1.0', claudeSource: 'bundled', sdkVersion: '0.3.0', platform: 'win32' })) }
  }
}

// Full-tree renders and many simulated keystrokes: well under 5 s idle, but they approach it under parallel CPU load.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.unstubAllGlobals()
  queryClient.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useWorkspaceStore.setState({ cwd: undefined, extraCwds: [], activeConvId: undefined, activeTitle: undefined, activeBranch: undefined, loadingSession: false })
  window.localStorage.clear()
  api = makeApi()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})

async function openPicker(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /select a project|alpha/i }))
  return screen.findByRole('listbox', { name: 'Projects' })
}

describe('AppShell', () => {
  it('lists projects and flags missing folders as disabled', async () => {
    const user = userEvent.setup()
    render(<AppShell />)
    const list = await openPicker(user)
    const alpha = await within(list).findByRole('option', { name: /alpha/ })
    const gone = within(list).getByRole('option', { name: /gone/ })
    expect(alpha).not.toHaveAttribute('aria-disabled')
    expect(gone).toHaveAttribute('aria-disabled', 'true')
    await user.click(gone)
    expect(useWorkspaceStore.getState().cwd).toBeUndefined()
  })

  it('selecting a project persists it, starts a draft chat and lists sessions', async () => {
    const user = userEvent.setup()
    render(<AppShell />)
    const list = await openPicker(user)
    await user.click(await within(list).findByRole('option', { name: /alpha/ }))
    expect(window.localStorage.getItem('ccwrap.lastCwd')).toBe('C:\\fixture\\alpha')
    expect(await screen.findByTestId('chat-view')).toBeInTheDocument()
    expect(await screen.findByText('Fix the parser')).toBeInTheDocument()
    expect(api.history.list).toHaveBeenCalledWith({ cwd: 'C:\\fixture\\alpha' })
    expect(await screen.findByTestId('status-claude')).toHaveTextContent('claude 2.1.0')
  })

  it('subscribes to session events once at startup', async () => {
    render(<AppShell />)
    await waitFor(() => expect(api.session.onEvent).toHaveBeenCalledTimes(1))
  })

  it('resume: history.load -> seed -> ChatView with resumeSessionId', async () => {
    window.localStorage.setItem('ccwrap.lastCwd', 'C:\\fixture\\alpha')
    useWorkspaceStore.setState({ cwd: 'C:\\fixture\\alpha' })
    const user = userEvent.setup()
    render(<AppShell />)
    await user.click(await screen.findByText('Fix the parser'))
    await waitFor(() =>
      expect(api.history.load).toHaveBeenCalledWith({ sessionId: 's-1', cwd: 'C:\\fixture\\alpha' })
    )
    const conv = await waitFor(() => {
      const c = useChatStore.getState().convs['hist-s-1']
      expect(c?.items.length).toBe(2)
      return c!
    })
    expect(conv.resumeSessionId).toBe('s-1')
    expect(screen.getByTestId('chat-view')).toHaveAttribute('data-conv-id', 'hist-s-1')

    // first send resumes
    await act(async () => {
      await useChatStore.getState().submit('hist-s-1', 'continue')
    })
    expect(api.session.start).toHaveBeenCalledWith(expect.objectContaining({ resumeId: 's-1', cwd: 'C:\\fixture\\alpha' }))
  })

  it('restored last project that is missing disables starting', async () => {
    useWorkspaceStore.setState({ cwd: 'C:\\FIXTURE\\gone' })
    render(<AppShell />)
    expect(await screen.findByText('Folder not found')).toBeInTheDocument()
    expect(screen.queryByTestId('chat-view')).toBeNull()
    expect(screen.getByRole('button', { name: /new session/i })).toBeDisabled()
  })

  it('status bar: shows latest cost (not a sum) and ctx %', async () => {
    // Reduced motion makes CostMeter settle immediately instead of running a 600 ms rAF tick,
    // which is what timed out under CPU load.
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: true, media: query, addEventListener() {}, removeEventListener() {} }))
    useWorkspaceStore.setState({ cwd: 'C:\\fixture\\alpha' })
    render(<AppShell />)
    await screen.findByTestId('chat-view')
    const localId = 'L9'
    const convId = useWorkspaceStore.getState().activeConvId!
    act(() => useChatStore.getState().bindLocalId(convId, localId))
    const usage = { inputTokens: 1000, outputTokens: 10, cacheReadTokens: 3000, cacheCreationTokens: 1000 }
    const result = (costUsd: number): SessionEvent => ({
      t: 'result', costUsd, durationMs: 1, turns: 1, usage, isError: false, contextWindow: 10000
    })
    act(() => onEvent({ localId, event: { t: 'init', sessionId: 'x', model: 'opus-test', tools: [], mcp: [], slashCommands: [], cwd: 'C:\\fixture\\alpha' } }))
    act(() => onEvent({ localId, event: result(0.5) }))
    act(() => onEvent({ localId, event: result(0.75) }))
    await waitFor(() => expect(screen.getByTestId('cost-meter')).toHaveTextContent('$0.7500'), )
    expect(screen.getByTestId('cost-meter')).toHaveAttribute('data-value', '0.75')
    expect(screen.getByTestId('status-ctx')).toHaveTextContent('ctx 50%')
    // display name (family match), the raw id stays in the title
    expect(screen.getByTestId('status-model')).toHaveTextContent('Opus')
    expect(screen.getByTestId('status-model')).toHaveAttribute('title', 'opus-test')
  })

  it('shows the interrupt button while running and calls interrupt', async () => {
    useWorkspaceStore.setState({ cwd: 'C:\\fixture\\alpha' })
    const user = userEvent.setup()
    render(<AppShell />)
    await screen.findByTestId('chat-view')
    const convId = useWorkspaceStore.getState().activeConvId!
    expect(screen.queryByRole('button', { name: 'Interrupt' })).toBeNull()
    act(() => useChatStore.getState().bindLocalId(convId, 'L2'))
    act(() => onEvent({ localId: 'L2', event: { t: 'status', state: 'running' } }))
    await user.click(await screen.findByRole('button', { name: 'Interrupt' }))
    expect(api.session.interrupt).toHaveBeenCalledWith('L2')
  })

  it('permission-mode selector calls setPermissionMode', async () => {
    useWorkspaceStore.setState({ cwd: 'C:\\fixture\\alpha' })
    const user = userEvent.setup()
    render(<AppShell />)
    await screen.findByTestId('chat-view')
    const convId = useWorkspaceStore.getState().activeConvId!
    act(() => useChatStore.getState().bindLocalId(convId, 'L3'))
    await user.selectOptions(screen.getByRole('combobox', { name: 'Permission mode' }), 'plan')
    expect(api.session.setPermissionMode).toHaveBeenCalledWith('L3', 'plan')
  })

  it('open folder uses the dialog and selects the folder', async () => {
    api.dialog.pickDirectory.mockResolvedValueOnce('C:\\fixture\\new')
    const user = userEvent.setup()
    render(<AppShell />)
    const list = await openPicker(user)
    await user.click(within(list).getByRole('button', { name: /open folder/i }))
    await waitFor(() => expect(useWorkspaceStore.getState().cwd).toBe('C:\\fixture\\new'))
  })
})
