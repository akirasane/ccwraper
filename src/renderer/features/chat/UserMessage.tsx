import * as React from 'react'
import type { ImageAttachment } from '@shared/ipc'
import { dataUrl } from './attachments'

export function UserMessage({
  text,
  images,
  children
}: {
  text: string
  images?: ImageAttachment[]
  /** Hover actions, shown at the top right (e.g. rewind). */
  children?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      data-testid="user-message"
      className="group relative rounded-md border border-border bg-bg-2 px-3.5 py-2.5 text-md leading-[1.6] text-fg shadow-[var(--highlight-inset)]"
    >
      {images?.length ? (
        <div className="mb-2 flex flex-wrap gap-2" data-testid="user-images">
          {images.map((img, i) => (
            <img
              key={i}
              src={dataUrl(img)}
              alt={`Attached image ${i + 1}`}
              className="max-h-40 max-w-[240px] rounded-sm border border-border object-contain"
            />
          ))}
        </div>
      ) : null}
      {text ? <p className="m-0 whitespace-pre-wrap break-words">{text}</p> : null}
      {children ? (
        <div className="absolute right-1.5 top-1.5 opacity-0 transition-opacity duration-fast focus-within:opacity-100 group-hover:opacity-100">
          {children}
        </div>
      ) : null}
    </div>
  )
}
