import { describe, expect, it } from 'vitest'
import { configKeys, keysForChange, refKey } from './config-queries'

describe('config-queries keys', () => {
  it('refKey ignores slash style, trailing separator and case of cwd', () => {
    const a = refKey({ kind: 'settings', scope: 'project', cwd: 'C:\\Fixture\\Proj\\' })
    const b = refKey({ kind: 'settings', scope: 'project', cwd: 'c:/fixture/proj' })
    expect(a).toBe(b)
    expect(refKey({ kind: 'memory', scope: 'user' })).toBe('memory:user:')
  })

  it('has the three frozen key families', () => {
    expect(configKeys.file({ kind: 'settings', scope: 'user' })[0]).toBe('config')
    expect(configKeys.settingsResolve('C:\\p')[0]).toBe('settings-resolve')
    expect(configKeys.mcp('C:\\p')[0]).toBe('mcp')
  })

  it('maps fs:changed payloads to the keys to invalidate', () => {
    expect(keysForChange({ kind: 'mcp', path: 'p' })).toEqual([['mcp']])
    expect(keysForChange({ kind: 'memory', scope: 'local', cwd: 'C:\\p', path: 'p' })).toEqual([
      ['config', 'memory:local:c:/p']
    ])
    expect(keysForChange({ kind: 'settings', path: 'p' })).toEqual([['config'], ['settings-resolve'], ['mcp']])
  })

  it('covers item refs and keys (P3)', () => {
    expect(refKey({ kind: 'skill', scope: 'user', name: 'a' })).toBe('skill:user::a')
    expect(refKey({ kind: 'command', scope: 'project', cwd: 'C:\\P\\', name: 'a/b' })).toBe('command:project:c:/p:a/b')
    expect(refKey({ kind: 'agent', scope: 'plugin', plugin: 'pl', name: 'r' })).toBe('agent:plugin:pl:r')
    expect(configKeys.items('skill', 'C:\\P\\')).toEqual(['items', 'skill', 'c:/p'])
    expect(keysForChange({ kind: 'agent', scope: 'project', cwd: 'C:\\p', path: 'p' })).toEqual([['items', 'agent'], ['config']])
  })
})
