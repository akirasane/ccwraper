import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { requestRunInTerminal, resetTerminalBus } from '@/lib/terminal-bus'
import { useTerminalStore } from './terminal-store'
import { TerminalPanel } from './TerminalPanel'

const h = vi.hoisted(() => {
  interface FakeTerm {
    writes: string[]
    cols: number
    rows: number
    disposed: boolean
    dataCb?: (d: string) => void
    selection: string
    clear: ReturnType<typeof import('vitest').vi.fn>
  }
  return { terms: [] as FakeTerm[], searchCalls: [] as string[], resultsCb: undefined as undefined | ((r: { resultIndex: number; resultCount: number }) => void), webglFails: false }
})

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    writes: string[] = []
    cols = 100
    rows = 30
    disposed = false
    selection = ''
    unicode = { activeVersion: '6' }
    options: unknown
    dataCb?: (d: string) => void
    constructor(opts: unknown) {
      this.options = opts
      h.terms.push(this as never)
    }
    loadAddon(): void {}
    open(): void {}
    write(d: string): void {
      this.writes.push(d)
    }
    paste(d: string): void {
      this.writes.push(`PASTE:${d}`)
    }
    clear = vi.fn()
    focus = vi.fn()
    hasSelection(): boolean {
      return this.selection !== ''
    }
    getSelection(): string {
      return this.selection
    }
    onData(cb: (d: string) => void): { dispose(): void } {
      this.dataCb = cb
      return { dispose() {} }
    }
    onCursorMove(): { dispose(): void } {
      return { dispose() {} }
    }
    attachCustomKeyEventHandler(): void {}
    dispose(): void {
      this.disposed = true
    }
  }
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit(): void {} } }))
vi.mock('@xterm/addon-web-links', () => ({ WebLinksAddon: class {} }))
vi.mock('@xterm/addon-unicode11', () => ({ Unicode11Addon: class {} }))
vi.mock('@xterm/addon-webgl', () => ({
  WebglAddon: class {
    constructor() {
      if (h.webglFails) throw new Error('no webgl')
    }
    onContextLoss(): void {}
    dispose(): void {}
  }
}))
vi.mock('@xterm/addon-search', () => ({
  SearchAddon: class {
    findNext(q: string): boolean {
      h.searchCalls.push(`next:${q}`)
      return true
    }
    findPrevious(q: string): boolean {
      h.searchCalls.push(`prev:${q}`)
      return true
    }
    clearDecorations(): void {
      h.searchCalls.push('clear')
    }
    onDidChangeResults(cb: (r: { resultIndex: number; resultCount: number }) => void): { dispose(): void } {
      h.resultsCb = cb
      return { dispose() {} }
    }
  }
}))

const shells = [
  { id: 'pwsh', label: 'PowerShell 7', path: 'C:\\pwsh.exe', isDefault: true },
  { id: 'gitbash', label: 'Git Bash', path: 'C:\\bash.exe' }
]

let onData: (p: { ptyId: string; data: string }) => void
let onExit: (p: { ptyId: string; exitCode: number }) => void
let api: ReturnType<typeof makeApi>
let n = 0

function makeApi() {
  return {
    pty: {
      listShells: vi.fn(async () => shells),
      open: vi.fn(async (a: { shellId: string }) => ({ ptyId: `p${++n}`, pid: 1, shellId: a.shellId })),
      write: vi.fn(),
      resize: vi.fn(),
      close: vi.fn(async () => {}),
      onData: vi.fn((cb: typeof onData) => {
        onData = cb
        return () => {}
      }),
      onExit: vi.fn((cb: typeof onExit) => {
        onExit = cb
        return () => {}
      })
    }
  }
}

beforeEach(() => {
  h.terms.length = 0
  h.searchCalls.length = 0
  h.webglFails = false
  n = 0
  useTerminalStore.getState().reset()
  resetTerminalBus()
  api = makeApi()
  ;(window as unknown as { ccwrap: unknown }).ccwrap = api
  // jsdom: elements have no layout; pretend visible so refit proceeds.
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', { configurable: true, get: () => 800 })
  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', { configurable: true, get: () => 300 })
})
afterEach(() => {
  cleanup() // unmount (closes ptys) while the mocked api is still installed
})

async function mount(cwd: string | undefined = 'C:\\proj') {
  const onClose = vi.fn()
  const utils = render(<TerminalPanel cwd={cwd} onClose={onClose} />)
  if (cwd) await waitFor(() => expect(api.pty.open).toHaveBeenCalledTimes(1))
  return { ...utils, onClose }
}

