import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionEvent } from '@shared/events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { eventFixtures as fx } from '@/features/chat/model/fixtures'
import { useChatStore } from '@/stores/chat-store'
import { PermissionDialog } from '../permission/PermissionDialog'
import { ToolCard } from './ToolCard'

const permissionReply = vi.fn(async () => {})

function seed(events: SessionEvent[], localId = 'L1'): void {
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\fixture\\proj', localId })
  useChatStore.getState().seedFromHistory('c1', events)
}
const apply = (e: SessionEvent): void => {
  act(() => useChatStore.getState().applyEvent('L1', e))
}
const upTo = (events: SessionEvent[], t: SessionEvent['t']): SessionEvent[] =>
  events.slice(0, events.findIndex((e) => e.t === t) + 1)

beforeEach(() => {
  permissionReply.mockClear()
  ;(globalThis as unknown as { window: { ccwrap: unknown } }).window.ccwrap = { session: { permissionReply } }
})

describe('ToolCard', () => {
  it('renders nothing for an unknown tool', () => {
    seed([])
    const { container } = render(<ToolCard convId="c1" toolUseId="nope" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('Bash goes running -> done -> error-state variants', () => {
    seed([])
    apply({ t: 'tool_use', toolUseId: 'b1', name: 'Bash', input: { command: 'npm test' } })
    render(<ToolCard convId="c1" toolUseId="b1" />)
    const card = screen.getByTestId('tool-card')
    expect(card).toHaveAttribute('data-status', 'running')
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'run')
    expect(screen.getAllByText('npm test').length).toBeGreaterThan(0)

    apply({ t: 'tool_result', toolUseId: 'b1', content: 'all green', isError: false })
    expect(card).toHaveAttribute('data-status', 'done')
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'done')
    expect(screen.getByText('all green')).toBeInTheDocument()
  })

  it('an error result shows the error state and message', () => {
    seed([])
    apply({ t: 'tool_use', toolUseId: 'b2', name: 'Bash', input: { command: 'false' } })
    render(<ToolCard convId="c1" toolUseId="b2" />)
    apply({ t: 'tool_result', toolUseId: 'b2', content: 'exit 1', isError: true })
    const card = screen.getByTestId('tool-card')
    expect(card).toHaveAttribute('data-status', 'error')
    expect(card.className).toContain('border-danger-border')
    expect(screen.getByRole('status')).toHaveAttribute('data-state', 'err')
    expect(screen.getByText('exit 1')).toBeInTheDocument()
  })

  it('Edit renders a diff with counts, and flashes when it turns done', () => {
    seed(fx.toolEditTurn.slice(0, fx.toolEditTurn.findIndex((e) => e.t === 'tool_use') + 1))
    render(<ToolCard convId="c1" toolUseId="tu1" />)
    expect(screen.getByTestId('diff-view')).toBeInTheDocument()
    expect(screen.getByText('const a = 1')).toBeInTheDocument()
    expect(screen.getByText('const a = 2')).toBeInTheDocument()
    expect(screen.getByText('+1')).toBeInTheDocument()
    expect(screen.getByText('-1')).toBeInTheDocument()
    expect(screen.queryByTestId('diff-flash')).toBeNull()
    apply({ t: 'tool_result', toolUseId: 'tu1', content: 'ok', isError: false })
    expect(screen.getAllByTestId('diff-flash').length).toBe(2)
  })

  it('does not flash for a tool that is already done on mount', () => {
    seed(fx.toolEditTurn)
    render(<ToolCard convId="c1" toolUseId="tu1" />)
    expect(screen.queryByTestId('diff-flash')).toBeNull()
  })

  it('long output is truncated with show more', async () => {
    seed([])
    apply({ t: 'tool_use', toolUseId: 'b3', name: 'Bash', input: { command: 'seq 100' } })
    apply({
      t: 'tool_result',
      toolUseId: 'b3',
      content: Array.from({ length: 100 }, (_, i) => `line${i}`).join('\n'),
      isError: false
    })
    render(<ToolCard convId="c1" toolUseId="b3" />)
    expect(screen.queryByText(/line99/)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /show 60 more lines/i }))
    expect(screen.getByText(/line99/)).toBeInTheDocument()
  })

  it('header toggles the body', async () => {
    seed([])
    apply({ t: 'tool_use', toolUseId: 'g1', name: 'Grep', input: { pattern: 'needle' } })
    render(<ToolCard convId="c1" toolUseId="g1" />)
    const head = screen.getByRole('button', { expanded: true })
    await userEvent.click(head)
    expect(screen.getByRole('button', { expanded: false })).toBeInTheDocument()
  })
})

describe('PermissionDialog', () => {
  const pending = (): SessionEvent[] => upTo(fx.permissionFlow, 'permission_request')

  it('renders nothing without a pending request', () => {
    seed([])
    const { container } = render(<PermissionDialog convId="c1" />)
    expect(container).toBeEmptyDOMElement()
  })

  it('shows title, diff preview, ruleLabel and focuses Allow once', () => {
    seed(pending())
    render(<PermissionDialog convId="c1" />)
    expect(screen.getByText('Write b.txt')).toBeInTheDocument()
    expect(screen.getByTestId('diff-view')).toBeInTheDocument()
    expect(screen.getByTestId('perm-rules')).toHaveTextContent('Write')
    expect(screen.getByRole('button', { name: /allow once/i })).toHaveFocus()
  })

  it('Enter allows once', async () => {
    seed(pending())
    render(<PermissionDialog convId="c1" />)
    await userEvent.keyboard('{Enter}')
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'allow', remember: 'once' })
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('Esc denies', async () => {
    seed(pending())
    render(<PermissionDialog convId="c1" />)
    await userEvent.keyboard('{Escape}')
    expect(permissionReply).toHaveBeenCalledTimes(1)
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
  })

  it('Deny button denies', async () => {
    seed(pending())
    render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('button', { name: /deny/i }))
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
  })

  it('Always allow sends remember:always', async () => {
    seed(pending())
    render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('button', { name: /always allow/i }))
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'allow', remember: 'always' })
  })

  it('Always allow is disabled without ruleLabel', async () => {
    seed(
      pending().map((e) => {
        if (e.t !== 'permission_request') return e
        const { ruleLabel: _r, ...rest } = e
        return rest
      })
    )
    render(<PermissionDialog convId="c1" />)
    const btn = screen.getByRole('button', { name: /always allow/i })
    expect(btn).toBeDisabled()
    await userEvent.click(btn)
    expect(permissionReply).not.toHaveBeenCalled()
  })

  it('shows a count badge when more requests are queued', () => {
    seed(pending())
    apply({ t: 'permission_request', reqId: 'r2', toolName: 'Bash', input: { command: 'ls' } })
    render(<PermissionDialog convId="c1" />)
    expect(screen.getByTestId('perm-count')).toHaveTextContent('+1 more')
  })

  it('Bash request previews the command', () => {
    seed([{ t: 'permission_request', reqId: 'r3', toolName: 'Bash', input: { command: 'git commit -m x' } }])
    render(<PermissionDialog convId="c1" />)
    expect(screen.getByText('git commit -m x')).toBeInTheDocument()
    expect(screen.getByText('Bash', { selector: 'h2' })).toBeInTheDocument()
  })
})
