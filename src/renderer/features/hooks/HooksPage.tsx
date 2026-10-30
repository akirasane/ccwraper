import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, ChevronRight, Plus, RotateCcw, Save, ShieldAlert, Trash2 } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import type { ConfigFileRef, SettingsScope } from '@shared/config'
import { HOOK_EVENTS } from '@shared/hook-events'
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Input, Spinner } from '@/components/ui'
import { configKeys } from '@/lib/config-queries'
import { cn } from '@/lib/cn'
import { useDirtyRegistry } from '@/stores/dirty-registry'
import { useWorkspaceStore } from '@/stores/workspace-store'
import { applyPatch } from '@/features/settings/model/settings-patch'
import { useSettingsBuffer } from '@/features/settings/use-settings-buffer'
import { EffectiveHooks } from './EffectiveHooks'
import { HookEntryForm } from './HookEntryForm'
import { HooksConfirmDialog } from './HooksConfirmDialog'
import {
  changedExecutables,
  entryType,
  hasErrors,
  matcherHint,
  newGroup,
  defaultEntry,
  opsForEvent,
  readHooks,
  validateHooks,
  type HookGroup,
  type HookIssue,
  type RawObj
} from './model/hooks-model'

type View = SettingsScope | 'effective'
const VIEWS: Array<{ id: View; label: string }> = [
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
  { id: 'local', label: 'Local' },
  { id: 'effective', label: 'Effective' }
]

function SafetyBanner(): React.JSX.Element {
  return (
    <div role="note" data-testid="hooks-safety-banner" className="flex items-start gap-2 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-base text-warn">
      <ShieldAlert size={16} className="mt-0.5 shrink-0" aria-hidden />
      <p>
        Hooks run automatically with your user account&apos;s permissions whenever the event fires, in every Claude Code session that loads this file (the CLI
        too). ccwraper never runs hooks.
      </p>
    </div>
  )
}

function DisableAllBanner({ cwd }: { cwd?: string }): React.JSX.Element | null {
  const q = useQuery({ queryKey: configKeys.settingsResolve(cwd), queryFn: () => window.ccwrap.settings.resolve({ cwd }) })
  if (q.data?.effective.disableAllHooks !== true) return null
  const src = q.data.provenance.disableAllHooks?.source
  return (
    <div role="status" data-testid="hooks-disabled-banner" className="flex items-center gap-2 rounded-md border border-info-border bg-info-bg px-3 py-2 text-base text-info">
      <AlertTriangle size={14} aria-hidden />
      <span>disableAllHooks is on{src ? ` (set in ${src})` : ''}, so no hook runs in new sessions even though they are listed here.</span>
    </div>
  )
}

function IssueList({ issues }: { issues: HookIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-0.5">
      {issues.map((i, k) => (
        <li key={k} className={cn('text-xs', i.severity === 'error' ? 'text-danger' : i.severity === 'warning' ? 'text-warn' : 'text-fg-3')}>
          {i.severity === 'error' ? 'Error: ' : i.severity === 'warning' ? 'Warning: ' : ''}
          {i.message}
        </li>
      ))}
    </ul>
  )
}

