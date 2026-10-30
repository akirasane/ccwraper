import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { addUserItem, createConvState, reduce, reduceAll } from './reducer'
import {
  selectChildItems,
  selectLiveContext,
  selectRunningTasks,
  selectTaskForTool,
  selectTopLevelItems,
  selectTurnSummary,
  selectWorkingState
} from './selectors'
import type { ConvState } from './types'

const fresh = (): ConvState => createConvState({ convId: 'c1', cwd: 'C:\\fixture\\proj' })
const u = (n: number) => ({ inputTokens: n, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 })
const live = (ctx: number, out: number, exact: boolean): SessionEvent => ({
  t: 'usage_live',
  contextTokens: ctx,
  contextOutputTokens: out,
  contextExact: exact,
  turn: u(ctx),
  exact,
  apiCalls: 1
})

// Synthetic subagent turn (swap for tests/fixtures/events/subagent-turn.json when WP1 lands it).
const subagentTurn: SessionEvent[] = [
  { t: 'status', state: 'running' },
  live(1000, 5, false),
  { t: 'tool_use', toolUseId: 'ag1', name: 'Agent', input: { prompt: 'count' } },
  { t: 'task_started', taskId: 'tk1', toolUseId: 'ag1', description: 'Count files', subagentType: 'general-purpose' },
  { t: 'tool_use', toolUseId: 'g1', name: 'Glob', input: {}, parentToolUseId: 'ag1' },
  { t: 'assistant_message', msgId: 'sub1', blocks: [{ type: 'text', text: 'sub' }], parentToolUseId: 'ag1' },
  { t: 'tool_progress', toolUseId: 'g1', toolName: 'Glob', parentToolUseId: 'ag1', elapsedMs: 500, taskId: 'tk1' },
  { t: 'task_progress', taskId: 'tk1', toolUseId: 'ag1', totalTokens: 900, toolUses: 1, durationMs: 800, lastToolName: 'Glob' },
  { t: 'tool_result', toolUseId: 'g1', content: '3 files', isError: false },
  { t: 'task_ended', taskId: 'tk1', toolUseId: 'ag1', status: 'completed', totalTokens: 1200, toolUses: 1, durationMs: 1500 },
  { t: 'tool_result', toolUseId: 'ag1', content: '3', isError: false },
  live(1500, 20, true),
  {
    t: 'result',
    costUsd: 0.02,
    durationMs: 4000,
    durationApiMs: 3000,
    turns: 2,
    usage: u(9999),
    isError: false,
    contextWindow: 200000,
    sessionUsage: { ...u(2500), costUsd: 0.02 }
  }
]

