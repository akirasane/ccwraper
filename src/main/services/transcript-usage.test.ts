import { mkdtempSync, rmSync, writeFileSync, appendFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { aLine } from './usage-test-util'
import { finalizeState, makeContext, scanFile, scanLines, emptyState } from './transcript-usage'

const utc = (ms: number): string => new Date(ms).toISOString().slice(0, 10)

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), 'ccwrap-usage-'))
  dirs.push(d)
  return d
}

describe('scanLines', () => {
  it('counts 3 lines with the same message.id once', () => {
    const ctx = makeContext(emptyState(), { dateOf: utc })
    scanLines([aLine({}), aLine({}), aLine({})], ctx)
    const b = Object.values(ctx.state.buckets)
    expect(b).toHaveLength(1)
    expect(b[0]).toMatchObject({ input: 1, output: 2, cacheRead: 3, cacheCreation: 4, messages: 1 })
  })

  it('keeps the max of each counter for repeated ids', () => {
    const ctx = makeContext(emptyState(), { dateOf: utc })
    scanLines([aLine({ out: 2 }), aLine({ out: 10 }), aLine({ out: 5 })], ctx)
    expect(Object.values(ctx.state.buckets)[0]).toMatchObject({ output: 10, messages: 1 })
  })

  it('skips synthetic, usage-less and non-assistant lines; corrupt candidates count as errors', () => {
    const errs: string[] = []
    const ctx = makeContext(emptyState(), { dateOf: utc, onError: (n, r) => errs.push(`${n}:${r}`) })
    scanLines(
      [
        aLine({ model: '<synthetic>', id: 'x' }),
        JSON.stringify({ type: 'user', message: { usage: {} } }),
        JSON.stringify({ type: 'assistant', message: { id: 'q', model: 'm' } }),
        '{"type":"assistant","usage": oops SECRET-BODY',
        aLine({ id: 'ok' })
      ],
      ctx
    )
    expect(ctx.errors).toBe(1)
    expect(errs).toEqual(['4:invalid json'])
    expect(errs.join()).not.toContain('SECRET')
    expect(Object.values(ctx.state.buckets)[0]!.messages).toBe(1)
  })

  it('buckets by injected timezone date, cwd and model; counts distinct sessions', () => {
    const ctx = makeContext(emptyState(), { dateOf: (ms) => utc(ms + 10 * 3600_000) })
    scanLines(
      [
        aLine({ id: 'a', ts: '2026-03-10T20:00:00Z', sid: 's1' }),
        aLine({ id: 'b', ts: '2026-03-10T20:30:00Z', sid: 's2' }),
        aLine({ id: 'c', ts: '2026-03-10T20:30:00Z', sid: 's2', model: 'other' })
      ],
      ctx
    )
    expect(Object.values(ctx.state.buckets).every((b) => b.date === '2026-03-11')).toBe(true)
    expect(Object.keys(ctx.state.buckets)).toHaveLength(2)
    const key = Object.keys(ctx.state.sessions)[0]!
    expect(ctx.state.sessions[key]!.sort()).toEqual(['s1', 's2'])
  })

  it('dedupes across a resume via the persisted tail', () => {
    const c1 = makeContext(emptyState(), { dateOf: utc })
    scanLines([aLine({ id: 'r', out: 5 })], c1)
    const st = JSON.parse(JSON.stringify(finalizeState(c1)))
    const c2 = makeContext(st, { dateOf: utc })
    scanLines([aLine({ id: 'r', out: 5 }), aLine({ id: 'r', out: 8 })], c2)
    expect(Object.values(c2.state.buckets)[0]).toMatchObject({ output: 8, messages: 1 })
  })
})

describe('scanFile', () => {
  it('leaves a partial last line for the next scan and resumes from the offset', async () => {
    const f = join(tmp(), 'a.jsonl')
    const l1 = aLine({ id: 'm1' })
    const l2 = aLine({ id: 'm2' })
    writeFileSync(f, l1 + '\n' + l2.slice(0, 20))
    const c1 = makeContext(emptyState(), { dateOf: utc })
    const r1 = await scanFile(f, 0, c1)
    expect(r1.offset).toBe(Buffer.byteLength(l1) + 1)
    expect(Object.values(c1.state.buckets)[0]!.messages).toBe(1)

    appendFileSync(f, l2.slice(20) + '\n')
    const read: number[] = []
    const st = JSON.parse(JSON.stringify(finalizeState(c1)))
    const c2 = makeContext(st, { dateOf: utc })
    const r2 = await scanFile(f, r1.offset, c2, { onBytes: (n) => read.push(n) })
    expect(read.reduce((a, b) => a + b, 0)).toBe(Buffer.byteLength(l2) + 1)

    const full = makeContext(emptyState(), { dateOf: utc })
    await scanFile(f, 0, full)
    expect(c2.state.buckets).toEqual(full.state.buckets)
    expect(r2.offset).toBe(Buffer.byteLength(l1) + Buffer.byteLength(l2) + 2)
  })

  it('handles lines that span chunk boundaries and multibyte text', async () => {
    const f = join(tmp(), 'b.jsonl')
    const lines = Array.from({ length: 50 }, (_, i) => aLine({ id: 'm' + i }).replace('SECRET-BODY', 'ไทย'.repeat(40)))
    writeFileSync(f, lines.join('\n') + '\n')
    const ctx = makeContext(emptyState(), { dateOf: utc })
    await scanFile(f, 0, ctx, { chunkSize: 97 })
    expect(Object.values(ctx.state.buckets)[0]!.messages).toBe(50)
    expect(ctx.errors).toBe(0)
  })
})