function EventSection({
  event,
  known,
  malformed,
  groups,
  issues,
  disabled,
  onChange
}: {
  event: string
  known: boolean
  malformed: boolean
  groups: HookGroup[]
  issues: HookIssue[]
  disabled: boolean
  onChange: (groups: HookGroup[]) => void
}) {
  const [open, setOpen] = useState(true)
  const count = groups.reduce((n, g) => n + g.hooks.length, 0)
  const setGroup = (gi: number, g: HookGroup) => onChange(groups.map((x, i) => (i === gi ? g : x)))
  return (
    <section className="rounded-md border border-border bg-bg-1" aria-label={`Event ${event}`} data-testid={`hooks-event-${event}`}>
      <h3 className="flex items-center gap-2 px-3 py-2">
        <button
          type="button"
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
          className="flex min-w-0 flex-1 items-center gap-2 rounded-sm text-left text-md font-medium text-fg"
        >
          {open ? <ChevronDown size={14} aria-hidden /> : <ChevronRight size={14} aria-hidden />}
          <span className="truncate">{event}</span>
          <span className="text-sm font-normal text-fg-3">{count} {count === 1 ? 'hook' : 'hooks'}</span>
        </button>
        {!known && <Chip variant="warn" className="h-5 px-1.5 text-xs">unknown event (newer CLI?)</Chip>}
      </h3>
      {open && (
        <div className="flex flex-col gap-3 border-t border-border p-3">
          {malformed ? (
            <p className="text-sm text-warn">This event is not a list of hook groups, so it is shown read-only and kept as is. Edit it as raw JSON in Settings.</p>
          ) : (
            <>
              {groups.map((g, gi) => {
                const gIssues = issues.filter((i) => i.group === gi && i.entry === undefined)
                return (
                  <div key={gi} className="flex flex-col gap-2 rounded-md border border-border bg-bg-2 p-3" role="group" aria-label={`${event} group ${gi + 1}`}>
                    <div className="flex items-end gap-2">
                      <label className="flex min-w-0 flex-1 flex-col gap-1">
                        <span className="text-sm font-medium text-fg-2">Matcher</span>
                        <Input
                          mono
                          aria-label={`Matcher for ${event} group ${gi + 1}`}
                          placeholder={matcherHint(event)}
                          value={typeof g.matcher === 'string' ? g.matcher : ''}
                          disabled={disabled}
                          onChange={(e) => {
                            const next: HookGroup = { ...g }
                            if (e.target.value === '') delete next.matcher
                            else next.matcher = e.target.value
                            setGroup(gi, next)
                          }}
                        />
                      </label>
                      <Button variant="ghost" size="icon-md" aria-label={`Remove group ${gi + 1} of ${event}`} disabled={disabled} onClick={() => onChange(groups.filter((_, i) => i !== gi))}>
                        <Trash2 size={14} />
                      </Button>
                    </div>
                    <p className="text-xs text-fg-3">{matcherHint(event)}</p>
                    <IssueList issues={gIssues} />
                    {g.hooks.map((entry, ei) => {
                      const eIssues = issues.filter((i) => i.group === gi && i.entry === ei)
                      return (
                        <div key={ei} className="flex flex-col gap-2 rounded-sm border border-border bg-bg-1 p-3" role="group" aria-label={`${event} group ${gi + 1} hook ${ei + 1}`}>
                          <div className="flex items-center justify-between gap-2">
                            <Chip className="h-5 px-1.5 text-xs">{entryType(entry) || 'no type'}</Chip>
                            <Button
                              variant="ghost"
                              size="sm"
                              aria-label={`Remove hook ${ei + 1} of ${event} group ${gi + 1}`}
                              disabled={disabled}
                              onClick={() => setGroup(gi, { ...g, hooks: g.hooks.filter((_, i) => i !== ei) })}
                            >
                              <Trash2 size={12} /> Remove
                            </Button>
                          </div>
                          <fieldset disabled={disabled} className="min-w-0 border-0 p-0">
                            <HookEntryForm entry={entry} onChange={(next: RawObj) => setGroup(gi, { ...g, hooks: g.hooks.map((x, i) => (i === ei ? next : x)) })} />
                          </fieldset>
                          <IssueList issues={eIssues} />
                        </div>
                      )
                    })}
                    <Button size="sm" variant="ghost" className="self-start" disabled={disabled} onClick={() => setGroup(gi, { ...g, hooks: [...g.hooks, defaultEntry('command')] })}>
                      <Plus size={12} /> Add hook
                    </Button>
                  </div>
                )
              })}
              <Button size="sm" variant="secondary" className="self-start" disabled={disabled} onClick={() => onChange([...groups, newGroup()])}>
                <Plus size={12} /> Add matcher group
              </Button>
            </>
          )}
        </div>
      )}
    </section>
  )
}

