import { Plus, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'
import { useWorkspaceStore, type TabRef } from '@/stores/workspace-store'
import { statusText, tabStatus, tabTitle, tabTooltip, type TabStatus } from './tab-status'

const noDrag = { WebkitAppRegion: 'no-drag' } as React.CSSProperties

const DOT: Record<Exclude<TabStatus, 'idle'>, string> = {
  running: 'bg-info animate-pulse motion-reduce:animate-none',
  waiting: 'bg-warn',
  error: 'bg-danger',
  unread: 'bg-accent-to'
}

function Tab({ tab, active }: { tab: TabRef; active: boolean }): React.JSX.Element {
  const conv = useChatStore((s) => s.convs[tab.convId])
  const unread = useWorkspaceStore((s) => !!s.unread[tab.convId])
  const activate = useWorkspaceStore((s) => s.activateTab)
  const close = useWorkspaceStore((s) => s.closeTab)
  const status = tabStatus(conv, unread && !active)
  const title = tabTitle(tab, conv)
  return (
    <div
      role="presentation"
      data-testid="tab"
      data-conv-id={tab.convId}
      data-status={status}
      data-active={active || undefined}
      className={cn(
        'group relative flex h-7 w-[180px] min-w-[72px] max-w-[240px] shrink-0 items-center rounded-sm text-base transition-colors duration-fast',
        active ? 'bg-bg-2 text-fg' : 'text-fg-2 hover:bg-bg-3 hover:text-fg'
      )}
      onAuxClick={(e) => {
        if (e.button === 1) {
          e.preventDefault()
          void close(tab.convId)
        }
      }}
      onMouseDown={(e) => {
        if (e.button === 1) e.preventDefault() // no autoscroll cursor on middle click
      }}
    >
      <button
        type="button"
        role="tab"
        id={`tab-${tab.convId}`}
        aria-selected={active}
        tabIndex={active ? 0 : -1}
        title={tabTooltip(tab, conv, status)}
        aria-label={`${title}, ${statusText(status)}`}
        onClick={() => activate(tab.convId)}
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded-sm pl-2.5 pr-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-accent-to"
      >
        {status !== 'idle' && (
          <span aria-hidden data-testid="tab-dot" className={cn('size-1.5 shrink-0 rounded-full', DOT[status])} />
        )}
        <span className="truncate" data-testid="tab-title">
          {title}
        </span>
      </button>
      <button
        type="button"
        aria-label={`Close ${title}`}
        title="Close tab"
        onClick={() => void close(tab.convId)}
        className="mr-1 flex size-5 shrink-0 items-center justify-center rounded-xs text-fg-3 opacity-0 outline-none transition-opacity duration-fast hover:bg-bg-3 hover:text-fg focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-accent-to group-hover:opacity-100 data-[active]:opacity-100"
        data-active={active || undefined}
      >
        <X size={12} aria-hidden />
      </button>
      {active && (
        <span
          aria-hidden
          className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-linear-to-r from-accent-from to-accent-to"
        />
      )}
    </div>
  )
}

/** Tabs in the title bar: scrolls horizontally on overflow; every interactive part is no-drag. */
export function TabStrip(): React.JSX.Element {
  const tabs = useWorkspaceStore((s) => s.tabs)
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const newTab = useWorkspaceStore((s) => s.newTab)
  const hasCwd = useWorkspaceStore((s) => !!s.cwd)
  const scroller = useRef<HTMLDivElement>(null)
  const [fade, setFade] = useState({ left: false, right: false })

  const measure = useCallback(() => {
    const el = scroller.current
    if (!el) return
    const left = el.scrollLeft > 1
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
    setFade((f) => (f.left === left && f.right === right ? f : { left, right }))
  }, [])

  useEffect(() => {
    measure()
    const el = scroller.current
    if (!el) return
    const active = el.querySelector<HTMLElement>('[data-active="true"], [data-testid="tab"][data-active]')
    if (typeof active?.scrollIntoView === 'function') active.scrollIntoView({ inline: 'nearest', block: 'nearest' })
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [tabs, activeConvId, measure])

  const mask =
    fade.left || fade.right
      ? `linear-gradient(to right, ${fade.left ? 'transparent' : 'black'}, black 16px, black calc(100% - 16px), ${fade.right ? 'transparent' : 'black'})`
      : undefined

  return (
    <div className="flex min-w-0 items-center gap-1" style={noDrag} data-testid="tab-strip">
      <div
        ref={scroller}
        role="tablist"
        aria-label="Open sessions"
        data-testid="tab-list"
        className="flex min-w-0 items-center gap-1 overflow-x-auto [scrollbar-width:none]"
        style={{ ...noDrag, ...(mask ? { maskImage: mask, WebkitMaskImage: mask } : {}) }}
        onScroll={measure}
        onWheel={(e) => {
          const el = scroller.current
          if (el && el.scrollWidth > el.clientWidth) el.scrollLeft += e.deltaY + e.deltaX
        }}
      >
        {tabs.map((t) => (
          <Tab key={t.convId} tab={t} active={t.convId === activeConvId} />
        ))}
      </div>
      <button
        type="button"
        aria-label="New tab"
        title="New tab (Ctrl+T)"
        disabled={!hasCwd}
        onClick={() => newTab()}
        className="flex size-7 shrink-0 items-center justify-center rounded-sm text-fg-2 outline-none transition-colors duration-fast hover:bg-bg-3 hover:text-fg focus-visible:ring-2 focus-visible:ring-accent-to disabled:opacity-[0.42]"
      >
        <Plus size={14} aria-hidden />
      </button>
    </div>
  )
}
