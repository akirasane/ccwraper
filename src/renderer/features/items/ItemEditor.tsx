import { AlertTriangle, Copy, Lock, Pencil, RotateCcw, Save, Trash2 } from 'lucide-react'
import { Tabs } from 'radix-ui'
import { useMemo, useState } from 'react'
import type { ConfigFileRef, ConfigItemSummary, ModelOption } from '@shared/config'
import { keyRange } from '@shared/frontmatter'
import { CodeEditor, type CodeEditorDiagnostic } from '@/components/editor'
import { Button, Spinner, toast } from '@/components/ui'
import { cn } from '@/lib/cn'
import { DeleteItemDialog, RenameItemDialog } from './ItemDialogs'
import { ItemForm } from './ItemForm'
import { specFor } from './item-specs'
import type { ItemIssue } from './kinds/types'
import { useItemBuffer, type ItemBanner, type ItemBuffer } from './use-item-buffer'

function Banner({ banner, buf }: { banner: ItemBanner; buf: ItemBuffer }) {
  if (!banner) return null
  const base = 'flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-base'
  if (banner.kind === 'error') {
    return (
      <div role="alert" className={cn(base, 'border-danger-border bg-danger-bg text-danger')}>
        <AlertTriangle size={14} aria-hidden />
        <span className="min-w-0 flex-1">Could not save: {banner.message}</span>
        <Button size="sm" variant="ghost" onClick={buf.dismissBanner}>
          Dismiss
        </Button>
      </div>
    )
  }
  const conflict = banner.kind === 'conflict'
  return (
    <div role="alert" className={cn(base, 'border-warn-border bg-warn-bg text-warn')} data-testid={conflict ? 'conflict-banner' : 'external-banner'}>
      <AlertTriangle size={14} aria-hidden />
      <span className="min-w-0 flex-1">
        {conflict ? 'The file changed on disk since you opened it, so nothing was saved.' : 'This file changed on disk. Your unsaved edits are kept.'}
      </span>
      <Button size="sm" variant="secondary" onClick={buf.reload}>
        Reload
      </Button>
      {conflict ? (
        <Button size="sm" variant="danger" disabled={buf.saving} onClick={() => void buf.overwrite()}>
          Overwrite
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={buf.keepMine}>
          Keep mine
        </Button>
      )}
    </div>
  )
}

function IssueList({ issues }: { issues: ItemIssue[] }) {
  if (issues.length === 0) return null
  return (
    <ul className="flex flex-col gap-1 text-sm" aria-label="Problems" data-testid="item-issues">
      {issues.map((i, n) => (
        <li key={n} className={i.severity === 'error' ? 'text-danger' : i.severity === 'warning' ? 'text-warn' : 'text-fg-3'}>
          {i.severity === 'error' ? 'Error' : i.severity === 'warning' ? 'Warning' : 'Note'}: {i.message}
        </li>
      ))}
    </ul>
  )
}

