import * as React from 'react'
import { cn } from '@/lib/cn'

export const MENTION_LISTBOX_ID = 'mention-listbox'
export const mentionOptionId = (i: number): string => `mention-opt-${i}`

export interface MentionPopupProps {
  items: string[]
  activeIndex: number
  onPick: (path: string) => void
  onHover: (i: number) => void
}

function split(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf('/')
  return i < 0 ? { dir: '', base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) }
}

export function MentionPopup({ items, activeIndex, onPick, onHover }: MentionPopupProps): React.JSX.Element {
  const activeRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, items])

  return (
    <div
      className="absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-md border border-border-glass bg-glass text-fg shadow-lg backdrop-blur-[var(--blur-glass)]"
      data-testid="mention-popup"
    >
      <div id={MENTION_LISTBOX_ID} role="listbox" aria-label="Files" className="max-h-[272px] overflow-y-auto p-1">
        {items.map((p, i) => {
          const { dir, base } = split(p)
          const active = i === activeIndex
          return (
            <div
              key={p}
              id={mentionOptionId(i)}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(p)}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm',
                active ? 'bg-bg-3 text-fg' : 'text-fg-2'
              )}
            >
              <span className="shrink-0 font-mono text-fg">{base}</span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">{dir}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
