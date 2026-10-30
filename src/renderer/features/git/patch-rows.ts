import type { DiffResult, DiffRow } from '@/features/chat/diff/compute-diff'

export interface PatchRows extends DiffResult {
  /** Header facts git printed before the first hunk (rename, mode change, ...). */
  notes: string[]
}

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/

/**
 * Turn a unified `git diff` patch into DiffView rows. Line numbers follow each hunk header;
 * `\ No newline at end of file` markers are ignored; rename / mode headers become notes.
 */
export function patchToRows(patch: string): PatchRows {
  const rows: DiffRow[] = []
  const notes: string[] = []
  let added = 0
  let removed = 0
  let oldNo = 0
  let newNo = 0
  let inHunk = false
  let hunks = 0

  for (const raw of patch.replace(/\r\n/g, '\n').split('\n')) {
    const m = HUNK.exec(raw)
    if (m) {
      inHunk = true
      oldNo = Number(m[1])
      newNo = Number(m[3])
      if (hunks > 0) rows.push({ kind: 'hunk', text: raw })
      hunks++
      continue
    }
    if (!inHunk) {
      if (raw.startsWith('rename from ')) notes.push(`Renamed from ${raw.slice(12)}`)
      else if (raw.startsWith('rename to ')) notes.push(`Renamed to ${raw.slice(10)}`)
      else if (raw.startsWith('copy from ')) notes.push(`Copied from ${raw.slice(10)}`)
      else if (raw.startsWith('old mode ')) notes.push(`Mode ${raw.slice(9)}`)
      else if (raw.startsWith('new mode ')) notes[notes.length - 1] = `${notes[notes.length - 1] ?? 'Mode'} to ${raw.slice(9)}`
      else if (raw.startsWith('new file mode ')) notes.push('New file')
      else if (raw.startsWith('deleted file mode ')) notes.push('Deleted file')
      continue
    }
    if (raw.startsWith('\\')) continue // "\ No newline at end of file"
    if (raw.startsWith('diff --git ')) {
      inHunk = false
      continue
    }
    const sign = raw[0]
    const text = raw.slice(1)
    if (sign === '+') {
      rows.push({ kind: 'add', newNo: newNo++, text })
      added++
    } else if (sign === '-') {
      rows.push({ kind: 'del', oldNo: oldNo++, text })
      removed++
    } else if (sign === ' ') {
      rows.push({ kind: 'ctx', oldNo: oldNo++, newNo: newNo++, text })
    }
  }
  return { rows, added, removed, notes }
}
