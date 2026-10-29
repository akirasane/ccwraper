import { useVirtualizer } from '@tanstack/react-virtual'
import * as React from 'react'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'
import { AssistantMessage } from './AssistantMessage'
import type { ChatItem } from './model/types'
import { ToolCard } from './tools/ToolCard'
import { UserMessage } from './UserMessage'

const GAP = 14
const STICK_PX = 48
const EMPTY: ChatItem[] = []

function ItemView({ convId, item }: { convId: string; item: ChatItem }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} />
    case 'assistant':
      return <AssistantMessage item={item} />
    case 'tool':
      return <ToolCard convId={convId} toolUseId={item.toolUseId} />
    case 'error':
      return (
        <div
          role="alert"
          data-testid="error-message"
          className="rounded-md border border-danger-border bg-danger-bg px-3.5 py-2.5 text-base text-danger"
        >
          {item.message}
        </div>
      )
  }
}

/**
 * Virtualized stream. Content is max 760 wide with 24px side padding and a 14px gap. Sticks to the bottom while
 * streaming unless the user scrolled up. Only newly appended items get a transform/opacity enter, applied to the
 * inner element (the absolutely positioned virtual row is never animated).
 */
export function MessageList({ convId }: { convId: string }): React.JSX.Element {
  const items = useChatStore((s) => s.convs[convId]?.items) ?? EMPTY
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const stick = React.useRef(true)
  const seen = React.useRef<Set<string>>(new Set())
  const animated = React.useRef<Set<string>>(new Set())
  const initialized = React.useRef(false)

  for (const it of items) {
    if (!seen.current.has(it.id)) {
      seen.current.add(it.id)
      if (initialized.current) animated.current.add(it.id)
    }
  }
  React.useEffect(() => {
    initialized.current = true
    if (animated.current.size === 0) return
    const t = setTimeout(() => animated.current.clear(), 400)
    return () => clearTimeout(t)
  }, [items])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 96,
    overscan: 6,
    gap: GAP,
    getItemKey: (i) => items[i]?.id ?? i
  })

  const total = virtualizer.getTotalSize()
  React.useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [total, items.length])

  const onScroll = (): void => {
    const el = scrollRef.current
    if (!el) return
    stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < STICK_PX
  }

  return (
    <div
      ref={scrollRef}
      onScroll={onScroll}
      data-testid="message-list"
      className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden"
    >
      {items.length === 0 ? (
        <div className="flex h-full items-center justify-center px-6 text-base text-fg-3">
          Send a message to start the session.
        </div>
      ) : (
        <div
          className="relative mx-auto w-full max-w-[calc(var(--chat-max-w)+48px)] px-6 pb-6 pt-6"
          style={{ height: total + 48, boxSizing: 'border-box' }}
        >
          <div className="relative w-full" style={{ height: total }}>
            {virtualizer.getVirtualItems().map((v) => {
              const item = items[v.index]
              if (!item) return null
              return (
                <div
                  key={v.key}
                  data-index={v.index}
                  data-testid="message-row"
                  ref={virtualizer.measureElement}
                  className="absolute left-0 top-0 w-full"
                  style={{ transform: `translateY(${v.start}px)` }}
                >
                  <div
                    className={cn(
                      animated.current.has(item.id) && 'ccw-item-in',
                      'parentToolUseId' in item && item.parentToolUseId && 'pl-4'
                    )}
                  >
                    <ItemView convId={convId} item={item} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
