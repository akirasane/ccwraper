import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LimitsState } from '../../shared/limits'
import { formatCountdown, limitLevel, normalizeUtilization, viewLimit } from '../../shared/limits'
import { LimitsService } from './limits-service'

const T0 = Date.parse('2026-10-31T10:00:00Z')
let dir: string
let file: string
let clock: number
let sent: LimitsState[]

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ccw-limits-'))
  file = join(dir, 'limits.json')
  clock = T0
  sent = []
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

const make = (): LimitsService => new LimitsService({ file, broadcast: (s) => sent.push(s), now: () => clock })
const secs = (ms: number): number => Math.round(ms / 1000)

describe('normalizeUtilization', () => {
  it('reads <= 1 as a 0..1 fraction and > 1 as a percent, clamped', () => {
    expect(normalizeUtilization(0)).toBe(0)
    expect(normalizeUtilization(0.42)).toBeCloseTo(42)
    expect(normalizeUtilization(1)).toBe(100)
    expect(normalizeUtilization(42)).toBe(42)
    expect(normalizeUtilization(250)).toBe(100)
  })
  it('rejects non-numbers and negatives', () => {
    for (const bad of [undefined, null, 'x', NaN, Infinity, -1]) expect(normalizeUtilization(bad)).toBeUndefined()
  })
})

describe('LimitsService', () => {
  it('stores per type, converts seconds to ms and the fraction to percent', () => {
    const s = make()
    const reset = T0 + 3_600_000
    expect(s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.35, resetsAt: secs(reset) })).toBe(true)
    expect(s.getState().limits).toEqual([{ type: 'five_hour', status: 'allowed', usedPercent: 35, resetsAt: reset, seenAt: T0, stale: false }])
    expect(sent).toHaveLength(1)
  })

  it('latest event wins per type and types are independent', () => {
    const s = make()
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1, resetsAt: secs(T0 + 1000) })
    s.ingest({ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.5 })
    clock += 5000
    s.ingest({ status: 'allowed_warning', rateLimitType: 'five_hour', utilization: 0.8, resetsAt: secs(T0 + 1000) })
    const by = Object.fromEntries(s.getState().limits.map((e) => [e.type, e]))
    expect(by['five_hour']).toMatchObject({ usedPercent: 80, status: 'allowed_warning', seenAt: T0 + 5000 })
    expect(by['seven_day']).toMatchObject({ usedPercent: 50 })
  })

  it('aggregates events from several sessions (the service has no per-session state)', () => {
    const s = make()
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.2 }) // session A
    s.ingest({ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.3 }) // session B
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.4 }) // session B again
    expect(s.getState().limits.map((e) => [e.type, e.usedPercent])).toEqual([
      ['five_hour', 40],
      ['seven_day', 30]
    ])
  })

  it('keeps seven_day_opus/sonnet for the tooltip and ignores other types and junk', () => {
    const s = make()
    expect(s.ingest({ status: 'allowed', rateLimitType: 'seven_day_opus', utilization: 0.1 })).toBe(true)
    expect(s.ingest({ status: 'allowed', rateLimitType: 'overage', utilization: 0.9 })).toBe(false)
    expect(s.ingest({ status: 'allowed' })).toBe(false)
    expect(s.ingest({ status: 'weird', rateLimitType: 'five_hour' })).toBe(false)
    expect(s.ingest(null)).toBe(false)
    expect(s.getState().limits.map((e) => e.type)).toEqual(['seven_day_opus'])
  })

  it('keeps the old percent for the same window when an event has no utilization, drops it for a new window', () => {
    const s = make()
    const reset = T0 + 3_600_000
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.6, resetsAt: secs(reset) })
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: secs(reset) })
    expect(s.getState().limits[0]!.usedPercent).toBe(60)
    s.ingest({ status: 'allowed', rateLimitType: 'five_hour', resetsAt: secs(reset + 5 * 3_600_000) })
    expect(s.getState().limits[0]!.usedPercent).toBeUndefined()
  })

  it('a rejected event without utilization means 100%', () => {
    const s = make()
    s.ingest({ status: 'rejected', rateLimitType: 'five_hour' })
    expect(s.getState().limits[0]!.usedPercent).toBe(100)
  })

  it('persists and reloads (stale until a fresh event), round trip in a temp dir', async () => {
    const a = make()
    const reset = T0 + 3_600_000
    a.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.35, resetsAt: secs(reset) })
    a.ingest({ status: 'allowed', rateLimitType: 'seven_day', utilization: 0.7 })
    await a.flush()
    expect(JSON.parse(readFileSync(file, 'utf8')).limits).toHaveLength(2)

    clock += 600_000
    const b = make()
    expect(b.getState().limits.map((e) => [e.type, e.usedPercent, e.stale, e.seenAt])).toEqual([
      ['five_hour', 35, true, T0],
      ['seven_day', 70, true, T0]
    ])
    b.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.4, resetsAt: secs(reset) })
    expect(b.getState().limits.map((e) => [e.type, e.stale])).toEqual([
      ['five_hour', false],
      ['seven_day', true]
    ])
  })

  it('survives a missing, corrupt or invalid file', () => {
    expect(make().getState().limits).toEqual([])
    writeFileSync(file, '{not json')
    expect(make().getState().limits).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, limits: [{ type: 'five_hour', usedPercent: 500, status: 'allowed', seenAt: 1 }] }))
    expect(make().getState().limits).toEqual([])
    writeFileSync(file, JSON.stringify({ version: 1, limits: [{ type: 'bogus', status: 'allowed', seenAt: 1 }] }))
    expect(make().getState().limits).toEqual([])
  })

  it('does not throw when the file cannot be written', async () => {
    const log = vi.fn()
    const s = new LimitsService({ file: join(dir, 'file.txt', 'x', 'limits.json'), broadcast: () => {}, log })
    writeFileSync(join(dir, 'file.txt'), 'blocker')
    expect(s.ingest({ status: 'allowed', rateLimitType: 'five_hour', utilization: 0.1 })).toBe(true)
    await s.flush()
    expect(log).toHaveBeenCalled()
  })
})

describe('viewLimit', () => {
  const entry = { type: 'five_hour' as const, usedPercent: 72.4, resetsAt: T0 + 3_600_000, status: 'allowed' as const, seenAt: T0 - 1000, stale: true }
  it('rounds and levels the percent', () => {
    expect(viewLimit(entry, T0)).toMatchObject({ percent: 72, level: 'warn', expired: false, stale: true })
    expect([69, 70, 89, 90, 100].map(limitLevel)).toEqual(['ok', 'warn', 'warn', 'danger', 'danger'])
  })
  it('shows 0% / expired (and not stale) once the reset has passed', () => {
    expect(viewLimit(entry, T0 + 3_600_000)).toMatchObject({ percent: 0, expired: true, stale: false, level: 'ok' })
  })
  it('formats countdowns', () => {
    expect(formatCountdown(30_000)).toBe('<1m')
    expect(formatCountdown(23 * 60_000)).toBe('23m')
    expect(formatCountdown(83 * 60_000)).toBe('1h23m')
    expect(formatCountdown((2 * 24 + 4) * 3_600_000)).toBe('2d4h')
  })
})
