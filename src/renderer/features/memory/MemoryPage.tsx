import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ConfigFileRef, ConfigSnapshot, MemoryScope } from '@shared/config'
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
import { CodeEditor } from '@/components/editor'
import { cn } from '@/lib/cn'
import { configKeys } from '@/lib/config-queries'
import { Markdown } from '@/features/chat/Markdown'
import { setDirty } from '@/stores/dirty-registry'

type ViewMode = 'edit' | 'preview' | 'split'

const TABS: Array<{ scope: MemoryScope; label: string; needsProject: boolean }> = [
  { scope: 'user', label: 'User', needsProject: false },
  { scope: 'project', label: 'Project', needsProject: true },
  { scope: 'projectDotClaude', label: 'Project .claude', needsProject: true },
  { scope: 'local', label: 'Local', needsProject: true }
]

const MODES: Array<{ mode: ViewMode; label: string }> = [
  { mode: 'edit', label: 'Edit' },
  { mode: 'preview', label: 'Preview' },
  { mode: 'split', label: 'Split' }
]

function makeRef(scope: MemoryScope, cwd: string | undefined): ConfigFileRef {
  return scope === 'user' ? { kind: 'memory', scope } : { kind: 'memory', scope, ...(cwd ? { cwd } : {}) }
}

function Banner({
  tone,
  children,
  actions
}: {
  tone: 'warn' | 'danger'
  children: React.ReactNode
  actions?: React.ReactNode
}): React.JSX.Element {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-2 rounded-sm border px-3 py-2 text-base',
        tone === 'warn' ? 'border-border-strong bg-bg-2 text-fg' : 'border-danger-border bg-danger-bg text-danger'
      )}
    >
      <span className="min-w-0 flex-1">{children}</span>
      {actions}
    </div>
  )
}

interface EditorProps {
  scope: MemoryScope
  cwd: string | undefined
  onDirtyChange: (dirty: boolean) => void
}

function MemoryEditor({ scope, cwd, onDirtyChange }: EditorProps): React.JSX.Element {
  const ref = makeRef(scope, cwd)
  const qc = useQueryClient()
  const query = useQuery<ConfigSnapshot>({
    queryKey: configKeys.file(ref),
    queryFn: () => window.ccwrap.config.read(ref)
  })

  const [base, setBase] = useState<ConfigSnapshot | null>(null)
  const [draft, setDraft] = useState('')
  const [mode, setMode] = useState<ViewMode>('edit')
  const [saving, setSaving] = useState(false)
  const [conflict, setConflict] = useState<ConfigSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = base !== null && draft !== base.text
  useEffect(() => onDirtyChange(dirty), [dirty, onDirtyChange])
  useEffect(() => () => onDirtyChange(false), [onDirtyChange])

  // Adopt a fresh snapshot (first load, or an external change while the draft is clean).
  const data = query.data
  useEffect(() => {
    if (!data) return
    if (base === null || (!dirty && data.hash !== base.hash)) {
      setBase(data)
      setDraft(data.text)
    }
  }, [data, base, dirty])

  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent): void => e.preventDefault()
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  const externalChange = dirty && data && base && data.hash !== base.hash && !conflict ? data : null
  const clash = conflict ?? externalChange

  const write = useCallback(
    async (text: string, baseHash: string | null, created = false): Promise<void> => {
      setSaving(true)
      setError(null)
      try {
        const res = await window.ccwrap.config.write({ ref, text, baseHash })
        if (res.ok) {
          setBase(res.snapshot)
          setDraft(res.snapshot.text)
          setConflict(null)
          qc.setQueryData(configKeys.file(ref), res.snapshot)
          toast.success(created ? 'Created file' : 'Saved', {
            description: res.backupPath ? 'Backup saved' : undefined
          })
        } else if (res.code === 'conflict' && res.current) {
          setConflict(res.current)
        } else {
          setError(res.message)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e))
      } finally {
        setSaving(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [scope, cwd, qc]
  )

  const save = useCallback((): void => {
    if (!base || saving || !dirty) return
    void write(draft, base.hash)
  }, [base, saving, dirty, draft, write])

  const reload = (): void => {
    if (!clash) return
    setBase(clash)
    setDraft(clash.text)
    setConflict(null)
    qc.setQueryData(configKeys.file(ref), clash)
  }
  const overwrite = (): void => {
    if (!clash) return
    void write(draft, clash.hash)
  }

  if (query.isError) {
    return (
      <Banner
        tone="danger"
        actions={
          <Button size="sm" onClick={() => void query.refetch()}>
            Retry
          </Button>
        }
      >
        Could not read file: {query.error instanceof Error ? query.error.message : String(query.error)}
      </Banner>
    )
  }
  if (!base) {
    return (
      <p role="status" className="text-base text-fg-3">
        Loading...
      </p>
    )
  }

  if (!base.exists) {
    return (
      <div className="flex flex-col items-start gap-3" data-testid="memory-missing">
        <p className="text-base text-fg-2">
          <span className="font-mono text-fg">{base.path}</span> does not exist yet.
        </p>
        {error && <Banner tone="danger">{error}</Banner>}
        {conflict && (
          <Banner
            tone="warn"
            actions={
              <Button size="sm" onClick={reload}>
                Reload
              </Button>
            }
          >
            This file was created elsewhere in the meantime.
          </Banner>
        )}
        <Button variant="primary" disabled={saving} onClick={() => void write('', null, true)}>
          Create
        </Button>
      </div>
    )
  }

  const showEditor = mode !== 'preview'
  const showPreview = mode !== 'edit'

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="min-w-0 flex-1 truncate font-mono text-sm text-fg-3" title={base.path}>
          {base.path}
        </span>
        {dirty && (
          <span className="flex items-center gap-1.5 text-sm text-fg-2" data-testid="dirty-indicator">
            <span aria-hidden className="size-1.5 rounded-full bg-accent-solid" />
            Unsaved changes
          </span>
        )}
        <div role="group" aria-label="View mode" className="flex gap-0.5 rounded-sm border border-border bg-bg-1 p-0.5">
          {MODES.map((m) => (
            <Button
              key={m.mode}
              size="sm"
              variant={mode === m.mode ? 'secondary' : 'ghost'}
              aria-pressed={mode === m.mode}
              onClick={() => setMode(m.mode)}
            >
              {m.label}
            </Button>
          ))}
        </div>
        <Button variant="primary" size="sm" disabled={!dirty || saving} onClick={save}>
          Save
        </Button>
        <Kbd>Ctrl+S</Kbd>
      </div>

      {clash && (
        <Banner
          tone="warn"
          actions={
            <>
              <Button size="sm" onClick={reload}>
                Reload
              </Button>
              <Button size="sm" variant="danger" disabled={saving} onClick={overwrite}>
                Overwrite
              </Button>
            </>
          }
        >
          {conflict ? 'This file changed on disk since you opened it. Saving was blocked.' : 'This file changed on disk.'}{' '}
          Reload discards your edits; Overwrite replaces the disk version with yours.
        </Banner>
      )}
      {error && <Banner tone="danger">{error}</Banner>}

      <div className={cn('grid min-h-0 flex-1 gap-3', mode === 'split' ? 'grid-cols-2' : 'grid-cols-1')}>
        {showEditor && (
          <div className="flex min-h-0 min-w-0 flex-col">
            <CodeEditor
              value={draft}
              onChange={setDraft}
              language="markdown"
              ariaLabel={`CLAUDE.md editor (${scope})`}
              onSave={save}
            />
          </div>
        )}
        {showPreview && (
          <div
            data-testid="memory-preview"
            aria-label="Preview"
            className="min-h-0 min-w-0 overflow-auto rounded-sm border border-border bg-bg-1 p-4"
          >
            <Markdown text={draft} />
          </div>
        )}
      </div>
    </div>
  )
}

