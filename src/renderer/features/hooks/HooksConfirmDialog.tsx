import { useEffect, useRef, useState } from 'react'
import { Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import type { ChangedExecutable } from './model/hooks-model'

const KIND_LABEL: Record<ChangedExecutable['kind'], string> = { command: 'Command', http: 'URL', mcp_tool: 'MCP tool' }

/**
 * Lists exactly what is being added or changed before it is written. Cancel is the default (focused)
 * button; Save is secondary. Project scope needs an extra checkbox. Nothing here runs anything.
 */
export function HooksConfirmDialog({
  open,
  scope,
  changes,
  saving,
  onCancel,
  onConfirm
}: {
  open: boolean
  scope: 'user' | 'project' | 'local'
  changes: ChangedExecutable[]
  saving?: boolean
  onCancel: () => void
  onConfirm: () => void
}): React.JSX.Element {
  const [ack, setAck] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (open) setAck(false)
  }, [open])
  const needsAck = scope === 'project'
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          cancelRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>Save hooks that run code?</DialogTitle>
          <DialogDescription>
            These hooks run automatically with your user account&apos;s permissions whenever their event fires. ccwraper never runs them.
          </DialogDescription>
        </DialogHeader>
        <ul className="flex max-h-56 flex-col gap-1.5 overflow-y-auto" aria-label="Added or changed hooks" data-testid="hooks-confirm-list">
          {changes.map((c, i) => (
            <li key={i} className="rounded-sm border border-border bg-bg-2 px-2 py-1.5">
              <div className="flex items-center gap-2 text-xs text-fg-3">
                <span>{c.event}</span>
                <span>{KIND_LABEL[c.kind]}</span>
                <span>{c.change === 'added' ? 'new' : 'changed'}</span>
              </div>
              <code className="break-all font-mono text-sm text-fg">{c.text}</code>
            </li>
          ))}
        </ul>
        {needsAck && (
          <label className="mt-3 flex items-start gap-2 text-base text-fg-2">
            <Checkbox className="mt-0.5" checked={ack} onCheckedChange={(v) => setAck(v === true)} />
            <span>
              This file is usually committed to the repository. These hooks will run for everyone who opens the repo. I understand.
            </span>
          </label>
        )}
        <DialogFooter>
          <Button ref={cancelRef} variant="primary" onClick={onCancel}>
            Cancel
          </Button>
          <Button variant="secondary" disabled={(needsAck && !ack) || saving} onClick={onConfirm}>
            {saving ? 'Saving…' : 'Save hooks'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
