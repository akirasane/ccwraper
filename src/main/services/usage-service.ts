import { readFile, readdir, stat } from 'node:fs/promises'
import { basename, join } from 'node:path'
import type { UsageDay, UsageModel, UsageProject, UsageQuery, UsageSummary, UsageTokens } from '../../shared/usage'
import { normalizeCwdKey } from '../paths'
import { writeFileAtomic } from './atomic-write'
import {
  type Bucket,
  type FileScanState,
  emptyState,
  finalizeState,
  localDateOf,
  makeContext,
  scanFile
} from './transcript-usage'
import { readLedger } from './usage-ledger'

// D5. Token numbers come from transcripts (all Claude Code sessions); dollar figures are the
// ledger's ESTIMATED API-equivalent value (subscription user: not a bill). The contract names them
// `costUsd`; they are always estimates.

export interface UsageServiceDeps {
  /** `<configDir>/projects` */
  root: string
  cacheFile: string
  ledgerFile: string
  /** `file:lineNumber: reason` lines only; never message content. Default console.warn. */
  log?: (line: string) => void
  /** injectable clock and timezone (tests) */
  now?: () => number
  dateOf?: (ms: number) => string
  concurrency?: number
}

interface CacheEntry extends FileScanState {
  size: number
  mtimeMs: number
  offset: number
}

interface CacheFile {
  v: 1
  files: Record<string, CacheEntry>
}

const CACHE_VERSION = 1

interface Found {
  path: string
  size: number
  mtimeMs: number
}

export class UsageService {
  private cache: CacheFile | null = null
  private chain: Promise<unknown> = Promise.resolve()

  constructor(private deps: UsageServiceDeps) {}

  /** Calls are serialized so overlapping requests share one cache and never double-scan. */
  summary(q: UsageQuery): Promise<UsageSummary> {
    const run = this.chain.then(() => this.compute(q))
    this.chain = run.catch(() => undefined)
    return run
  }

  private log(line: string): void {
    ;(this.deps.log ?? ((l) => console.warn(l)))(line)
  }

  private async loadCache(): Promise<CacheFile> {
    if (this.cache) return this.cache
    try {
      const raw = JSON.parse(await readFile(this.deps.cacheFile, 'utf8')) as CacheFile
      if (raw && raw.v === CACHE_VERSION && raw.files && typeof raw.files === 'object') {
        this.cache = raw
        return raw
      }
    } catch {
      /* missing or corrupt: start fresh (the file is replaced on the next save) */
    }
    this.cache = { v: CACHE_VERSION, files: {} }
    return this.cache
  }

  private async discover(): Promise<Found[]> {
    const out: Found[] = []
    const statInto = async (p: string): Promise<void> => {
      try {
        const s = await stat(p)
        if (s.isFile()) out.push({ path: p, size: s.size, mtimeMs: s.mtimeMs })
      } catch {
        /* vanished */
      }
    }
    const list = async (dir: string): Promise<{ name: string; dir: boolean }[]> => {
      try {
        return (await readdir(dir, { withFileTypes: true })).map((d) => ({ name: d.name, dir: d.isDirectory() }))
      } catch {
        return []
      }
    }
    const projects = (await list(this.deps.root)).filter((e) => e.dir)
    const jobs: Promise<void>[] = []
    for (const p of projects) {
      jobs.push(
        (async () => {
          const pdir = join(this.deps.root, p.name)
          const entries = await list(pdir)
          const inner: Promise<void>[] = []
          for (const e of entries) {
            if (!e.dir && e.name.endsWith('.jsonl')) inner.push(statInto(join(pdir, e.name)))
            else if (e.dir) {
              inner.push(
                (async () => {
                  const sub = join(pdir, e.name, 'subagents')
                  for (const f of await list(sub)) {
                    if (!f.dir && f.name.endsWith('.jsonl')) await statInto(join(sub, f.name))
                  }
                })()
              )
            }
          }
          await Promise.all(inner)
        })()
      )
    }
    await Promise.all(jobs)
    return out
  }

