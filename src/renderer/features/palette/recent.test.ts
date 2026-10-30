import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readRecent, recordRecent, RECENT_KEY, RECENT_MAX } from './recent'

beforeEach(() => window.localStorage.clear())

describe('recent', () => {
  it('records newest first, deduped, max 8', () => {
    for (let i = 0; i < 10; i++) recordRecent(`c${i}`)
    recordRecent('c5')
    const r = readRecent()
    expect(r).toHaveLength(RECENT_MAX)
    expect(r[0]).toBe('c5')
    expect(r.filter((x) => x === 'c5')).toHaveLength(1)
  })

  it('survives corrupt storage', () => {
    window.localStorage.setItem(RECENT_KEY, '{not json')
    expect(readRecent()).toEqual([])
    window.localStorage.setItem(RECENT_KEY, '{"a":1}')
    expect(readRecent()).toEqual([])
  })

  it('survives throwing storage', () => {
    const spy = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota')
    })
    expect(() => recordRecent('x')).not.toThrow()
    spy.mockRestore()
  })
})
