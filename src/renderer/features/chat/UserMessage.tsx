import * as React from 'react'

export function UserMessage({ text }: { text: string }): React.JSX.Element {
  return (
    <div
      data-testid="user-message"
      className="rounded-md border border-border bg-bg-2 px-3.5 py-2.5 text-md leading-[1.6] text-fg shadow-[var(--highlight-inset)]"
    >
      <p className="m-0 whitespace-pre-wrap break-words">{text}</p>
    </div>
  )
}