export function MemoryPage({ cwd }: { cwd?: string }): React.JSX.Element {
  const [scope, setScope] = useState<MemoryScope>('user')
  const [pending, setPending] = useState<MemoryScope | null>(null)
  const dirtyRef = useRef(false)
  const onDirtyChange = useCallback((d: boolean) => {
    dirtyRef.current = d
    setDirty('memory', d)
  }, [])

  // Without a project, project-level tabs are unavailable.
  const effective: MemoryScope = !cwd && scope !== 'user' ? 'user' : scope

  const select = (next: MemoryScope): void => {
    if (next === effective) return
    if (dirtyRef.current) setPending(next)
    else setScope(next)
  }

  return (
    <section
      className="flex h-full min-h-0 w-full flex-col gap-3 px-6 py-5"
      data-testid="memory-page"
      aria-label="Memory"
    >
      <header className="flex flex-col gap-1">
        <h2 className="text-lg font-medium text-fg">Memory (CLAUDE.md)</h2>
        <p className="truncate text-base text-fg-3">{cwd ?? 'No project selected'}</p>
      </header>

      <div role="tablist" aria-label="Memory scope" className="flex gap-1 border-b border-border">
        {TABS.map((t) => {
          const disabled = t.needsProject && !cwd
          const selected = t.scope === effective
          return (
            <button
              key={t.scope}
              type="button"
              role="tab"
              aria-selected={selected}
              disabled={disabled}
              onClick={() => select(t.scope)}
              className={cn(
                'rounded-t-sm px-3 py-1.5 text-base transition-colors duration-fast motion-reduce:transition-none',
                'focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent-solid',
                'disabled:cursor-not-allowed disabled:opacity-[0.42]',
                selected ? 'border-b-2 border-accent-solid text-fg' : 'text-fg-3 hover:text-fg'
              )}
            >
              {t.label}
            </button>
          )
        })}
      </div>

      <MemoryEditor key={`${effective}|${cwd ?? ''}`} scope={effective} cwd={cwd} onDirtyChange={onDirtyChange} />

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>Your edits to this file have not been saved.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button onClick={() => setPending(null)}>Keep editing</Button>
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
