import { ArrowDown, ArrowUp, X } from 'lucide-react'
import { useEffect, useRef } from 'react'

export interface SearchOverlayProps {
  query: string
  /** resultCount -1 = not searched yet. */
  resultIndex: number
  resultCount: number
  onQueryChange: (q: string) => void
  onNext: () => void
  onPrev: () => void
  onClose: () => void
}

const iconBtn =
  'inline-flex size-6 items-center justify-center rounded-xs text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--accent-ring)]'

export function SearchOverlay({
  query,
  resultIndex,
  resultCount,
  onQueryChange,
  onNext,
  onPrev,
  onClose
}: SearchOverlayProps): React.JSX.Element {
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])

  const label =
    query === '' ? '' : resultCount <= 0 ? 'No results' : `${Math.max(resultIndex, 0) + 1} of ${resultCount}`

  return (
    <div
      role="search"
      aria-label="Find in terminal"
      className="absolute right-3 top-2 z-10 flex items-center gap-1 rounded-sm border border-border-glass bg-glass-strong px-2 py-1 shadow-md backdrop-blur-[var(--blur-glass)]"
    >
      <input
        ref={ref}
        value={query}
        aria-label="Find"
        placeholder="Find"
        spellCheck={false}
        onChange={(e) => onQueryChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            if (e.shiftKey) onPrev()
            else onNext()
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        className="h-6 w-40 rounded-xs bg-transparent px-1 font-mono text-sm text-fg placeholder:text-fg-muted focus:outline-none"
      />
      <span aria-live="polite" data-testid="search-count" className="min-w-14 text-right text-xs text-fg-3">
        {label}
      </span>
      <button type="button" aria-label="Previous match" className={iconBtn} onClick={onPrev}>
        <ArrowUp size={14} />
      </button>
      <button type="button" aria-label="Next match" className={iconBtn} onClick={onNext}>
        <ArrowDown size={14} />
      </button>
      <button type="button" aria-label="Close find" className={iconBtn} onClick={onClose}>
        <X size={14} />
      </button>
    </div>
  )
}
