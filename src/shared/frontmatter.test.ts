import { describe, expect, it } from 'vitest'
import { keyRange, parseFrontmatter, patchFrontmatter, quoteUnsafeScalars, replaceBody } from './frontmatter'

const LF = `---
# top comment
name: demo   # trailing
description: 'it''s "odd"'
allowed-tools:
  - Read
  - "Bash(git *)"
hooks:
  PreToolUse:
    - matcher: Bash
---
# Body

text
`
const CRLF = LF.replace(/\n/g, '\r\n')

describe('parseFrontmatter', () => {
  it('parses data, body and offsets', () => {
    const d = parseFrontmatter(LF)
    expect(d.hasFrontmatter).toBe(true)
    expect(d.error).toBeUndefined()
    expect(d.data.name).toBe('demo')
    expect(d.data.description).toBe('it\'s "odd"')
    expect(d.data['allowed-tools']).toEqual(['Read', 'Bash(git *)'])
    expect(d.body).toBe('# Body\n\ntext\n')
    expect(LF.slice(d.bodyOffset)).toBe(d.body)
    expect(d.eol).toBe('\n')
    expect(LF.slice(d.yamlRange![0], d.yamlRange![1]).startsWith('# top comment')).toBe(true)
  })

  it('detects CRLF', () => {
    const d = parseFrontmatter(CRLF)
    expect(d.eol).toBe('\r\n')
    expect(d.data.name).toBe('demo')
    expect(d.body).toBe('# Body\r\n\r\ntext\r\n')
  })

  it('no frontmatter -> bodyOffset 0', () => {
    const d = parseFrontmatter('# just md\n---\nnot fm\n')
    expect(d.hasFrontmatter).toBe(false)
    expect(d.bodyOffset).toBe(0)
    expect(d.body).toBe('# just md\n---\nnot fm\n')
    expect(d.data).toEqual({})
    expect(d.error).toBeUndefined()
  })

  it('empty text and fence not at offset 0', () => {
    expect(parseFrontmatter('').hasFrontmatter).toBe(false)
    expect(parseFrontmatter('\n---\na: 1\n---\n').hasFrontmatter).toBe(false)
    expect(parseFrontmatter('---x\na: 1\n---\n').hasFrontmatter).toBe(false)
  })

  it('empty frontmatter is valid', () => {
    const d = parseFrontmatter('---\n---\nbody')
    expect(d.hasFrontmatter).toBe(true)
    expect(d.error).toBeUndefined()
    expect(d.data).toEqual({})
    expect(d.yamlRange).toEqual([4, 4])
    expect(d.body).toBe('body')
    expect(parseFrontmatter('---\r\n---\r\n').bodyOffset).toBe(10)
  })

  it('accepts ... as the closing fence and a fence at EOF', () => {
    const d = parseFrontmatter('---\na: 1\n...\nrest')
    expect(d.data).toEqual({ a: 1 })
    expect(d.body).toBe('rest')
    const e = parseFrontmatter('---\na: 1\n---')
    expect(e.data).toEqual({ a: 1 })
    expect(e.body).toBe('')
  })

  it('handles a BOM', () => {
    const text = '﻿---\nname: x\n---\nbody\n'
    const d = parseFrontmatter(text)
    expect(d.hasFrontmatter).toBe(true)
    expect(d.data.name).toBe('x')
    expect(d.body).toBe('body\n')
    expect(patchFrontmatter(text, [])).toBe(text)
    expect(patchFrontmatter(text, [{ op: 'set', key: 'name', value: 'y' }])).toBe(
      '﻿---\nname: y\n---\nbody\n'
    )
    expect(replaceBody(text, 'new\n')).toBe('﻿---\nname: x\n---\nnew\n')
    // BOM without frontmatter: bodyOffset stays 0
    expect(parseFrontmatter('﻿hello').bodyOffset).toBe(0)
    // creating a block keeps the BOM first
    expect(patchFrontmatter('﻿hello', [{ op: 'set', key: 'a', value: 1 }])).toBe(
      '﻿---\na: 1\n---\nhello'
    )
    expect(replaceBody('﻿hello', 'x')).toBe('﻿x')
  })

  it('errors: bad yaml, non-mapping root, unclosed fence', () => {
    const bad = '---\nname: [unclosed\nother: 1\n---\nbody\n'
    const d = parseFrontmatter(bad)
    expect(d.hasFrontmatter).toBe(true)
    expect(d.data).toEqual({})
    expect(d.error).toBeDefined()
    expect(d.error!.from).toBeGreaterThanOrEqual(d.yamlRange![0])
    expect(d.error!.to).toBeLessThanOrEqual(d.yamlRange![1] + 1)
    expect(d.error!.to).toBeGreaterThanOrEqual(d.error!.from)
    expect(d.bodyOffset).toBe(bad.indexOf('body'))

    const seq = parseFrontmatter('---\n- a\n- b\n---\nx')
    expect(seq.error?.message).toMatch(/mapping/)
    expect(seq.error!.from).toBe(4)

    const scalar = parseFrontmatter('---\njust text\n---\nx')
    expect(scalar.error).toBeDefined()

    const open = parseFrontmatter('---\nname: x\nbody never closes\n')
    expect(open.error).toBeDefined()
    expect(open.bodyOffset).toBe(0)
  })

  it('duplicate keys are an error', () => {
    expect(parseFrontmatter('---\na: 1\na: 2\n---\n').error).toBeDefined()
  })
})

