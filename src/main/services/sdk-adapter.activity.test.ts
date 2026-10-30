import { describe, expect, it } from 'vitest'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import { mapMessage, startSdkSession, TurnUsageAccumulator, type MapState, type UsageLiveEvent } from './sdk-adapter'

const msg = (m: unknown): SDKMessage => m as SDKMessage
const se = (event: unknown, parent: string | null = null): SDKMessage =>
  msg({ type: 'stream_event', event, parent_tool_use_id: parent })
const start = (id: string, usage: Record<string, number>, parent: string | null = null): SDKMessage =>
  se({ type: 'message_start', message: { id, usage } }, parent)
const textDelta = (text: string, parent: string | null = null): SDKMessage =>
  se({ type: 'content_block_delta', delta: { type: 'text_delta', text } }, parent)
const msgDelta = (out: number, parent: string | null = null): SDKMessage =>
  se({ type: 'message_delta', usage: { output_tokens: out } }, parent)

function harness(intervalMs = 250) {
  let t = 0
  const timers: Array<{ at: number; fn: () => void; live: boolean }> = []
  const emitted: UsageLiveEvent[] = []
  const acc = new TurnUsageAccumulator({
    emit: (e) => emitted.push(e),
    now: () => t,
    setTimer: (fn, ms) => {
      const h = { at: t + ms, fn, live: true }
      timers.push(h)
      return h
    },
    clearTimer: (h) => {
      ;(h as { live: boolean }).live = false
    },
    intervalMs
  })
  const state: MapState = { msgId: '', acc }
  return {
    acc,
    state,
    emitted,
    advance(ms: number) {
      t += ms
      for (const h of timers) if (h.live && h.at <= t) ((h.live = false), h.fn())
    }
  }
}

describe('mapMessage per-parent streams (D4)', () => {
  it('keeps main deltas on the main msgId and emits no subagent text', () => {
    const { state } = harness()
    const events: SessionEvent[] = []
    for (const m of [
      start('main_1', { input_tokens: 10 }),
      start('sub_1', { input_tokens: 5 }, 'toolu_agent'),
      textDelta('sub text', 'toolu_agent'),
      textDelta('main text'),
      se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'sub think' } }, 'toolu_agent')
    ])
      events.push(...mapMessage(m, state))
    expect(events).toEqual([{ t: 'text_delta', msgId: 'main_1', text: 'main text' }])
    expect(state.msgId).toBe('main_1')
  })
})

describe('TurnUsageAccumulator', () => {
  it('estimates from chars then switches to exact on message_delta', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 100, cache_read_input_tokens: 50, cache_creation_input_tokens: 10, output_tokens: 1 }), h.state)
    let last = h.emitted.at(-1)!
    expect(last).toMatchObject({ contextTokens: 160, exact: false, contextExact: false, apiCalls: 1 })
    mapMessage(textDelta('x'.repeat(40)), h.state)
    h.advance(250)
    last = h.emitted.at(-1)!
    expect(last.turn.outputTokens).toBe(10)
    expect(last.exact).toBe(false)
    mapMessage(msgDelta(33), h.state)
    last = h.emitted.at(-1)!
    expect(last.turn.outputTokens).toBe(33)
    expect(last.contextOutputTokens).toBe(33)
    expect(last.exact).toBe(true)
    expect(last.contextExact).toBe(true)
  })

  it('counts partial_json and thinking chars', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 1 }), h.state)
    mapMessage(se({ type: 'content_block_delta', delta: { type: 'input_json_delta', partial_json: 'a'.repeat(8) } }), h.state)
    mapMessage(se({ type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'b'.repeat(8) } }), h.state)
    h.advance(250)
    expect(h.emitted.at(-1)!.turn.outputTokens).toBe(4)
  })

  it('context uses only main-thread calls; turn sums main + subagent', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 1000 }), h.state)
    mapMessage(msgDelta(20), h.state)
    mapMessage(start('s1', { input_tokens: 300 }, 'toolu_a'), h.state)
    mapMessage(msgDelta(7, 'toolu_a'), h.state)
    const last = h.emitted.at(-1)!
    expect(last.contextTokens).toBe(1000)
    expect(last.contextOutputTokens).toBe(20)
    expect(last.turn.inputTokens).toBe(1300)
    expect(last.turn.outputTokens).toBe(27)
    expect(last.apiCalls).toBe(2)
    mapMessage(start('m2', { input_tokens: 1500 }), h.state)
    expect(h.emitted.at(-1)!.contextTokens).toBe(1500)
    expect(h.emitted.at(-1)!.exact).toBe(false)
  })

  it('thinking_tokens raises the estimate', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 1 }), h.state)
    mapMessage(textDelta('abcd'), h.state)
    mapMessage(msg({ type: 'system', subtype: 'thinking_tokens', estimated_tokens: 500, estimated_tokens_delta: 500 }), h.state)
    h.advance(250)
    expect(h.emitted.at(-1)!.turn.outputTokens).toBe(500)
  })

  it('throttles to one per 250 ms with a trailing flush', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 1 }), h.state)
    const base = h.emitted.length
    for (let i = 0; i < 20; i++) {
      mapMessage(textDelta('abcd'), h.state)
      h.advance(10)
    }
    // 200 ms elapsed since the start emit: still throttled, nothing new yet
    expect(h.emitted.length).toBe(base)
    h.advance(60)
    expect(h.emitted.length).toBe(base + 1) // trailing flush
    expect(h.emitted.at(-1)!.turn.outputTokens).toBe(20)
    mapMessage(textDelta('abcd'), h.state)
    expect(h.emitted.length).toBe(base + 1)
    h.advance(300)
    expect(h.emitted.length).toBe(base + 2)
  })

  it('finish() flushes a pending emit and ignores later input; reset() restarts', () => {
    const h = harness()
    mapMessage(start('m1', { input_tokens: 1 }), h.state)
    const n = h.emitted.length
    mapMessage(textDelta('abcdefgh'), h.state)
    h.acc.finish()
    expect(h.emitted.length).toBe(n + 1)
    mapMessage(start('late', { input_tokens: 9 }), h.state)
    expect(h.emitted.length).toBe(n + 1)
    h.acc.reset()
    mapMessage(start('m2', { input_tokens: 5 }), h.state)
    expect(h.emitted.at(-1)).toMatchObject({ apiCalls: 1, contextTokens: 5 })
  })
})

