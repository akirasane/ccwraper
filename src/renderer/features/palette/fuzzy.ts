// Pure fuzzy scorer for the command palette (P4 D7): subsequence match with bonuses for word starts,
// consecutive runs and a prefix match. No React, no DOM.

const WORD_START = 10
const CONSECUTIVE = 6
const PREFIX = 14
const BASE = 1
const GAP = 0.5
const MAX_GAP = 8

function isWordStart(text: string, i: number): boolean {
  if (i === 0) return true
  const prev = text[i - 1]!
  const cur = text[i]!
  if (/[\s\-_/\\.:()]/.test(prev)) return true
  // camelCase boundary
  return prev === prev.toLowerCase() && prev !== prev.toUpperCase() && cur !== cur.toLowerCase()
}

/**
 * Score `query` against `text`. Returns null when `query` is not a subsequence of `text`
 * (case-insensitive); otherwise a positive number, higher is better. An empty query scores 0.
 */
export function fuzzyScore(query: string, text: string): number | null {
  const q = query.replace(/\s+/g, '').toLowerCase()
  if (q.length === 0) return 0
  const lower = text.toLowerCase()
  const n = lower.length
  const m = q.length
  if (m > n) return null

  // best[j] = best score with q[i] matched at text index j (or -Infinity).
  let prev: number[] = []
  for (let j = 0; j < n; j++) {
    if (lower[j] !== q[0]) {
      prev.push(-Infinity)
      continue
    }
    let s = BASE
    if (isWordStart(text, j)) s += WORD_START
    if (j === 0) s += PREFIX
    prev.push(s - Math.min(j, MAX_GAP) * GAP * 0.5)
  }
  for (let i = 1; i < m; i++) {
    const cur: number[] = new Array<number>(n).fill(-Infinity)
    for (let j = i; j < n; j++) {
      if (lower[j] !== q[i]) continue
      let best = -Infinity
      for (let k = i - 1; k < j; k++) {
        const p = prev[k]!
        if (p === -Infinity) continue
        const gap = j - k - 1
        const s = p + (gap === 0 ? CONSECUTIVE : -Math.min(gap, MAX_GAP) * GAP)
        if (s > best) best = s
      }
      if (best === -Infinity) continue
      cur[j] = best + BASE + (isWordStart(text, j) ? WORD_START : 0)
    }
    prev = cur
  }
  let result = -Infinity
  for (const v of prev) if (v > result) result = v
  if (result === -Infinity) return null
  // Shorter targets are slightly better for the same match.
  return Math.max(0.01, result - n * 0.01)
}

export interface Scorable {
  title: string
  keywords?: string[]
}

/** Title at full weight, keywords at half weight. Null when neither matches. */
export function scoreCommand(query: string, c: Scorable): number | null {
  if (query.trim() === '') return 0
  const t = fuzzyScore(query, c.title)
  let best = t
  for (const k of c.keywords ?? []) {
    const s = fuzzyScore(query, k)
    if (s !== null && (best === null || s * 0.5 > best)) best = s * 0.5
  }
  return best
}