describe('patchFrontmatter', () => {
  it('[] ops is byte-identical (LF, CRLF, comments, odd quoting)', () => {
    for (const t of [LF, CRLF, '---\n---\n', '', 'no fm\n', "---\na: 'x'   # c\nb:   \"y\"\n---\n"]) {
      expect(patchFrontmatter(t, [])).toBe(t)
    }
    const broken = '---\na: [\n---\nx'
    expect(patchFrontmatter(broken, [])).toBe(broken)
  })

  it('set keeps comments and key order, and untouched bytes', () => {
    const out = patchFrontmatter(LF, [{ op: 'set', key: 'description', value: 'new one' }])
    expect(out).toContain(`description: 'new one'`)
    expect(out).toContain('allowed-tools:\n  - Read\n  - "Bash(git *)"\nhooks:')
    expect(out).toContain('# top comment')
    // setting an identical value is a verbatim no-op
    expect(patchFrontmatter(LF, [{ op: 'set', key: 'name', value: 'demo' }])).toBe(LF)
    expect(out).toContain('# trailing')
    expect(out.endsWith('---\n# Body\n\ntext\n')).toBe(true)
    const keys = Object.keys(parseFrontmatter(out).data)
    expect(keys).toEqual(['name', 'description', 'allowed-tools', 'hooks'])
  })

  it('does not re-pad untouched flow collections', () => {
    const text = ['---', 'name: demo', 'custom: [1, 2]', 'map: {a: 1}', '---', 'body', ''].join('\n')
    const out = patchFrontmatter(text, [{ op: 'set', key: 'name', value: 'other' }])
    expect(out).toContain('custom: [1, 2]')
    expect(out).toContain('map: {a: 1}')
  })

  it('set appends new keys at the end and keeps nested structures', () => {
    const out = patchFrontmatter(LF, [{ op: 'set', key: 'model', value: 'opus' }])
    const d = parseFrontmatter(out)
    expect(Object.keys(d.data)).toEqual(['name', 'description', 'allowed-tools', 'hooks', 'model'])
    expect(d.data.hooks).toEqual({ PreToolUse: [{ matcher: 'Bash' }] })
    expect(d.body).toBe('# Body\n\ntext\n')
  })

  it('set supports lists and objects', () => {
    const out = patchFrontmatter('---\nname: a\n---\nb', [
      { op: 'set', key: 'tools', value: ['Read', 'Grep'] },
      { op: 'set', key: 'meta', value: { x: 1, y: [true, null] } }
    ])
    expect(parseFrontmatter(out).data).toEqual({
      name: 'a',
      tools: ['Read', 'Grep'],
      meta: { x: 1, y: [true, null] }
    })
  })

  it('multi-line description set and read back is equal', () => {
    const values = [
      'line one\nline two\nline three',
      'ends with newline\nsecond\n',
      '  leading space\n    indented\nplain: colon # hash',
      'blank\n\nbetween lines',
      'with "quotes" and \'apos\'\nsecond'
    ]
    for (const eolText of [LF, CRLF]) {
      for (const v of values) {
        const out = patchFrontmatter(eolText, [{ op: 'set', key: 'description', value: v }])
        const d = parseFrontmatter(out)
        expect(d.error).toBeUndefined()
        expect(d.data.description).toBe(v)
        expect(d.data.name).toBe('demo')
        expect(d.body).toBe(parseFrontmatter(eolText).body)
        if (eolText === CRLF) expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
      }
    }
    // also into a missing key and a long line (no folding)
    const long = 'x'.repeat(300) + ' ' + 'y'.repeat(300)
    const out = patchFrontmatter(LF, [{ op: 'set', key: 'extra', value: long }])
    expect(parseFrontmatter(out).data.extra).toBe(long)
    expect(out).toContain(long)
  })

  it('delete removes a key and keeps the rest', () => {
    const out = patchFrontmatter(LF, [{ op: 'delete', key: 'description' }])
    const d = parseFrontmatter(out)
    expect(Object.keys(d.data)).toEqual(['name', 'allowed-tools', 'hooks'])
    expect(out).toContain('# top comment')
    expect(patchFrontmatter(LF, [{ op: 'delete', key: 'nope' }])).toBe(LF)
  })

  it('deleting every key leaves an empty block', () => {
    const out = patchFrontmatter('---\na: 1\n---\nbody', [{ op: 'delete', key: 'a' }])
    expect(out).toBe('---\n---\nbody')
    expect(parseFrontmatter(out).error).toBeUndefined()
  })

  it('set into an empty frontmatter', () => {
    expect(patchFrontmatter('---\n---\nbody', [{ op: 'set', key: 'a', value: 'b' }])).toBe(
      '---\na: b\n---\nbody'
    )
  })

  it('preserves CRLF in the patched output', () => {
    const out = patchFrontmatter(CRLF, [{ op: 'set', key: 'model', value: 'opus' }])
    expect(out.replace(/\r\n/g, '')).not.toMatch(/[\r\n]/)
    expect(parseFrontmatter(out).eol).toBe('\r\n')
    expect(parseFrontmatter(out).data.model).toBe('opus')
  })

  it('creates a block on a missing frontmatter with the file EOL', () => {
    expect(patchFrontmatter('body\n', [{ op: 'set', key: 'name', value: 'x' }])).toBe(
      '---\nname: x\n---\nbody\n'
    )
    expect(patchFrontmatter('body\r\nmore\r\n', [{ op: 'set', key: 'name', value: 'x' }])).toBe(
      '---\r\nname: x\r\n---\r\nbody\r\nmore\r\n'
    )
    expect(patchFrontmatter('', [{ op: 'set', key: 'name', value: 'x' }])).toBe('---\nname: x\n---\n')
    // deletes only: untouched
    expect(patchFrontmatter('body\n', [{ op: 'delete', key: 'name' }])).toBe('body\n')
  })

  it('throws on unparsable frontmatter', () => {
    for (const bad of ['---\na: [\n---\nx', '---\n- a\n---\nx', '---\na: 1\nno close']) {
      expect(() => patchFrontmatter(bad, [{ op: 'set', key: 'a', value: 1 }])).toThrow()
    }
  })
})