function ScopeEditor({ scope, fileRef }: { scope: SettingsScope; fileRef: ConfigFileRef }): React.JSX.Element {
  const buf = useSettingsBuffer(fileRef)
  const setView = useWorkspaceStore((s) => s.setView)
  const [confirmOpen, setConfirmOpen] = useState(false)

  useEffect(() => {
    useDirtyRegistry.getState().setDirty(`hooks:${scope}`, buf.dirty)
  }, [scope, buf.dirty])
  useEffect(() => () => useDirtyRegistry.getState().setDirty(`hooks:${scope}`, false), [scope])
  useEffect(() => {
    if (!buf.dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [buf.dirty])

  const settings = buf.parsed.ok ? buf.parsed.value : undefined
  const view = useMemo(() => readHooks(settings), [settings])
  const issues = useMemo(() => validateHooks(settings), [settings])
  const baseParsed = useMemo(() => {
    try {
      const v: unknown = JSON.parse(buf.snapshot?.text || '{}')
      return v && typeof v === 'object' && !Array.isArray(v) ? (v as RawObj) : undefined
    } catch {
      return undefined
    }
  }, [buf.snapshot?.text])
  const changes = useMemo(() => changedExecutables(baseParsed, settings), [baseParsed, settings])

  const editEvent = (event: string, groups: HookGroup[]) => {
    if (!buf.parsed.ok) return
    buf.setText(applyPatch(buf.text, opsForEvent(event, groups)))
  }
  const present = new Set(view.events.map((e) => e.event))
  const addable = HOOK_EVENTS.filter((e) => !present.has(e))

  const canSave = buf.dirty && buf.parsed.ok && !hasErrors(issues) && !buf.saving && buf.snapshot !== undefined
  const onSave = () => {
    if (changes.length > 0) setConfirmOpen(true)
    else void buf.save()
  }

  if (buf.loading) {
    return (
      <div role="status" className="flex items-center gap-2 text-fg-3">
        <Spinner size={14} /> Loading&hellip;
      </div>
    )
  }
  if (buf.loadError) {
    return (
      <p role="alert" className="text-danger">
        Could not read settings: {buf.loadError}
      </p>
    )
  }

  const banner = buf.banner
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      {banner && (
        <div
          role="alert"
          data-testid={banner.kind === 'conflict' ? 'conflict-banner' : banner.kind === 'external' ? 'external-banner' : 'error-banner'}
          className={cn('flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-base', banner.kind === 'error' ? 'border-danger-border bg-danger-bg text-danger' : 'border-warn-border bg-warn-bg text-warn')}
        >
          <AlertTriangle size={14} aria-hidden />
          <span className="min-w-0 flex-1">
            {banner.kind === 'conflict'
              ? 'The file changed on disk since you opened it, so nothing was saved.'
              : banner.kind === 'external'
                ? 'This file changed on disk. Your unsaved edits are kept.'
                : `Could not save: ${banner.message}`}
          </span>
          {banner.kind === 'error' ? (
            <Button size="sm" variant="ghost" onClick={buf.dismissBanner}>
              Dismiss
            </Button>
          ) : (
            <>
              <Button size="sm" variant="secondary" onClick={buf.reload}>
                Reload
              </Button>
              {banner.kind === 'conflict' ? (
                <Button size="sm" variant="danger" disabled={buf.saving} onClick={() => void buf.overwrite()}>
                  Overwrite
                </Button>
              ) : (
                <Button size="sm" variant="ghost" onClick={buf.keepMine}>
                  Keep mine
                </Button>
              )}
            </>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-sm text-fg-3">
        {buf.snapshot && (
          <code className="min-w-0 truncate font-mono" title={buf.snapshot.path} data-testid="hooks-path">
            {buf.snapshot.path}
          </code>
        )}
        {buf.snapshot && !buf.snapshot.exists && <span>(will be created)</span>}
        <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setView('settings')}>
          Edit raw JSON in Settings
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pr-1">
        {!buf.parsed.ok ? (
          <p role="alert" className="text-danger">
            This file is not valid JSON ({buf.parsed.message}). Fix it in Settings (Raw JSON) before editing hooks.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            {view.malformed && <p className="text-sm text-warn">&quot;hooks&quot; in this file is not an object, so it is not editable here.</p>}
            {!view.malformed && view.events.length === 0 && <p className="text-base text-fg-3">No hooks in this file yet.</p>}
            {view.events.map((ev) => (
              <EventSection
                key={ev.event}
                event={ev.event}
                known={ev.known}
                malformed={ev.malformed}
                groups={ev.groups}
                issues={issues.filter((i) => i.event === ev.event)}
                disabled={false}
                onChange={(g) => editEvent(ev.event, g)}
              />
            ))}
            {!view.malformed && (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Add event"
                  className="h-[30px] rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg hover:bg-bg-3 focus:border-accent-from"
                  value=""
                  onChange={(e) => {
                    if (e.target.value) editEvent(e.target.value, [newGroup()])
                  }}
                >
                  <option value="">Add event…</option>
                  {addable.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
        {buf.dirty && <span className="mr-auto text-sm text-warn">Unsaved changes</span>}
        {hasErrors(issues) && buf.dirty && <span className="text-sm text-danger">Fix the errors above to save</span>}
        <Button variant="ghost" disabled={!buf.dirty} onClick={buf.revert}>
          <RotateCcw size={13} /> Revert
        </Button>
        <Button variant="primary" disabled={!canSave} onClick={onSave}>
          <Save size={13} /> {buf.saving ? 'Saving…' : 'Save'}
        </Button>
      </div>

      <HooksConfirmDialog
        open={confirmOpen}
        scope={scope}
        changes={changes}
        saving={buf.saving}
        onCancel={() => setConfirmOpen(false)}
        onConfirm={() => {
          setConfirmOpen(false)
          void buf.save()
        }}
      />
    </div>
  )
}

export function HooksPage({ cwd }: { cwd?: string }): React.JSX.Element {
  const [scope, setScope] = useState<View>('user')
  const [pending, setPending] = useState<View | null>(null)
  const dirty = useDirtyRegistry((s) => Object.keys(s.dirty).some((k) => k.startsWith('hooks:')))

  const active: View = scope !== 'user' && scope !== 'effective' && !cwd ? 'user' : scope
  const request = (v: View) => {
    if (v === active) return
    if (dirty) setPending(v)
    else setScope(v)
  }
  const fileRef: ConfigFileRef | undefined =
    active === 'effective' ? undefined : active === 'user' ? { kind: 'settings', scope: 'user' } : { kind: 'settings', scope: active, cwd }

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-3 px-6 py-5" data-testid="hooks-page" aria-label="Hooks">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-medium tracking-[var(--tracking-tight)] text-fg">Hooks</h2>
        <div role="group" aria-label="Hooks scope" className="flex gap-1.5">
          {VIEWS.map(({ id, label }) => {
            const disabled = id !== 'user' && id !== 'effective' && !cwd
            return (
              <Chip key={id} variant={id === active ? 'selected' : 'neutral'} disabled={disabled} onClick={() => request(id)} title={disabled ? 'Select a project first' : undefined}>
                {label}
              </Chip>
            )
          })}
        </div>
        <span className="min-w-0 truncate text-sm text-fg-3" title={cwd}>
          {cwd ?? 'No project selected (user scope only)'}
        </span>
      </header>

      <SafetyBanner />
      <DisableAllBanner cwd={cwd} />

      {fileRef ? (
        <ScopeEditor key={`${active}:${cwd ?? ''}`} scope={active as SettingsScope} fileRef={fileRef} />
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          <EffectiveHooks cwd={cwd} />
        </div>
      )}

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>You have unsaved hook edits. Switching scope will discard them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pending) setScope(pending)
                setPending(null)
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