describe('activity model', () => {
  it('replays a subagent turn', () => {
    const c = reduceAll(fresh(), subagentTurn, 10_000)
    const top = selectTopLevelItems(c)
    expect(top.filter((i) => i.kind === 'tool')).toHaveLength(1)
    expect(top.some((i) => i.kind === 'assistant')).toBe(false)
    expect(selectChildItems(c, 'ag1')).toHaveLength(2)
    expect(selectTaskForTool(c, 'ag1')).toMatchObject({ status: 'completed', totalTokens: 1200, toolUses: 1 })
    expect(c.tools['g1']!.progressMs).toBe(500)
    expect(c.turn).toBeUndefined()
    expect(c.lastTurn).toMatchObject({ durationMs: 4000, apiCalls: 1 })
    expect(c.session).toMatchObject({ workMs: 4000, apiMs: 3000, turns: 1, usage: { costUsd: 0.02 } })
    expect(selectTurnSummary(c)).toBe(c.lastTurn)
    expect(selectRunningTasks(c)).toHaveLength(0)
  })

  it('tool_progress keeps the max', () => {
    let c = reduce(fresh(), { t: 'tool_use', toolUseId: 't', name: 'Bash', input: {} }, 1)
    c = reduce(c, { t: 'tool_progress', toolUseId: 't', toolName: 'Bash', elapsedMs: 900 })
    c = reduce(c, { t: 'tool_progress', toolUseId: 't', toolName: 'Bash', elapsedMs: 400 })
    expect(c.tools['t']!.progressMs).toBe(900)
  })

  it('live context follows usage_live, not result.usage, and keeps exact false mid-message', () => {
    let c = addUserItem(fresh(), 'hi', 100)
    c = { ...c, lastResult: { costUsd: 0, durationMs: 1, turns: 1, usage: u(50000), isError: false, contextWindow: 1000 } }
    c = reduce(c, live(100, 10, false), 200)
    expect(selectLiveContext(c)).toMatchObject({ used: 110, window: 1000, exact: false })
    c = reduce(c, live(100, 12, true), 300)
    expect(selectLiveContext(c)).toMatchObject({ used: 112, exact: true })
    expect(selectLiveContext(fresh(), 500)).toBeUndefined()
  })

  it('interrupt: tasks stopped, turn closed with local elapsed, ctx kept', () => {
    let c = addUserItem(fresh(), 'go', 1000)
    c = reduce(c, live(300, 5, true), 1100)
    c = reduce(c, { t: 'task_started', taskId: 'a', description: 'fg' }, 1200)
    c = reduce(c, { t: 'task_started', taskId: 'b', description: 'bg', background: true, ambient: true }, 1200)
    c = reduce(c, { t: 'status', state: 'idle' }, 3000)
    expect(c.tasks['a']!.status).toBe('stopped')
    expect(c.tasks['b']!.status).toBe('stopped')
    expect(c.turn).toBeUndefined()
    expect(c.lastTurn).toMatchObject({ durationMs: 2000, contextTokens: 305 })
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    c = reduce(c, { t: 'result', costUsd: 0, durationMs: 1, turns: 0, usage: zero, isError: true, contextWindow: 1000 }, 3100)
    expect(selectLiveContext(c)).toMatchObject({ used: 305, window: 1000 })
  })

  it('result keeps background tasks alive while the session runs; running tasks exclude ambient/hidden', () => {
    let c = addUserItem(fresh(), 'go', 0)
    c = reduce(c, { t: 'task_started', taskId: 'bg', description: 'bg', background: true }, 1)
    c = reduce(c, { t: 'task_started', taskId: 'am', description: 'amb', ambient: true }, 1)
    c = reduce(c, { t: 'task_started', taskId: 'hd', description: 'hid', hidden: true }, 1)
    c = reduce(c, { t: 'task_started', taskId: 'fg', description: 'fg' }, 1)
    expect(selectRunningTasks(c).map((t) => t.taskId).sort()).toEqual(['bg', 'fg'])
    c = reduce(c, { t: 'result', costUsd: 0, durationMs: 5, turns: 1, usage: u(1), isError: false }, 10)
    expect(c.tasks['bg']!.status).toBe('running')
    expect(c.tasks['fg']!.status).toBe('stopped')
    expect(c.status).toBe('idle')
  })

  it('task_updated merges and ends terminal statuses', () => {
    let c = reduce(fresh(), { t: 'task_started', taskId: 'x', description: 'd' }, 5)
    c = reduce(c, { t: 'task_updated', taskId: 'x', status: 'killed', error: 'boom' }, 9)
    expect(c.tasks['x']).toMatchObject({ status: 'killed', error: 'boom', endedAt: 9, startedAt: 5 })
  })

  it('selectors are referentially stable', () => {
    const c = reduceAll(fresh(), subagentTurn.slice(0, 6), 10)
    expect(selectTopLevelItems(c)).toBe(selectTopLevelItems(c))
    const c2 = { ...c, tools: { ...c.tools } }
    expect(selectTopLevelItems(c2)).toBe(selectTopLevelItems(c))
    expect(selectChildItems(c, 'ag1')).toBe(selectChildItems(c, 'ag1'))
    expect(selectChildItems(c, 'none')).toBe(selectChildItems(c, 'none2'))
    expect(selectRunningTasks(c)).toBe(selectRunningTasks(c))
    expect(selectWorkingState({ ...c })).toBe(selectWorkingState({ ...c }))
  })

  it('working state verbs', () => {
    let c = addUserItem(fresh(), 'hi', 50)
    expect(selectWorkingState(c)).toMatchObject({ verb: 'working', since: 50 })
    c = reduce(c, { t: 'thinking_delta', msgId: 'm', text: 'hm' }, 60)
    expect(selectWorkingState(c)).toMatchObject({ verb: 'thinking', since: 60 })
    c = reduce(c, { t: 'tool_use', toolUseId: 't', name: 'Bash', input: {} }, 70)
    expect(selectWorkingState(c)).toMatchObject({ verb: 'tool', toolName: 'Bash', since: 70 })
    c = reduce(c, { t: 'permission_request', reqId: 'r', toolName: 'Bash', input: {} }, 80)
    expect(selectWorkingState(c)?.verb).toBe('approval')
    expect(selectWorkingState(fresh())).toBeUndefined()
  })
})
