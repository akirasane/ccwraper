import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { startSdkSession, TASK_TOOLS, type QueryImpl } from './sdk-adapter'

describe('SDK options', () => {
  it('allow-lists the task-list tools so headless sessions expose them', async () => {
    const impl = vi.fn((() => {
      const q = {
        [Symbol.asyncIterator]: () => ({ next: async () => ({ value: undefined, done: true as const }) }),
        interrupt: async () => {},
        close: () => {}
      }
      return q as unknown as Query
    }) as QueryImpl)
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: impl, onEvent: () => {} })
    const opts = (impl.mock.calls[0]![0] as { options: { allowedTools?: string[] } }).options
    expect(opts.allowedTools).toEqual([...TASK_TOOLS])
    expect(TASK_TOOLS).toEqual(['TaskCreate', 'TaskUpdate', 'TaskList', 'TaskGet'])
    s.close()
  })
})
