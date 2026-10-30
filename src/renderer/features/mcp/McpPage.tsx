import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { McpScope, McpServerEntry, McpTestResult } from '@shared/config'
import {
  Button,
  Chip,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  toast,
  Tooltip
} from '@/components/ui'
import { configKeys } from '@/lib/config-queries'
import { cwdKey } from '@/stores/workspace-store'
import { useChatStore } from '@/stores/chat-store'
import { McpServerDialog, type McpSubmit } from './McpServerDialog'
import { MASK, patchApproval, SCOPE_LABEL, SCOPE_ORDER, secretKeys, summarize } from './mcp-model'

const APPROVED_NOTE =
  'Approved in .claude/settings.local.json. `claude mcp list` may still print Pending approval; sessions use this setting.'

type TestState = { running: true } | { running: false; result: McpTestResult }

const TEST_VARIANT = { connected: 'ok', failed: 'danger', pending: 'warn', needs_auth: 'warn', unknown: 'neutral' } as const
const TEST_LABEL = {
  connected: 'Connected',
  failed: 'Failed',
  pending: 'Pending approval',
  needs_auth: 'Needs auth',
  unknown: 'Unknown'
} as const

function liveVariant(status: string): 'ok' | 'danger' | 'warn' | 'neutral' {
  if (status === 'connected') return 'ok'
  if (status === 'failed' || status === 'error') return 'danger'
  if (status === 'needs-auth' || status === 'pending' || status === 'needs_auth') return 'warn'
  return 'neutral'
}

function useLiveStatus(cwd: string | undefined): Map<string, string> {
  const convs = useChatStore((s) => s.convs)
  return useMemo(() => {
    const out = new Map<string, string>()
    if (!cwd) return out
    const key = cwdKey(cwd)
    for (const c of Object.values(convs)) {
      if (cwdKey(c.cwd) !== key) continue
      for (const m of c.meta.mcp) out.set(m.name, m.status)
    }
    return out
  }, [convs, cwd])
}