describe('TerminalPanel', () => {
  it('opens the default shell in the project cwd', async () => {
    await mount()
    expect(api.pty.open).toHaveBeenCalledWith({ shellId: 'pwsh', cwd: 'C:\\proj', cols: 100, rows: 30 })
    expect(screen.getByRole('tab', { name: /PowerShell 7/ })).toHaveAttribute('aria-selected', 'true')
  })

  it('does not open a pty without a project', async () => {
    await mount('')
    await act(async () => {})
    expect(api.pty.open).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'New terminal' })).toBeDisabled()
  })

  it('opening and closing tabs call pty.open / pty.close; only the tab close kills the pty', async () => {
    const user = userEvent.setup()
    await mount()
    await user.click(screen.getByRole('button', { name: 'Choose shell' }))
    await user.click(screen.getByRole('menuitem', { name: /Git Bash/ }))
    await waitFor(() => expect(api.pty.open).toHaveBeenCalledTimes(2))
    expect(api.pty.open.mock.calls[1]![0]).toMatchObject({ shellId: 'gitbash', cwd: 'C:\\proj' })
    expect(api.pty.close).not.toHaveBeenCalled()

    await user.click(screen.getByRole('button', { name: 'Close Git Bash tab' }))
    await waitFor(() => expect(api.pty.close).toHaveBeenCalledWith('p2'))
    expect(screen.queryByRole('tab', { name: /Git Bash/ })).toBeNull()
    expect(h.terms[1]!.disposed).toBe(true)
  })

  it('closing the panel (hide) does not close ptys', async () => {
    const user = userEvent.setup()
    const { onClose } = await mount()
    await user.click(screen.getByRole('button', { name: 'Close terminal' }))
    expect(onClose).toHaveBeenCalled()
    expect(api.pty.close).not.toHaveBeenCalled()
  })

  it('routes pty data to xterm (batched per frame) and keystrokes to pty.write', async () => {
    await mount()
    await waitFor(() => expect(useTerminalStore.getState().tabs[0]?.ptyId).toBe('p1'))
    act(() => {
      onData({ ptyId: 'p1', data: 'a' })
      onData({ ptyId: 'p1', data: 'b' })
      onData({ ptyId: 'other', data: 'zzz' })
    })
    await waitFor(() => expect(h.terms[0]!.writes).toContain('ab'))
    expect(h.terms[0]!.writes.join('')).not.toContain('zzz')
    h.terms[0]!.dataCb?.('ls')
    expect(api.pty.write).toHaveBeenCalledWith('p1', 'ls')
  })

  it('an exit shows [process exited N] and the tab state', async () => {
    await mount()
    await waitFor(() => expect(useTerminalStore.getState().tabs[0]?.ptyId).toBe('p1'))
    act(() => onExit({ ptyId: 'p1', exitCode: 3 }))
    expect(h.terms[0]!.writes.join('')).toContain('[process exited 3]')
    expect(screen.getByRole('tab', { name: /PowerShell 7/ })).toHaveAttribute('data-exited', 'true')
    expect(screen.getByText('exit 3')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Kill process' })).toBeDisabled()
  })

  it('kill closes the pty and marks the tab', async () => {
    const user = userEvent.setup()
    await mount()
    await waitFor(() => expect(useTerminalStore.getState().tabs[0]?.ptyId).toBe('p1'))
    await user.click(screen.getByRole('button', { name: 'Kill process' }))
    expect(api.pty.close).toHaveBeenCalledWith('p1')
    expect(useTerminalStore.getState().tabs[0]).toMatchObject({ exitCode: -1, killed: true })
  })

  it('run-in-terminal types the command into a Git Bash tab WITHOUT a newline', async () => {
    await mount()
    await waitFor(() => expect(useTerminalStore.getState().tabs[0]?.ptyId).toBe('p1'))
    act(() => requestRunInTerminal({ cwd: 'C:\\proj', command: 'npm test\n' }))
    await waitFor(() => expect(api.pty.open).toHaveBeenCalledTimes(2))
    expect(api.pty.open.mock.calls[1]![0]).toMatchObject({ shellId: 'gitbash' })
    await waitFor(() => expect(api.pty.write).toHaveBeenCalledWith('p2', 'npm test'))
    const typed = api.pty.write.mock.calls.map((c) => c[1] as string)
    expect(typed.some((t) => /[\r\n]/.test(t))).toBe(false)
    // second request reuses the bash tab
    act(() => requestRunInTerminal({ cwd: 'C:\\proj', command: 'git status' }))
    await waitFor(() => expect(api.pty.write).toHaveBeenCalledWith('p2', 'git status'))
    expect(api.pty.open).toHaveBeenCalledTimes(2)
  })

  it('a request that arrives before the panel mounts is delivered on mount', async () => {
    requestRunInTerminal({ cwd: 'C:\\proj', command: 'echo hi' })
    render(<TerminalPanel cwd="C:\\proj" onClose={() => {}} />)
    await waitFor(() => expect(api.pty.write).toHaveBeenCalledWith('p1', 'echo hi'))
    expect(api.pty.open).toHaveBeenCalledTimes(1)
  })

  it('Ctrl+F opens the search overlay; typing searches, Enter/Shift+Enter step, Esc closes', async () => {
    const user = userEvent.setup()
    await mount()
    fireEvent.keyDown(screen.getByTestId('terminal-panel'), { key: 'f', ctrlKey: true })
    const input = await screen.findByRole('textbox', { name: 'Find' })
    await user.type(input, 'err')
    expect(h.searchCalls).toContain('next:err')
    act(() => h.resultsCb?.({ resultIndex: 1, resultCount: 4 }))
    expect(screen.getByTestId('search-count')).toHaveTextContent('2 of 4')
    await user.type(input, '{Enter}')
    await user.type(input, '{Shift>}{Enter}{/Shift}')
    expect(h.searchCalls).toContain('prev:err')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('search')).toBeNull()
    expect(h.searchCalls).toContain('clear')
  })

  it('copy writes the selection to the clipboard; clear clears', async () => {
    const user = userEvent.setup()
    await mount()
    const writeText = vi.fn(async () => {})
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } })
    h.terms[0]!.selection = 'picked'
    await user.click(screen.getByRole('button', { name: 'Copy selection' }))
    expect(writeText).toHaveBeenCalledWith('picked')
    await user.click(screen.getByRole('button', { name: 'Clear terminal' }))
    expect(h.terms[0]!.clear).toHaveBeenCalled()
  })

  it('drag resize clamps to 120px .. 70vh and persists', async () => {
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 1000 })
    await mount()
    const handle = screen.getByTestId('terminal-resize-handle')
    const panel = screen.getByTestId('terminal-panel')
    expect(panel.style.height).toBe('260px')
    fireEvent.pointerDown(handle, { clientY: 700, pointerId: 1 })
    fireEvent.pointerMove(handle, { clientY: 0, pointerId: 1 })
    expect(panel.style.height).toBe('700px')
    fireEvent.pointerMove(handle, { clientY: 5000, pointerId: 1 })
    expect(panel.style.height).toBe('120px')
    fireEvent.pointerUp(handle, { pointerId: 1 })
    expect(window.localStorage.getItem('ccwrap.terminal.height')).toBe('120')
  })

  it('shows the failure and exit state when the shell cannot start', async () => {
    api.pty.open.mockRejectedValueOnce(new Error('cwd missing'))
    render(<TerminalPanel cwd="C:\\gone" onClose={() => {}} />)
    await waitFor(() => expect(h.terms[0]?.writes.join('')).toContain('failed to start shell: cwd missing'))
    expect(screen.getByRole('tab', { name: /PowerShell 7/ })).toHaveAttribute('data-exited', 'true')
  })

  it('falls back to the DOM renderer when WebGL throws and still works', async () => {
    h.webglFails = true
    await mount()
    expect(h.terms).toHaveLength(1)
  })

  it('refits and resizes the pty when the host changes size (also after display:none -> shown)', async () => {
    const instances: Array<() => void> = []
    class RO {
      constructor(cb: () => void) {
        instances.push(cb)
      }
      observe(): void {}
      disconnect(): void {}
    }
    vi.stubGlobal('ResizeObserver', RO)
    try {
      await mount()
      await waitFor(() => expect(useTerminalStore.getState().tabs[0]?.ptyId).toBe('p1'))
      api.pty.resize.mockClear()
      h.terms[0]!.cols = 120
      h.terms[0]!.rows = 40
      vi.useFakeTimers()
      instances.forEach((cb) => cb())
      instances.forEach((cb) => cb()) // debounced into one call
      vi.advanceTimersByTime(60)
      vi.useRealTimers()
      expect(api.pty.resize).toHaveBeenCalledTimes(1)
      expect(api.pty.resize).toHaveBeenCalledWith('p1', 120, 40)
    } finally {
      vi.useRealTimers()
      vi.unstubAllGlobals()
    }
  })
})
