import { QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { StatusBar } from '@/app/shell/StatusBar'
import { nowSubscriberCount, useNow } from '@/lib/use-now'
import { queryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { ChatView } from '../ChatView'
import { modelLabel } from '../ModelMenu'
import { eventFixtures } from '../model/fixtures'
import { createConvState, reduce, reduceAll } from '../model/reducer'
import type { ConvState } from '../model/types'
import { formatElapsed, formatTokens } from './format'
import { TokenCount } from './TokenCount'

const target = { convId: 'c1', cwd: 'C:\\fixture\\proj' }
const T0 = 1_000_000

beforeAll(() => {
  Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: () => 900 })
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
    stopTask: vi.fn().mockResolvedValue(undefined),
    setPermissionMode: vi.fn().mockResolvedValue(undefined),
    permissionReply: vi.fn().mockResolvedValue(undefined)
  },
  history: { listProjects: vi.fn().mockResolvedValue([]) },
  app: { info: vi.fn().mockResolvedValue({ claudeVersion: '2.1.0', claudeSource: 'bundled', sdkVersion: '0', platform: 'win32' }) }
}

const put = (c: ConvState): void => useChatStore.setState({ convs: { c1: { ...c, localId: 'L1' } }, localToConv: { L1: 'c1' } })
const feed = (e: SessionEvent): void =>
  act(() => {
    useChatStore.setState((s) => ({ convs: { ...s.convs, c1: reduce(s.convs['c1']!, e, Date.now()) } }))
  })
const tick = async (ms: number): Promise<void> => {
  await act(async () => {
    vi.advanceTimersByTime(ms)
  })
}
const u = (out: number) => ({ inputTokens: 10, outputTokens: out, cacheReadTokens: 0, cacheCreationTokens: 0 })
const usageLive = (out: number, exact: boolean): SessionEvent => ({
  t: 'usage_live',
  contextTokens: 5000,
  contextOutputTokens: out,
  contextExact: exact,
  turn: u(out),
  exact,
  apiCalls: 1
})
const fresh = (): ConvState => createConvState(target)

beforeEach(() => {
  vi.useFakeTimers({ now: T0 })
  vi.clearAllMocks()
  queryClient.clear()
  window.localStorage.clear()
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useWorkspaceStore.setState({ activeConvId: undefined })
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('formatters', () => {
  it('formats tokens and elapsed', () => {
    expect(formatTokens(842)).toBe('842')
    expect(formatTokens(1234)).toBe('1.2k')
    expect(formatTokens(20726)).toBe('20.7k')
    expect(formatTokens(123456)).toBe('123k')
    expect(formatElapsed(12_400)).toBe('12s')
    expect(formatElapsed(65_000)).toBe('1m 05s')
  })
})

describe('useNow', () => {
  it('shares one subscription list, ticks per second, and releases on unmount', async () => {
    function Probe(): React.JSX.Element {
      return <span data-testid="p">{useNow(true)}</span>
    }
    const a = render(<Probe />)
    expect(nowSubscriberCount()).toBe(1)
    const first = Number(screen.getByTestId('p').textContent)
    await tick(2000)
    expect(Number(screen.getByTestId('p').textContent)).toBeGreaterThanOrEqual(first + 2000)
    a.unmount()
    expect(nowSubscriberCount()).toBe(0)
  })

  it('still ticks under prefers-reduced-motion', async () => {
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('reduce'), addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }))
    function Probe(): React.JSX.Element {
      return <span data-testid="p">{useNow(true)}</span>
    }
    render(<Probe />)
    const first = Number(screen.getByTestId('p').textContent)
    await tick(1000)
    expect(Number(screen.getByTestId('p').textContent)).toBeGreaterThan(first)
    vi.unstubAllGlobals()
    // restore the layout stubs removed by unstubAllGlobals
    class RO {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO)
  })
})