describe('mapMessage init / result / tasks', () => {
  it('maps agents, skills and plugins on init', () => {
    const [e] = mapMessage(
      msg({
        type: 'system',
        subtype: 'init',
        session_id: 's',
        model: 'm',
        tools: [],
        mcp_servers: [],
        slash_commands: [],
        cwd: 'C:\\fixture\\proj',
        permissionMode: 'default',
        agents: ['general-purpose'],
        skills: ['s1'],
        plugins: [{ name: 'p', path: 'C:\\fixture\\p', version: '2.0.0' }, { name: 'q', path: 'C:\\fixture\\q' }]
      }),
      { msgId: '' }
    )
    expect(e).toMatchObject({
      agents: ['general-purpose'],
      skills: ['s1'],
      plugins: [{ name: 'p', path: 'C:\\fixture\\p', version: '2.0.0' }, { name: 'q', path: 'C:\\fixture\\q' }]
    })
  })

  it('sums modelUsage into sessionUsage and passes durationApiMs', () => {
    const ev = mapMessage(
      msg({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'x',
        total_cost_usd: 0.5,
        duration_ms: 100,
        duration_api_ms: 80,
        num_turns: 1,
        usage: { input_tokens: 1, output_tokens: 1 },
        modelUsage: {
          a: { inputTokens: 10, outputTokens: 2, cacheReadInputTokens: 3, cacheCreationInputTokens: 4, costUSD: 0.1, contextWindow: 200000, thinkingTokens: 5 },
          b: { inputTokens: 1, outputTokens: 1, cacheReadInputTokens: 1, cacheCreationInputTokens: 1, costUSD: 0.2, contextWindow: 100 }
        }
      }),
      { msgId: '' }
    )
    expect(ev[0]).toMatchObject({
      t: 'result',
      durationApiMs: 80,
      sessionUsage: {
        inputTokens: 11,
        outputTokens: 3,
        cacheReadTokens: 4,
        cacheCreationTokens: 5,
        thinkingTokens: 5
      }
    })
    const su = (ev[0] as Extract<SessionEvent, { t: 'result' }>).sessionUsage!
    expect(su.costUsd).toBeCloseTo(0.3)
  })

  it('maps task events 1:1 (skip_transcript -> hidden) and tool_progress', () => {
    const state: MapState = { msgId: '' }
    expect(
      mapMessage(
        msg({
          type: 'system',
          subtype: 'task_started',
          task_id: 't1',
          tool_use_id: 'toolu_1',
          description: 'count',
          subagent_type: 'general-purpose',
          task_type: 'local_agent',
          spawn_depth: 1,
          is_backgrounded: true,
          skip_transcript: true,
          ambient: true,
          parent_task_id: 't0'
        }),
        state
      )
    ).toEqual([
      {
        t: 'task_started',
        taskId: 't1',
        toolUseId: 'toolu_1',
        description: 'count',
        subagentType: 'general-purpose',
        taskType: 'local_agent',
        parentTaskId: 't0',
        depth: 1,
        background: true,
        ambient: true,
        hidden: true
      }
    ])
    expect(
      mapMessage(
        msg({
          type: 'system',
          subtype: 'task_progress',
          task_id: 't1',
          tool_use_id: 'toolu_1',
          description: 'count',
          usage: { total_tokens: 900, tool_uses: 2, duration_ms: 1500 },
          last_tool_name: 'Glob'
        }),
        state
      )
    ).toEqual([
      { t: 'task_progress', taskId: 't1', toolUseId: 'toolu_1', totalTokens: 900, toolUses: 2, durationMs: 1500, lastToolName: 'Glob' }
    ])
    expect(
      mapMessage(
        msg({ type: 'system', subtype: 'task_updated', task_id: 't1', patch: { status: 'running', is_backgrounded: false, error: 'e' } }),
        state
      )
    ).toEqual([{ t: 'task_updated', taskId: 't1', status: 'running', background: false, error: 'e' }])
    expect(
      mapMessage(
        msg({
          type: 'system',
          subtype: 'task_notification',
          task_id: 't1',
          tool_use_id: 'toolu_1',
          status: 'stopped',
          summary: 'done',
          output_file: 'x',
          usage: { total_tokens: 1000, tool_uses: 3, duration_ms: 2000 }
        }),
        state
      )
    ).toEqual([
      { t: 'task_ended', taskId: 't1', toolUseId: 'toolu_1', status: 'stopped', summary: 'done', totalTokens: 1000, toolUses: 3, durationMs: 2000 }
    ])
    expect(
      mapMessage(msg({ type: 'tool_progress', tool_use_id: 'tu', tool_name: 'Bash', parent_tool_use_id: 'toolu_1', elapsed_time_seconds: 2.5, task_id: 't1' }), state)
    ).toEqual([{ t: 'tool_progress', toolUseId: 'tu', toolName: 'Bash', parentToolUseId: 'toolu_1', elapsedMs: 2500, taskId: 't1' }])
    expect(mapMessage(msg({ type: 'system', subtype: 'background_tasks_changed' }), state)).toEqual([])
  })
})

