import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { onRunInTerminal, resetTerminalBus } from '@/lib/terminal-bus'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { eventFixtures } from './model/fixtures'

const target = { convId: 'c1', cwd: 'C:\\fixture\\proj' }

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 600 })
  Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 60 })
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
  HTMLElement.prototype.getBoundingClientRect = () =>
    ({ width: 800, height: 60, top: 0, left: 0, right: 800, bottom: 60, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect
  class RO {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', RO)
  HTMLElement.prototype.scrollIntoView = () => {}
})

const api = {
  session: {
    start: vi.fn().mockResolvedValue({ localId: 'L1' }),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    setModel: vi.fn().mockResolvedValue(undefined),
    supportedModels: vi.fn(),
    permissionReply: vi.fn().mockResolvedValue(undefined)
  },
  history: { listProjects: vi.fn().mockResolvedValue([]), load: vi.fn() }
}

const MODELS = [
  { value: 'default', displayName: 'Default (recommended)' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'claude-opus-4-1-20250805', displayName: 'Opus 4.1' }
]

// Full-tree renders and many simulated keystrokes: well under 5 s idle, but they approach it under parallel CPU load.
vi.setConfig({ testTimeout: 20_000 })

beforeEach(() => {
  vi.clearAllMocks()
  window.localStorage.clear()
  resetTerminalBus()
  api.session.supportedModels.mockResolvedValue(MODELS)
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {}, draftModels: {} })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})
afterEach(() => vi.useRealTimers())

function seedLive(events: SessionEvent[] = []): void {
  useChatStore.getState().createConv({ ...target, localId: 'L1' })
  useChatStore.getState().seedFromHistory(target.convId, events)
}

async function openModelMenu(): Promise<void> {
  const trigger = screen.getByRole('button', { name: /^Model:/ })
  trigger.focus()
  await userEvent.keyboard('{Enter}')
  await screen.findByRole('menu')
}

describe('model picker', () => {
  it('lists aliases first and full ids under More; a live change calls setModel and updates the chip', async () => {
    seedLive([{ t: 'init', sessionId: 's', model: 'sonnet', tools: [], mcp: [], slashCommands: [], cwd: target.cwd } as SessionEvent])
    render(<Composer convId="c1" />)
    await waitFor(() => expect(api.session.supportedModels).toHaveBeenCalledWith('L1'))
    await waitFor(() => expect(window.localStorage.getItem('ccwrap.models')).toContain('claude-opus-4-1-20250805'))
    await openModelMenu()
    expect(screen.getAllByTestId('model-option')).toHaveLength(3)
    expect(screen.queryByText('Opus 4.1')).toBeNull()
    await userEvent.click(screen.getByText(/More models \(1\)/))
    expect(await screen.findByText('Opus 4.1')).toBeInTheDocument()
    await userEvent.click(screen.getByText('Opus 4.1'))
    await waitFor(() => expect(api.session.setModel).toHaveBeenCalledWith('L1', 'claude-opus-4-1-20250805'))
    await waitFor(() => expect(useChatStore.getState().convs.c1!.meta.model).toBe('claude-opus-4-1-20250805'))
    expect(screen.getByRole('button', { name: 'Model: Opus 4.1' })).toBeInTheDocument()
  })

  it('a draft model goes into session.start and not into setModel', async () => {
    useChatStore.getState().createConv(target)
    render(<Composer convId="c1" />)
    await openModelMenu()
    // fallback list is used for a draft (no live session to ask)
    await userEvent.click(screen.getByRole('menuitem', { name: 'Opus' }))
    expect(api.session.setModel).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText('Message'), 'hello{Enter}')
    await waitFor(() => expect(api.session.start).toHaveBeenCalledTimes(1))
    expect(api.session.start.mock.calls[0]![0]).toMatchObject({ model: 'opus', prompt: 'hello' })
  })
})

