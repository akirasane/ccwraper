import { describe, expect, it } from 'vitest'
import { applyMention, mentionAt, mentionText } from './mentions'

describe('mentionAt', () => {
  it('finds an @token at the start or after whitespace', () => {
    expect(mentionAt('@src/ma', 7)).toEqual({ query: 'src/ma', start: 0 })
    expect(mentionAt('look at @foo', 12)).toEqual({ query: 'foo', start: 8 })
    expect(mentionAt('a\n@', 3)).toEqual({ query: '', start: 2 })
  })
  it('ignores emails, closed tokens and carets before the @', () => {
    expect(mentionAt('me@host', 7)).toBeNull()
    expect(mentionAt('@foo bar', 8)).toBeNull()
    expect(mentionAt('x @foo', 1)).toBeNull()
    expect(mentionAt('hello', 5)).toBeNull()
  })
  it('uses the caret, not the end of the text', () => {
    expect(mentionAt('@ab cd', 3)).toEqual({ query: 'ab', start: 0 })
  })
})

describe('applyMention', () => {
  it('replaces the token and keeps the rest of the text', () => {
    const m = mentionAt('see @sr and more', 7)!
    const r = applyMention('see @sr and more', 7, m, 'src/index.ts')
    expect(r.text).toBe('see @src/index.ts  and more')
    expect(r.caret).toBe('see @src/index.ts '.length)
  })
  it('quotes paths with whitespace', () => {
    expect(mentionText('my docs/a b.md')).toBe('@"my docs/a b.md"')
    expect(mentionText('a.md')).toBe('@a.md')
  })
})
