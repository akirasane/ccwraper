import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'
import { ChatView } from './ChatView'
import { Composer } from './Composer'
import { Markdown } from './Markdown'
import { eventFixtures } from './model/fixtures'
import { ThinkingBlock } from './ThinkingBlock'

const target = { convId: 'c1', cwd: 'C:\\fixture\\proj' }

// jsdom has no layout: give the scroller a viewport and every row a height so the virtualizer can work.
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
})

const api = {
  session: {
    start: vi.fn().mockResolvedValue({ localId: 'L1' }),
    send: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    permissionReply: vi.fn().mockResolvedValue(undefined)
  },
  history: { listProjects: vi.fn().mockResolvedValue([]) }
}

function seed(events: SessionEvent[], local = 'L1'): void {
  useChatStore.getState().createConv({ ...target, localId: local })
  useChatStore.getState().seedFromHistory(target.convId, events)
}

beforeEach(() => {
  vi.clearAllMocks()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})
afterEach(() => vi.useRealTimers())

describe('ChatView with fixtures', () => {
  it('renders the text turn, thinking collapsed and expandable', async () => {
    seed(eventFixtures.textTurn)
    render(<ChatView target={target} />)
    expect(await screen.findByTestId('assistant-message')).toBeInTheDocument()
    const toggle = screen.getByRole('button', { name: /thought/i })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByText('Let me think.')).not.toBeInTheDocument()
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(screen.getByText('Let me think.')).toBeInTheDocument()
  })

  it('renders a tool item through ToolCard by id', async () => {
    seed(eventFixtures.toolEditTurn)
    render(<ChatView target={target} />)
    expect((await screen.findAllByTestId('tool-card')).length).toBeGreaterThan(0)
  })

  it('shows the streaming caret container while a message streams', async () => {
    useChatStore.getState().createConv({ ...target, localId: 'L1' })
    useChatStore.getState().applyEvent('L1', { t: 'status', state: 'running' })
    useChatStore.getState().applyEvent('L1', { t: 'text_delta', msgId: 'm', text: 'Hello **wor' })
    await act(async () => {
      const { flushChatEvents } = await import('@/stores/chat-store')
      flushChatEvents()
    })
    render(<ChatView target={target} />)
    const st = await screen.findByTestId('streaming-text')
    expect(st).toHaveAttribute('data-streaming', 'true')
    expect(st).toHaveClass('ccw-streaming')
  })

  it('keeps the DOM bounded for 2,000 items', async () => {
    useChatStore.getState().createConv({ ...target, localId: 'L1' })
    const events: SessionEvent[] = []
    for (let i = 0; i < 1000; i++) {
      events.push({ t: 'user_message', text: `question ${i}` })
      events.push({ t: 'assistant_message', msgId: `m${i}`, blocks: [{ type: 'text', text: `answer ${i}` }] })
    }
    useChatStore.getState().seedFromHistory(target.convId, events)
    expect(useChatStore.getState().convs.c1!.items).toHaveLength(2000)
    render(<ChatView target={target} />)
    const rows = await screen.findAllByTestId('message-row')
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThan(60)
  })
})

describe('Markdown', () => {
  it('renders a code block with a language label and plain text before highlighting', async () => {
    render(<Markdown text={'Intro\n\n```ts\nconst a = 1\n```\n'} />)
    const block = screen.getByTestId('code-block')
    expect(block).toHaveAttribute('data-lang', 'ts')
    expect(block).toHaveTextContent('const a = 1')
    // shiki (JS engine) swaps in highlighted token spans
    await waitFor(() => expect(block.querySelector('[data-highlighted] span')).not.toBeNull(), { timeout: 8000 })
  }, 15000)

  it('renders gfm and inline code', () => {
    render(<Markdown text={'a `x` b\n\n| h |\n|---|\n| v |\n'} />)
    expect(screen.getByText('x').tagName).toBe('CODE')
    expect(screen.getByRole('table')).toBeInTheDocument()
  })
})

