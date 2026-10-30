import { afterEach, describe, expect, it, vi } from 'vitest'
import { insertIntoComposer, setComposerInserter } from './composer-bus'

afterEach(() => setComposerInserter(undefined))

describe('composer-bus', () => {
  it('returns false when no composer is mounted', () => {
    expect(insertIntoComposer('/x ')).toBe(false)
  })
  it('delivers text to the registered inserter', () => {
    const fn = vi.fn()
    setComposerInserter(fn)
    expect(insertIntoComposer('/review ')).toBe(true)
    expect(fn).toHaveBeenCalledWith('/review ')
  })
  it('stops delivering after unmount', () => {
    const fn = vi.fn()
    setComposerInserter(fn)
    setComposerInserter(undefined)
    expect(insertIntoComposer('a')).toBe(false)
    expect(fn).not.toHaveBeenCalled()
  })
  it('the latest registration wins', () => {
    const a = vi.fn()
    const b = vi.fn()
    setComposerInserter(a)
    setComposerInserter(b)
    insertIntoComposer('z')
    expect(a).not.toHaveBeenCalled()
    expect(b).toHaveBeenCalledWith('z')
  })
})