export function ItemEditor({
  item,
  models,
  knownTools,
  tab,
  onTabChange,
  onRenamed,
  onDeleted
}: {
  item: ConfigItemSummary
  models?: ModelOption[]
  knownTools?: string[]
  tab: 'form' | 'raw'
  onTabChange: (t: 'form' | 'raw') => void
  onRenamed: (ref: ConfigFileRef) => void
  onDeleted: () => void
}): React.JSX.Element {
  const readOnly = item.readOnly || item.scope === 'plugin'
  const spec = specFor(item.kind)
  const buf = useItemBuffer(item.ref, readOnly)
  const [renaming, setRenaming] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const issues = useMemo(
    () => spec.validate(buf.doc, { fileName: item.name, knownTools, models }),
    [spec, buf.doc, item.name, knownTools, models]
  )
  const diagnostics = useMemo<CodeEditorDiagnostic[]>(() => {
    const out: CodeEditorDiagnostic[] = []
    const text = buf.text
    const firstLineEnd = Math.max(1, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'))
    if (buf.doc.error) {
      const { from, to, message } = buf.doc.error
      out.push({ from, to: Math.max(to, from + 1), message, severity: 'error' })
      return out
    }
    for (const i of issues) {
      if (i.severity === 'info') continue
      const r = i.key ? keyRange(text, i.key) : undefined
      out.push({ from: r?.[0] ?? 0, to: r?.[1] ?? firstLineEnd, message: i.message, severity: i.severity === 'error' ? 'error' : 'warning' })
    }
    return out
  }, [issues, buf.doc.error, buf.text])

  const broken = !!buf.doc.error
  const canSave = !readOnly && buf.dirty && !broken && !buf.saving && buf.snapshot !== undefined
  const copyPath = () => {
    const p = buf.snapshot?.path ?? item.path
    void navigator.clipboard?.writeText(p).then(
      () => toast.success('Path copied'),
      () => toast.error('Could not copy the path')
    )
  }
  const baseHash = buf.snapshot?.hash
  const busyLock = buf.dirty ? 'Save or revert your changes first' : undefined

  return (
    <div
      className="flex min-h-0 min-w-0 flex-1 flex-col gap-3"
      onKeyDown={(e) => {
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
          e.preventDefault()
          if (canSave) void buf.save()
        }
      }}
    >
      <Tabs.Root value={tab} onValueChange={(v) => onTabChange(v as 'form' | 'raw')} className="flex min-h-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h3 className="min-w-0 truncate font-mono text-md font-medium text-fg">{item.name}</h3>
          {readOnly && (
            <span className="inline-flex items-center gap-1 text-sm text-fg-3">
              <Lock size={12} aria-hidden /> Read-only plugin item{item.plugin ? ` (${item.plugin})` : ''}
            </span>
          )}
          <Tabs.List aria-label="Editor view" className="ml-auto inline-flex gap-1 rounded-md border border-border bg-bg-1 p-0.5">
            {(
              [
                ['form', 'Form'],
                ['raw', 'Raw']
              ] as const
            ).map(([v, label]) => (
              <Tabs.Trigger
                key={v}
                value={v}
                className="h-6 rounded-sm px-3 text-base text-fg-2 transition-colors duration-fast hover:text-fg data-[state=active]:bg-accent-tint data-[state=active]:text-accent-text"
              >
                {label}
              </Tabs.Trigger>
            ))}
          </Tabs.List>
        </div>
        <div className="flex min-w-0 items-center gap-1.5 text-sm text-fg-3">
          <code className="min-w-0 select-all truncate font-mono" title={item.path} data-testid="item-path">
            {buf.snapshot?.path ?? item.path}
          </code>
          <Button variant="ghost" size="icon-sm" aria-label="Copy path" onClick={copyPath}>
            <Copy size={13} />
          </Button>
        </div>

        <Banner banner={buf.banner} buf={buf} />

        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {buf.loading ? (
            <div role="status" className="flex items-center gap-2 text-fg-3">
              <Spinner size={14} /> Loading&hellip;
            </div>
          ) : buf.loadError ? (
            <p role="alert" className="text-danger">
              Could not read the file: {buf.loadError}
            </p>
          ) : (
            <>
              <Tabs.Content value="form" className="flex flex-col gap-3 outline-none">
                <IssueList issues={broken ? [] : issues} />
                <ItemForm spec={spec} text={buf.text} doc={buf.doc} readOnly={readOnly} onTextChange={buf.setText} onOpenRaw={() => onTabChange('raw')} />
              </Tabs.Content>
              <Tabs.Content value="raw" className="flex h-full min-h-[320px] flex-col gap-2 outline-none">
                <IssueList issues={broken ? [{ message: buf.doc.error!.message, severity: 'error' }] : issues} />
                <CodeEditor
                  value={buf.text}
                  onChange={buf.setText}
                  language="markdown"
                  ariaLabel={`${item.name} raw text`}
                  readOnly={readOnly}
                  diagnostics={diagnostics}
                  onSave={() => canSave && void buf.save()}
                />
              </Tabs.Content>
            </>
          )}
        </div>

        {!readOnly && (
          <div className="flex items-center justify-end gap-2 border-t border-border pt-3">
            {buf.dirty && <span className="mr-auto text-sm text-warn">Unsaved changes</span>}
            {broken && <span className="text-sm text-danger">Fix the frontmatter to save</span>}
            <Button variant="ghost" disabled={!!busyLock || buf.loading} title={busyLock} onClick={() => setRenaming(true)}>
              <Pencil size={13} /> Rename
            </Button>
            <Button variant="danger" disabled={!!busyLock || buf.loading} title={busyLock} onClick={() => setDeleting(true)}>
              <Trash2 size={13} /> Delete
            </Button>
            <Button variant="ghost" disabled={!buf.dirty} onClick={buf.revert}>
              <RotateCcw size={13} /> Revert
            </Button>
            <Button variant="primary" disabled={!canSave} onClick={() => void buf.save()}>
              <Save size={13} /> {buf.saving ? 'Saving...' : 'Save'}
            </Button>
          </div>
        )}
      </Tabs.Root>
      {!readOnly && renaming && (
        <RenameItemDialog
          item={item}
          baseHash={baseHash}
          text={buf.text}
          open
          onOpenChange={setRenaming}
          onRenamed={(ref) => {
            setRenaming(false)
            onRenamed(ref)
          }}
        />
      )}
      {!readOnly && deleting && (
        <DeleteItemDialog item={item} baseHash={baseHash} open onOpenChange={setDeleting} onDeleted={onDeleted} />
      )}
    </div>
  )
}