describe('ThinkingBlock', () => {
  it('labels duration', () => {
    render(<ThinkingBlock text="t" startedAt={1000} endedAt={4000} />)
    expect(screen.getByText('Thought for 3s')).toBeInTheDocument()
  })
  it('empty thinking text is a plain label, not an expandable control', () => {
    render(<ThinkingBlock text="" />)
    expect(screen.getByText('Thought')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
  })
  it('shimmers while active', () => {
    render(<ThinkingBlock text="t" active />)
    expect(screen.getByText('Thinking')).toHaveClass('ccw-shimmer')
  })
})

describe('Working indicator', () => {
  it('shows for the whole running turn (also while text streams) and hides at idle', async () => {
    seed([])
    useChatStore.getState().applyEvent('L1', { t: 'status', state: 'running' })
    render(<ChatView target={target} />)
    expect(screen.getByTestId('working-indicator')).toBeInTheDocument()
    act(() => useChatStore.getState().applyEvent('L1', { t: 'text_delta', msgId: 'm', text: 'hi' }))
    await screen.findByText('hi')
    expect(screen.getByTestId('working-indicator')).toBeInTheDocument()
    act(() => useChatStore.getState().applyEvent('L1', { t: 'status', state: 'idle' }))
    await waitFor(() => expect(screen.queryByTestId('working-indicator')).toBeNull())
  })
})

describe('Composer', () => {
  it('Enter submits (starts the session), Shift+Enter adds a newline', async () => {
    useChatStore.getState().createConv(target)
    render(<Composer convId="c1" />)
    const box = screen.getByLabelText('Message')
    await userEvent.type(box, 'hi{Shift>}{Enter}{/Shift}there')
    expect(box).toHaveValue('hi\nthere')
    await userEvent.type(box, '{Enter}')
    await waitFor(() => expect(api.session.start).toHaveBeenCalledTimes(1))
    expect(api.session.start.mock.calls[0]![0]).toMatchObject({ cwd: target.cwd, prompt: 'hi\nthere' })
    expect(box).toHaveValue('')
  })

  it('does not send empty text', async () => {
    useChatStore.getState().createConv(target)
    render(<Composer convId="c1" />)
    await userEvent.type(screen.getByLabelText('Message'), '   {Enter}')
    expect(api.session.start).not.toHaveBeenCalled()
  })

  it('Esc while running calls interrupt; the stop button too', async () => {
    seed([{ t: 'status', state: 'running' }])
    render(<Composer convId="c1" />)
    expect(screen.getByText(/to interrupt/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    await waitFor(() => expect(api.session.interrupt).toHaveBeenCalledWith('L1'))
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }))
    expect(api.session.interrupt).toHaveBeenCalledTimes(2)
  })

  it('Esc while idle does nothing', () => {
    seed([{ t: 'status', state: 'idle' }])
    render(<Composer convId="c1" />)
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(api.session.interrupt).not.toHaveBeenCalled()
  })

  it('mode chip cycles default -> acceptEdits -> plan', async () => {
    useChatStore.getState().createConv({ ...target, localId: 'L1' })
    render(<Composer convId="c1" />)
    const chip = () => screen.getByRole('button', { name: /Permission mode/ })
    expect(chip()).toHaveTextContent('Default')
    await userEvent.click(chip())
    expect(api.session.setPermissionMode).toHaveBeenLastCalledWith('L1', 'acceptEdits')
    expect(chip()).toHaveTextContent('Accept edits')
    await userEvent.click(chip())
    expect(api.session.setPermissionMode).toHaveBeenLastCalledWith('L1', 'plan')
  })

  it('is disabled when asked (missing cwd)', () => {
    useChatStore.getState().createConv(target)
    render(<Composer convId="c1" disabled disabledReason="gone" />)
    expect(screen.getByLabelText('Message')).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
  })

  it('ChatView disables the composer when the project does not exist', async () => {
    api.history.listProjects.mockResolvedValueOnce([
      { key: 'c:/fixture/proj', cwd: 'C:\\fixture\\proj', exists: false, sessionCount: 1, lastModified: 0 }
    ])
    render(<ChatView target={target} />)
    await waitFor(() => expect(screen.getByLabelText('Message')).toBeDisabled())
  })
})