  private async compute(q: UsageQuery): Promise<UsageSummary> {
    const t0 = performance.now()
    const now = this.deps.now ?? Date.now
    const dateOf = this.deps.dateOf ?? localDateOf
    const cache = await this.loadCache()

    // Zero-filled day list (calendar dates in dateOf's timezone, oldest first).
    const [ty, tm, td] = dateOf(now()).split('-').map(Number) as [number, number, number]
    const DAY = 86_400_000
    const baseUtc = Date.UTC(ty, tm - 1, td)
    const days: UsageDay[] = []
    for (let i = q.days - 1; i >= 0; i--) {
      days.push({ date: new Date(baseUtc - i * DAY).toISOString().slice(0, 10), tokens: zero(), byModel: {}, costUsd: 0, sessions: 0 })
    }
    const from = days[0]!.date
    const to = days[days.length - 1]!.date
    // A file last modified well before the range start cannot hold a line inside the range (36 h timezone slop).
    const rangeStartMs = baseUtc - (q.days - 1) * DAY - 36 * 3600_000

    const found = await this.discover()
    const scan = { files: found.length, cachedFiles: 0, skippedFiles: 0, bytesRead: 0, ms: 0, errors: 0 }
    const todo: Found[] = []
    const inRange: Found[] = []
    for (const f of found) {
      if (f.mtimeMs < rangeStartMs && !q.force) {
        scan.skippedFiles++
        continue
      }
      inRange.push(f)
      const c = cache.files[f.path]
      if (c && !q.force && c.size === f.size && c.mtimeMs === f.mtimeMs) scan.cachedFiles++
      else todo.push(f)
    }

    let dirty = false
    const queue = [...todo]
    const worker = async (): Promise<void> => {
      for (;;) {
        const f = queue.shift()
        if (!f) return
        const c = q.force ? undefined : cache.files[f.path]
        const resume = !!c && f.size > c.size && c.offset <= f.size && c.offset <= c.size
        const name = basename(f.path)
        const ctx = makeContext(resume ? structuredClone(pickState(c)) : emptyState(), {
          dateOf,
          onError: (n, reason) => this.log(`${name}:${n}: ${reason}`)
        })
        try {
          const r = await scanFile(f.path, resume ? c.offset : 0, ctx)
          scan.bytesRead += r.bytesRead
          scan.errors += ctx.errors
          const st = finalizeState(ctx)
          cache.files[f.path] = { ...st, size: f.size, mtimeMs: f.mtimeMs, offset: r.offset }
          dirty = true
        } catch (err) {
          scan.errors++
          this.log(`${name}:0: ${err instanceof Error ? (err as NodeJS.ErrnoException).code ?? 'read failed' : 'read failed'}`)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(this.deps.concurrency ?? 2, todo.length) }, worker))

    // Forget cache entries for files that no longer exist.
    const live = new Set(found.map((f) => f.path))
    for (const p of Object.keys(cache.files)) {
      if (!live.has(p)) {
        delete cache.files[p]
        dirty = true
      }
    }
    if (dirty) {
      try {
        await writeFileAtomic(this.deps.cacheFile, JSON.stringify(cache))
      } catch (err) {
        this.log(`usage-cache:0: save failed (${(err as NodeJS.ErrnoException).code ?? 'error'})`)
      }
    }

    const summary = this.aggregate(q, days, from, to, inRange, cache, dateOf)
    scan.ms = Math.round(performance.now() - t0)
    summary.scan = scan
    summary.generatedAt = now()
    return summary
  }

