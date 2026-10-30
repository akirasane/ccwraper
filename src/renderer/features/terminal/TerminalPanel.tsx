import { ChevronDown, Copy, Eraser, Plus, Power, Search, Terminal as TerminalIcon, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ShellProfile } from '@shared/config'
import { cn } from '@/lib/cn'
import { onRunInTerminal, type RunInTerminalRequest } from '@/lib/terminal-bus'
import { SearchOverlay } from './SearchOverlay'
import { useTerminalStore, type TerminalTab } from './terminal-store'
import { TerminalView, type TerminalHandle } from './TerminalView'
import { clampPanelHeight, maxPanelHeight, PANEL_MIN_HEIGHT } from './theme'

const iconBtn =
  'inline-flex size-6 shrink-0 items-center justify-center rounded-xs text-fg-3 transition-colors duration-fast hover:bg-bg-3 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--accent-ring)] disabled:pointer-events-none disabled:opacity-40'

function pickShell(shells: ShellProfile[], preferred: string | undefined): ShellProfile | undefined {
  return (
    shells.find((s) => s.id === preferred) ?? shells.find((s) => s.isDefault) ?? shells[0]
  )
}

function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

export function TerminalPanel({ cwd, onClose }: { cwd?: string; onClose: () => void }): React.JSX.Element {
  const tabs = useTerminalStore((s) => s.tabs)
  const activeId = useTerminalStore((s) => s.activeId)
  const height = useTerminalStore((s) => s.height)
  const defaultShell = useTerminalStore((s) => s.defaultShell)

  const rootRef = useRef<HTMLElement>(null)
  const handles = useRef(new Map<string, TerminalHandle>())
  const shellsRef = useRef<Promise<ShellProfile[]>>(Promise.resolve([]))
  const autoOpened = useRef(false)
  const cwdRef = useRef(cwd)
  cwdRef.current = cwd

  const [shells, setShells] = useState<ShellProfile[]>([])
  const [menuOpen, setMenuOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const [, setViewportTick] = useState(0)
  const [search, setSearch] = useState({ open: false, query: '', index: -1, count: -1 })
  const searchRef = useRef(search)
  searchRef.current = search

  const active = tabs.find((t) => t.id === activeId)
  const effectiveHeight = clampPanelHeight(height, window.innerHeight)

  // Shell list (once). Run-in-terminal waits on the same promise.
  useEffect(() => {
    const p = Promise.resolve(window.ccwrap.pty?.listShells?.() ?? []).catch(() => [] as ShellProfile[])
    shellsRef.current = p
    let live = true
    void p.then((list) => {
      if (!live) return
      setShells(list)
      // First open: one tab with the default shell, once.
      const dir = cwdRef.current
      if (!autoOpened.current && dir && useTerminalStore.getState().tabs.length === 0) {
        const sh = pickShell(list, useTerminalStore.getState().defaultShell)
        if (sh) {
          autoOpened.current = true
          useTerminalStore.getState().addTab({ shellId: sh.id, label: sh.label, cwd: dir })
        }
      }
    })
    return () => {
      live = false
    }
  }, [])

  const openTab = useCallback((sh: ShellProfile, dir: string | undefined = cwdRef.current, pendingInput?: string) => {
    if (!dir) return undefined
    autoOpened.current = true
    return useTerminalStore.getState().addTab({ shellId: sh.id, label: sh.label, cwd: dir, pendingInput })
  }, [])

  // Chat -> terminal: type the command (no Enter) into a Git Bash tab, else the active tab.
  useEffect(() => {
    return onRunInTerminal((req: RunInTerminalRequest) => {
      autoOpened.current = true // a run request replaces the automatic first tab
      void shellsRef.current.then((list) => {
        const st = useTerminalStore.getState()
        const alive = (t: TerminalTab): boolean => t.exitCode === undefined
        const bash = st.tabs.find((t) => t.shellId === 'gitbash' && alive(t))
        const fallbackTab = st.tabs.find((t) => t.id === st.activeId && alive(t))
        const target = bash ?? (list.some((s) => s.id === 'gitbash') ? undefined : fallbackTab)
        if (target) {
          st.setActive(target.id)
          st.setPendingInput(target.id, req.command)
          return
        }
        const sh = list.find((s) => s.id === 'gitbash') ?? pickShell(list, st.defaultShell)
        if (sh) openTab(sh, req.cwd, req.command)
      })
    })
  }, [openTab])

  // Show animation (transform + opacity) and refit/focus when the slot goes display:none -> shown.
  useEffect(() => {
    const root = rootRef.current
    if (!root) return
    const play = (): void => {
      if (prefersReducedMotion() || typeof root.animate !== 'function') return
      root.animate(
        [
          { transform: 'translateY(40px)', opacity: 0 },
          { transform: 'translateY(0)', opacity: 1 }
        ],
        { duration: 250, easing: 'cubic-bezier(0.22, 1, 0.36, 1)' }
      )
    }
    let wasHidden = root.offsetHeight === 0
    if (!wasHidden) play()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => {
      const hidden = root.offsetHeight === 0
      if (wasHidden && !hidden) {
        play()
        const id = useTerminalStore.getState().activeId
        if (id) requestAnimationFrame(() => handles.current.get(id)?.focus())
      }
      wasHidden = hidden
    })
    ro.observe(root)
    return () => ro.disconnect()
  }, [])

  // Keep the height inside the clamp when the window resizes.
  useEffect(() => {
    const on = (): void => setViewportTick((n) => n + 1)
    window.addEventListener('resize', on)
    return () => window.removeEventListener('resize', on)
  }, [])

  // Outside click / Esc closes the "+" menu.
  useEffect(() => {
    if (!menuOpen) return
    const close = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return
      if (e instanceof MouseEvent && (e.target as Element | null)?.closest('[data-shell-menu]')) return
      setMenuOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [menuOpen])

  const activeHandle = (): TerminalHandle | undefined => (activeId ? handles.current.get(activeId) : undefined)

  // ---- find ----
  const openSearch = useCallback(() => setSearch((s) => ({ ...s, open: true })), [])
  const closeSearch = useCallback(() => {
    const id = useTerminalStore.getState().activeId
    const h = id ? handles.current.get(id) : undefined
    h?.clearSearch()
    setSearch({ open: false, query: '', index: -1, count: -1 })
    h?.focus()
  }, [])
  const runFind = (q: string, dir: 'next' | 'prev' | 'incremental'): void => {
    const h = activeHandle()
    if (!h) return
    if (q === '') {
      h.clearSearch()
      setSearch((s) => ({ ...s, query: q, index: -1, count: -1 }))
      return
    }
    if (dir === 'prev') h.findPrevious(q)
    else h.findNext(q, dir === 'incremental')
  }
  // Close the overlay when the active tab changes.
  const prevActive = useRef(activeId)
  useEffect(() => {
    if (prevActive.current !== activeId) {
      if (prevActive.current) handles.current.get(prevActive.current)?.clearSearch()
      prevActive.current = activeId
      if (searchRef.current.open) setSearch({ open: false, query: '', index: -1, count: -1 })
    }
  }, [activeId])

  // ---- drag resize ----
  const dragRef = useRef<{ startY: number; startH: number } | null>(null)
  const onDragStart = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = { startY: e.clientY, startH: effectiveHeight }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onDragMove = (e: React.PointerEvent<HTMLDivElement>): void => {
    const d = dragRef.current
    if (!d) return
    useTerminalStore.getState().setHeight(d.startH + (d.startY - e.clientY))
  }
  const onDragEnd = (e: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  const copySelection = async (): Promise<void> => {
    const ok = await activeHandle()?.copy()
    if (ok) {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
  }

  const exited = active?.exitCode !== undefined
  const defaultProfile = pickShell(shells, defaultShell)

  return (
    <section
      ref={rootRef}
      className="relative flex shrink-0 flex-col border-t border-border bg-bg-1"
      style={{ height: effectiveHeight }}
      data-testid="terminal-panel"
      aria-label="Terminal"
      onKeyDown={(e) => {
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
          e.preventDefault()
          openSearch()
        }
      }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        aria-valuemin={PANEL_MIN_HEIGHT}
        aria-valuemax={maxPanelHeight(window.innerHeight)}
        aria-valuenow={effectiveHeight}
        tabIndex={0}
        data-testid="terminal-resize-handle"
        className="absolute inset-x-0 -top-1 z-20 h-2 cursor-row-resize touch-none hover:bg-accent-tint focus-visible:outline-none focus-visible:shadow-[var(--accent-ring)]"
        onPointerDown={onDragStart}
        onPointerMove={onDragMove}
        onPointerUp={onDragEnd}
        onPointerCancel={onDragEnd}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp') {
            e.preventDefault()
            useTerminalStore.getState().setHeight(effectiveHeight + 24)
          } else if (e.key === 'ArrowDown') {
            e.preventDefault()
            useTerminalStore.getState().setHeight(effectiveHeight - 24)
          }
        }}
      />

      <header className="relative z-10 flex h-9 shrink-0 items-center gap-1 border-b border-border-glass bg-glass px-2 backdrop-blur-[var(--blur-glass)]">
        <div role="tablist" aria-label="Terminal tabs" className="flex min-w-0 items-center gap-0.5 overflow-x-auto">
          {tabs.map((t) => {
            const isActive = t.id === activeId
            const ended = t.exitCode !== undefined
            return (
              <div
                key={t.id}
                className={cn(
                  'group flex h-7 shrink-0 items-center gap-1 rounded-xs pl-2 pr-1 text-sm transition-colors duration-fast',
                  isActive ? 'bg-bg-3 text-fg' : 'text-fg-3 hover:bg-bg-2 hover:text-fg-2'
                )}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-exited={ended ? 'true' : undefined}
                  title={ended ? `${t.label} (${t.killed ? 'killed' : `exited ${t.exitCode}`})` : t.label}
                  onClick={() => useTerminalStore.getState().setActive(t.id)}
                  className="flex items-center gap-1.5 focus-visible:outline-none focus-visible:shadow-[var(--accent-ring)]"
                >
                  <TerminalIcon size={13} aria-hidden />
                  <span className={cn(ended && 'text-fg-muted line-through decoration-fg-muted')}>{t.label}</span>
                  {ended && <span className="text-2xs text-fg-3">{t.killed ? 'killed' : `exit ${t.exitCode}`}</span>}
                </button>
                <button
                  type="button"
                  aria-label={`Close ${t.label} tab`}
                  className={iconBtn}
                  onClick={() => useTerminalStore.getState().closeTab(t.id)}
                >
                  <X size={12} />
                </button>
              </div>
            )
          })}
        </div>

        <div className="relative flex items-center" data-shell-menu>
          <button
            type="button"
            aria-label="New terminal"
            title={cwd ? 'New terminal' : 'Select a project first'}
            disabled={!cwd || !defaultProfile}
            className={iconBtn}
            onClick={() => defaultProfile && openTab(defaultProfile)}
          >
            <Plus size={14} />
          </button>
          <button
            type="button"
            aria-label="Choose shell"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            disabled={!cwd || shells.length === 0}
            className={cn(iconBtn, 'w-4')}
            onClick={() => setMenuOpen((o) => !o)}
          >
            <ChevronDown size={12} />
          </button>
          {menuOpen && (
            <div
              role="menu"
              className="absolute left-0 top-8 z-30 min-w-44 rounded-sm border border-border-glass bg-glass-strong p-1 shadow-md backdrop-blur-[var(--blur-glass)]"
            >
              {shells.map((sh) => (
                <button
                  key={sh.id}
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    useTerminalStore.getState().setDefaultShell(sh.id)
                    setMenuOpen(false)
                    openTab(sh)
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xs px-2 py-1.5 text-left text-sm text-fg-2 hover:bg-bg-3 hover:text-fg focus-visible:outline-none focus-visible:bg-bg-3"
                >
                  <span>{sh.label}</span>
                  {sh.id === defaultProfile?.id && <span className="text-2xs text-fg-3">default</span>}
                </button>
              ))}
            </div>
          )}
        </div>

        <span className="ml-2 min-w-0 flex-1 truncate font-mono text-xs text-fg-3" title={cwd}>
          {cwd ?? 'No project'}
        </span>

        <span aria-live="polite" className="text-xs text-ok">
          {copied ? 'Copied' : ''}
        </span>
        <button type="button" aria-label="Find in terminal" title="Find (Ctrl+F)" className={iconBtn} disabled={!active} onClick={openSearch}>
          <Search size={14} />
        </button>
        <button type="button" aria-label="Clear terminal" title="Clear" className={iconBtn} disabled={!active} onClick={() => activeHandle()?.clear()}>
          <Eraser size={14} />
        </button>
        <button type="button" aria-label="Copy selection" title="Copy selection" className={iconBtn} disabled={!active} onClick={() => void copySelection()}>
          <Copy size={14} />
        </button>
        <button type="button" aria-label="Kill process" title="Kill process" className={iconBtn} disabled={!active || exited} onClick={() => activeHandle()?.kill()}>
          <Power size={14} />
        </button>
        <button type="button" aria-label="Close terminal" title="Close panel (Ctrl+`)" className={iconBtn} onClick={onClose}>
          <X size={14} />
        </button>
      </header>

      <div className="relative min-h-0 flex-1 bg-bg-1">
        {tabs.map((t) => (
          <TerminalView
            key={t.id}
            tab={t}
            active={t.id === activeId}
            ref={(h) => {
              if (h) handles.current.set(t.id, h)
              else handles.current.delete(t.id)
            }}
            onRequestFind={openSearch}
            onSearchResults={(id, r) => {
              if (id === useTerminalStore.getState().activeId)
                setSearch((s) => ({ ...s, index: r.resultIndex, count: r.resultCount }))
            }}
          />
        ))}
        {tabs.length === 0 && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-fg-3">
            <span>{cwd ? 'No terminal open' : 'Select a project to open a terminal'}</span>
            {cwd && defaultProfile && (
              <button
                type="button"
                className="rounded-sm border border-border-strong px-3 py-1 text-fg-2 hover:bg-bg-3 hover:text-fg focus-visible:outline-none focus-visible:shadow-[var(--accent-ring)]"
                onClick={() => openTab(defaultProfile)}
              >
                New {defaultProfile.label} terminal
              </button>
            )}
          </div>
        )}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 z-[5] h-4"
          style={{ background: 'linear-gradient(to bottom, var(--bg-1), transparent)' }}
        />
        {search.open && (
          <SearchOverlay
            query={search.query}
            resultIndex={search.index}
            resultCount={search.count}
            onQueryChange={(q) => {
              setSearch((s) => ({ ...s, query: q }))
              runFind(q, 'incremental')
            }}
            onNext={() => runFind(search.query, 'next')}
            onPrev={() => runFind(search.query, 'prev')}
            onClose={closeSearch}
          />
        )}
      </div>
    </section>
  )
}
