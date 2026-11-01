import type { SlashCommandInfo } from '@shared/events'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { commandTag } from './slash-commands'

export const SLASH_LISTBOX_ID = 'slash-listbox'
export const slashOptionId = (name: string): string => `slash-opt-${name.replace(/[^\w-]/g, '_')}`

export interface SlashPopupProps {
  items: SlashCommandInfo[]
  activeIndex: number
  /** True when the list is the static pre-session fallback. */
  fallback: boolean
  onPick: (c: SlashCommandInfo) => void
  onHover: (i: number) => void
}

export function SlashPopup({ items, activeIndex, fallback, onPick, onHover }: SlashPopupProps): React.JSX.Element {
  const activeRef = React.useRef<HTMLDivElement>(null)
  React.useEffect(() => {
    activeRef.current?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIndex, items])

  return (
    <div
      className="absolute inset-x-0 bottom-full z-40 mb-2 overflow-hidden rounded-md border border-border-glass bg-glass text-fg shadow-lg backdrop-blur-[var(--blur-glass)]"
      data-testid="slash-popup"
    >
      <div
        id={SLASH_LISTBOX_ID}
        role="listbox"
        aria-label="Slash commands"
        className="max-h-[272px] overflow-y-auto p-1"
      >
        {items.map((c, i) => {
          const tag = commandTag(c)
          const active = i === activeIndex
          return (
            <div
              key={c.name}
              id={slashOptionId(c.name)}
              ref={active ? activeRef : undefined}
              role="option"
              aria-selected={active}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => onHover(i)}
              onClick={() => onPick(c)}
              className={cn(
                'flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2.5 text-sm',
                active ? 'bg-bg-3 text-fg' : 'text-fg-2'
              )}
            >
              <span className="shrink-0 font-mono text-fg">/{c.name}</span>
              {c.argumentHint ? <span className="shrink-0 font-mono text-xs text-fg-3">{c.argumentHint}</span> : null}
              <span className="min-w-0 flex-1 truncate text-xs text-fg-3">{c.description}</span>
              {tag ? (
                <span className="shrink-0 rounded-xs border border-border px-1.5 text-2xs text-fg-3">{tag}</span>
              ) : null}
            </div>
          )
        })}
      </div>
      {fallback ? (
        <div className="border-t border-border px-3 py-1.5 text-xs text-fg-3">Full list loads after the session starts</div>
      ) : null}
    </div>
  )
}
