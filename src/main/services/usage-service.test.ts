import { appendFileSync, mkdirSync, mkdtempSync, rmSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { UsageService } from './usage-service'
import { UsageLedger } from './usage-ledger'
import { aLine } from './usage-test-util'
import type { SessionEvent } from '../../shared/events'

const NOW = Date.parse('2026-03-10T12:00:00Z')
const utc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function setup() {
  const base = mkdtempSync(join(tmpdir(), 'ccwrap-usvc-'))
  dirs.push(base)
  const root = join(base, 'projects')
  mkdirSync(join(root, 'p1'), { recursive: true })
  const logs: string[] = []
  const mk = (): UsageService =>
    new UsageService({
      root,
      cacheFile: join(base, 'usage-cache.json'),
      ledgerFile: join(base, 'ledger.jsonl'),
      now: () => NOW,
      dateOf: utc,
      log: (l) => logs.push(l)
    })
  return { base, root, logs, mk, svc: mk() }
}

const ts = (d: string): string => `${d}T10:00:00Z`

describe('UsageService', () => {
  it('returns a zero-filled range with no files', async () => {
    const { svc } = setup()
    const s = await svc.summary({ days: 7 })
    expect(s.days).toHaveLength(7)
    expect(s.to).toBe('2026-03-10')
    expect(s.from).toBe('2026-03-04')
    expect(s.totals.messages).toBe(0)
    expect(s.cost.since).toBeUndefined()
  })

  it('aggregates days/projects/models, dedupes ids, includes subagents, filters by cwd', async () => {
    const { svc, root } = setup()
    const f = join(root, 'p1', 'sess1.jsonl')
    writeFileSync(
      f,
      [
        aLine({ id: 'a', ts: ts('2026-03-10'), out: 5, sid: 'sess1' }),
        aLine({ id: 'a', ts: ts('2026-03-10'), out: 5, sid: 'sess1' }),
        aLine({ id: 'b', ts: ts('2026-03-09'), model: 'm2', sid: 'sess1' }),
        aLine({ id: 'c', ts: ts('2026-03-09'), cwd: 'C:\\proj\\b', sid: 'sess2' }),
        aLine({ id: 'old', ts: ts('2025-01-01') })
      ].join('\n') + '\n'
    )
    mkdirSync(join(root, 'p1', 'sess1', 'subagents'), { recursive: true })
    writeFileSync(join(root, 'p1', 'sess1', 'subagents', 'agent-1.jsonl'), aLine({ id: 'sub', ts: ts('2026-03-10'), sid: 'sess1' }) + '\n')

    const s = await svc.summary({ days: 7 })
    expect(s.totals.messages).toBe(4)
    expect(s.totals.sessions).toBe(2)
    const d10 = s.days.find((d) => d.date === '2026-03-10')!
    expect(d10.tokens.output).toBe(5 + 2)
    expect(d10.sessions).toBe(1)
    expect(s.models.map((m) => m.model).sort()).toEqual(['claude-x', 'm2'])
    expect(s.projects).toHaveLength(2)
    expect(s.projects[0]!.tokens.output).toBeGreaterThanOrEqual(s.projects[1]!.tokens.output)

    const only = await svc.summary({ days: 7, cwd: 'c:\\proj\\b\\' })
    expect(only.projects.map((p) => p.cwd)).toEqual(['C:\\proj\\b'])
    expect(only.totals.messages).toBe(1)
  })

  it('reads only the appended bytes and matches a full rescan', async () => {
    const { svc, mk, root, base } = setup()
    const f = join(root, 'p1', 's.jsonl')
    const first = aLine({ id: 'a', ts: ts('2026-03-10') }) + '\n'
    writeFileSync(f, first)
    const s1 = await svc.summary({ days: 7 })
    expect(s1.scan.bytesRead).toBe(Buffer.byteLength(first))

    const more = aLine({ id: 'b', ts: ts('2026-03-10') }) + '\n'
    appendFileSync(f, more)
    utimesSync(f, new Date(NOW + 60_000), new Date(NOW + 60_000))
    const s2 = await svc.summary({ days: 7 })
    expect(s2.scan.bytesRead).toBe(Buffer.byteLength(more))
    expect(s2.scan.cachedFiles).toBe(0)

    const fresh = new UsageService({ root, cacheFile: join(base, 'other-cache.json'), ledgerFile: join(base, 'l.jsonl'), now: () => NOW, dateOf: utc, log: () => {} })
    const full = await fresh.summary({ days: 7 })
    expect(s2.totals).toEqual(full.totals)
    expect(s2.days).toEqual(full.days)

    // unchanged file is not opened, via a persisted cache in a new instance
    const s3 = await mk().summary({ days: 7 })
    expect(s3.scan.bytesRead).toBe(0)
    expect(s3.scan.cachedFiles).toBe(1)
    expect(s3.totals).toEqual(full.totals)
  })

  it('rescans a truncated file fully', async () => {
    const { svc, root } = setup()
    const f = join(root, 'p1', 's.jsonl')
    const l1 = aLine({ id: 'a', ts: ts('2026-03-10') }) + '\n'
    const l2 = aLine({ id: 'b', ts: ts('2026-03-10') }) + '\n'
    writeFileSync(f, l1 + l2)
    expect((await svc.summary({ days: 7 })).totals.messages).toBe(2)
    truncateSync(f, Buffer.byteLength(l1))
    utimesSync(f, new Date(NOW + 5000), new Date(NOW + 5000))
    const s = await svc.summary({ days: 7 })
    expect(s.totals.messages).toBe(1)
    expect(s.scan.bytesRead).toBe(Buffer.byteLength(l1))
  })

  it('counts corrupt lines in scan.errors and never logs fixture text', async () => {
    const { svc, root, logs } = setup()
    writeFileSync(
      join(root, 'p1', 's.jsonl'),
      ['{"type":"assistant","usage": SENTINEL_SECRET_TEXT', aLine({ id: 'a', ts: ts('2026-03-10') })].join('\n') + '\n'
    )
    const s = await svc.summary({ days: 7 })
    expect(s.scan.errors).toBe(1)
    expect(s.totals.messages).toBe(1)
    expect(logs).toEqual(['s.jsonl:1: invalid json'])
    expect(logs.join('')).not.toContain('SENTINEL')
    expect(JSON.stringify(s)).not.toContain('SECRET')
  })

  it('recovers from a corrupt cache file', async () => {
    const { mk, base, root } = setup()
    writeFileSync(join(root, 'p1', 's.jsonl'), aLine({ id: 'a', ts: ts('2026-03-10') }) + '\n')
    writeFileSync(join(base, 'usage-cache.json'), '{"v":1,"files": [[[ broken')
    const s = await mk().summary({ days: 7 })
    expect(s.totals.messages).toBe(1)
    const s2 = await mk().summary({ days: 7 })
    expect(s2.scan.cachedFiles).toBe(1)
  })

  it('skips files older than the range and prunes deleted files from the cache', async () => {
    const { svc, root } = setup()
    const f = join(root, 'p1', 'old.jsonl')
    writeFileSync(f, aLine({ id: 'a', ts: ts('2025-01-01') }) + '\n')
    utimesSync(f, new Date('2025-01-01'), new Date('2025-01-01'))
    const s = await svc.summary({ days: 7 })
    expect(s.scan).toMatchObject({ files: 1, skippedFiles: 1, bytesRead: 0 })
    const big = await svc.summary({ days: 7, force: true })
    expect(big.scan.skippedFiles).toBe(0)
    rmSync(f)
    expect((await svc.summary({ days: 7 })).scan.files).toBe(0)
  })

  it('joins ledger cost by date, cwd and model', async () => {
    const { svc, base, root } = setup()
    writeFileSync(join(root, 'p1', 's.jsonl'), aLine({ id: 'a', ts: ts('2026-03-10'), cwd: 'C:\\proj\\a' }) + '\n')
    const ledger = new UsageLedger(join(base, 'ledger.jsonl'), () => Date.parse('2026-03-10T09:00:00Z'))
    const ev = (c: number): SessionEvent => ({
      t: 'result',
      costUsd: c,
      durationMs: 1,
      turns: 1,
      isError: false,
      usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 },
      modelUsage: { 'claude-x': { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheCreationTokens: 0, costUsd: c } }
    })
    ledger.onSessionEvent('L', ev(0.1), { cwd: 'C:\\proj\\a' })
    ledger.onSessionEvent('L', ev(0.25), { cwd: 'C:\\proj\\a' })
    const s = await svc.summary({ days: 7 })
    expect(s.totals.costUsd).toBeCloseTo(0.25)
    expect(s.days.find((d) => d.date === '2026-03-10')!.costUsd).toBeCloseTo(0.25)
    expect(s.models[0]!.costUsd).toBeCloseTo(0.25)
    expect(s.projects[0]!.costUsd).toBeCloseTo(0.25)
    expect(s.cost).toEqual({ source: 'ledger', since: '2026-03-10' })
    const other = await svc.summary({ days: 7, cwd: 'C:\\elsewhere' })
    expect(other.totals.costUsd).toBe(0)
  })
})