describe('startSdkSession wiring', () => {
  it('stopTask reaches q.stopTask, supportedModels maps resolvedModel, usage_live precedes result', async () => {
    const stopped: string[] = []
    async function* gen(): AsyncGenerator<SDKMessage> {
      yield start('m1', { input_tokens: 10 })
      yield msgDelta(5)
      yield msg({
        type: 'result',
        subtype: 'success',
        is_error: false,
        result: 'ok',
        total_cost_usd: 0,
        duration_ms: 1,
        num_turns: 1,
        usage: {},
        modelUsage: {}
      })
    }
    const q = Object.assign(gen(), {
      stopTask: async (id: string) => void stopped.push(id),
      supportedModels: async () => [{ value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' }],
      interrupt: async () => {},
      close: () => {}
    }) as unknown as Query
    const events: SessionEvent[] = []
    const s = await startSdkSession({ cwd: 'C:\\fixture\\proj', prompt: 'hi', queryImpl: () => q, onEvent: (e) => events.push(e) })
    await s.done
    await s.stopTask('t9')
    expect(stopped).toEqual(['t9'])
    expect(await s.supportedModels()).toEqual([{ value: 'sonnet', displayName: 'Sonnet', resolvedModel: 'claude-sonnet-5' }])
    const kinds = events.map((e) => e.t)
    expect(kinds.filter((k) => k === 'usage_live')).toHaveLength(2)
    expect(kinds.indexOf('usage_live')).toBeLessThan(kinds.indexOf('result'))
    expect(kinds[kinds.length - 1]).toBe('session_closed')
  })

  it('emits session_closed after a crash (status error) but not after an is_error result', async () => {
    const run = async (gen: () => AsyncGenerator<SDKMessage>): Promise<SessionEvent[]> => {
      const events: SessionEvent[] = []
      const q = Object.assign(gen(), { interrupt: async () => {}, close: () => {} }) as unknown as Query
      const s = await startSdkSession({ cwd: 'C:\fixture\proj', prompt: 'hi', queryImpl: () => q, onEvent: (e) => events.push(e) })
      await s.done
      return events
    }
    const crashed = await run(async function* () {
      yield start('m1', { input_tokens: 1 })
      throw new Error('process exited with code 1')
    })
    expect(crashed.map((e) => e.t).slice(-3)).toEqual(['error', 'status', 'session_closed'])
    // An is_error result keeps the session open; the loop only ends when the query is closed, which is
    // also reported (a closed query can run no task), but an is_error result by itself emits no closed event.
    let release!: () => void
    const gate = new Promise<void>((r) => (release = r))
    const events: SessionEvent[] = []
    const q = Object.assign(
      (async function* (): AsyncGenerator<SDKMessage> {
        yield msg({ type: 'result', subtype: 'error_during_execution', is_error: true, total_cost_usd: 0, duration_ms: 1, num_turns: 1, usage: {}, modelUsage: {} })
        await gate
      })(),
      { interrupt: async () => {}, close: () => {} }
    ) as unknown as Query
    await startSdkSession({ cwd: 'C:\fixture\proj', prompt: 'hi', queryImpl: () => q, onEvent: (e) => events.push(e) })
    await new Promise((r) => setTimeout(r, 20))
    expect(events.some((e) => e.t === 'status' && e.state === 'error')).toBe(true)
    expect(events.some((e) => e.t === 'session_closed')).toBe(false)
    release()
  })
})