describe('replaceBody', () => {
  it('keeps the frontmatter bytes verbatim', () => {
    for (const t of [LF, CRLF]) {
      const d = parseFrontmatter(t)
      const out = replaceBody(t, 'brand new body')
      expect(out.slice(0, d.bodyOffset)).toBe(t.slice(0, d.bodyOffset))
      expect(out).toBe(t.slice(0, d.bodyOffset) + 'brand new body')
      expect(parseFrontmatter(out).body).toBe('brand new body')
    }
  })

  it('replaces the whole text when there is no frontmatter', () => {
    expect(replaceBody('old', 'new')).toBe('new')
  })

  it('keeps broken yaml bytes when the fences are intact, throws when unclosed', () => {
    const bad = '---\na: [\n---\nold'
    expect(replaceBody(bad, 'new')).toBe('---\na: [\n---\nnew')
    expect(() => replaceBody('---\na: 1\nnever closed', 'x')).toThrow()
  })
})

describe('keyRange', () => {
  it('points at the key line', () => {
    const r = keyRange(LF, 'description')!
    expect(LF.slice(r[0], r[1])).toBe(`description: 'it''s "odd"'`)
    const n = keyRange(LF, 'name')!
    expect(LF.slice(n[0], n[1]).startsWith('name:')).toBe(true)
    expect(LF.slice(n[0], n[1])).not.toMatch(/\n/)
  })

  it('works with CRLF and a BOM', () => {
    const t = '﻿' + CRLF
    const r = keyRange(t, 'description')!
    expect(t.slice(r[0], r[1])).toBe(`description: 'it''s "odd"'`)
  })

  it('is undefined for missing keys, no frontmatter, or broken frontmatter', () => {
    expect(keyRange(LF, 'nope')).toBeUndefined()
    expect(keyRange('body', 'name')).toBeUndefined()
    expect(keyRange('---\na: [\n---\n', 'a')).toBeUndefined()
  })
})

describe('lenient frontmatter (P4 D13 #4)', () => {
  const SRC = '---\nname: demo\ndescription: Use this agent: when "x" helps\ntools: Read\n---\nBody: keep this: as is\n'

  it('quoteUnsafeScalars quotes only unsafe plain scalars, frontmatter only', () => {
    const r = quoteUnsafeScalars(SRC)
    expect(r.keys).toEqual(['description'])
    expect(r.text).toContain('description: "Use this agent: when \\"x\\" helps"')
    expect(r.text.endsWith('Body: keep this: as is\n')).toBe(true)
  })

  it('leaves quoted values, block scalars, lists and safe text untouched', () => {
    const t = '---\na: "q: r"\nb: |\n  x: y\nc:\n  - d: e\nf: plain\n---\nz: a: b\n'
    expect(quoteUnsafeScalars(t)).toEqual({ text: t, keys: [] })
  })

  it('handles CRLF', () => {
    const r = quoteUnsafeScalars(SRC.replace(/\n/g, '\r\n'))
    expect(r.keys).toEqual(['description'])
    expect(r.text).toContain('helps"\r\n')
  })

  it('lenient parse returns data, lenient.keys and keeps the error', () => {
    const fm = parseFrontmatter(SRC)
    expect(fm.error).toBeDefined()
    expect(fm.lenient).toEqual({ keys: ['description'] })
    expect(fm.data['description']).toBe('Use this agent: when "x" helps')
    expect(fm.data['name']).toBe('demo')
  })

  it('valid strict YAML never sets lenient; patch still throws on lenient text', () => {
    expect(parseFrontmatter('---\na: "b: c"\n---\n').lenient).toBeUndefined()
    expect(() => patchFrontmatter(SRC, [{ op: 'set', key: 'name', value: 'x' }])).toThrow()
  })
})
