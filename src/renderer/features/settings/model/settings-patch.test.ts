import { describe, expect, it } from 'vitest'
import { applyPatch, detectFormat, getAt, parseSettingsText } from './settings-patch'

describe('detectFormat', () => {
  it('detects 2/4 spaces, tabs, CRLF and trailing newline', () => {
    expect(detectFormat('{\n  "a": 1\n}\n')).toEqual({ indent: 2, eol: '\n', trailingNewline: true })
    expect(detectFormat('{\n    "a": 1\n}')).toEqual({ indent: 4, eol: '\n', trailingNewline: false })
    expect(detectFormat('{\n\t"a": 1\n}\n').indent).toBe('\t')
    expect(detectFormat('{\r\n  "a": 1\r\n}\r\n')).toEqual({ indent: 2, eol: '\r\n', trailingNewline: true })
  })
  it('defaults for empty text', () => {
    expect(detectFormat('')).toEqual({ indent: 2, eol: '\n', trailingNewline: true })
  })
})

describe('parseSettingsText', () => {
  it('treats empty as {} and rejects non-objects / broken json', () => {
    expect(parseSettingsText('  ')).toEqual({ ok: true, value: {} })
    expect(parseSettingsText('[1]').ok).toBe(false)
    expect(parseSettingsText('{"a":').ok).toBe(false)
    expect(parseSettingsText('// c\n{}').ok).toBe(false)
  })
})

describe('applyPatch', () => {
  const base = '{\n  "zeta": {"x": [1, 2]},\n  "model": "opus",\n  "alpha": true\n}\n'

  it('sets a key, keeps unknown keys and key order', () => {
    const out = applyPatch(base, [{ op: 'set', path: ['model'], value: 'sonnet' }])
    const o = JSON.parse(out) as Record<string, unknown>
    expect(Object.keys(o)).toEqual(['zeta', 'model', 'alpha'])
    expect(o.model).toBe('sonnet')
    expect(o.zeta).toEqual({ x: [1, 2] })
    expect(out.endsWith('\n')).toBe(true)
  })

  it('appends new keys at the end', () => {
    const out = applyPatch(base, [{ op: 'set', path: ['cleanupPeriodDays'], value: 7 }])
    expect(Object.keys(JSON.parse(out) as object).at(-1)).toBe('cleanupPeriodDays')
  })

  it('creates nested objects and preserves 4-space indent and CRLF', () => {
    const src = '{\r\n    "a": 1\r\n}\r\n'
    const out = applyPatch(src, [{ op: 'set', path: ['permissions', 'allow'], value: ['Bash(ls:*)'] }])
    expect(out).toBe('{\r\n    "a": 1,\r\n    "permissions": {\r\n        "allow": [\r\n            "Bash(ls:*)"\r\n        ]\r\n    }\r\n}\r\n')
  })

  it('keeps no trailing newline when the source had none', () => {
    expect(applyPatch('{"a":1}', [{ op: 'set', path: ['b'], value: 2 }]).endsWith('}')).toBe(true)
  })

  it('deletes a key and a missing path is a no-op', () => {
    const out = applyPatch(base, [
      { op: 'delete', path: ['model'] },
      { op: 'delete', path: ['nope', 'deep'] }
    ])
    expect(JSON.parse(out)).toEqual({ zeta: { x: [1, 2] }, alpha: true })
  })

  it('removes an emptied parent only if the patch created it', () => {
    const created = applyPatch('{"a":1}', [
      { op: 'set', path: ['permissions', 'allow'], value: ['x'] },
      { op: 'delete', path: ['permissions', 'allow'] }
    ])
    expect(JSON.parse(created)).toEqual({ a: 1 })
    const pre = applyPatch('{"permissions":{"allow":["x"]}}', [{ op: 'delete', path: ['permissions', 'allow'] }])
    expect(JSON.parse(pre)).toEqual({ permissions: {} })
  })

  it('preserves unrelated nested keys in a touched object', () => {
    const src = '{"permissions":{"allow":["a"],"custom":{"k":1}}}'
    const out = applyPatch(src, [{ op: 'set', path: ['permissions', 'deny'], value: ['b'] }])
    expect(JSON.parse(out)).toEqual({ permissions: { allow: ['a'], custom: { k: 1 }, deny: ['b'] } })
  })

  it('replaces a non-object intermediate on set', () => {
    const out = applyPatch('{"env":"oops"}', [{ op: 'set', path: ['env', 'A'], value: '1' }])
    expect(JSON.parse(out)).toEqual({ env: { A: '1' } })
  })

  it('works on empty text and refuses unsafe paths / unparsable text', () => {
    expect(JSON.parse(applyPatch('', [{ op: 'set', path: ['model'], value: 'x' }]))).toEqual({ model: 'x' })
    expect(() => applyPatch('{', [{ op: 'set', path: ['a'], value: 1 }])).toThrow()
    expect(() => applyPatch('{}', [{ op: 'set', path: ['__proto__', 'x'], value: 1 }])).toThrow()
  })

  it('getAt reads nested values', () => {
    expect(getAt({ a: { b: 1 } }, ['a', 'b'])).toBe(1)
    expect(getAt({ a: 1 }, ['a', 'b'])).toBeUndefined()
  })
})
