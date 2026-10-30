// Opt-in perf gate (D5): CCWRAP_PERF=1 npx vitest run --project node usage-perf. Synthetic data only.
import { monitorEventLoopDelay } from 'node:perf_hooks'
import { createWriteStream, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { once } from 'node:events'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { UsageService } from './usage-service'
import { aLine } from './usage-test-util'

const run = process.env['CCWRAP_PERF'] === '1' ? describe : describe.skip

run('usage perf gate', () => {
  it('64 MB cold < 4 s, p99 loop delay < 50 ms, 500 cached files < 300 ms', async () => {
    const base = 'D:\\claude-tmp\\ccwrap-usage-perf'
    rmSync(base, { recursive: true, force: true })
    const root = join(base, 'projects')
    mkdirSync(join(root, 'big'), { recursive: true })
    const pad = 'x'.repeat(1500)
    const out = createWriteStream(join(root, 'big', 'huge.jsonl'))
    let bytes = 0
    let i = 0
    const target = 64 * 1024 * 1024
    while (bytes < target) {
      const base0 = aLine({ id: 'm' + Math.floor(i / 2), ts: new Date(Date.now() - (i % 20) * 86_400_000).toISOString(), model: 'm' + (i % 3) })
      const line = (i % 5 === 0 ? base0 : base0.replace('SECRET-BODY', pad)) + '\n'
      // plus non-usage filler lines (tool results etc.) that the prefilter must skip cheaply
      const filler = JSON.stringify({ type: 'user', message: { content: 'r' } }) + '\n'
      bytes += line.length + filler.length
      if (!out.write(line + filler)) await once(out, 'drain')
      i++
    }
    out.end()
    await once(out, 'finish')

    const mk = (): UsageService =>
      new UsageService({ root, cacheFile: join(base, 'cache.json'), ledgerFile: join(base, 'l.jsonl'), log: () => {} })
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const t0 = performance.now()
    const s = await mk().summary({ days: 30 })
    const cold = performance.now() - t0
    h.disable()
    const p99 = h.percentile(99) / 1e6
    console.log(`PERF cold=${Math.round(cold)}ms p99=${p99.toFixed(1)}ms bytes=${(s.scan.bytesRead / 1048576).toFixed(1)}MB messages=${s.totals.messages}`)
    expect(cold).toBeLessThan(4000)
    expect(p99).toBeLessThan(50)

    for (let n = 0; n < 500; n++) {
      mkdirSync(join(root, 'p' + (n % 25)), { recursive: true })
      writeFileSync(join(root, 'p' + (n % 25), `s${n}.jsonl`), aLine({ id: 'q' + n }) + '\n')
    }
    await mk().summary({ days: 30 })
    const t1 = performance.now()
    const s2 = await mk().summary({ days: 30 })
    const warm = performance.now() - t1
    console.log(`PERF cached 501 files (new instance, disk cache) = ${Math.round(warm)}ms cached=${s2.scan.cachedFiles}`)
    expect(s2.scan.bytesRead).toBe(0)
    expect(warm).toBeLessThan(300)
    rmSync(base, { recursive: true, force: true })
  }, 120_000)
})

// Read-only, counts-only probe of the real projects dir (never prints paths or content).
const probe = process.env['CCWRAP_PROBE'] === '1' ? describe : describe.skip
probe('usage real-data probe', () => {
  it('prints aggregate numbers only', async () => {
    const { homedir } = await import('node:os')
    const base = 'D:\claude-tmp\ccwrap-usage-probe'
    mkdirSync(base, { recursive: true })
    const svc = new UsageService({
      root: join(process.env['CCWRAP_TEST_REAL_HOME'] ?? homedir(), '.claude', 'projects'),
      cacheFile: join(base, 'cache.json'),
      ledgerFile: join(base, 'l.jsonl'),
      log: () => {}
    })
    const h = monitorEventLoopDelay({ resolution: 5 })
    h.enable()
    const s = await svc.summary({ days: 365 })
    h.disable()
    const s2 = await svc.summary({ days: 365 })
    console.log(`PROBE files=${s.scan.files} MB=${(s.scan.bytesRead / 1048576).toFixed(0)} cold=${s.scan.ms}ms p99=${(h.percentile(99) / 1e6).toFixed(1)}ms errors=${s.scan.errors} messages=${s.totals.messages} rerun=${s2.scan.ms}ms rerunMB=${(s2.scan.bytesRead / 1048576).toFixed(1)} rerunCached=${s2.scan.cachedFiles}`)
    rmSync(base, { recursive: true, force: true })
  }, 120_000)
})
