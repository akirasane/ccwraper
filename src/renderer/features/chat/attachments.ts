import { IMAGE_MEDIA_TYPES, MAX_IMAGE_BYTES, MAX_IMAGES, type ImageAttachment } from '@shared/ipc'

type MediaType = ImageAttachment['mediaType']

export interface AttachmentResult {
  accepted: ImageAttachment[]
  /** Human-readable reasons for each rejected file; surface them, never drop silently. */
  rejected: string[]
}

export const isImageType = (t: string): t is MediaType => (IMAGE_MEDIA_TYPES as readonly string[]).includes(t)

/** Pure validation on file metadata, so it can be tested without a DOM. */
export function checkFile(f: { name: string; type: string; size: number }): string | null {
  if (!isImageType(f.type)) return `${f.name || 'file'}: only PNG, JPEG, GIF and WebP images are supported`
  if (f.size === 0) return `${f.name || 'image'}: empty file`
  if (f.size > MAX_IMAGE_BYTES) return `${f.name || 'image'}: larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB`
  return null
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onerror = () => reject(r.error ?? new Error('read failed'))
    r.onload = () => {
      const s = String(r.result)
      resolve(s.slice(s.indexOf(',') + 1))
    }
    r.readAsDataURL(file)
  })
}

/** Validate and read files, honouring the cap on images already attached. */
export async function readImages(files: File[], existing: number): Promise<AttachmentResult> {
  const accepted: ImageAttachment[] = []
  const rejected: string[] = []
  for (const f of files) {
    const bad = checkFile(f)
    if (bad) {
      rejected.push(bad)
      continue
    }
    if (existing + accepted.length >= MAX_IMAGES) {
      rejected.push(`${f.name || 'image'}: at most ${MAX_IMAGES} images per message`)
      continue
    }
    try {
      accepted.push({ mediaType: f.type as MediaType, data: await toBase64(f) })
    } catch {
      rejected.push(`${f.name || 'image'}: could not be read`)
    }
  }
  return { accepted, rejected }
}

export const dataUrl = (i: ImageAttachment): string => `data:${i.mediaType};base64,${i.data}`
