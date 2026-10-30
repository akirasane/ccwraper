import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '../../shared/events'
import { mapMessage, type MapState } from './sdk-adapter'

// Synthetic messages built from the SDK typings (SDKRateLimitEvent, SDKAssistantMessage.error, SDKResultSuccess).
// No live call: nothing here can touch the subscription.
const NOW = Date.parse('2026-10-30T08:00:00Z') // 15:00 in Asia/Bangkok
const state = (): MapState => ({ msgId: '', now: () => NOW })

const rateEvent = (info: Record<string, unknown>): SDKMessage =>
  ({ type: 'rate_limit_event', rate_limit_info: info, uuid: 'u', session_id: 's' }) as unknown as SDKMessage

const limitAssistant = (text: string, error: string = 'rate_limit'): SDKMessage =>
  ({
    type: 'assistant',
    error,
    message: { id: 'm1', content: [{ type: 'text', text }] },
    parent_tool_use_id: null,
    uuid: 'u',
    session_id: 's'
  }) as unknown as SDKMessage

const result = (over: Record<string, unknown> = {}): SDKMessage =>
  ({
    type: 'result',
    subtype: 'success',
    is_error: true,
    result: '',
    total_cost_usd: 0,
    duration_ms: 10,
    duration_api_ms: 5,
    num_turns: 1,
    usage: {},
    modelUsage: {},
    uuid: 'u',
    session_id: 's',
    ...over
  }) as unknown as SDKMessage

function run(msgs: SDKMessage[], st = state()): SessionEvent[] {
  return msgs.flatMap((m) => mapMessage(m, st))
}
const limited = (evs: SessionEvent[]): Extract<SessionEvent, { t: 'rate_limited' }>[] =>
  evs.filter((e): e is Extract<SessionEvent, { t: 'rate_limited' }> => e.t === 'rate_limited')

describe('usage limit detection in mapMessage', () => {
  it('uses the structured rejected event (resetsAt in epoch seconds) and emits before the result', () => {
    const reset = Date.parse('2026-10-30T09:10:00Z')
    const evs = run([
      rateEvent({ status: 'rejected', resetsAt: reset / 1000, rateLimitType: 'five_hour' }),
      limitAssistant("You've hit your limit"),
      result()
    ])
    expect(limited(evs)).toEqual([{ t: 'rate_limited', source: 'event', resetsAt: reset, limitType: 'five_hour' }])
    const idx = evs.findIndex((e) => e.t === 'rate_limited')
    expect(evs[idx + 1]?.t).toBe('result')
  })

  it('falls back to the CLI text when the event has no resetsAt', () => {
    const evs = run([
      rateEvent({ status: 'rejected' }),
      limitAssistant('5-hour limit reached ∙ resets 4:10pm (Asia/Bangkok)'),
      result()
    ])
    expect(limited(evs)).toEqual([
      { t: 'rate_limited', source: 'text', resetsAt: Date.parse('2026-10-30T09:10:00Z'), limitType: 'five_hour' }
    ])
  })

  it('detects from text alone (assistant error rate_limit + limit wording)', () => {
    const evs = run([limitAssistant('5-hour limit reached ∙ resets 4:10pm (Asia/Bangkok)'), result()])
    expect(limited(evs)).toHaveLength(1)
    expect(limited(evs)[0]?.source).toBe('text')
  })

  it('reports an unknown reset (source none) when the text cannot be parsed', () => {
    const evs = run([rateEvent({ status: 'rejected' }), limitAssistant('limit reached ∙ resets soon'), result()])
    expect(limited(evs)).toEqual([{ t: 'rate_limited', source: 'none' }])
  })

  it('does not treat a plain API 429 as a usage limit', () => {
    const evs = run([limitAssistant('API Error: 429 too many requests, please retry'), result()])
    expect(limited(evs)).toHaveLength(0)
  })

  it('ignores warnings, allowed events and non-error results', () => {
    expect(limited(run([rateEvent({ status: 'allowed_warning', resetsAt: 1_793_350_800 }), result()]))).toHaveLength(0)
    expect(limited(run([rateEvent({ status: 'rejected', resetsAt: 1_793_350_800 }), result({ is_error: false })]))).toHaveLength(0)
  })

  it('a later allowed event cancels an earlier rejection', () => {
    const evs = run([rateEvent({ status: 'rejected', resetsAt: 1_793_350_800 }), rateEvent({ status: 'allowed' }), result()])
    expect(limited(evs)).toHaveLength(0)
  })

  it('does not carry evidence into the next turn', () => {
    const st = state()
    run([rateEvent({ status: 'rejected', resetsAt: 1_793_350_800 }), result()], st)
    expect(limited(run([result()], st))).toHaveLength(0)
  })

  it('keeps the old error event and carries no message text in rate_limited', () => {
    const evs = run([rateEvent({ status: 'rejected', resetsAt: 1_793_350_800 }), limitAssistant('secret prompt text'), result()])
    expect(evs.some((e) => e.t === 'error')).toBe(true)
    expect(JSON.stringify(limited(evs))).not.toContain('secret')
  })
})
