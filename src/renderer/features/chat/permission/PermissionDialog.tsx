import { ChevronDown } from 'lucide-react'
import { DropdownMenu } from 'radix-ui'
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

type Scope = 'project' | 'user' | 'session'
const SCOPES: { id: Scope; label: string; remember: 'always' | 'user' | 'session'; where: string }[] = [
  { id: 'project', label: 'This project', remember: 'always', where: 'this project (local settings)' },
  { id: 'user', label: 'All projects', remember: 'user', where: 'all projects (user settings)' },
  { id: 'session', label: 'This session', remember: 'session', where: 'this session only' }
]

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
  const labels = req.ruleLabels?.length ? req.ruleLabels : req.ruleLabel ? [req.ruleLabel] : []
  const always = async (scope: Scope): Promise<void> => {
    const s = SCOPES.find((x) => x.id === scope)!
    await replyPermission(convId, reqId, 'allow', s.remember)
    toast.success(`Rule saved for ${s.where}`, { description: labels.join(', ') })
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
        {labels.length > 0 && (
          <div className="mt-3" data-testid="perm-rules">
            <div className="mb-1 text-2xs uppercase tracking-wider text-fg-muted">
              {labels.length === 1 ? 'Always allow rule' : `Always allow rules (${labels.length})`}
            </div>
            <ul className="flex flex-wrap gap-1.5">
              {labels.map((l) => (
                <li key={l} className="rounded-sm border border-border bg-bg-1 px-1.5 py-0.5 font-mono text-sm text-fg-2">
                  {l}
                </li>
              ))}
            </ul>
          </div>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={deny}>
            Deny <Kbd>Esc</Kbd>
          </Button>
          <div className="inline-flex items-center" data-testid="perm-always">
            <Button
              variant="secondary"
              disabled={labels.length === 0}
              onClick={() => void always('project')}
              title={labels.length === 0 ? 'No rule available for this request' : 'Always allow in this project'}
              className="rounded-r-none"
            >
              Always allow
            </Button>
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <Button
                  variant="secondary"
                  disabled={labels.length === 0}
                  aria-label="Choose where to save the rule"
                  className="rounded-l-none border-l-0 px-1.5"
                >
                  <ChevronDown size={12} aria-hidden />
                </Button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  side="top"
                  align="end"
                  sideOffset={6}
                  className="z-[60] min-w-[180px] rounded-md border border-border-glass bg-glass p-1 text-fg shadow-lg backdrop-blur-[var(--blur-glass)]"
                >
                  {SCOPES.map((sc) => (
                    <DropdownMenu.Item
                      key={sc.id}
                      onSelect={() => void always(sc.id)}
                      className="flex cursor-pointer select-none items-center rounded-sm px-2 py-1.5 text-sm text-fg-2 outline-none data-[highlighted]:bg-bg-3 data-[highlighted]:text-fg"
                    >
                      {sc.label}
                    </DropdownMenu.Item>
                  ))}
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
          <Button ref={allowRef} variant="primary" onClick={once}>
            Allow once <Kbd>Enter</Kbd>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
