import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { SessionEvent } from '../../shared/events'
import { UsageLedger, readLedger } from './usage-ledger'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'ccwrap-ledger-'))
  dirs.push(d)
  return d
}

function result(cost: number, inp = 0, model = 'm1'): SessionEvent {
  return {
    t: 'result',
    costUsd: cost,
    durationMs: 1,
    turns: 1,
    isError: false,
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
    modelUsage: { [model]: { inputTokens: inp, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: cost } }
  }
}

describe('UsageLedger', () => {
  it('records the delta between cumulative results (0.10 then 0.25 -> 0.10, 0.15)', () => {
    const file = join(tmp(), 'sub', 'ledger.jsonl')
    const l = new UsageLedger(file, () => 1000)
    const info = { cwd: 'C:\\proj\\a', sdkSessionId: 'sdk1' }
    l.onSessionEvent('L1', result(0.1, 10), info)
    l.onSessionEvent('L1', result(0.25, 30), info)
    const lines = readLedger(file)
    expect(lines).toHaveLength(2)
    expect(lines[0]!.models['m1']!.estCostUsd).toBeCloseTo(0.1)
    expect(lines[1]!.models['m1']!.estCostUsd).toBeCloseTo(0.15)
    expect(lines[1]!.models['m1']!.inputTokens).toBe(20)
    expect(lines[1]).toMatchObject({ sdkSessionId: 'sdk1', ts: 1000 })
  })

  it('tracks localIds independently and treats a counter reset as a fresh process', () => {
    const file = join(tmp(), 'ledger.jsonl')
    const l = new UsageLedger(file)
    const info = { cwd: 'C:\\p' }
    l.onSessionEvent('A', result(0.5), info)
    l.onSessionEvent('B', result(0.2), info)
    l.onSessionEvent('A', result(0.1), info) // went backwards: new process
    const costs = readLedger(file).map((x) => x.models['m1']!.estCostUsd)
    expect(costs).toEqual([0.5, 0.2, 0.1])
  })

  it('ignores non-result events, zero deltas and missing info; session_closed resets', () => {
    const file = join(tmp(), 'ledger.jsonl')
    const l = new UsageLedger(file)
    l.onSessionEvent('A', { t: 'status', state: 'idle' }, { cwd: 'x' })
    l.onSessionEvent('A', result(0.3), undefined)
    l.onSessionEvent('A', result(0.3), { cwd: 'x' }) // zero delta (already seen via undefined-info call)
    expect(readLedger(file)).toHaveLength(0)
    l.onSessionEvent('A', { t: 'session_closed' }, { cwd: 'x' })
    l.onSessionEvent('A', result(0.3), { cwd: 'x' })
    expect(readLedger(file)).toHaveLength(1)
  })

  it('reader skips bad lines', () => {
    const file = join(tmp(), 'ledger.jsonl')
    const l = new UsageLedger(file)
    l.onSessionEvent('A', result(0.3), { cwd: 'x' })
    appendFileSync(file, 'not json\n{"ts":"x"}\n{"ts":5,"models":{"m":{"costUsd":1.5}}}\n')
    expect(readFileSync(file, 'utf8').split('\n').length).toBeGreaterThan(3)
    const r = readLedger(file)
    expect(r).toHaveLength(2)
    expect(r[1]!.models['m']!.estCostUsd).toBe(1.5)
    expect(readLedger(join(tmp(), 'missing.jsonl'))).toEqual([])
  })
})
