import { describe, expect, it } from 'vitest'
import { computeDiff, computeWriteDiff, diffFromToolInput } from './compute-diff'

describe('computeDiff', () => {
  it('single change with context and line numbers', () => {
    const r = computeDiff('a\nb\nc\n', 'a\nB\nc\n')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.rows.map((x) => x.kind)).toEqual(['ctx', 'del', 'add', 'ctx'])
    expect(r.rows[1]).toMatchObject({ kind: 'del', oldNo: 2, text: 'b' })
    expect(r.rows[2]).toMatchObject({ kind: 'add', newNo: 2, text: 'B' })
  })

  it('multi-hunk output separates hunks with a hunk row', () => {
    const lines = Array.from({ length: 30 }, (_, i) => `l${i}`)
    const changed = [...lines]
    changed[1] = 'X'
    changed[27] = 'Y'
    const r = computeDiff(lines.join('\n'), changed.join('\n'))
    expect(r.rows.filter((x) => x.kind === 'hunk')).toHaveLength(1)
    expect(r.added).toBe(2)
    expect(r.removed).toBe(2)
  })

  it('CRLF content produces no spurious changes and no CR in text', () => {
    const r = computeDiff('a\r\nb\r\n', 'a\r\nc\r\n')
    expect(r.added).toBe(1)
    expect(r.removed).toBe(1)
    expect(r.rows.every((x) => !x.text.includes('\r'))).toBe(true)
    expect(computeDiff('a\r\nb', 'a\nb').rows.every((x) => x.kind === 'ctx')).toBe(true)
  })

  it('empty old string is all additions starting at line 1', () => {
    const r = computeDiff('', 'x\ny')
    expect(r.removed).toBe(0)
    expect(r.rows).toEqual([
      { kind: 'add', newNo: 1, text: 'x' },
      { kind: 'add', newNo: 2, text: 'y' }
    ])
  })

  it('Write is an all-add diff', () => {
    const r = computeWriteDiff('one\ntwo\n')
    expect(r.added).toBe(2)
    expect(r.rows.every((x) => x.kind === 'add')).toBe(true)
  })

  it('diffFromToolInput handles Edit, MultiEdit, Write and unknown shapes', () => {
    expect(diffFromToolInput('Edit', { old_string: 'a', new_string: 'b' })).toMatchObject({ added: 1, removed: 1 })
    const multi = diffFromToolInput('MultiEdit', {
      edits: [
        { old_string: 'a', new_string: 'b' },
        { old_string: 'c', new_string: 'd' }
      ]
    })
    expect(multi).toMatchObject({ added: 2, removed: 2 })
    expect(multi?.rows.some((x) => x.kind === 'hunk')).toBe(true)
    expect(diffFromToolInput('Write', { content: 'hi' })?.added).toBe(1)
    expect(diffFromToolInput('Bash', { command: 'ls' })).toBeUndefined()
    expect(diffFromToolInput('Edit', null)).toBeUndefined()
  })
})
