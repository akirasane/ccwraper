import { structuredPatch } from 'diff'

export type DiffRowKind = 'add' | 'del' | 'ctx' | 'hunk'

export interface DiffRow {
  kind: DiffRowKind
  /** Line number in the old text (absent for add and hunk rows). */
  oldNo?: number
  /** Line number in the new text (absent for del and hunk rows). */
  newNo?: number
  text: string
}

export interface DiffResult {
  rows: DiffRow[]
  added: number
  removed: number
}

const norm = (s: string): string => s.replace(/\r\n?/g, '\n')

/** Unified row model from two strings. Line numbers are relative to the given strings. */
export function computeDiff(oldText: string, newText: string, context = 3): DiffResult {
  const patch = structuredPatch('a', 'b', norm(oldText), norm(newText), undefined, undefined, { context })
  const rows: DiffRow[] = []
  let added = 0
  let removed = 0
  patch.hunks.forEach((h, i) => {
    if (i > 0) rows.push({ kind: 'hunk', text: `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@` })
    let o = h.oldStart
    let n = h.newStart
    for (const line of h.lines) {
      const sign = line[0]
      const text = line.slice(1)
      if (sign === '+') {
        rows.push({ kind: 'add', newNo: n++, text })
        added++
      } else if (sign === '-') {
        rows.push({ kind: 'del', oldNo: o++, text })
        removed++
      } else if (sign === ' ') {
        rows.push({ kind: 'ctx', oldNo: o++, newNo: n++, text })
      }
      // "No newline at end of file" markers start with a backslash and are dropped.
    }
  })
  return { rows, added, removed }
}

/** Write: everything is an addition. */
export function computeWriteDiff(content: string): DiffResult {
  return computeDiff('', content)
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

/** Diff for an Edit / MultiEdit / Write tool input, or undefined when the input has no diffable shape. */
export function diffFromToolInput(name: string, input: unknown): DiffResult | undefined {
  if (!input || typeof input !== 'object') return undefined
  const i = input as Record<string, unknown>
  if (name === 'Write' && typeof i.content === 'string') return computeWriteDiff(i.content)
  if (name === 'Edit' && typeof i.new_string === 'string') return computeDiff(str(i.old_string), i.new_string)
  if (name === 'MultiEdit' && Array.isArray(i.edits)) {
    const parts = i.edits.map((e) => {
      const r = (e ?? {}) as Record<string, unknown>
      return computeDiff(str(r.old_string), str(r.new_string))
    })
    const rows: DiffRow[] = []
    parts.forEach((p, idx) => {
      if (idx > 0) rows.push({ kind: 'hunk', text: `edit ${idx + 1}` })
      rows.push(...p.rows)
    })
    return {
      rows,
      added: parts.reduce((a, p) => a + p.added, 0),
      removed: parts.reduce((a, p) => a + p.removed, 0)
    }
  }
  return undefined
}
