import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { useChatStore } from '@/stores/chat-store'
import { TodoPanel } from './TodoPanel'

const todoEvent = (todos: Array<{ content: string; status: string; activeForm: string }>, id = 'tu1'): SessionEvent => ({
  t: 'tool_use',
  toolUseId: id,
  name: 'TodoWrite',
  input: { todos }
} as SessionEvent)

beforeEach(() => {
  useChatStore.setState({ convs: {}, localToConv: {}, drafts: {}, draftImages: {} })
  useChatStore.getState().createConv({ convId: 'c1', cwd: 'C:\p' })
})

describe('TodoPanel', () => {
  it('renders nothing without todos', () => {
    const { container } = render(<TodoPanel convId="c1" />)
    expect(container.firstChild).toBeNull()
  })

  it('shows progress and updates in place as the list changes', () => {
    render(<TodoPanel convId="c1" />)
    const seed = (id: string, ev: SessionEvent[]): void => act(() => useChatStore.getState().seedFromHistory(id, ev))
    seed('c1', [todoEvent([{ content: 'Write code', status: 'in_progress', activeForm: 'Writing code' }, { content: 'Test', status: 'pending', activeForm: 'Testing' }])])
    expect(screen.getByTestId('todo-title').textContent).toBe('Tasks 0/2')
    expect(screen.getAllByTestId('todo-row').map((r) => r.textContent)).toEqual(['Writing code', 'Test'])
    seed('c1', [todoEvent([{ content: 'Write code', status: 'completed', activeForm: 'Writing code' }, { content: 'Test', status: 'in_progress', activeForm: 'Testing' }], 'tu2')])
    expect(screen.getByTestId('todo-title').textContent).toBe('Tasks 1/2')
    expect(screen.getAllByTestId('todo-row').map((r) => r.getAttribute('data-status'))).toEqual(['completed', 'in_progress'])
  })

  it('collapses to a one-line summary of the current task', () => {
    render(<TodoPanel convId="c1" />)
    act(() => useChatStore.getState().seedFromHistory('c1', [todoEvent([{ content: 'Test', status: 'in_progress', activeForm: 'Testing' }])]))
    fireEvent.click(screen.getByRole('button', { expanded: true }))
    expect(screen.queryAllByTestId('todo-row')).toHaveLength(0)
    expect(screen.getByText('Testing')).toBeTruthy()
  })
})
