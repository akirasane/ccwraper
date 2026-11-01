import { describe, expect, it } from 'vitest'
import { MAX_IMAGES, SessionRewindSchema, SessionSendSchema, SessionStartSchema } from './ipc'

const img = { mediaType: 'image/png', data: 'AAAA' }

describe('image attachments in session schemas', () => {
  it('send accepts text, images, or both; rejects neither', () => {
    expect(SessionSendSchema.safeParse({ localId: 'a', text: 'hi' }).success).toBe(true)
    expect(SessionSendSchema.safeParse({ localId: 'a', text: '', images: [img] }).success).toBe(true)
    expect(SessionSendSchema.safeParse({ localId: 'a', text: '' }).success).toBe(false)
    expect(SessionSendSchema.safeParse({ localId: 'a', text: '', images: [] }).success).toBe(false)
  })
  it('start accepts an image-only prompt', () => {
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: '', images: [img] }).success).toBe(true)
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: '' }).success).toBe(false)
  })
  it('rejects bad media types, non-base64 data and too many images', () => {
    const bad = (i: unknown): boolean => SessionSendSchema.safeParse({ localId: 'a', text: 'x', images: [i] }).success
    expect(bad({ mediaType: 'image/svg+xml', data: 'AAAA' })).toBe(false)
    expect(bad({ mediaType: 'image/png', data: 'data:image/png;base64,AAAA' })).toBe(false)
    expect(bad({ mediaType: 'image/png', data: '' })).toBe(false)
    const many = Array.from({ length: MAX_IMAGES + 1 }, () => img)
    expect(SessionSendSchema.safeParse({ localId: 'a', text: 'x', images: many }).success).toBe(false)
  })
  it('rejects an oversize payload', () => {
    const huge = { mediaType: 'image/png', data: 'A'.repeat(8 * 1024 * 1024) }
    expect(SessionSendSchema.safeParse({ localId: 'a', text: 'x', images: [huge] }).success).toBe(false)
  })
})

describe('message ids and rewind schema', () => {
  const id = '11111111-1111-4111-8111-111111111111'
  it('accepts uuid message ids only', () => {
    expect(SessionSendSchema.safeParse({ localId: 'a', text: 'x', messageId: id }).success).toBe(true)
    expect(SessionSendSchema.safeParse({ localId: 'a', text: 'x', messageId: 'not-a-uuid' }).success).toBe(false)
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: 'x', messageId: id }).success).toBe(true)
  })
  it('rewind needs a uuid and an explicit dryRun flag', () => {
    expect(SessionRewindSchema.safeParse({ localId: 'a', messageId: id, dryRun: true }).success).toBe(true)
    expect(SessionRewindSchema.safeParse({ localId: 'a', messageId: id }).success).toBe(false)
    expect(SessionRewindSchema.safeParse({ localId: 'a', messageId: '../x', dryRun: false }).success).toBe(false)
  })
})

describe('additionalDirectories', () => {
  it('accepts a bounded list of non-empty paths', () => {
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: 'x', additionalDirectories: ['D:/a'] }).success).toBe(true)
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: 'x', additionalDirectories: [''] }).success).toBe(false)
    expect(SessionStartSchema.safeParse({ cwd: 'C:/x', prompt: 'x', additionalDirectories: Array(11).fill('D:/a') }).success).toBe(false)
  })
})
