import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebglAddon } from '@xterm/addon-webgl'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from 'react'
import type { PtyDataPayload } from '@shared/config'
import { cn } from '@/lib/cn'
import { useTerminalStore, type TerminalTab } from './terminal-store'
import { SEARCH_DECORATIONS, TERMINAL_FONT_LOAD, TERMINAL_OPTIONS } from './theme'

export interface TerminalHandle {
  clear(): void
  /** Copies the current selection; resolves false when nothing is selected. */
  copy(): Promise<boolean>
  hasSelection(): boolean
  focus(): void
  findNext(query: string, incremental?: boolean): boolean
  findPrevious(query: string): boolean
  clearSearch(): void
  /** Closes the pty now (tab stays, shows the killed state). */
  kill(): void
  refit(): void
}

export interface TerminalViewProps {
  tab: TerminalTab
  active: boolean
  onSearchResults?: (tabId: string, r: { resultIndex: number; resultCount: number }) => void
  onRequestFind?: () => void
  /** Reports which renderer is active, for the WP11 check. Never carries terminal content. */
  onRenderer?: (kind: 'webgl' | 'dom') => void
}

const RESIZE_DEBOUNCE_MS = 50

async function loadFont(): Promise<void> {
  try {
    await document.fonts?.load(TERMINAL_FONT_LOAD)
  } catch {
    /* fall back to the stack's next family */
  }
}

