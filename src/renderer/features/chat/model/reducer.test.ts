import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@shared/events'
import { eventFixtures as fx } from './fixtures'
import { addUserItem, createConvState, reduce, reduceAll, resolvePermission } from './reducer'
import { selectContextUsage } from './selectors'
import type { ChatItem, ConvState } from './types'

const fresh = (): ConvState => createConvState({ convId: 'c1', cwd: 'C:\\fixture\\proj' })
const run = (events: SessionEvent[]): ConvState => reduceAll(fresh(), events, 1000)
const assistants = (c: ConvState): Extract<ChatItem, { kind: 'assistant' }>[] =>
  c.items.filter((i): i is Extract<ChatItem, { kind: 'assistant' }> => i.kind === 'assistant')
const usage = { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0 }

describe('reducer', () => {
  it('is pure: does not mutate the input state', () => {
    const c = fresh()
    const snap = JSON.stringify(c)
    reduce(c, { t: 'text_delta', msgId: 'm', text: 'x' })
    expect(JSON.stringify(c)).toBe(snap)
  })

  it('streams deltas into one assistant item, then final message replaces (no duplication)', () => {
    let c = fresh()
    c = reduce(c, { t: 'text_delta', msgId: 'm', text: 'Hel' })
    c = reduce(c, { t: 'text_delta', msgId: 'm', text: 'lo' })
    expect(assistants(c)).toHaveLength(1)
    expect(assistants(c)[0]).toMatchObject({ streaming: true, parts: [{ kind: 'text', text: 'Hello' }] })
    c = reduce(c, { t: 'assistant_message', msgId: 'm', blocks: [{ type: 'text', text: 'Hello!' }] })
    expect(assistants(c)).toHaveLength(1)
    expect(assistants(c)[0]).toMatchObject({ streaming: false, parts: [{ kind: 'text', text: 'Hello!' }] })
  })

  it('text turn fixture: thinking + text parts, result, idle', () => {
    const c = run(fx.textTurn)
    const a = assistants(c)
    expect(a).toHaveLength(1)
    expect(a[0]!.parts.map((p) => p.kind)).toEqual(['thinking', 'text'])
    expect(a[0]!.streaming).toBe(false)
    expect(c.status).toBe('idle')
    expect(c.lastResult?.costUsd).toBe(0.01)
  })

  it('thinking from deltas only (and thinking ends when text starts)', () => {
    let c = fresh()
    c = reduce(c, { t: 'thinking_delta', msgId: 'm', text: 'hmm' }, 10)
    c = reduce(c, { t: 'thinking_delta', msgId: 'm', text: '...' }, 20)
    c = reduce(c, { t: 'text_delta', msgId: 'm', text: 'ok' }, 30)
    expect(assistants(c)[0]!.parts).toEqual([
      { kind: 'thinking', text: 'hmm...', startedAt: 10, endedAt: 30 },
      { kind: 'text', text: 'ok' }
    ])
  })

  it('thinking from a final message block only', () => {
    const c = reduce(fresh(), {
      t: 'assistant_message',
      msgId: 'm',
      blocks: [{ type: 'thinking', text: 'deep' }, { type: 'text', text: 'ans' }]
    })
    expect(assistants(c)[0]!.parts.map((p) => p.kind)).toEqual(['thinking', 'text'])
  })

  it('tool_use / tool_result pairing, tool event after assistant block is idempotent', () => {
    const c = run(fx.toolEditTurn)
    const toolItems = c.items.filter((i) => i.kind === 'tool')
    expect(toolItems).toHaveLength(1)
    expect(c.tools['tu1']).toMatchObject({ name: 'Edit', status: 'done', result: 'File edited' })
    expect(c.items.map((i) => i.kind)).toEqual(['assistant', 'tool', 'assistant'])
  })

  it('tool_result error sets error status; unknown id ignored', () => {
    let c = run([{ t: 'tool_use', toolUseId: 't', name: 'Bash', input: {} }])
    c = reduce(c, { t: 'tool_result', toolUseId: 't', content: 'boom', isError: true })
    expect(c.tools['t']!.status).toBe('error')
    expect(reduce(c, { t: 'tool_result', toolUseId: 'nope', content: '', isError: false })).toBe(c)
  })

  it('permission lifecycle: queue, match tool -> needs_approval, resolve allow', () => {
    const upto = fx.permissionFlow.findIndex((e) => e.t === 'permission_request')
    let c = run(fx.permissionFlow.slice(0, upto + 1))
    expect(c.pending).toHaveLength(1)
    expect(c.pending[0]).toMatchObject({ reqId: 'r1', toolUseId: 'tu2', ruleLabel: 'Write' })
    expect(c.tools['tu2']!.status).toBe('needs_approval')
    c = resolvePermission(c, 'r1', 'allow')
    expect(c.pending).toHaveLength(0)
    expect(c.tools['tu2']!.status).toBe('running')
    c = reduceAll(c, fx.permissionFlow.slice(upto + 1), 2000)
    expect(c.tools['tu2']!.status).toBe('done')
    expect(c.status).toBe('idle')
  })

  it('permission deny marks tool error; unmatched request stays queued without tool', () => {
    let c = run([
      { t: 'tool_use', toolUseId: 't', name: 'Bash', input: { command: 'rm x' } },
      { t: 'permission_request', reqId: 'a', toolName: 'Bash', input: { command: 'rm x' } },
      { t: 'permission_request', reqId: 'b', toolName: 'Bash', input: { command: 'other' } }
    ])
    expect(c.pending.map((p) => p.toolUseId)).toEqual(['t', undefined])
    c = resolvePermission(c, 'a', 'deny')
    expect(c.tools['t']).toMatchObject({ status: 'error', result: 'Denied' })
    expect(c.pending.map((p) => p.reqId)).toEqual(['b'])
  })

  it('tool_result clears the pending request of that tool', () => {
    let c = run([
      { t: 'tool_use', toolUseId: 't', name: 'Bash', input: {} },
      { t: 'permission_request', reqId: 'a', toolName: 'Bash', input: {} }
    ])
    c = reduce(c, { t: 'tool_result', toolUseId: 't', content: 'ok', isError: false })
    expect(c.pending).toHaveLength(0)
  })

  it('init replaces meta and never adds items (two different inits in one turn)', () => {
    const c = run(fx.doubleInit)
    expect(c.meta.tools).toHaveLength(5)
    expect(c.meta.sessionId).toBe('s1')
    expect(c.items.every((i) => i.kind === 'assistant')).toBe(true)
    expect(c.items).toHaveLength(1)
  })

  it('user_message adds a user item; addUserItem is optimistic and sets running', () => {
    const c = reduce(fresh(), { t: 'user_message', text: 'hi' })
    expect(c.items[0]).toMatchObject({ kind: 'user', text: 'hi' })
    const d = addUserItem(fresh(), 'yo')
    expect(d.status).toBe('running')
    expect(d.items[0]).toMatchObject({ kind: 'user', text: 'yo' })
  })

  it('result cost is the latest value, never summed', () => {
    const r = (costUsd: number): SessionEvent => ({
      t: 'result',
      costUsd,
      durationMs: 1,
      turns: 1,
      usage,
      isError: false
    })
    const c = run([r(0.5), r(0.7)])
    expect(c.lastResult?.costUsd).toBe(0.7)
  })

  it('result carries contextWindow; context usage selector', () => {
    const c = run(fx.textTurn)
    expect(c.lastResult?.contextWindow).toBe(200000)
    expect(selectContextUsage(c)).toBeCloseTo(100 / 200000)
    expect(selectContextUsage(fresh())).toBeUndefined()
  })

  it('interrupted turn -> idle, unfinished tools fail, pending cleared, streaming stops', () => {
    const c = run(fx.interruptedTurn)
    expect(c.status).toBe('idle')
    expect(c.tools['tu3']).toMatchObject({ status: 'error', result: 'Interrupted' })
    expect(assistants(c)[0]!.streaming).toBe(false)
    expect(c.pending).toHaveLength(0)
    expect(c.lastResult?.isError).toBe(true)
  })

  it('interrupted (zero-usage error) result keeps the previous context usage and cost', () => {
    const ok: SessionEvent = { t: 'result', costUsd: 0.2, durationMs: 1, turns: 1, usage, isError: false, contextWindow: 1000 }
    const zero = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 }
    const c = run([ok, { t: 'result', costUsd: 0, durationMs: 1, turns: 0, usage: zero, isError: true }])
    expect(c.lastResult?.costUsd).toBe(0.2)
    expect(c.lastResult?.contextWindow).toBe(1000)
    expect(selectContextUsage(c)).toBeCloseTo(0.001)
    expect(c.lastResult?.isError).toBe(true)
  })

  it('error becomes an inline item and status error (kept by a following result)', () => {
    let c = reduce(fresh(), { t: 'error', message: 'bad' })
    expect(c.items[0]).toMatchObject({ kind: 'error', message: 'bad' })
    expect(c.status).toBe('error')
    c = reduce(c, { t: 'result', costUsd: 0, durationMs: 0, turns: 0, usage, isError: true })
    expect(c.status).toBe('error')
  })

  it('status events update status', () => {
    expect(reduce(fresh(), { t: 'status', state: 'waiting_permission' }).status).toBe('waiting_permission')
  })

  it('history replay builds ordered conversation', () => {
    const c = run(fx.historyReplay)
    expect(c.items.map((i) => i.kind)).toEqual(['user', 'assistant', 'tool', 'assistant', 'user', 'assistant'])
    expect(c.tools['htu1']!.status).toBe('done')
    expect(c.status).toBe('idle')
  })

  it('same msgId split across events: finalizing thinking keeps streamed text streaming', () => {
    let c = fresh()
    c = reduce(c, { t: 'thinking_delta', msgId: 'm', text: 't' })
    c = reduce(c, { t: 'text_delta', msgId: 'm', text: 'x' })
    c = reduce(c, { t: 'assistant_message', msgId: 'm', blocks: [{ type: 'thinking', text: 't' }] })
    c = reduce(c, { t: 'assistant_message', msgId: 'm', blocks: [{ type: 'text', text: 'x' }] })
    const a = assistants(c)
    expect(a.map((i) => i.parts.map((p) => p.kind))).toEqual([['thinking'], ['text']])
    expect(a.every((i) => !i.streaming)).toBe(true)
  })

  it('item ids are unique', () => {
    const c = run([...fx.historyReplay, ...fx.toolEditTurn])
    const ids = c.items.map((i) => i.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
