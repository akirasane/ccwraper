import { useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import type { ConfigFileRef, ConfigItemSummary, ItemKind, ItemMutationResult, ItemScope } from '@shared/config'
import { isValidNewName, maxItemSegments } from '@shared/ipc'
import { patchFrontmatter, parseFrontmatter } from '@shared/frontmatter'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  toast
} from '@/components/ui'
import { specFor } from './item-specs'

/** Why a new name is not acceptable (undefined = fine). */
export function nameProblem(kind: ItemKind, name: string): string | undefined {
  if (name === '') return 'Enter a name'
  if (isValidNewName(kind, name)) return undefined
  return maxItemSegments(kind) > 1
    ? 'Use lowercase letters, digits and single hyphens; "/" separates up to 3 namespace levels'
    : 'Use lowercase letters, digits and single hyphens (max 64 characters)'
}

function useRefresh(kind: ItemKind): () => void {
  const qc = useQueryClient()
  return () => {
    void qc.invalidateQueries({ queryKey: ['items', kind] })
  }
}

function failText(res: Extract<ItemMutationResult, { ok: false }>): string {
  return res.code === 'exists' ? 'An item with that name already exists.' : res.message
}

export function NewItemDialog({
  kind,
  cwd,
  open,
  onOpenChange,
  onCreated
}: {
  kind: ItemKind
  cwd?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onCreated: (ref: ConfigFileRef) => void
}): React.JSX.Element {
  const spec = specFor(kind)
  const [scope, setScope] = useState<ItemScope>(cwd ? 'project' : 'user')
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useRefresh(kind)
  const problem = nameProblem(kind, name)
  const shown = name === '' ? undefined : problem

  const submit = async (): Promise<void> => {
    if (problem || busy) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await window.ccwrap.items.create({ kind, scope, cwd: scope === 'project' ? cwd : undefined, name, text: spec.template(name) })
      if (res.ok) {
        refresh()
        toast.success(`${spec.label} created`)
        onOpenChange(false)
        setName('')
        onCreated(res.ref)
      } else setError(failText(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New {spec.label.toLowerCase()}</DialogTitle>
          <DialogDescription>Created from the {spec.label.toLowerCase()} template.</DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <fieldset className="flex flex-col gap-1">
            <legend className="text-sm font-medium text-fg-2">Scope</legend>
            <div className="flex gap-4 text-base text-fg">
              <label className="inline-flex items-center gap-1.5">
                <input type="radio" name="scope" checked={scope === 'user'} onChange={() => setScope('user')} /> User
              </label>
              <label className={cwd ? 'inline-flex items-center gap-1.5' : 'inline-flex items-center gap-1.5 opacity-[0.42]'}>
                <input type="radio" name="scope" disabled={!cwd} checked={scope === 'project'} onChange={() => setScope('project')} /> Project
              </label>
            </div>
          </fieldset>
          <div className="flex flex-col gap-1">
            <label htmlFor="new-item-name" className="text-sm font-medium text-fg-2">
              Name
            </label>
            <Input
              id="new-item-name"
              autoFocus
              mono
              value={name}
              error={!!shown}
              aria-describedby="new-item-name-msg"
              onChange={(e) => setName(e.target.value)}
            />
            <p id="new-item-name-msg" className={shown ? 'text-sm text-danger' : 'text-sm text-fg-3'}>
              {shown ?? (kind === 'command' ? 'Use "/" for namespaces, e.g. team/review' : 'Lowercase letters, digits and hyphens')}
            </p>
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!!problem || busy}>
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The text to send with a rename: the frontmatter `name` follows the rename only when it equalled the old name. */
export function renamedText(text: string, oldName: string, newName: string): string | undefined {
  const doc = parseFrontmatter(text)
  if (doc.error || doc.data.name !== oldName) return undefined
  return patchFrontmatter(text, [{ op: 'set', key: 'name', value: newName }])
}

export function RenameItemDialog({
  item,
  baseHash,
  text,
  open,
  onOpenChange,
  onRenamed
}: {
  item: ConfigItemSummary
  baseHash: string | null | undefined
  text: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onRenamed: (ref: ConfigFileRef) => void
}): React.JSX.Element {
  const [name, setName] = useState(item.name)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useRefresh(item.kind)
  const problem = name === item.name ? 'Enter a different name' : nameProblem(item.kind, name)
  const shown = name === item.name ? undefined : problem

  const submit = async (): Promise<void> => {
    if (problem || busy || !baseHash) return
    setBusy(true)
    setError(undefined)
    try {
      const patched = renamedText(text, item.name, name)
      const res = await window.ccwrap.items.rename({ ref: item.ref, newName: name, baseHash, ...(patched !== undefined ? { text: patched } : {}) })
      if (res.ok) {
        refresh()
        toast.success('Renamed', { description: res.backupPath ? `Backup saved: ${res.backupPath}` : undefined })
        onOpenChange(false)
        onRenamed(res.ref)
      } else setError(failText(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Rename {item.name}</DialogTitle>
          <DialogDescription>
            {item.kind === 'skill' ? 'The skill folder is moved.' : 'The file is moved.'} The frontmatter name is updated when it matches the old name.
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div className="flex flex-col gap-1">
            <label htmlFor="rename-item-name" className="text-sm font-medium text-fg-2">
              New name
            </label>
            <Input id="rename-item-name" autoFocus mono value={name} error={!!shown} onChange={(e) => setName(e.target.value)} />
            {shown && <p className="text-sm text-danger">{shown}</p>}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={!!problem || busy}>
              Rename
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

export function DeleteItemDialog({
  item,
  baseHash,
  trashDir,
  open,
  onOpenChange,
  onDeleted
}: {
  item: ConfigItemSummary
  baseHash: string | null | undefined
  /** Display only; the exact path is shown in the toast after the move. */
  trashDir?: string
  open: boolean
  onOpenChange: (o: boolean) => void
  onDeleted: () => void
}): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const refresh = useRefresh(item.kind)

  const confirm = async (): Promise<void> => {
    if (busy || !baseHash) return
    setBusy(true)
    setError(undefined)
    try {
      const res = await window.ccwrap.items.delete({ ref: item.ref, baseHash })
      if (res.ok) {
        refresh()
        toast.success(`${item.name} moved to the trash`, { description: res.trashPath })
        onOpenChange(false)
        onDeleted()
      } else setError(failText(res))
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Delete {item.name}?</DialogTitle>
          <DialogDescription>
            Move {item.name} to the ccwraper trash?{trashDir ? ` (${trashDir})` : ''} It can be restored from there.
          </DialogDescription>
        </DialogHeader>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="danger" disabled={busy || !baseHash} onClick={() => void confirm()}>
            Move to trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
