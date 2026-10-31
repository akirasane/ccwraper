import * as React from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd
} from '@/components/ui'
import type { PendingPermission } from '@/features/chat/model/types'
import { useChatStore } from '@/stores/chat-store'
import { Markdown } from '../Markdown'

/** ExitPlanMode: show the plan as markdown; Approve allows, Keep planning denies. */
export function PlanDialog({ convId, req }: { convId: string; req: PendingPermission }): React.JSX.Element {
  const replyPermission = useChatStore((s) => s.replyPermission)
  const approveRef = React.useRef<HTMLButtonElement>(null)
  const plan = (req.input as { plan?: unknown } | null)?.plan
  const text = typeof plan === 'string' ? plan : ''
  return (
    <Dialog open onOpenChange={(o) => !o && void replyPermission(convId, req.reqId, 'deny')}>
      <DialogContent
        showClose={false}
        aria-describedby="plan-desc"
        data-testid="plan-dialog"
        className="flex max-h-[85vh] w-[640px] flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onOpenAutoFocus={(e) => {
          e.preventDefault()
          approveRef.current?.focus()
        }}
      >
        <DialogHeader>
          <DialogTitle>{req.title ?? 'Ready to start?'}</DialogTitle>
          <DialogDescription id="plan-desc">Claude has a plan and wants to leave plan mode.</DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto rounded-sm border border-border bg-bg-1 px-3 py-2 text-base">
          {text ? <Markdown text={text} /> : <p className="text-sm text-fg-3">No plan text was provided.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => void replyPermission(convId, req.reqId, 'deny')}>
            Keep planning <Kbd>Esc</Kbd>
          </Button>
          <Button ref={approveRef} variant="primary" onClick={() => void replyPermission(convId, req.reqId, 'allow', 'once')}>
            Approve plan <Kbd>Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