describe('TokenCount', () => {
  it('marks estimates with ~ and a dotted underline, exact values bare; ticks to a new value', async () => {
    const { rerender } = render(<TokenCount value={1234} exact={false} data-testid="tc" />)
    expect(screen.getByTestId('tc')).toHaveTextContent('~1.2k')
    expect(screen.getByTestId('tc').className).toContain('decoration-dotted')
    rerender(<TokenCount value={1100} exact data-testid="tc" />)
    await tick(700)
    expect(screen.getByTestId('tc')).toHaveTextContent('1.1k')
    expect(screen.getByTestId('tc').textContent).not.toContain('~')
  })
})

describe('WorkingRow', () => {
  it('shows advancing seconds and ~tokens, switches verbs, and goes away at the result', async () => {
    let c = reduce(fresh(), { t: 'status', state: 'running' }, T0)
    c = reduce(c, usageLive(1234, false), T0)
    put(c)
    render(<ChatView target={target} />)
    const row = screen.getByTestId('working-indicator')
    expect(row).toHaveAttribute('role', 'status')
    expect(row).toHaveAttribute('data-verb', 'working')
    expect(screen.getByTestId('working-verb')).toHaveTextContent('Working...')
    expect(screen.getByTestId('working-elapsed')).toHaveTextContent('0s')
    expect(screen.getByTestId('working-tokens')).toHaveTextContent('~1.2k')
    expect(row).toHaveTextContent(/esc/i)
    await tick(3000)
    expect(screen.getByTestId('working-elapsed')).toHaveTextContent('3s')

    feed({ t: 'tool_use', toolUseId: 'b1', name: 'Bash', input: { command: 'ls' } })
    expect(screen.getByTestId('working-verb')).toHaveTextContent('Running Bash...')
    expect(screen.getByTestId('working-indicator')).toHaveAttribute('data-verb', 'tool')
    feed({ t: 'tool_result', toolUseId: 'b1', content: 'ok', isError: false })
    feed({ t: 'thinking_delta', msgId: 'm9', text: 'hmm' })
    expect(screen.getByTestId('working-verb')).toHaveTextContent('Thinking...')

    feed(usageLive(1300, true))
    await tick(700)
    expect(screen.getByTestId('working-tokens')).toHaveTextContent('1.3k')
    expect(screen.getByTestId('working-tokens').textContent).not.toContain('~')

    feed({ t: 'result', costUsd: 0.01, durationMs: 4000, turns: 1, usage: u(1300), isError: false, contextWindow: 10000 })
    feed({ t: 'status', state: 'idle' })
    expect(screen.queryByTestId('working-indicator')).toBeNull()
  })

  it('stays visible while text streams (whole running turn)', () => {
    let c = reduce(fresh(), { t: 'status', state: 'running' }, T0)
    c = reduce(c, { t: 'text_delta', msgId: 'm', text: 'hello' }, T0)
    put(c)
    render(<ChatView target={target} />)
    expect(screen.getByTestId('working-indicator')).toBeInTheDocument()
  })

  it('shows main + subagent tokens and the agent count mid-turn', () => {
    const mid = eventFixtures.subagentTurn.slice(0, eventFixtures.subagentTurn.findIndex((e) => e.t === 'result'))
    put(reduceAll(fresh(), mid, T0))
    render(<ChatView target={target} />)
    expect(screen.getByTestId('working-sub-tokens')).toHaveTextContent('main + 20.7k subagents')
    expect(screen.getByTestId('working-agents')).toHaveTextContent('1 agent')
  })

  it('after the result a background agent shows as "running in background", not as a working turn', () => {
    put(reduceAll(fresh(), eventFixtures.subagentTurn, T0))
    render(<ChatView target={target} />)
    expect(screen.queryByTestId('working-indicator')).toBeNull()
    expect(screen.getByTestId('background-indicator')).toHaveTextContent('1 agent running in background')
  })
})

