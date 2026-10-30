import { describe, expect, it } from 'vitest'
import { patchToRows } from './patch-rows'

const MULTI = `diff --git a/a.txt b/a.txt
index 111..222 100644
--- a/a.txt
+++ b/a.txt
@@ -1,3 +1,3 @@
 one
-two
+TWO
 three
@@ -10,2 +10,3 @@
 ten
+ten-and-a-half
 eleven
\\ No newline at end of file
`

describe('patchToRows', () => {
  it('numbers lines across multiple hunks', () => {
    const r = patchToRows(MULTI)
    expect(r.added).toBe(2)
    expect(r.removed).toBe(1)
    expect(r.rows.map((x) => [x.kind, x.oldNo, x.newNo])).toEqual([
      ['ctx', 1, 1],
      ['del', 2, undefined],
      ['add', undefined, 2],
      ['ctx', 3, 3],
      ['hunk', undefined, undefined],
      ['ctx', 10, 10],
      ['add', undefined, 11],
      ['ctx', 11, 12]
    ])
  })

  it('ignores the no-newline marker', () => {
    const r = patchToRows(MULTI)
    expect(r.rows.some((x) => x.text.includes('No newline'))).toBe(false)
  })

  it('reports a pure rename as a note with no rows', () => {
    const r = patchToRows('diff --git a/old.txt b/new.txt\nsimilarity index 100%\nrename from old.txt\nrename to new.txt\n')
    expect(r.rows).toEqual([])
    expect(r.notes).toEqual(['Renamed from old.txt', 'Renamed to new.txt'])
  })

  it('keeps rows of a rename with edits', () => {
    const r = patchToRows(
      'diff --git a/o b/n\nrename from o\nrename to n\n--- a/o\n+++ b/n\n@@ -1 +1 @@\n-x\n+y\n'
    )
    expect(r.notes).toHaveLength(2)
    expect(r.rows.map((x) => x.kind)).toEqual(['del', 'add'])
  })
})