export const TerminalView = forwardRef<TerminalHandle, TerminalViewProps>(function TerminalView(
  { tab, active, onSearchResults, onRequestFind, onRenderer },
  ref
) {
  const hostRef = useRef<HTMLDivElement>(null)
  const glowRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const searchRef = useRef<SearchAddon | null>(null)
  const ptyIdRef = useRef<string | undefined>(undefined)
  const closedRef = useRef(false)
  const lastSizeRef = useRef({ cols: 0, rows: 0 })
  const cbRef = useRef({ onSearchResults, onRequestFind, onRenderer })
  cbRef.current = { onSearchResults, onRequestFind, onRenderer }

  const refit = useCallback(() => {
    const term = termRef.current
    const host = hostRef.current
    if (!term || !host || host.offsetWidth === 0 || host.offsetHeight === 0) return // hidden (display:none slot)
    try {
      fitRef.current?.fit()
    } catch {
      return
    }
    const { cols, rows } = term
    if (cols === lastSizeRef.current.cols && rows === lastSizeRef.current.rows) return
    lastSizeRef.current = { cols, rows }
    if (ptyIdRef.current && !closedRef.current) window.ccwrap.pty.resize(ptyIdRef.current, cols, rows)
  }, [])

  const killPty = useCallback(() => {
    if (closedRef.current) return
    closedRef.current = true
    const id = ptyIdRef.current
    if (id) void Promise.resolve(window.ccwrap.pty.close(id)).catch(() => {})
  }, [])

  useImperativeHandle(
    ref,
    () => ({
      clear: () => termRef.current?.clear(),
      hasSelection: () => termRef.current?.hasSelection() ?? false,
      copy: async () => {
        const text = termRef.current?.getSelection() ?? ''
        if (!text) return false
        try {
          await navigator.clipboard.writeText(text)
          return true
        } catch {
          return false
        }
      },
      focus: () => termRef.current?.focus(),
      findNext: (q, incremental) =>
        searchRef.current?.findNext(q, { decorations: SEARCH_DECORATIONS, incremental }) ?? false,
      findPrevious: (q) => searchRef.current?.findPrevious(q, { decorations: SEARCH_DECORATIONS }) ?? false,
      clearSearch: () => searchRef.current?.clearDecorations(),
      kill: () => {
        if (closedRef.current) return
        killPty()
        const store = useTerminalStore.getState()
        termRef.current?.write('\r\n\x1b[2m[process killed]\x1b[0m\r\n')
        store.markExited(tab.id, -1, true)
      },
      refit
    }),
    [killPty, refit, tab.id]
  )

  // Create xterm + pty once per tab. The pty lives until the tab closes (this view unmounts).
  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    const disposers: Array<() => void> = []
    closedRef.current = false

    const run = async (): Promise<void> => {
      await loadFont()
      if (cancelled) return

      const term = new Terminal(TERMINAL_OPTIONS)
      termRef.current = term
      const fit = new FitAddon()
      const search = new SearchAddon()
      fitRef.current = fit
      searchRef.current = search
      term.loadAddon(fit)
      term.loadAddon(search)
      term.loadAddon(new WebLinksAddon())
      term.loadAddon(new Unicode11Addon())
      term.unicode.activeVersion = '11'
      term.open(host)

      // WebGL after open(); on failure or context loss stay on the DOM renderer (xterm 6 has no canvas).
      try {
        const webgl = new WebglAddon()
        webgl.onContextLoss(() => {
          webgl.dispose()
          cbRef.current.onRenderer?.('dom')
        })
        term.loadAddon(webgl)
        cbRef.current.onRenderer?.('webgl')
      } catch {
        cbRef.current.onRenderer?.('dom')
      }

      const sr = search.onDidChangeResults((r) => cbRef.current.onSearchResults?.(tab.id, r))
      disposers.push(() => sr.dispose())

      term.attachCustomKeyEventHandler((e) => {
        if (e.type !== 'keydown') return true
        if (e.ctrlKey && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'f') {
          cbRef.current.onRequestFind?.()
          return false
        }
        if (e.ctrlKey && !e.altKey && e.code === 'Backquote') return false // shell toggles the panel
        const copyKey = (e.ctrlKey && e.shiftKey && e.code === 'KeyC') || (e.ctrlKey && !e.shiftKey && e.key === 'c')
        if (copyKey && term.hasSelection()) {
          void navigator.clipboard?.writeText(term.getSelection()).catch(() => {})
          return false
        }
        return true
      })

      // Cursor glow overlay follows the cursor with transform only.
      const placeGlow = (): void => {
        const glow = glowRef.current
        const screen = host.querySelector<HTMLElement>('.xterm-screen')
        if (!glow || !screen || term.cols === 0) return
        const cw = screen.clientWidth / term.cols
        const ch = screen.clientHeight / term.rows
        const b = term.buffer.active
        glow.style.width = `${cw}px`
        glow.style.height = `${ch}px`
        glow.style.transform = `translate(${screen.offsetLeft + b.cursorX * cw}px, ${screen.offsetTop + b.cursorY * ch}px)`
      }
      const cm = term.onCursorMove?.(placeGlow)
      if (cm) disposers.push(() => cm.dispose())

      // Fit before opening the pty so it starts at the right size (fallback 80x24 while hidden).
      try {
        if (host.offsetWidth > 0) fit.fit()
      } catch {
        /* keep defaults */
      }
      const cols = term.cols >= 2 ? term.cols : 80
      const rows = term.rows >= 2 ? term.rows : 24
      lastSizeRef.current = { cols, rows }

      // pty events can arrive before open() resolves; queue them until we know our id.
      let myId: string | undefined
      const early: PtyDataPayload[] = []
      let chunks: string[] = []
      let raf = 0
      const flush = (): void => {
        raf = 0
        if (chunks.length === 0) return
        const data = chunks.join('')
        chunks = []
        term.write(data)
      }
      const push = (data: string): void => {
        chunks.push(data)
        if (!raf) raf = requestAnimationFrame(flush)
      }
      disposers.push(() => {
        if (raf) cancelAnimationFrame(raf)
      })

      const offData = window.ccwrap.pty.onData((p) => {
        if (myId === undefined) early.push(p)
        else if (p.ptyId === myId) push(p.data)
      })
      const offExit = window.ccwrap.pty.onExit((p) => {
        if (p.ptyId !== ptyIdRef.current) return
        flush()
        closedRef.current = true
        term.write(`\r\n\x1b[2m[process exited ${p.exitCode}]\x1b[0m\r\n`)
        useTerminalStore.getState().markExited(tab.id, p.exitCode)
      })
      disposers.push(offData, offExit)

      const input = term.onData((d) => {
        if (ptyIdRef.current && !closedRef.current) window.ccwrap.pty.write(ptyIdRef.current, d)
      })
      disposers.push(() => input.dispose())

      try {
        const res = await window.ccwrap.pty.open({ shellId: tab.shellId, cwd: tab.cwd, cols, rows })
        if (cancelled) {
          void Promise.resolve(window.ccwrap.pty.close(res.ptyId)).catch(() => {})
          return
        }
        myId = res.ptyId
        ptyIdRef.current = res.ptyId
        useTerminalStore.getState().setPty(tab.id, res.ptyId)
        for (const p of early) if (p.ptyId === myId) push(p.data)
        early.length = 0
        refit()
      } catch (err) {
        if (cancelled) return
        closedRef.current = true
        const msg = err instanceof Error ? err.message : 'unknown error'
        term.write(`\x1b[31m[failed to start shell: ${msg}]\x1b[0m\r\n`)
        useTerminalStore.getState().markExited(tab.id, -1)
      }
    }
    void run()

    return () => {
      cancelled = true
      killPty()
      for (const d of disposers) d()
      fitRef.current = null
      searchRef.current = null
      const term = termRef.current
      termRef.current = null
      try {
        term?.dispose()
      } catch {
        /* already disposed */
      }
    }
    // The tab identity (id/shell/cwd) is fixed for the life of the view.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id])

  // Refit when the host changes size, including display:none -> shown (AppShell terminal slot). Debounced 50 ms.
  useEffect(() => {
    const host = hostRef.current
    if (!host || typeof ResizeObserver === 'undefined') return
    let timer: ReturnType<typeof setTimeout> | undefined
    const ro = new ResizeObserver(() => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(refit, RESIZE_DEBOUNCE_MS)
    })
    ro.observe(host)
    return () => {
      if (timer) clearTimeout(timer)
      ro.disconnect()
    }
  }, [refit])

  // Becoming the active tab: refit (it may have been hidden) and focus.
  useEffect(() => {
    if (!active) return
    const id = requestAnimationFrame(() => {
      refit()
      termRef.current?.focus()
    })
    return () => cancelAnimationFrame(id)
  }, [active, refit])

  // Run-in-terminal: type the text into the pty WITHOUT a carriage return.
  useEffect(() => {
    const text = tab.pendingInput
    if (!text || !tab.ptyId || closedRef.current) return
    const trimmed = text.replace(/[\r\n]+$/, '')
    if (/[\r\n]/.test(trimmed)) termRef.current?.paste(trimmed) // bracketed paste where supported
    else window.ccwrap.pty.write(tab.ptyId, trimmed)
    useTerminalStore.getState().consumeInput(tab.id)
    termRef.current?.focus()
  }, [tab.pendingInput, tab.ptyId, tab.id])

  return (
    <div
      className={cn('absolute inset-0', active ? 'visible' : 'invisible pointer-events-none')}
      data-testid={`terminal-view-${tab.id}`}
      aria-hidden={!active}
    >
      <div ref={hostRef} className="absolute inset-0 px-3 pt-2" />
      <div
        ref={glowRef}
        aria-hidden
        className="pointer-events-none absolute left-0 top-0 rounded-xs opacity-60"
        style={{ boxShadow: '0 0 10px var(--term-cursor)' }}
      />
    </div>
  )
})
