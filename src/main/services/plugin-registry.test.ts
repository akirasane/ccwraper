import { describe, expect, it } from 'vitest'
import { PluginRegistry } from './plugin-registry'

describe('PluginRegistry', () => {
  it('starts empty and unknown', () => {
    const r = new PluginRegistry()
    expect(r.list()).toEqual([])
    expect(r.known).toBe(false)
    expect(r.get('x')).toBeUndefined()
  })

  it('unions plugins across inits and later entries replace same-name ones', () => {
    const r = new PluginRegistry()
    r.update([{ name: 'a', path: 'C:\\fixture\\plug\\a', version: '1.0.0' }])
    r.update([
      { name: 'a', path: 'C:\\fixture\\plug\\a2' },
      { name: 'b', path: 'C:\\fixture\\plug\\b' }
    ])
    expect(r.known).toBe(true)
    expect(r.get('a')).toEqual({ name: 'a', path: 'C:\\fixture\\plug\\a2' })
    expect(r.list().map((p) => p.name)).toEqual(['a', 'b'])
  })

  it('ignores undefined input and incomplete entries', () => {
    const r = new PluginRegistry()
    r.update(undefined)
    expect(r.known).toBe(false)
    r.update([{ name: '', path: 'x' }, { name: 'n', path: '' }])
    expect(r.list()).toEqual([])
    expect(r.known).toBe(true) // an init reported a (useless) list: plugins are known to be absent
  })
})
