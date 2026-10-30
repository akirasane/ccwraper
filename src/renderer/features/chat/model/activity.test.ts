import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { eventFixtures as fx } from './fixtures'
import { addUserItem, createConvState, reduce, reduceAll } from './reducer'
import {
  selectChildItems,
  selectLiveContext,
  selectRunningTasks,
  selectSubagentTokens,
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

const subagentTurn: SessionEvent[] = fx.subagentTurn

describe('activity model', () => {
  it('replays the real subagent turn (background agent outlives the result)', () => {
    const c = reduceAll(fresh(), subagentTurn, 10_000)
    const top = selectTopLevelItems(c)
    expect(top.filter((i) => i.kind === 'tool' && i.toolUseId === 'toolu_agent')).toHaveLength(1)
    expect(top.some((i) => i.kind === 'tool' && i.toolUseId === 'toolu_glob')).toBe(false)
    expect(selectChildItems(c, 'toolu_agent').length).toBeGreaterThanOrEqual(1)
    expect(selectTaskForTool(c, 'toolu_agent')).toMatchObject({
      status: 'running', background: true, totalTokens: 20726, toolUses: 1, lastToolName: 'Glob', description: 'Count files'
    })
    expect(c.turn).toBeUndefined()
    expect(c.lastTurn).toMatchObject({ durationMs: 4048, apiCalls: 2 })
    expect(c.session).toMatchObject({ turns: 1, workMs: 4048 })
    expect(selectRunningTasks(c)).toHaveLength(1)
    expect(selectSubagentTokens(c)).toBe(20726)
  })

  it('background task: events after result update it; a new turn keeps it; interrupt stops it', () => {
    let c = reduceAll(fresh(), subagentTurn, 10_000)
    c = reduce(c, { t: 'task_progress', taskId: 'task1', totalTokens: 30000, toolUses: 2, durationMs: 5000 }, 11_000)
    expect(c.tasks['task1']).toMatchObject({ status: 'running', totalTokens: 30000, progressAt: 11_000 })
    c = reduce(c, { t: 'tool_progress', toolUseId: 'toolu_glob', toolName: 'Glob', elapsedMs: 77 }, 11_100)
    expect(c.tools['toolu_glob']!.progressMs).toBe(77)
    c = addUserItem(c, 'next', 12_000)
    c = reduce(c, { t: 'status', state: 'running' }, 12_000)
    expect(c.tasks['task1']!.status).toBe('running')
    c = reduce(c, { t: 'status', state: 'idle' }, 13_000) // interrupt of the new turn
    expect(c.tasks['task1']!.status).toBe('stopped')

    let d = reduceAll(fresh(), subagentTurn, 10_000)
    d = reduce(d, { t: 'task_ended', taskId: 'task1', status: 'completed', totalTokens: 31000 }, 14_000)
    expect(d.tasks['task1']).toMatchObject({ status: 'completed', totalTokens: 31000, endedAt: 14_000 })
    expect(selectRunningTasks(d)).toHaveLength(0)
  })

  it('idle after result does not kill a background task; a stopping one is confirmed stopped', () => {
    let c = reduceAll(fresh(), subagentTurn, 10_000)
    expect(c.tasks['task1']!.status).toBe('running')
    c = { ...c, tasks: { ...c.tasks, task1: { ...c.tasks['task1']!, status: 'stopping' } } }
    c = reduce(c, { t: 'status', state: 'idle' }, 12_000)
    expect(c.tasks['task1']!.status).toBe('stopped')
  })

  it('an exact output lower than the estimate is accepted', () => {
    let c = addUserItem(fresh(), 'hi', 0)
    c = reduce(c, live(100, 400, false), 1)
    expect(selectLiveContext({ ...c, lastResult: undefined }, 1000)?.used).toBe(500)
    expect(c.turn?.exact).toBe(false)
    c = reduce(c, live(100, 120, true), 2)
    expect(c.turn).toMatchObject({ contextTokens: 220, exact: true })
    expect(selectLiveContext(c, 1000)).toMatchObject({ used: 220, exact: true })
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
