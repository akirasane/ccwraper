import * as React from 'react'
import { cn } from '@/lib/cn'

/** Renders the first `maxLines` lines of a long text plus a "show more" button. Slicing keeps huge output cheap. */
export function TruncatedText({
  text,
  maxLines = 40,
  className
}: {
  text: string
  maxLines?: number
  className?: string
}): React.JSX.Element {
  const [all, setAll] = React.useState(false)
  const { shown, hidden } = React.useMemo(() => {
    if (all) return { shown: text, hidden: 0 }
    let idx = -1
    for (let n = 0; n < maxLines; n++) {
      idx = text.indexOf('\n', idx + 1)
      if (idx === -1) return { shown: text, hidden: 0 }
    }
    const rest = text.slice(idx + 1)
    return { shown: text.slice(0, idx), hidden: rest === '' ? 0 : rest.split('\n').length }
  }, [text, all, maxLines])
  return (
    <div>
      <pre className={cn('m-0 max-h-[360px] overflow-auto whitespace-pre-wrap break-words', className)}>{shown}</pre>
      {hidden > 0 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="mt-1 rounded-xs text-xs text-accent-text hover:underline"
        >
          Show {hidden} more lines
        </button>
      )}
    </div>
  )
}
