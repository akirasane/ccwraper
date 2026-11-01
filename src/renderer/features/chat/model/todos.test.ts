import { describe, expect, it } from 'vitest'
import { deriveTodos, todoProgress } from './todos'
import type { ToolCallView } from './types'

let n = 0
const tool = (name: string, input: unknown, extra: Partial<ToolCallView> = {}): [string, ToolCallView] => {
  const id = `t${++n}`
  return [id, { toolUseId: id, name, input, status: 'done', ...extra }]
}
const conv = (...ts: Array<[string, ToolCallView]>): { tools: Record<string, ToolCallView> } => ({ tools: Object.fromEntries(ts) })

describe('deriveTodos', () => {
  it('TodoWrite replaces the list; the last call wins', () => {
    const c = conv(
      tool('TodoWrite', { todos: [{ content: 'a', status: 'pending', activeForm: 'Doing a' }] }),
      tool('TodoWrite', {
        todos: [
          { content: 'a', status: 'completed', activeForm: 'Doing a' },
          { content: 'b', status: 'in_progress', activeForm: 'Doing b' }
        ]
      })
    )
    const list = deriveTodos(c)
    expect(list.map((x) => [x.subject, x.status])).toEqual([
      ['a', 'completed'],
      ['b', 'in_progress']
    ])
    expect(todoProgress(list)).toMatchObject({ done: 1, total: 2, current: { subject: 'b', activeForm: 'Doing b' } })
  })

  it('TaskCreate / TaskUpdate edit by id, using the id from the result text', () => {
    const c = conv(
      tool('TaskCreate', { subject: 'one', description: 'd' }, { result: 'Task #7 created successfully: one' }),
      tool('TaskCreate', { subject: 'two', description: 'd', activeForm: 'Doing two' }, { result: 'Task #8 created successfully: two' }),
      tool('TaskUpdate', { taskId: '7', status: 'completed' }),
      tool('TaskUpdate', { taskId: '8', status: 'in_progress', subject: 'two!' })
    )
    expect(deriveTodos(c).map((x) => [x.id, x.subject, x.status])).toEqual([
      ['7', 'one', 'completed'],
      ['8', 'two!', 'in_progress']
    ])
  })

  it('falls back to sequential ids when the result has no id, and honours deleted', () => {
    const c = conv(
      tool('TaskCreate', { subject: 'one', description: 'd' }, { status: 'running' }),
      tool('TaskCreate', { subject: 'two', description: 'd' }, { status: 'running' }),
      tool('TaskUpdate', { taskId: '1', status: 'deleted' })
    )
    expect(deriveTodos(c).map((x) => x.id)).toEqual(['2'])
  })

  it('ignores errored calls, subagent calls and unrelated tools', () => {
    const c = conv(
      tool('TodoWrite', { todos: [{ content: 'x', status: 'pending', activeForm: 'x' }] }, { status: 'error' }),
      tool('TodoWrite', { todos: [{ content: 'y', status: 'pending', activeForm: 'y' }] }, { parentToolUseId: 'agent1' }),
      tool('Bash', { command: 'ls' })
    )
    expect(deriveTodos(c)).toEqual([])
  })

  it('tolerates malformed input', () => {
    const c = conv(tool('TodoWrite', { todos: 'nope' }), tool('TaskUpdate', {}), tool('TodoWrite', { todos: [null, { content: '' }, { content: 'ok', status: 'weird' }] }))
    expect(deriveTodos(c).map((x) => [x.subject, x.status])).toEqual([['ok', 'pending']])
  })

  it('parses the real CLI result text "Task #N created successfully: ..."', () => {
    const c = conv(
      tool('TaskCreate', { subject: 'Create file', description: 'd', activeForm: 'Creating file' }, { result: 'Task #1 created successfully: Create file' }),
      tool('TaskCreate', { subject: 'Run it', description: 'd' }, { result: 'Task #2 created successfully: Run it' }),
      tool('TaskUpdate', { taskId: '1', status: 'in_progress' }, { result: 'Updated task #1 status' })
    )
    expect(deriveTodos(c).map((x) => [x.id, x.status, x.activeForm])).toEqual([
      ['1', 'in_progress', 'Creating file'],
      ['2', 'pending', undefined]
    ])
  })
})
