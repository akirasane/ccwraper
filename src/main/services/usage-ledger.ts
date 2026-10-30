import { appendFileSync, mkdirSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { SessionEvent } from '../../shared/events'
import { normalizeCwdKey } from '../paths'

/**
 * Estimated API-equivalent value in USD. The user is on a subscription: this is NOT a bill.
 * (SDK `costUSD` is what the API would have charged at list price.)
 */
export type EstApiValueUsd = number

export interface LedgerModelDelta {
  estCostUsd: EstApiValueUsd
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export interface LedgerLine {
  ts: number
  sdkSessionId: string
  cwdKey: string
  models: Record<string, LedgerModelDelta>
}

type Cum = Record<string, LedgerModelDelta>

const FIELDS = ['estCostUsd', 'inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheCreationTokens'] as const

/** Tolerant reader: skips blank, corrupt or mis-shaped lines. Accepts a legacy `costUsd` key. */
export function readLedger(file: string): LedgerLine[] {
  let text: string
  try {
    text = readFileSync(file, 'utf8')
  } catch {
    return []
  }
  const out: LedgerLine[] = []
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue
    try {
      const o = JSON.parse(raw) as { ts?: unknown; sdkSessionId?: unknown; cwdKey?: unknown; models?: unknown }
      if (typeof o.ts !== 'number' || !o.models || typeof o.models !== 'object') continue
      const models: Record<string, LedgerModelDelta> = {}
      for (const [m, v] of Object.entries(o.models as Record<string, Record<string, unknown>>)) {
        if (!v || typeof v !== 'object') continue
        const n = (k: string): number => (typeof v[k] === 'number' && Number.isFinite(v[k]) ? (v[k] as number) : 0)
        models[m] = {
          estCostUsd: typeof v['estCostUsd'] === 'number' ? n('estCostUsd') : n('costUsd'),
          inputTokens: n('inputTokens'),
          outputTokens: n('outputTokens'),
          cacheReadTokens: n('cacheReadTokens'),
          cacheCreationTokens: n('cacheCreationTokens')
        }
      }
      out.push({
        ts: o.ts,
        sdkSessionId: typeof o.sdkSessionId === 'string' ? o.sdkSessionId : '',
        cwdKey: typeof o.cwdKey === 'string' ? o.cwdKey : '',
        models
      })
    } catch {
      /* skip bad line */
    }
  }
  return out
}

/**
 * Appends one line per `result` holding the per-model DELTA of the (cumulative per query process)
 * `modelUsage` since that localId's previous result.
 */
export class UsageLedger {
  private last = new Map<string, Cum>()

  constructor(
    private file: string,
    private now: () => number = Date.now
  ) {}

  onSessionEvent(localId: string, e: SessionEvent, info: { cwd: string; sdkSessionId?: string } | undefined): void {
    if (e.t === 'session_closed') {
      this.last.delete(localId)
      return
    }
    if (e.t !== 'result' || !e.modelUsage) return
    const prev = this.last.get(localId) ?? {}
    const cum: Cum = {}
    const delta: Record<string, LedgerModelDelta> = {}
    for (const [model, u] of Object.entries(e.modelUsage)) {
      const c: LedgerModelDelta = {
        estCostUsd: u.costUsd,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadTokens,
        cacheCreationTokens: u.cacheCreationTokens
      }
      cum[model] = c
      const p = prev[model]
      // A counter going backwards means a fresh query process: the new value is the delta.
      const reset = !!p && FIELDS.some((k) => c[k] < p[k])
      const d = {} as LedgerModelDelta
      for (const k of FIELDS) d[k] = p && !reset ? round(c[k] - p[k]) : c[k]
      if (FIELDS.some((k) => d[k] > 0)) delta[model] = d
    }
    this.last.set(localId, cum)
    if (!info || !Object.keys(delta).length) return
    const line: LedgerLine = {
      ts: this.now(),
      sdkSessionId: info.sdkSessionId ?? localId,
      cwdKey: safeKey(info.cwd),
      models: delta
    }
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      appendFileSync(this.file, JSON.stringify(line) + '\n', 'utf8')
    } catch {
      /* the ledger is best effort; never break the session event path */
    }
  }
}

function round(n: number): number {
  return Math.round(n * 1e9) / 1e9
}

function safeKey(cwd: string): string {
  try {
    return normalizeCwdKey(cwd)
  } catch {
    return cwd
  }
}