describe('permission rules', () => {
  const ask = (): void => {
    seedLive([
      {
        t: 'permission_request',
        reqId: 'r1',
        toolName: 'Bash',
        input: { command: 'npm test' },
        ruleLabel: 'Bash(npm test:*)',
        ruleLabels: ['Bash(npm test:*)', 'Bash(npm run:*)']
      }
    ])
  }

  it('renders every rule label', () => {
    ask()
    render(<ChatView target={target} />)
    const rules = screen.getByTestId('perm-rules')
    expect(within(rules).getByText('Bash(npm test:*)')).toBeInTheDocument()
    expect(within(rules).getByText('Bash(npm run:*)')).toBeInTheDocument()
  })

  it('Always allow defaults to this project (always)', async () => {
    ask()
    render(<ChatView target={target} />)
    await userEvent.click(screen.getByRole('button', { name: 'Always allow' }))
    await waitFor(() =>
      expect(api.session.permissionReply).toHaveBeenCalledWith(expect.objectContaining({ reqId: 'r1', remember: 'always' }))
    )
  })

  it('All projects sends remember:"user"; This session sends "session"', async () => {
    ask()
    const { unmount } = render(<ChatView target={target} />)
    const pick = async (name: string): Promise<void> => {
      const t = screen.getByRole('button', { name: /Choose where to save/ })
      t.focus()
      await userEvent.keyboard('{Enter}')
      await userEvent.click(await screen.findByRole('menuitem', { name }))
    }
    await pick('All projects')
    await waitFor(() =>
      expect(api.session.permissionReply).toHaveBeenLastCalledWith(expect.objectContaining({ remember: 'user' }))
    )
    unmount()
    useChatStore.setState({ convs: {}, localToConv: {} })
    ask()
    render(<ChatView target={target} />)
    await pick('This session')
    await waitFor(() =>
      expect(api.session.permissionReply).toHaveBeenLastCalledWith(expect.objectContaining({ remember: 'session' }))
    )
  })
})

describe('tab focus vs stick-to-bottom', () => {
  it('focusing an earlier card does not snap back to the bottom when content grows', async () => {
    seedLive(eventFixtures.toolEditTurn)
    render(<ChatView target={target} />)
    const list = screen.getByTestId('message-list')
    let top = 120
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 5000 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) })
    const rows = await screen.findAllByTestId('message-row')
    expect(rows.length).toBeGreaterThan(1)
    const first = rows[0]!
    const focusable = first.querySelector('button') ?? first
    act(() => {
      fireEvent.focusIn(focusable)
    })
    top = 120
    act(() => {
      useChatStore.getState().applyEvent('L1', { t: 'user_message', text: 'more' })
    })
    expect(top).toBe(120)
  })

  it('still sticks to the bottom when nothing was focused', async () => {
    seedLive(eventFixtures.toolEditTurn)
    render(<ChatView target={target} />)
    const list = screen.getByTestId('message-list')
    let top = 0
    Object.defineProperty(list, 'scrollHeight', { configurable: true, get: () => 5000 })
    Object.defineProperty(list, 'scrollTop', { configurable: true, get: () => top, set: (v: number) => (top = v) })
    act(() => {
      useChatStore.getState().applyEvent('L1', { t: 'user_message', text: 'more' })
    })
    expect(top).toBe(5000)
  })
})

describe('truncated history notice', () => {
  it('shows for a 5 MB file with 2 events, not for a small one', async () => {
    api.history.load.mockResolvedValue([
      { t: 'user_message', text: 'a' },
      { t: 'assistant_message', msgId: 'm', blocks: [{ type: 'text', text: 'b' }] }
    ])
    const info = { sessionId: 's1', title: 't', cwd: target.cwd, lastModified: 1, fileSize: 5 * 1024 * 1024 }
    await useWorkspaceStore.getState().openSession(info)
    const convId = 'hist-s1'
    expect(useChatStore.getState().convs[convId]!.notice).toMatch(/incomplete/)
    render(<ChatView target={{ convId, cwd: target.cwd }} />)
    expect(screen.getByTestId('history-notice')).toHaveTextContent('History may be incomplete')

    await useWorkspaceStore.getState().openSession({ ...info, sessionId: 's2', fileSize: 1000 })
    expect(useChatStore.getState().convs['hist-s2']!.notice).toBeUndefined()
  })
})

describe('Run in terminal', () => {
  it('emits the Bash command and cwd on the bus', async () => {
    const got = vi.fn()
    onRunInTerminal(got)
    seedLive([
      { t: 'tool_use', toolUseId: 'tu1', name: 'Bash', input: { command: 'git status' } } as SessionEvent
    ])
    render(<ChatView target={target} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Run in terminal' }))
    expect(got).toHaveBeenCalledWith({ cwd: target.cwd, command: 'git status' })
  })
})
