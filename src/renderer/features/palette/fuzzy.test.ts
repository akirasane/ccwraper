import { describe, expect, it } from 'vitest'
import { fuzzyScore, scoreCommand } from './fuzzy'

describe('fuzzyScore', () => {
  it('returns null when the query is not a subsequence', () => {
    expect(fuzzyScore('xyz', 'Git status')).toBeNull()
    expect(fuzzyScore('tsg', 'Git status')).toBeNull()
  })

  it('is case-insensitive and ignores spaces in the query', () => {
    expect(fuzzyScore('GIT S', 'git status')).not.toBeNull()
  })

  it('gst ranks "Git status" above "Toggle settings"', () => {
    const a = fuzzyScore('gst', 'Git status')!
    const b = fuzzyScore('gst', 'Toggle settings')!
    expect(a).toBeGreaterThan(b)
  })

  it('rewards word starts', () => {
    expect(fuzzyScore('ns', 'New session')!).toBeGreaterThan(fuzzyScore('ns', 'Dunes')!)
  })

  it('rewards consecutive runs', () => {
    expect(fuzzyScore('rmi', 'xxrmixx')!).toBeGreaterThan(fuzzyScore('rmi', 'xxrxxmxxixx')!)
  })

  it('rewards a prefix match', () => {
    expect(fuzzyScore('set', 'Settings')!).toBeGreaterThan(fuzzyScore('set', 'Reset')!)
  })

  it('scores an empty query as 0', () => {
    expect(fuzzyScore('', 'anything')).toBe(0)
  })
})

describe('scoreCommand', () => {
  it('keywords weigh less than the title', () => {
    const viaTitle = scoreCommand('stop', { title: 'Stop' })!
    const viaKeyword = scoreCommand('stop', { title: 'Interrupt', keywords: ['stop'] })!
    expect(viaKeyword).toBeGreaterThan(0)
    expect(viaKeyword).toBeLessThan(viaTitle)
  })

  it('is null when neither title nor keywords match', () => {
    expect(scoreCommand('zzz', { title: 'Interrupt', keywords: ['stop'] })).toBeNull()
  })
})
