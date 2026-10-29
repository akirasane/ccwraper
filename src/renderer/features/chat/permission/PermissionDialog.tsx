import * as React from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd,
  toast
} from '@/components/ui'
import { selectActivePermission } from '@/features/chat/model/selectors'
import type { PendingPermission } from '@/features/chat/model/types'
import { useChatStore } from '@/stores/chat-store'
import { diffFromToolInput } from '../diff/compute-diff'
import { DiffView } from '../diff/DiffView'
import { TruncatedText } from '../tools/TruncatedText'

const asRec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' ? (v as Record<string, unknown>) : {})

function InputPreview({ req }: { req: PendingPermission }): React.JSX.Element {
  const diff = diffFromToolInput(req.toolName, req.input)
  const input = asRec(req.input)
  if (diff) {
    return (
      <div className="overflow-hidden rounded-sm border border-border bg-bg-1">
        {typeof input.file_path === 'string' && (
          <div className="border-b border-border px-3 py-1 font-mono text-xs text-fg-3">{input.file_path}</div>
        )}
        <div className="max-h-[260px] overflow-y-auto">
          <DiffView diff={diff} />
        </div>
      </div>
    )
  }
  if (req.toolName === 'Bash' && typeof input.command === 'string') {
    return (
      <div className="rounded-sm border border-border bg-bg-1 px-3 py-2 font-mono text-sm text-fg">
        <span className="select-none text-fg-3">$ </span>
        <span className="whitespace-pre-wrap break-all">{input.command}</span>
      </div>
    )
  }
  return (
    <div className="rounded-sm border border-border bg-bg-1 px-3 py-2">
      <TruncatedText text={JSON.stringify(req.input, null, 2) ?? ''} maxLines={20} className="font-mono text-sm text-fg-2" />
    </div>
  )
}

export function PermissionDialog({ convId }: { convId: string }): React.JSX.Element | null {
  const req = useChatStore((s) => {
    const c = s.convs[convId]
    return c ? selectActivePermission(c) : undefined
  })
  const queued = useChatStore((s) => s.convs[convId]?.pending.length ?? 0)
  const replyPermission = useChatStore((s) => s.replyPermission)
  const allowRef = React.useRef<HTMLButtonElement>(null)

  if (!req) return null
  const { reqId } = req

  const deny = (): void => void replyPermission(convId, reqId, 'deny')
  const once = (): void => void replyPermission(convId, reqId, 'allow', 'once')
  const always = async (): Promise<void> => {
    await replyPermission(convId, reqId, 'allow', 'always')
    toast.success('Rule saved', { description: req.ruleLabel })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && deny()}>
      <DialogContent
        showClose={false}
        aria-describedby="perm-desc"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          allowRef.current?.focus()
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{req.title ?? req.toolName}</DialogTitle>
            {queued > 1 && (
              <span
                data-testid="perm-count"
                className="rounded-full border border-warn-border bg-warn-bg px-1.5 text-xs text-warn tabular-nums"
              >
                +{queued - 1} more
              </span>
            )}
          </div>
          <DialogDescription id="perm-desc">Claude wants to use {req.toolName}.</DialogDescription>
        </DialogHeader>
        <InputPreview req={req} />
        <DialogFooter>
          <Button variant="ghost" onClick={deny}>
            Deny <Kbd>Esc</Kbd>
          </Button>
          <Button
            variant="secondary"
            disabled={!req.ruleLabel}
            onClick={() => void always()}
            title={req.ruleLabel ? undefined : 'No rule available for this request'}
          >
            Always allow{req.ruleLabel && <span className="font-mono text-sm text-fg-2">{req.ruleLabel}</span>}
          </Button>
          <Button ref={allowRef} variant="primary" onClick={once}>
            Allow once <Kbd>Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