  private aggregate(
    q: UsageQuery,
    days: UsageDay[],
    from: string,
    to: string,
    files: Found[],
    cache: CacheFile,
    dateOf: (ms: number) => string
  ): UsageSummary {
    const cwdFilter = q.cwd ? safeKey(q.cwd) : undefined
    const dayIdx = new Map(days.map((d, i) => [d.date, i]))
    const daySessions = days.map(() => new Set<string>())
    const allSessions = new Set<string>()
    const projects = new Map<string, UsageProject & { sess: Set<string> }>()
    const models = new Map<string, UsageModel>()
    const totals = { tokens: zero(), costUsd: 0, sessions: 0, messages: 0 }

    for (const f of files) {
      const c = cache.files[f.path]
      if (!c) continue
      for (const b of Object.values(c.buckets) as Bucket[]) {
        const i = dayIdx.get(b.date)
        if (i === undefined) continue
        if (cwdFilter !== undefined && b.cwdKey !== cwdFilter) continue
        const day = days[i]!
        const tok = toTokens(b)
        const total = tok.input + tok.output + tok.cacheRead + tok.cacheCreation
        add(day.tokens, tok)
        day.byModel[b.model] = (day.byModel[b.model] ?? 0) + total
        add(totals.tokens, tok)
        totals.messages += b.messages
        let p = projects.get(b.cwdKey)
        if (!p) {
          p = { key: b.cwdKey, cwd: b.cwd || b.cwdKey, tokens: zero(), costUsd: 0, sessions: 0, lastActive: 0, sess: new Set() }
          projects.set(b.cwdKey, p)
        }
        add(p.tokens, tok)
        if (b.last >= p.lastActive) {
          p.lastActive = b.last
          if (b.cwd) p.cwd = b.cwd
        }
        let m = models.get(b.model)
        if (!m) {
          m = { model: b.model, tokens: zero(), costUsd: 0 }
          models.set(b.model, m)
        }
        add(m.tokens, tok)
      }
      for (const [k, ids] of Object.entries(c.sessions)) {
        const bar = k.indexOf('|')
        const date = k.slice(0, bar)
        const cwdKey = k.slice(bar + 1)
        const i = dayIdx.get(date)
        if (i === undefined) continue
        if (cwdFilter !== undefined && cwdKey !== cwdFilter) continue
        const p = projects.get(cwdKey)
        for (const id of ids) {
          daySessions[i]!.add(id)
          allSessions.add(id)
          p?.sess.add(id)
        }
      }
    }
    days.forEach((d, i) => (d.sessions = daySessions[i]!.size))
    totals.sessions = allSessions.size

    // Ledger: estimated API-equivalent value, joined by date, cwdKey and model.
    let since: string | undefined
    for (const l of readLedger(this.deps.ledgerFile)) {
      const date = dateOf(l.ts)
      if (since === undefined || date < since) since = date
      const i = dayIdx.get(date)
      if (i === undefined) continue
      if (cwdFilter !== undefined && l.cwdKey !== cwdFilter) continue
      for (const [model, d] of Object.entries(l.models)) {
        days[i]!.costUsd += d.estCostUsd
        totals.costUsd += d.estCostUsd
        const p = projects.get(l.cwdKey)
        if (p) p.costUsd += d.estCostUsd
        const m = models.get(model)
        if (m) m.costUsd += d.estCostUsd
      }
    }

    const sum = (t: UsageTokens): number => t.input + t.output + t.cacheRead + t.cacheCreation
    const projectList: UsageProject[] = [...projects.values()]
      .map(({ sess, ...p }) => ({ ...p, sessions: sess.size }))
      .sort((a, b) => sum(b.tokens) - sum(a.tokens))
    const modelList = [...models.values()].sort((a, b) => sum(b.tokens) - sum(a.tokens))
    return {
      from,
      to,
      days,
      projects: projectList,
      models: modelList,
      totals,
      cost: { source: 'ledger', ...(since !== undefined ? { since } : {}) },
      scan: { files: 0, cachedFiles: 0, skippedFiles: 0, bytesRead: 0, ms: 0, errors: 0 },
      generatedAt: 0
    }
  }
}

function pickState(c: CacheEntry): FileScanState {
  return { buckets: c.buckets, sessions: c.sessions, tail: c.tail, lines: c.lines }
}

function zero(): UsageTokens {
  return { input: 0, output: 0, cacheRead: 0, cacheCreation: 0 }
}

function toTokens(b: Bucket): UsageTokens {
  return { input: b.input, output: b.output, cacheRead: b.cacheRead, cacheCreation: b.cacheCreation }
}

function add(a: UsageTokens, b: UsageTokens): void {
  a.input += b.input
  a.output += b.output
  a.cacheRead += b.cacheRead
  a.cacheCreation += b.cacheCreation
}

function safeKey(cwd: string): string {
  try {
    return normalizeCwdKey(cwd)
  } catch {
    return cwd
  }
}
