import { describe, expect, it } from 'vitest'
import { MAX_IMAGE_BYTES, MAX_IMAGES } from '@shared/ipc'
import { checkFile, dataUrl, readImages } from './attachments'

const file = (name: string, type: string, bytes = 4): File => new File([new Uint8Array(bytes)], name, { type })

describe('checkFile', () => {
  it('accepts supported image types', () => {
    for (const t of ['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
      expect(checkFile({ name: 'a', type: t, size: 10 })).toBeNull()
  })
  it('rejects other types, empty and oversize files', () => {
    expect(checkFile({ name: 'a.svg', type: 'image/svg+xml', size: 10 })).toMatch(/only PNG/)
    expect(checkFile({ name: 'a.txt', type: 'text/plain', size: 10 })).toMatch(/only PNG/)
    expect(checkFile({ name: 'a.png', type: 'image/png', size: 0 })).toMatch(/empty/)
    expect(checkFile({ name: 'a.png', type: 'image/png', size: MAX_IMAGE_BYTES + 1 })).toMatch(/larger than 5 MB/)
  })
})

describe('readImages', () => {
  it('reads valid files to base64 and reports rejected ones', async () => {
    const r = await readImages([file('a.png', 'image/png'), file('b.txt', 'text/plain')], 0)
    expect(r.accepted).toHaveLength(1)
    expect(r.accepted[0]!.mediaType).toBe('image/png')
    expect(r.accepted[0]!.data).toBe('AAAAAA==')
    expect(r.rejected).toHaveLength(1)
  })
  it('enforces the image count cap including already attached images', async () => {
    const r = await readImages([file('a.png', 'image/png'), file('b.png', 'image/png')], MAX_IMAGES - 1)
    expect(r.accepted).toHaveLength(1)
    expect(r.rejected[0]).toMatch(/at most 5/)
  })
  it('builds a data url', () => {
    expect(dataUrl({ mediaType: 'image/png', data: 'AAAA' })).toBe('data:image/png;base64,AAAA')
  })
})
