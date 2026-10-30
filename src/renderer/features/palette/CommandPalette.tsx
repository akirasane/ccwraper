import { Search } from 'lucide-react'
import { Dialog as DialogPrimitive } from 'radix-ui'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Kbd } from '@/components/ui'
import { cn } from '@/lib/cn'
import { rankCommands } from '@/lib/commands/registry'
import type { PaletteCommand } from '@/lib/commands/types'
import './palette.css'
import { usePaletteStore } from './palette-store'
import { readRecent, recordRecent } from './recent'
import { useAllCommands } from './sources'

const ROW_H = 36
const PAGE = 8
const LIST_ID = 'ccw-palette-list'
const optId = (i: number): string => `ccw-palette-opt-${i}`

/**
 * Command palette (P4 D7), hand-rolled on the Radix Dialog. Mounted lazily by AppShell; the open
 * state and the Ctrl+K / Ctrl+Shift+P listener live in always-loaded code (palette-store, PaletteTrigger).
 * Sources are collected only while open (PaletteBody mounts on open).
 */
export function CommandPalette(): React.JSX.Element {
  const open = usePaletteStore((s) => s.open)
  const setOpen = usePaletteStore((s) => s.setOpen)
  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="ccw-fade-in fixed inset-0 z-50 bg-scrim" />
        <DialogPrimitive.Content
          data-testid="command-palette"
          aria-describedby={undefined}
          className="ccw-palette overflow-hidden rounded-lg border border-border-glass bg-glass text-fg shadow-lg backdrop-blur-[var(--blur-glass)] backdrop-saturate-[1.4]"
        >
          <DialogPrimitive.Title className="sr-only">Command palette</DialogPrimitive.Title>
          <PaletteBody onClose={() => setOpen(false)} />
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function PaletteBody({ onClose }: { onClose: () => void }): React.JSX.Element {
  const commands = useAllCommands()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => readRecent())
  const listRef = useRef<HTMLDivElement>(null)
  const rowRefs = useRef<Array<HTMLDivElement | null>>([])
  const [pillY, setPillY] = useState<number | null>(null)
  const [still, setStill] = useState(true)

  const rows = useMemo(() => rankCommands(commands, query, recent), [commands, query, recent])
  const count = rows.length
  const activeIdx = count === 0 ? -1 : Math.min(active, count - 1)

  // Selection resets to the top whenever the query changes.
  useEffect(() => setActive(0), [query])

  const run = useCallback(
    (cmd: PaletteCommand): void => {
      if (cmd.disabled) return
      setRecent(recordRecent(cmd.id))
      onClose()
      try {
        const r = cmd.run()
        if (r && typeof (r as Promise<void>).catch === 'function') (r as Promise<void>).catch(() => {})
      } catch {
        /* a failing command must not break the palette */
      }
    },
    [onClose]
  )

  // Move the pill (transform only) and keep the selected row visible.
  useLayoutEffect(() => {
    const el = activeIdx >= 0 ? rowRefs.current[activeIdx] : null
    if (!el) {
      setPillY(null)
      return
    }
    setPillY(el.offsetTop)
    if (activeIdx === 0 && listRef.current) listRef.current.scrollTop = 0 // reveal the first group header
    el.scrollIntoView?.({ block: 'nearest' })
  }, [activeIdx, rows])

  // After the first placement, later moves animate.
  useEffect(() => {
    if (pillY === null) return
    const id = requestAnimationFrame(() => setStill(false))
    return () => cancelAnimationFrame(id)
  }, [pillY === null]) // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    if (e.nativeEvent.isComposing) return
    const move = (to: number): void => {
      if (count === 0) return
      e.preventDefault()
      setActive(to)
    }
    switch (e.key) {
      case 'ArrowDown':
        return move(activeIdx + 1 >= count ? 0 : activeIdx + 1)
      case 'ArrowUp':
        return move(activeIdx <= 0 ? count - 1 : activeIdx - 1)
      case 'PageDown':
        return move(Math.min(count - 1, activeIdx + PAGE))
      case 'PageUp':
        return move(Math.max(0, activeIdx - PAGE))
      case 'Home':
        return move(0)
      case 'End':
        return move(count - 1)
      case 'Enter': {
        e.preventDefault()
        const row = rows[activeIdx]
        if (row) run(row.command)
        return
      }
    }
  }

  // Consecutive rows with the same display group share one header.
  const sections: Array<{ group: string; items: Array<{ idx: number; row: (typeof rows)[number] }> }> = []
  rows.forEach((row, idx) => {
    const last = sections[sections.length - 1]
    if (last && last.group === row.group) last.items.push({ idx, row })
    else sections.push({ group: row.group, items: [{ idx, row }] })
  })

  return (
    <div>
      <div className="flex h-[52px] items-center gap-3 border-b border-border-glass px-4">
        <Search size={16} aria-hidden className="shrink-0 text-fg-3" />
        <input
          autoFocus
          role="combobox"
          aria-label="Search commands"
          aria-expanded
          aria-controls={LIST_ID}
          aria-autocomplete="list"
          aria-activedescendant={activeIdx >= 0 ? optId(activeIdx) : undefined}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type a command, session, project..."
          spellCheck={false}
          autoComplete="off"
          style={{ boxShadow: 'none' }}
          className="h-full min-w-0 flex-1 bg-transparent text-md text-fg outline-none placeholder:text-fg-3"
        />
        <Kbd>Esc</Kbd>
      </div>
      <div
        ref={listRef}
        id={LIST_ID}
        role="listbox"
        aria-label="Commands"
        className="ccw-palette-list relative overflow-y-auto p-1.5"
      >
        {pillY !== null && (
          <div
            aria-hidden
            data-testid="palette-pill"
            data-still={still}
            className="ccw-palette-pill pointer-events-none absolute left-1.5 right-1.5 top-0 rounded-sm bg-bg-3"
            style={{ height: ROW_H, transform: `translateY(${pillY}px)` }}
          />
        )}
        {count === 0 && <div className="px-3 py-6 text-center text-base text-fg-3">No matching commands</div>}
        {sections.map((sec, si) => (
          <div key={`${sec.group}-${si}`} role="group" aria-label={sec.group}>
            <div
              aria-hidden
              className="flex h-7 items-center px-3 text-xs font-medium uppercase tracking-wider text-fg-3"
            >
              {sec.group}
            </div>
            {sec.items.map(({ idx, row }) => {
              const c = row.command
              const Icon = c.icon
              return (
                <div
                  key={row.key}
                  id={optId(idx)}
                  ref={(el) => {
                    rowRefs.current[idx] = el
                  }}
                  role="option"
                  aria-selected={idx === activeIdx}
                  aria-disabled={c.disabled || undefined}
                  data-testid="palette-option"
                  onMouseMove={() => idx !== activeIdx && setActive(idx)}
                  onClick={() => run(c)}
                  style={{ height: ROW_H }}
                  className={cn(
                    'relative flex cursor-pointer items-center gap-3 rounded-sm px-3 text-base',
                    c.disabled ? 'text-fg-muted' : idx === activeIdx ? 'text-fg' : 'text-fg-2'
                  )}
                >
                  {Icon && <Icon size={15} aria-hidden className="shrink-0 text-fg-3" />}
                  <span className="min-w-0 truncate">{c.title}</span>
                  {c.subtitle && <span className="min-w-0 flex-1 truncate text-sm text-fg-3">{c.subtitle}</span>}
                  {!c.subtitle && <span className="flex-1" />}
                  {c.shortcut && (
                    <span className="flex shrink-0 gap-1">
                      {c.shortcut.map((k) => (
                        <Kbd key={k}>{k}</Kbd>
                      ))}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}
