// Transcript token scanner (D5). Pure line scanner + resumable streaming file reader.
// Only numbers, ids and short keys are kept: no message text is retained, returned or logged.
import { open } from 'node:fs/promises'
import { normalizeCwdKey } from '../paths'

export interface Counters {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/** One (local date, cwd, model) cell of one file. */
export interface Bucket extends Counters {
  date: string
  cwdKey: string
  cwd: string
  model: string
  messages: number
  /** latest timestamp (ms) seen in this cell */
  last: number
}

export interface SeenMessage extends Counters {
  id: string
  bucket: string
}

/** Serializable per-file scan state (what the cache stores besides size/mtime/offset). */
export interface FileScanState {
  buckets: Record<string, Bucket>
  /** `date|cwdKey` -> distinct sessionIds */
  sessions: Record<string, string[]>
  /** last few message ids so a resumed scan keeps deduping across the resume point */
  tail: SeenMessage[]
  /** complete lines consumed so far (for error positions only) */
  lines: number
}

export interface ScanContext {
  state: FileScanState
  seen: Map<string, SeenMessage>
  errors: number
  /** `file:lineNumber: reason` sink; never receives line content */
  onError?: (lineNo: number, reason: string) => void
  /** ms timestamp -> YYYY-MM-DD (injectable timezone); default local */
  dateOf: (ms: number) => string
  cwdKeyOf: (cwd: string) => string
}

const SEEN_LIMIT = 4000
const TAIL_SIZE = 32

export function emptyState(): FileScanState {
  return { buckets: {}, sessions: {}, tail: [], lines: 0 }
}

export function localDateOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function makeContext(
  state: FileScanState = emptyState(),
  opts: { dateOf?: (ms: number) => string; onError?: (lineNo: number, reason: string) => void } = {}
): ScanContext {
  const memo = new Map<string, string>()
  const seen = new Map<string, SeenMessage>()
  for (const s of state.tail) seen.set(s.id, s)
  return {
    state,
    seen,
    errors: 0,
    ...(opts.onError ? { onError: opts.onError } : {}),
    dateOf: opts.dateOf ?? localDateOf,
    cwdKeyOf: (cwd) => {
      let k = memo.get(cwd)
      if (k === undefined) {
        try {
          k = normalizeCwdKey(cwd)
        } catch {
          k = cwd
        }
        memo.set(cwd, k)
      }
      return k
    }
  }
}

const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0)

interface ParsedLine {
  type?: unknown
  timestamp?: unknown
  sessionId?: unknown
  cwd?: unknown
  message?: { id?: unknown; model?: unknown; usage?: Record<string, unknown> }
}

/**
 * Scans complete lines into ctx.state. Dedupes by message.id keeping the max of each counter,
 * skips `<synthetic>` and usage-less lines, and counts unparsable candidate lines in ctx.errors.
 */
