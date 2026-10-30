import { Search } from 'lucide-react'
import { Kbd } from '@/components/ui'
import { usePaletteShortcuts } from './palette-keys'
import { usePaletteStore } from './palette-store'

/**
 * Title-bar palette button (260 x 26, shrinks to 120). Also owns the always-loaded Ctrl+K / Ctrl+Shift+P
 * listener, because the palette itself is a lazy chunk. Rendered by TitleBar; no props.
 */
export function PaletteTrigger(): React.JSX.Element {
  usePaletteShortcuts()
  const setOpen = usePaletteStore((s) => s.setOpen)
  return (
    <button
      type="button"
      data-testid="palette-trigger"
      aria-label="Open command palette"
      aria-haspopup="dialog"
      onClick={() => setOpen(true)}
      className="flex h-[26px] w-[260px] min-w-[120px] shrink items-center gap-2 rounded-md border border-border bg-bg-2 px-2 text-sm text-fg-3 transition-colors duration-fast hover:border-border-strong hover:bg-bg-3 hover:text-fg-2"
    >
      <Search size={13} aria-hidden className="shrink-0" />
      <span className="min-w-0 flex-1 truncate text-left">Search or run a command</span>
      <Kbd className="shrink-0">Ctrl K</Kbd>
    </button>
  )
}
