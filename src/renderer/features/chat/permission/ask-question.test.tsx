import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { SessionEvent } from '@shared/events'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useChatStore } from '@/stores/chat-store'
import { PermissionDialog } from './PermissionDialog'

const permissionReply = vi.fn(async () => {})

const INPUT = {
  questions: [
    {
      question: 'Which library?',
      header: 'Library',
      multiSelect: false,
      options: [
        { label: 'Alpha', description: 'The first one', preview: '<b>alpha</b>\n  code' },
        { label: 'Beta', description: 'The second one' }
      ]
    },
    {
      question: 'Which features?',
      header: 'Features',
      multiSelect: true,
      options: [
        { label: 'Fast', description: 'Speed' },
        { label: 'Small', description: 'Size' },
        { label: 'Cheap', description: 'Cost' }
      ]
    }
  ]
}

function seedPending(toolName: string, input: unknown): void {
  useChatStore.setState({ convs: {}, localToConv: {}, modes: {} })
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\\fixture\\proj', localId: 'L1' })
  const e: SessionEvent = {
    t: 'permission_request',
    reqId: 'r1',
    toolName,
    input,
    ruleLabel: 'AskUserQuestion'
  } as SessionEvent
  act(() => useChatStore.getState().applyEvent('L1', e))
}

beforeEach(() => {
  permissionReply.mockClear()
  ;(globalThis as unknown as { window: { ccwrap: unknown } }).window.ccwrap = { session: { permissionReply } }
})

describe('AskUserQuestion dialog', () => {
  it('renders questions, header chips and options; hides Always allow', () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    expect(screen.getByText('Which library?')).toBeInTheDocument()
    expect(screen.getByText('Library')).toBeInTheDocument()
    expect(screen.getByText('The second one')).toBeInTheDocument()
    expect(screen.getAllByRole('radio', { name: /alpha|beta|other/i })).toHaveLength(3)
    expect(screen.getAllByRole('checkbox')).toHaveLength(4)
    expect(screen.queryByText(/always allow/i)).toBeNull()
    expect(screen.queryByTestId('perm-always')).toBeNull()
    expect(screen.queryByRole('button', { name: /deny/i })).toBeNull()
  })

  it('submit is disabled until every question is answered', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    const submit = screen.getByRole('button', { name: /submit/i })
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('radio', { name: /alpha/i }))
    expect(submit).toBeDisabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /fast/i }))
    expect(submit).toBeEnabled()
    await userEvent.click(screen.getByRole('checkbox', { name: /fast/i }))
    expect(submit).toBeDisabled()
  })

  it('single + multi select reply allow with answers keyed by question text and preview annotation', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('radio', { name: /alpha/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /fast/i }))
    await userEvent.click(screen.getByRole('checkbox', { name: /cheap/i }))
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    expect(permissionReply).toHaveBeenCalledTimes(1)
    expect(permissionReply).toHaveBeenCalledWith({
      localId: 'L1',
      reqId: 'r1',
      decision: 'allow',
      remember: 'once',
      updatedInput: {
        ...INPUT,
        answers: { 'Which library?': 'Alpha', 'Which features?': 'Fast, Cheap' },
        annotations: { 'Which library?': { preview: '<b>alpha</b>\n  code' } }
      }
    })
  })

  it('Other free text answers a single and a multi question', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    await userEvent.type(screen.getByRole('textbox', { name: /other answer for: which library/i }), 'Gamma')
    expect(screen.getByRole('radio', { name: 'Other' })).toBeChecked()
    await userEvent.click(screen.getByRole('checkbox', { name: /small/i }))
    await userEvent.type(screen.getByRole('textbox', { name: /other answer for: which features/i }), 'Free')
    await userEvent.click(screen.getByRole('button', { name: /submit/i }))
    const arg = (permissionReply.mock.calls as unknown as unknown[][])[0]![0] as { updatedInput: Record<string, unknown> }
    expect(arg.updatedInput.answers).toEqual({ 'Which library?': 'Gamma', 'Which features?': 'Small, Free' })
    expect(arg.updatedInput.annotations).toBeUndefined()
  })

  it('preview is shown as plain text, never as HTML', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('radio', { name: /alpha/i }))
    const pre = screen.getByTestId('ask-preview-0')
    expect(pre.textContent).toBe('<b>alpha</b>\n  code')
    expect(within(pre).queryByText('alpha', { selector: 'b' })).toBeNull()
    expect(document.body.querySelector('pre b')).toBeNull()
  })

  it('Skip denies', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('button', { name: /skip/i }))
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
  })

  it('Esc skips, but Esc inside the Other field only leaves the field', async () => {
    seedPending('AskUserQuestion', INPUT)
    render(<PermissionDialog convId="c1" />)
    const other = screen.getByRole('textbox', { name: /other answer for: which library/i })
    await userEvent.type(other, 'abc')
    await userEvent.keyboard('{Escape}')
    expect(permissionReply).not.toHaveBeenCalled()
    expect(other).not.toHaveFocus()
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    await userEvent.keyboard('{Escape}')
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
  })
})

describe('ExitPlanMode dialog', () => {
  it('renders the plan as markdown and Approve allows', async () => {
    seedPending('ExitPlanMode', { plan: '# The plan\n\n- step one\n- step two' })
    render(<PermissionDialog convId="c1" />)
    expect(screen.getByRole('heading', { name: 'The plan' })).toBeInTheDocument()
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.queryByText(/always allow/i)).toBeNull()
    await userEvent.click(screen.getByRole('button', { name: /approve plan/i }))
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'allow', remember: 'once' })
  })

  it('Keep planning and Esc deny', async () => {
    seedPending('ExitPlanMode', { plan: 'p' })
    const { unmount } = render(<PermissionDialog convId="c1" />)
    await userEvent.click(screen.getByRole('button', { name: /keep planning/i }))
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
    unmount()
    permissionReply.mockClear()
    seedPending('ExitPlanMode', { plan: 'p' })
    render(<PermissionDialog convId="c1" />)
    await userEvent.keyboard('{Escape}')
    expect(permissionReply).toHaveBeenCalledWith({ localId: 'L1', reqId: 'r1', decision: 'deny' })
  })
})