export function scanLines(lines: Iterable<string>, ctx: ScanContext): void {
  const st = ctx.state
  for (const line of lines) {
    st.lines++
    if (!line.includes('"usage"') || !line.includes('"assistant"')) continue
    let o: ParsedLine
    try {
      o = JSON.parse(line) as ParsedLine
    } catch {
      ctx.errors++
      ctx.onError?.(st.lines, 'invalid json')
      continue
    }
    if (!o || typeof o !== 'object' || o.type !== 'assistant') continue
    const msg = o.message
    const u = msg?.usage
    if (!msg || !u || typeof u !== 'object') continue
    const model = typeof msg.model === 'string' ? msg.model : ''
    if (model === '<synthetic>' || !model) continue
    const ms = typeof o.timestamp === 'string' ? Date.parse(o.timestamp) : NaN
    if (!Number.isFinite(ms)) {
      ctx.errors++
      ctx.onError?.(st.lines, 'bad timestamp')
      continue
    }
    const cur: Counters = {
      input: num(u['input_tokens']),
      output: num(u['output_tokens']),
      cacheRead: num(u['cache_read_input_tokens']),
      cacheCreation: num(u['cache_creation_input_tokens'])
    }
    const cwd = typeof o.cwd === 'string' ? o.cwd : ''
    const cwdKey = cwd ? ctx.cwdKeyOf(cwd) : ''
    const date = ctx.dateOf(ms)
    const bKey = `${date}|${cwdKey}|${model}`
    let b = st.buckets[bKey]
    if (!b) {
      b = { date, cwdKey, cwd, model, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, messages: 0, last: 0 }
      st.buckets[bKey] = b
    }
    if (ms > b.last) b.last = ms
    if (cwd) b.cwd = cwd

    const id = typeof msg.id === 'string' ? msg.id : ''
    const prev = id ? ctx.seen.get(id) : undefined
    if (prev && prev.bucket === bKey) {
      // Repeat of the same API message: only the growth over the max seen so far counts.
      const pb = b
      for (const k of ['input', 'output', 'cacheRead', 'cacheCreation'] as const) {
        if (cur[k] > prev[k]) {
          pb[k] += cur[k] - prev[k]
          prev[k] = cur[k]
        }
      }
    } else {
      b.input += cur.input
      b.output += cur.output
      b.cacheRead += cur.cacheRead
      b.cacheCreation += cur.cacheCreation
      b.messages++
      if (id) {
        ctx.seen.set(id, { id, bucket: bKey, ...cur })
        if (ctx.seen.size > SEEN_LIMIT) {
          const first = ctx.seen.keys().next().value
          if (first !== undefined) ctx.seen.delete(first)
        }
      }
    }
    const sid = typeof o.sessionId === 'string' ? o.sessionId : ''
    if (sid) {
      const sKey = `${date}|${cwdKey}`
      const arr = (st.sessions[sKey] ??= [])
      if (!arr.includes(sid)) arr.push(sid)
    }
  }
}

/** Snapshot the dedupe tail into the state before persisting. */
export function finalizeState(ctx: ScanContext): FileScanState {
  const all = [...ctx.seen.values()]
  ctx.state.tail = all.slice(-TAIL_SIZE).map((s) => ({ ...s }))
  return ctx.state
}

export interface ReadResult {
  /** byte offset just after the last complete line consumed */
  offset: number
  bytesRead: number
}

export interface ReadOptions {
  chunkSize?: number
  /** yield after this many ms of CPU work (default 8) */
  sliceMs?: number
  yieldFn?: () => Promise<void>
  /** observer for tests: bytes actually read per chunk */
  onBytes?: (n: number) => void
}

const defaultYield = (): Promise<void> => new Promise((r) => setImmediate(r))

/**
 * Streams `file` from `start`, feeding complete lines to scanLines. A trailing partial line (no \n)
 * is left unconsumed: the returned offset stops before it, so the next scan re-reads it.
 */
export async function scanFile(file: string, start: number, ctx: ScanContext, opts: ReadOptions = {}): Promise<ReadResult> {
  const chunkSize = opts.chunkSize ?? 512 * 1024
  const sliceMs = opts.sliceMs ?? 4
  const yieldFn = opts.yieldFn ?? defaultYield
  const fh = await open(file, 'r')
  let pos = start
  let consumed = start
  let bytesRead = 0
  let carry: Buffer = Buffer.alloc(0)
  let sliceStart = performance.now()
  try {
    const buf = Buffer.allocUnsafe(chunkSize)
    for (;;) {
      const { bytesRead: n } = await fh.read(buf, 0, chunkSize, pos)
      if (n === 0) break
      pos += n
      bytesRead += n
      opts.onBytes?.(n)
      const chunk = carry.length ? Buffer.concat([carry, buf.subarray(0, n)]) : buf.subarray(0, n)
      const lastNl = chunk.lastIndexOf(0x0a)
      if (lastNl < 0) {
        carry = Buffer.from(chunk)
        continue
      }
      const text = chunk.toString('utf8', 0, lastNl)
      carry = Buffer.from(chunk.subarray(lastNl + 1))
      consumed = pos - carry.length
      const lines = text.split('\n')
      let i = 0
      while (i < lines.length) {
        const end = Math.min(lines.length, i + 16)
        scanLines(lines.slice(i, end), ctx)
        i = end
        if (performance.now() - sliceStart >= sliceMs) {
          await yieldFn()
          sliceStart = performance.now()
        }
      }
    }
  } finally {
    await fh.close()
  }
  return { offset: consumed, bytesRead }
}
