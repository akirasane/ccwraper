import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { Query } from '@anthropic-ai/claude-agent-sdk'
import { LimitsService } from './limits-service'
import { startSdkSession, type QueryImpl } from './sdk-adapter'
import { createUsageRefresher, limitsFromUsage } from './usage-limits'

const RESP = {
  rate_limits_available: true,
  rate_limits: {
    five_hour: { utilization: 58, resets_at: '2026-11-01T10:30:00.072126+00:00' },
    seven_day: { utilization: 93, resets_at: '2026-11-03T02:00:00+00:00' },
    seven_day_opus: null,
    seven_day_sonnet: { utilization: 1, resets_at: null }
  }
}

describe('limitsFromUsage', () => {
  it('maps windows to fractions, statuses and epoch ms; skips null windows', () => {
    const r = limitsFromUsage(RESP)
    expect(r.map((x) => x.rateLimitType)).toEqual(['five_hour', 'seven_day', 'seven_day_sonnet'])
    expect(r[0]).toEqual({ rateLimitType: 'five_hour', status: 'allowed', utilization: 0.58, resetsAt: Date.parse('2026-11-01T10:30:00.072126+00:00') })
    expect(r[1]!.status).toBe('allowed_warning')
    expect(r[2]).toEqual({ rateLimitType: 'seven_day_sonnet', status: 'allowed', utilization: 0.01 })
  })
  it('100% is rejected and utilization above 100 is clamped', () => {
    const r = limitsFromUsage({ rate_limits_available: true, rate_limits: { five_hour: { utilization: 130, resets_at: null } } })
    expect(r[0]).toMatchObject({ status: 'rejected', utilization: 1 })
  })
  it('returns nothing for API-key sessions or odd shapes', () => {
    expect(limitsFromUsage({ rate_limits_available: false, rate_limits: null })).toEqual([])
    expect(limitsFromUsage(null)).toEqual([])
    expect(limitsFromUsage({ rate_limits: { five_hour: { utilization: 'x' } } })).toEqual([])
    expect(limitsFromUsage({ rate_limits: { five_hour: { utilization: -1 } } })).toEqual([])
  })

  it('end to end through LimitsService: 1% stays 1% (not read as 100%) and 58% shows 58', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ccwrap-lim-'))
    try {
      const svc = new LimitsService({ file: join(dir, 'limits.json'), broadcast: () => {} })
      for (const l of limitsFromUsage(RESP)) svc.ingest(l)
      const by = Object.fromEntries(svc.getState().limits.map((e) => [e.type, e.usedPercent]))
      expect(by['five_hour']).toBeCloseTo(58, 5)
      expect(by['seven_day']).toBeCloseTo(93, 5)
      expect(by['seven_day_sonnet']).toBeCloseTo(1, 5)
      expect(svc.getState().limits.find((e) => e.type === 'five_hour')?.stale).toBe(false)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

describe('createUsageRefresher', () => {
  it('throttles, never overlaps, and swallows failures', async () => {
    let t = 0
    const fetchUsage = vi.fn(async () => RESP)
    const seen: unknown[] = []
    const refresh = createUsageRefresher(fetchUsage, (l) => seen.push(l), { minIntervalMs: 1000, now: () => t })
    await Promise.all([refresh(), refresh()])
    expect(fetchUsage).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(3)
    await refresh()
    expect(fetchUsage).toHaveBeenCalledTimes(1) // inside the interval
    t += 1001
    await refresh()
    expect(fetchUsage).toHaveBeenCalledTimes(2)

    const bad = createUsageRefresher(async () => { throw new Error('offline') }, () => {}, { minIntervalMs: 0 })
    await expect(bad()).resolves.toBeUndefined()
  })
})

describe('adapter feeds the bars', () => {
  it('asks for usage on init and after a result and passes the windows to onRateLimitInfo', async () => {
    const usage = vi.fn(async () => RESP)
    const msgs = [
      { type: 'system', subtype: 'init', session_id: 's', tools: [], mcp_servers: [], model: 'm', permissionMode: 'default', slash_commands: [], cwd: 'C:/x' },
      { type: 'result', subtype: 'success', is_error: false, duration_ms: 1, duration_api_ms: 1, num_turns: 1, result: '', total_cost_usd: 0, usage: { input_tokens: 0, output_tokens: 0 }, session_id: 's' }
    ]
    const impl = (() => {
      let i = 0
      return {
        [Symbol.asyncIterator]: () => ({ next: async () => (i < msgs.length ? { value: msgs[i++], done: false as const } : { value: undefined, done: true as const }) }),
        interrupt: async () => {},
        close: () => {},
        usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: usage
      } as unknown as Query
    }) as unknown as QueryImpl
    const infos: unknown[] = []
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: impl, onEvent: () => {}, onRateLimitInfo: (i) => infos.push(i) })
    await s.done
    expect(usage).toHaveBeenCalledWith({ skipBehaviors: true })
    expect(infos.filter((i) => (i as { rateLimitType: string }).rateLimitType === 'five_hour')).toHaveLength(1)
  })
})
