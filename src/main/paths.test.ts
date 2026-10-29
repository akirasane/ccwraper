import { describe, expect, it } from 'vitest'
import { compareVersions, parseVersion, readSdkVersions } from './paths'

describe('version helpers', () => {
  it('parses the x.y.z prefix', () => {
    expect(parseVersion('2.1.312 (Claude Code)')).toEqual([2, 1, 312])
    expect(parseVersion('garbage')).toBeUndefined()
  })
  it('compares numerically, not lexically', () => {
    expect(compareVersions('2.1.312', '2.1.312')).toBe(0)
    expect(compareVersions('2.1.9', '2.1.312')).toBe(-1)
    expect(compareVersions('2.10.0', '2.9.99')).toBe(1)
    expect(compareVersions('3.0.0', '2.9.99')).toBe(1)
    expect(compareVersions('nope', '2.1.0')).toBe(0)
  })
  it('reads the installed SDK versions via fs', () => {
    const v = readSdkVersions()
    expect(v.cli).toMatch(/^\d+\.\d+\.\d+/)
    expect(v.sdk).toMatch(/^\d+\.\d+\.\d+/)
  })
})
