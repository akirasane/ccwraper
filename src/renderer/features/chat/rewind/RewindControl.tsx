import { Undo2 } from 'lucide-react'
import * as React from 'react'
import type { RewindResult } from '@shared/ipc'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
  Tooltip
} from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { selectIsRunning } from '../model/selectors'

type Phase =
  | { kind: 'idle' }
  | { kind: 'previewing' }
  | { kind: 'preview'; result: RewindResult }
  | { kind: 'restoring'; result: RewindResult }
  | { kind: 'error'; message: string }

const MAX_LISTED = 12

/** Show paths relative to the project when they live under it. */
export function relativeTo(cwd: string | undefined, file: string): string {
  if (!cwd) return file
  const norm = (s: string): string => s.replaceAll('\\', '/')
  const base = norm(cwd).replace(/\/+$/, '') + '/'
  const f = norm(file)
  return f.toLowerCase().startsWith(base.toLowerCase()) ? f.slice(base.length) : file
}

/** Hover action on a user message: preview, then restore, files Claude edited since that message. */
export function RewindControl({ convId, messageId }: { convId: string; messageId: string }): React.JSX.Element | null {
  const localId = useChatStore((s) => s.convs[convId]?.localId)
  const cwd = useChatStore((s) => s.convs[convId]?.cwd)
  const running = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectIsRunning(c) : false
  })
  const [phase, setPhase] = React.useState<Phase>({ kind: 'idle' })
  if (!localId) return null // no live session: nothing to rewind against

  const close = (): void => setPhase({ kind: 'idle' })

  const preview = async (): Promise<void> => {
    setPhase({ kind: 'previewing' })
    try {
      const result = await window.ccwrap.session.rewind({ localId, messageId, dryRun: true })
      setPhase(result.canRewind ? { kind: 'preview', result } : { kind: 'error', message: result.error ?? 'Nothing to rewind.' })
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const restore = async (result: RewindResult): Promise<void> => {
    setPhase({ kind: 'restoring', result })
    try {
      const res = await window.ccwrap.session.rewind({ localId, messageId, dryRun: false })
      if (!res.canRewind) {
        setPhase({ kind: 'error', message: res.error ?? 'Rewind failed.' })
        return
      }
      const n = res.filesChanged?.length ?? 0
      toast.success(`Restored ${n} ${n === 1 ? 'file' : 'files'}`, {
        description: res.skippedLinks ? `${res.skippedLinks} skipped (symlinks or unreadable backups).` : undefined
      })
      close()
    } catch (e) {
      setPhase({ kind: 'error', message: e instanceof Error ? e.message : String(e) })
    }
  }

  const busy = phase.kind === 'previewing' || phase.kind === 'restoring'
  const shown = phase.kind === 'preview' || phase.kind === 'restoring' ? phase.result : undefined
  const files = shown?.filesChanged ?? []

  return (
    <>
      <Tooltip content={running ? 'Wait for the current turn to finish' : 'Rewind files to before this message'}>
        <button
          type="button"
          aria-label="Rewind files to this message"
          disabled={running || busy}
          onClick={() => void preview()}
          className="grid h-6 w-6 place-items-center rounded-xs border border-border bg-bg-1 text-fg-3 hover:text-fg disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-from"
        >
          <Undo2 size={12} aria-hidden />
        </button>
      </Tooltip>

      <Dialog open={phase.kind === 'preview' || phase.kind === 'restoring' || phase.kind === 'error'} onOpenChange={(o) => !o && !busy && close()}>
        <DialogContent data-testid="rewind-dialog">
          <DialogHeader>
            <DialogTitle>{phase.kind === 'error' ? 'Cannot rewind' : 'Rewind files?'}</DialogTitle>
            <DialogDescription>
              {phase.kind === 'error'
                ? phase.message
                : 'Restores files Claude changed with its edit tools after this message. The conversation itself is not rewound, and changes made by shell commands are not tracked.'}
            </DialogDescription>
          </DialogHeader>
          {shown ? (
            <div className="text-sm text-fg-2" data-testid="rewind-preview">
              {files.length === 0 ? (
                <p>No file differences found.</p>
              ) : (
                <>
                  <p className="mb-1">
                    {files.length} {files.length === 1 ? 'file' : 'files'}
                    {shown.insertions !== undefined || shown.deletions !== undefined ? (
                      <span className="ml-2 font-mono text-xs">
                        <span className="text-ok">+{shown.insertions ?? 0}</span> <span className="text-danger">-{shown.deletions ?? 0}</span>
                      </span>
                    ) : null}
                  </p>
                  <ul className="max-h-40 overflow-y-auto rounded-sm border border-border bg-bg-1 p-1.5 font-mono text-xs">
                    {files.slice(0, MAX_LISTED).map((f) => (
                      <li key={f} className="truncate" title={f}>
                        {relativeTo(cwd, f)}
                      </li>
                    ))}
                    {files.length > MAX_LISTED ? <li className="text-fg-3">and {files.length - MAX_LISTED} more</li> : null}
                  </ul>
                </>
              )}
            </div>
          ) : null}
          <DialogFooter>
            <Button variant="secondary" onClick={close} disabled={busy}>
              {phase.kind === 'error' ? 'Close' : 'Cancel'}
            </Button>
            {shown ? (
              <Button variant="danger" onClick={() => void restore(shown)} disabled={busy || files.length === 0}>
                {phase.kind === 'restoring' ? 'Restoring...' : 'Restore files'}
              </Button>
            ) : null}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