describe('SubagentCard', () => {
  it('nests children, shows the task numbers, collapses, and Stop calls session.stopTask', async () => {
    put(reduceAll(fresh(), eventFixtures.subagentTurn, T0))
    render(<ChatView target={target} />)
    const card = screen.getByTestId('subagent-card')
    expect(card).toHaveAttribute('data-status', 'running')
    expect(within(card).getByTestId('subagent-tokens')).toHaveTextContent('20.7k')
    expect(within(card).getByTestId('subagent-tokens').textContent).not.toContain('~')
    expect(within(card).getByTestId('subagent-tool-count')).toHaveTextContent('1 tool call')
    expect(within(card).getByTestId('subagent-current-tool')).toHaveTextContent('Glob')
    expect(within(card).getByTestId('subagent-type')).toHaveTextContent('general-purpose')
    // The Glob child lives inside the card, not as a top-level row.
    expect(within(card).getAllByTestId('tool-card')).toHaveLength(1)
    expect(screen.getAllByTestId('tool-card')).toHaveLength(1)

    const header = within(card).getByRole('button', { name: /^Agent Count files/ })
    expect(header).toHaveAttribute('aria-expanded', 'true')
    fireEvent.click(header)
    expect(header).toHaveAttribute('aria-expanded', 'false')
    expect(within(card).queryByTestId('subagent-body')).toBeNull()
    fireEvent.click(header)

    await act(async () => {
      fireEvent.click(within(card).getByTestId('subagent-stop'))
    })
    expect(api.session.stopTask).toHaveBeenCalledWith('L1', 'task1')
    expect(screen.getByTestId('subagent-card')).toHaveAttribute('data-status', 'stopping')
    expect(within(card).queryByTestId('subagent-stop')).toBeNull()
  })

  it('a completed agent is collapsed by default', () => {
    let c = reduceAll(fresh(), eventFixtures.subagentTurn, T0)
    c = reduce(c, { t: 'task_ended', taskId: 'task1', status: 'completed', totalTokens: 31000 }, T0 + 5000)
    put(c)
    render(<ChatView target={target} />)
    const card = screen.getByTestId('subagent-card')
    expect(within(card).getByRole('button', { name: /^Agent / })).toHaveAttribute('aria-expanded', 'false')
    expect(within(card).getByText('Done')).toBeInTheDocument()
  })

  it('marks a still-running task as Lost when the session errored, instead of running forever', () => {
    let c = reduceAll(fresh(), eventFixtures.subagentTurn, T0)
    c = reduce(c, { t: 'status', state: 'error' }, T0 + 1)
    put(c)
    render(<ChatView target={target} />)
    const card = screen.getByTestId('subagent-card')
    expect(within(card).getByText('Lost')).toBeInTheDocument()
    expect(within(card).queryByTestId('subagent-stop')).toBeNull()
    expect(screen.queryByTestId('background-indicator')).toBeNull()
  })

  it('caps a 60-child agent at 50 with "Show 10 earlier"', () => {
    const evs: SessionEvent[] = [
      { t: 'status', state: 'running' },
      { t: 'tool_use', toolUseId: 'ag', name: 'Agent', input: { description: 'Big', subagent_type: 'general-purpose' } },
      { t: 'task_started', taskId: 'tk', toolUseId: 'ag', description: 'Big', depth: 1 }
    ]
    for (let i = 0; i < 60; i++) {
      evs.push({ t: 'tool_use', toolUseId: `ch${i}`, name: 'Read', input: { file_path: `f${i}.txt` }, parentToolUseId: 'ag' })
    }
    put(reduceAll(fresh(), evs, T0))
    render(<ChatView target={target} />)
    const card = screen.getByTestId('subagent-card')
    expect(within(card).getAllByTestId('tool-card')).toHaveLength(50)
    expect(within(card).queryAllByText('f0.txt')).toHaveLength(0)
    expect(within(card).queryAllByText('f59.txt').length).toBeGreaterThan(0)
    fireEvent.click(within(card).getByTestId('subagent-show-earlier'))
    expect(within(card).getAllByTestId('tool-card')).toHaveLength(60)
  })
})

