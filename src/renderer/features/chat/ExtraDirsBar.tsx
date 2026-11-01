import { FolderPlus, X } from 'lucide-react'
import * as React from 'react'
import { Button, toast, Tooltip } from '@/components/ui'
import { selectExtraDirs, useExtraDirs } from '@/stores/extra-dirs-store'
import { useChatStore } from '@/stores/chat-store'

const leaf = (p: string): string => p.replaceAll('\\', '/').replace(/\/+$/, '').split('/').pop() || p

/** Toolbar button that adds an extra folder (`--add-dir`) for this project. */
export function AddDirButton({ convId, disabled }: { convId: string; disabled?: boolean }): React.JSX.Element {
  const cwd = useChatStore((s) => s.convs[convId]?.cwd)
  const live = useChatStore((s) => Boolean(s.convs[convId]?.localId))
  const pick = async (): Promise<void> => {
    if (!cwd) return
    const dir = await window.ccwrap.dialog.pickDirectory()
    if (!dir) return
    const r = useExtraDirs.getState().add(cwd, dir)
    if (!r.ok) {
      toast.error('Could not add folder', { description: r.reason })
      return
    }
    if (live) toast.info('Folder added', { description: 'It applies to sessions started from now on, not this one.' })
  }
  return (
    <Tooltip content="Add a folder Claude can access">
      <Button variant="ghost" size="icon-md" aria-label="Add folder" disabled={disabled || !cwd} onClick={() => void pick()}>
        <FolderPlus size={14} aria-hidden />
      </Button>
    </Tooltip>
  )
}

/** Chips for the project's extra folders, shown at the top of the composer. */
export function ExtraDirsChips({ convId }: { convId: string }): React.JSX.Element | null {
  const cwd = useChatStore((s) => s.convs[convId]?.cwd)
  const dirs = useExtraDirs(selectExtraDirs(cwd))
  if (!cwd || dirs.length === 0) return null
  return (
    <ul className="flex flex-wrap gap-1.5 px-3 pt-3" data-testid="extra-dirs" aria-label="Extra folders">
      {dirs.map((d) => (
        <li
          key={d}
          title={d}
          className="inline-flex h-6 max-w-[240px] items-center gap-1 rounded-xs border border-border bg-bg-1 pl-2 pr-1 text-xs text-fg-2"
        >
          <FolderPlus size={11} aria-hidden className="shrink-0 text-fg-3" />
          <span className="truncate font-mono">{leaf(d)}</span>
          <button
            type="button"
            aria-label={`Remove folder ${leaf(d)}`}
            onClick={() => useExtraDirs.getState().remove(cwd, d)}
            className="grid h-4 w-4 shrink-0 place-items-center rounded-xs text-fg-3 hover:text-fg"
          >
            <X size={10} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
