import { describe, expect, it } from 'vitest'
import { MAX_IMAGES, SessionSendSchema, SessionStartSchema } from './ipc'

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