describe('ToolCard live duration', () => {
  it('ticks elapsed for a running tool and honours a larger CLI progress', async () => {
    let c = reduce(fresh(), { t: 'status', state: 'running' }, T0)
    c = reduce(c, { t: 'tool_use', toolUseId: 'b1', name: 'Bash', input: { command: 'sleep 9' } }, T0)
    put(c)
    render(<ChatView target={target} />)
    expect(screen.getByTestId('tool-elapsed')).toHaveTextContent('0s')
    await tick(5000)
    expect(screen.getByTestId('tool-elapsed')).toHaveTextContent('5s')
    feed({ t: 'tool_progress', toolUseId: 'b1', toolName: 'Bash', elapsedMs: 9000 })
    expect(screen.getByTestId('tool-elapsed')).toHaveTextContent('9s')
  })
})

describe('StatusBar', () => {
  const renderBar = (): void => {
    window.localStorage.setItem('ccwrap.ctxWindow', JSON.stringify({ 'claude-haiku-5-5': 10000 }))
    useWorkspaceStore.setState({ activeConvId: 'c1' })
    render(
      <QueryClientProvider client={queryClient}>
        <StatusBar />
      </QueryClientProvider>
    )
  }

  it('ctx shows ~ mid-turn and none after the result; the turn segment ticks', async () => {
    let c = reduce(fresh(), { t: 'init', sessionId: 's', model: 'claude-haiku-5-5', tools: [], mcp: [], slashCommands: [], cwd: target.cwd }, T0)
    c = reduce(c, { t: 'status', state: 'running' }, T0)
    c = reduce(c, usageLive(500, false), T0)
    put(c)
    renderBar()
    expect(screen.getByTestId('status-ctx')).toHaveTextContent('ctx ~55%')
    expect(screen.getByTestId('status-turn')).toHaveTextContent('turn 0s')
    expect(screen.getByTestId('status-turn')).toHaveTextContent('↑ 10')
    await tick(4000)
    expect(screen.getByTestId('status-turn')).toHaveTextContent('turn 4s')

    feed(usageLive(520, true))
    feed({ t: 'result', costUsd: 0.01, durationMs: 4100, turns: 1, usage: u(520), isError: false, contextWindow: 10000 })
    feed({ t: 'status', state: 'idle' })
    expect(screen.getByTestId('status-ctx')).toHaveTextContent('ctx 55%')
    expect(screen.getByTestId('status-ctx').textContent).not.toContain('~')
    expect(screen.getByTestId('status-turn')).toHaveTextContent('turn 4s')
  })
})

describe('model label', () => {
  const models = [
    { value: 'default', displayName: 'Default' },
    { value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5-5' },
    { value: 'opus', displayName: 'Opus' }
  ]
  it('matches value, resolvedModel, then family, then the raw id', () => {
    expect(modelLabel(models, 'sonnet')).toBe('Sonnet')
    expect(modelLabel(models, 'claude-sonnet-5-5')).toBe('Sonnet')
    expect(modelLabel(models, 'claude-opus-4-1')).toBe('Opus')
    expect(modelLabel(models, 'claude-haiku-5-5')).toBe('claude-haiku-5-5')
    expect(modelLabel(models, undefined)).toBe('Model')
  })
})

describe('perf rules', () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((n) => {
      const p = join(dir, n)
      return statSync(p).isDirectory() ? walk(p) : [p]
    })
  it('no motion layout props and no height transitions inside features/chat', () => {
    const root = join(__dirname, '..')
    const hits: string[] = []
    for (const f of walk(root).filter((p) => /\.(tsx|css)$/.test(p) && !/\.test\./.test(p))) {
      readFileSync(f, 'utf8')
        .split('\n')
        .forEach((line, i) => {
          if (/<motion\.[^>]*\blayout\b|\blayoutId\b|\bLayoutGroup\b|transition-\[height\]|transition:\s*height/.test(line)) hits.push(`${f}:${i + 1}`)
        })
    }
    expect(hits).toEqual([])
  })
})
