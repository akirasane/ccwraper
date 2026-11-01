import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UsageProbe, type ProbeQueryFn } from './usage-probe'
import type { IngestableLimit } from './usage-limits'

const RESP = { rate_limits_available: true, rate_limits: { five_hour: { utilization: 40, resets_at: '2026-11-01T10:00:00+00:00' } } }

function harness(usage: () => Promise<unknown> = async () => RESP): {
  impl: ProbeQueryFn
  opened: () => number
  closed: () => number
  options: () => Record<string, unknown>
  usage: ReturnType<typeof vi.fn>
} {
  let opened = 0
  let closed = 0
  let options: Record<string, unknown> = {}
  const fn = vi.fn(usage)
  const impl: ProbeQueryFn = (args) => {
    opened += 1
    options = args.options
    return {
      usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET: fn,
      close: () => {
        closed += 1
      }
    }
  }
  return { impl, opened: () => opened, closed: () => closed, options: () => options, usage: fn }
}

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

describe('UsageProbe', () => {
  it('fetches immediately, then every interval, reusing one idle session', async () => {
    const h = harness()
    const seen: IngestableLimit[] = []
    const p = new UsageProbe({ ingest: (l) => seen.push(l), enabled: () => true, queryImpl: h.impl, intervalMs: 30_000 })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.usage).toHaveBeenCalledTimes(1)
    expect(seen).toHaveLength(1)
    expect(seen[0]).toMatchObject({ rateLimitType: 'five_hour', utilization: 0.4 })
    await vi.advanceTimersByTimeAsync(30_000)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.usage).toHaveBeenCalledTimes(3)
    expect(h.opened()).toBe(1)
    p.dispose()
    expect(h.closed()).toBe(1)
  })

  it('opens a minimal, no-chat session: no settings, no tools, no persistence', async () => {
    const h = harness()
    const p = new UsageProbe({ ingest: () => {}, enabled: () => true, queryImpl: h.impl })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.options()).toMatchObject({ settingSources: [], tools: [], persistSession: false, permissionMode: 'plan' })
    p.dispose()
  })

  it('does nothing and closes its session while the bars are disabled, and resumes when re-enabled', async () => {
    const h = harness()
    let on = true
    const p = new UsageProbe({ ingest: () => {}, enabled: () => on, queryImpl: h.impl, intervalMs: 30_000 })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.opened()).toBe(1)
    on = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.closed()).toBe(1)
    expect(h.usage).toHaveBeenCalledTimes(1)
    on = true
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.opened()).toBe(2)
    expect(h.usage).toHaveBeenCalledTimes(2)
    p.dispose()
  })

  it('on failure closes the dead session, backs off, then recovers with a fresh one', async () => {
    let fail = true
    const h = harness(async () => {
      if (fail) throw new Error('process died')
      return RESP
    })
    const logs: string[] = []
    const seen: IngestableLimit[] = []
    const p = new UsageProbe({ ingest: (l) => seen.push(l), enabled: () => true, queryImpl: h.impl, intervalMs: 30_000, log: (m) => logs.push(m) })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(logs[0]).toMatch(/process died/)
    expect(h.closed()).toBe(1)
    await vi.advanceTimersByTimeAsync(30_000) // backoff is 60 s after one failure: not yet
    expect(h.usage).toHaveBeenCalledTimes(1)
    fail = false
    await vi.advanceTimersByTimeAsync(30_000)
    expect(h.usage).toHaveBeenCalledTimes(2)
    expect(h.opened()).toBe(2)
    expect(seen).toHaveLength(1)
    p.dispose()
  })

  it('a CLI without the usage API fails quietly (logged, not thrown)', async () => {
    const logs: string[] = []
    const p = new UsageProbe({
      ingest: () => {},
      enabled: () => true,
      queryImpl: () => ({ close: () => {} }),
      log: (m) => logs.push(m)
    })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    expect(logs[0]).toMatch(/no usage API/)
    p.dispose()
  })

  it('refreshNow is throttled and ignored after dispose', async () => {
    const h = harness()
    const p = new UsageProbe({ ingest: () => {}, enabled: () => true, queryImpl: h.impl, intervalMs: 30_000 })
    p.start()
    await vi.advanceTimersByTimeAsync(1)
    p.refreshNow() // inside the 5 s gap
    await vi.advanceTimersByTimeAsync(1)
    expect(h.usage).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(6_000)
    p.refreshNow()
    await vi.advanceTimersByTimeAsync(1)
    expect(h.usage).toHaveBeenCalledTimes(2)
    p.dispose()
    p.refreshNow()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(h.usage).toHaveBeenCalledTimes(2)
  })
})