export function McpPage({ cwd }: { cwd?: string }): React.JSX.Element {
  const qc = useQueryClient()
  const live = useLiveStatus(cwd)
  const [tests, setTests] = useState<Record<string, TestState>>({})
  const [dialog, setDialog] = useState<{ entry?: McpServerEntry; n: number } | undefined>()
  const [removing, setRemoving] = useState<McpServerEntry | undefined>()
  const [removeError, setRemoveError] = useState<{ message: string; output?: string } | undefined>()

  const list = useQuery({
    queryKey: configKeys.mcp(cwd),
    queryFn: () => window.ccwrap.mcp.list({ ...(cwd ? { cwd } : {}) })
  })
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['mcp'] })

  const servers = list.data?.servers ?? []
  const grouped = SCOPE_ORDER.map((scope) => ({ scope, items: servers.filter((s) => s.scope === scope) }))
  const sessionOnly = [...live.entries()].filter(([name]) => !servers.some((s) => s.name === name))

  const submit = async (v: McpSubmit): ReturnType<React.ComponentProps<typeof McpServerDialog>['onSubmit']> => {
    const editing = dialog?.entry
    const base = { scope: v.scope, ...(cwd ? { cwd } : {}), name: v.name, config: v.config as never }
    const res = editing
      ? await window.ccwrap.mcp.update({ ...base, ...(v.newName ? { newName: v.newName } : {}) })
      : await window.ccwrap.mcp.add(base)
    if (res.ok) {
      toast.success(editing ? 'Server updated' : 'Server added')
      await refresh()
      return { ok: true }
    }
    return { ok: false, message: res.message, ...(res.output ? { output: res.output } : {}) }
  }

  const runTest = async (s: McpServerEntry): Promise<void> => {
    setTests((t) => ({ ...t, [s.name]: { running: true } }))
    try {
      const result = await window.ccwrap.mcp.test({ ...(cwd ? { cwd } : {}), name: s.name })
      setTests((t) => ({ ...t, [s.name]: { running: false, result } }))
    } catch (e) {
      const output = e instanceof Error ? e.message : String(e)
      setTests((t) => ({
        ...t,
        [s.name]: { running: false, result: { name: s.name, status: 'failed', output, durationMs: 0 } }
      }))
    }
  }

  const remove = useMutation({
    mutationFn: async (s: McpServerEntry) =>
      window.ccwrap.mcp.remove({ scope: s.scope, ...(cwd ? { cwd } : {}), name: s.name }),
    onSuccess: async (res, s) => {
      if (res.ok) {
        toast.success(`Removed ${s.name}`)
        setRemoving(undefined)
        setRemoveError(undefined)
        await refresh()
      } else {
        setRemoveError({ message: res.message, ...(res.output ? { output: res.output } : {}) })
      }
    },
    onError: (e) => setRemoveError({ message: e instanceof Error ? e.message : String(e) })
  })

  const approve = async (s: McpServerEntry, decision: 'approve' | 'reject'): Promise<void> => {
    if (!cwd) return
    const ref = { kind: 'settings', scope: 'local', cwd } as const
    try {
      const snap = await window.ccwrap.config.read(ref)
      const patched = patchApproval(snap.text, s.name, decision)
      if ('error' in patched) {
        toast.error(patched.error)
        return
      }
      const res = await window.ccwrap.config.write({ ref, text: patched.text, baseHash: snap.hash })
      if (!res.ok) {
        toast.error(res.code === 'conflict' ? 'settings.local.json changed on disk; try again' : res.message)
        return
      }
      toast.success(decision === 'approve' ? `Approved ${s.name}` : `Rejected ${s.name}`)
      await refresh()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <section className="flex min-h-0 flex-1 flex-col" data-testid="mcp-page" aria-label="MCP servers">
      <header className="flex items-center gap-3 border-b border-border px-6 py-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold tracking-[var(--tracking-tight)] text-fg">MCP servers</h2>
          <p className="truncate font-mono text-sm text-fg-3">{cwd ?? 'No project selected (user scope only)'}</p>
        </div>
        <Button variant="ghost" size="icon-md" aria-label="Refresh" onClick={() => void refresh()}>
          <RefreshCw size={14} />
        </Button>
        <Button variant="primary" onClick={() => setDialog({ n: Date.now() })}>
          <Plus size={14} /> Add server
        </Button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-4">
        {list.isPending && <p className="text-base text-fg-3">Loading servers...</p>}
        {(list.error || list.data?.error) && (
          <div role="alert" className="mb-3 rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger">
            {list.data?.error ?? (list.error instanceof Error ? list.error.message : 'Could not load servers')}
          </div>
        )}

        {list.data &&
          grouped.map(({ scope, items }) => (
            <ScopeGroup key={scope} scope={scope} count={items.length}>
              {items.map((s) => (
                <ServerRow
                  key={`${s.scope}:${s.name}`}
                  entry={s}
                  live={live.get(s.name)}
                  test={tests[s.name]}
                  onTest={() => void runTest(s)}
                  onEdit={() => setDialog({ entry: s, n: Date.now() })}
                  onRemove={() => {
                    setRemoveError(undefined)
                    setRemoving(s)
                  }}
                  onApprove={(d) => void approve(s, d)}
                />
              ))}
            </ScopeGroup>
          ))}

        {list.data && sessionOnly.length > 0 && (
          <div className="mb-5">
            <h3 className="mb-1.5 text-sm font-medium uppercase tracking-wide text-fg-3">Session-only</h3>
            <ul className="flex flex-col gap-1.5">
              {sessionOnly.map(([name, status]) => (
                <li
                  key={name}
                  className="flex items-center gap-2 rounded-md border border-border bg-bg-1 px-3 py-2"
                  data-testid="session-only-row"
                >
                  <span className="font-mono text-base text-fg">{name}</span>
                  <Chip>plugin / connector</Chip>
                  <Chip variant={liveVariant(status)}>{status}</Chip>
                  <span className="text-sm text-fg-3">read-only</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {dialog && (
        <McpServerDialog
          key={dialog.n}
          open
          entry={dialog.entry}
          hasProject={Boolean(cwd)}
          onOpenChange={(o) => !o && setDialog(undefined)}
          onSubmit={submit}
        />
      )}

      <Dialog open={Boolean(removing)} onOpenChange={(o) => !o && !remove.isPending && setRemoving(undefined)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove {removing?.name}?</DialogTitle>
            <DialogDescription>
              This removes the server from {removing ? SCOPE_LABEL[removing.scope] : ''} config using the claude CLI.
            </DialogDescription>
          </DialogHeader>
          {removeError && (
            <div role="alert" className="rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger">
              <p className="font-medium">{removeError.message}</p>
              {removeError.output && (
                <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">{removeError.output}</pre>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="secondary" onClick={() => setRemoving(undefined)} disabled={remove.isPending}>
              Cancel
            </Button>
            <Button variant="danger" onClick={() => removing && remove.mutate(removing)} disabled={remove.isPending}>
              {remove.isPending ? 'Removing...' : 'Remove'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}

function ScopeGroup(props: { scope: McpScope; count: number; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="mb-5" role="group" aria-label={`${SCOPE_LABEL[props.scope]} servers`}>
      <h3 className="mb-1.5 text-sm font-medium uppercase tracking-wide text-fg-3">
        {SCOPE_LABEL[props.scope]} <span className="text-fg-muted">({props.count})</span>
      </h3>
      {props.count === 0 ? (
        <p className="text-sm text-fg-muted">No servers in this scope.</p>
      ) : (
        <ul className="flex flex-col gap-1.5">{props.children}</ul>
      )}
    </div>
  )
}

function ServerRow(props: {
  entry: McpServerEntry
  live?: string
  test?: TestState
  onTest: () => void
  onEdit: () => void
  onRemove: () => void
  onApprove: (d: 'approve' | 'reject') => void
}): React.JSX.Element {
  const { entry: s, test } = props
  const secrets = secretKeys(s)
  const shadowed = Boolean(s.shadowedBy)
  const [open, setOpen] = useState(false)
  return (
    <li
      className={`rounded-md border border-border bg-bg-1 px-3 py-2 ${shadowed ? 'opacity-70' : ''}`}
      data-testid="mcp-row"
      data-name={s.name}
    >
      <div className="flex items-center gap-2">
        <span className="font-mono text-base font-medium text-fg">{s.name}</span>
        <Chip>{s.transport}</Chip>
        {s.scope === 'project' && s.approval && (() => {
          const chip = (
            <Chip variant={s.approval === 'approved' ? 'ok' : s.approval === 'rejected' ? 'danger' : 'warn'}>
              {s.approval}
            </Chip>
          )
          return s.approval === 'approved' ? (
            <Tooltip content={APPROVED_NOTE}>
              <span tabIndex={0} className="rounded-sm focus-visible:outline-2 focus-visible:outline-accent-text">
                {chip}
              </span>
            </Tooltip>
          ) : (
            chip
          )
        })()}
        {props.live && <Chip variant={liveVariant(props.live)}>{props.live}</Chip>}
        {shadowed && <span className="text-sm text-fg-3">shadowed by {s.shadowedBy}</span>}
        <span className="flex-1" />
        {s.scope === 'project' && s.approval !== 'approved' && (
          <Button size="sm" variant="secondary" onClick={() => props.onApprove('approve')}>
            Approve
          </Button>
        )}
        {s.scope === 'project' && s.approval !== 'rejected' && (
          <Button size="sm" variant="ghost" onClick={() => props.onApprove('reject')}>
            Reject
          </Button>
        )}
        <Button size="sm" variant="ghost" aria-label={`Test ${s.name}`} onClick={props.onTest} disabled={test?.running}>
          <Play size={12} /> Test
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Edit ${s.name}`} onClick={props.onEdit}>
          <Pencil size={12} />
        </Button>
        <Button size="icon-sm" variant="ghost" aria-label={`Remove ${s.name}`} onClick={props.onRemove}>
          <Trash2 size={12} />
        </Button>
      </div>
      <p className="mt-1 truncate font-mono text-sm text-fg-3" title={summarize(s)}>
        {summarize(s)}
      </p>
      {secrets.length > 0 && (
        <p className="mt-0.5 truncate font-mono text-xs text-fg-muted">
          {secrets.map((k) => `${k}=${MASK}`).join('  ')}
        </p>
      )}
      {test && (
        <div className="mt-1.5" data-testid="test-result">
          {test.running ? (
            <Chip variant="running">Testing...</Chip>
          ) : (
            <>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-from"
                aria-expanded={open}
                aria-label={`Toggle output for ${s.name}`}
                onClick={() => setOpen((o) => !o)}
              >
                <ChevronRight size={12} className={`transition-transform duration-fast ${open ? 'rotate-90' : ''}`} />
                <Chip variant={TEST_VARIANT[test.result.status]}>{TEST_LABEL[test.result.status]}</Chip>
                <span className="text-sm text-fg-3">{(test.result.durationMs / 1000).toFixed(1)}s</span>
                {test.result.detail && <span className="text-sm text-fg-2">{test.result.detail}</span>}
              </button>
              {open && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded-sm bg-bg-2 p-2 font-mono text-xs text-fg-2">
                  {test.result.output}
                </pre>
              )}
            </>
          )}
        </div>
      )}
    </li>
  )
}
