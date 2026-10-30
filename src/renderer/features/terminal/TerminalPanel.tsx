// PLACEHOLDER (WP0). WP9 replaces the body (it owns its height, tabs and xterm); the props are frozen.
export function TerminalPanel({ cwd, onClose }: { cwd?: string; onClose: () => void }): React.JSX.Element {
  return (
    <section
      className="flex h-[260px] shrink-0 flex-col border-t border-border bg-bg-1"
      data-testid="terminal-panel"
      aria-label="Terminal"
    >
      <header className="flex h-9 items-center justify-between px-3 text-sm text-fg-3">
        <span>Terminal{cwd ? ` · ${cwd}` : ''}</span>
        <button type="button" onClick={onClose} aria-label="Close terminal" className="text-fg-3 hover:text-fg">
          Close
        </button>
      </header>
    </section>
  )
}
