import { Plus, X } from 'lucide-react'
import { useId, useState } from 'react'
import { patchFrontmatter, replaceBody, type FmOp, type FrontmatterDoc } from '@shared/frontmatter'
import { Button, Input, Textarea, Toggle } from '@/components/ui'
import { editToolList, parseToolList } from './kinds/common'
import type { ItemField, ItemKindSpec } from './kinds/types'

function ListField({
  label,
  items,
  readOnly,
  onChange
}: {
  label: string
  items: string[]
  readOnly: boolean
  onChange: (next: string[]) => void
}) {
  const [draft, setDraft] = useState('')
  const add = () => {
    const v = draft.trim()
    if (!v || items.includes(v)) return
    onChange([...items, v])
    setDraft('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      {items.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={label}>
          {items.map((it) => (
            <li key={it} className="inline-flex h-6 items-center gap-1 rounded-sm border border-border-strong bg-bg-2 pl-2 pr-1 font-mono text-sm text-fg-2">
              {it}
              {!readOnly && (
                <button
                  type="button"
                  aria-label={`Remove ${it}`}
                  className="inline-flex size-4 items-center justify-center rounded-sm text-fg-3 hover:bg-bg-3 hover:text-fg"
                  onClick={() => onChange(items.filter((x) => x !== it))}
                >
                  <X size={11} />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {!readOnly && (
        <div className="flex gap-1.5">
          <Input
            mono
            aria-label={`Add to ${label}`}
            value={draft}
            placeholder="Add..."
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                add()
              }
            }}
          />
          <Button size="icon-md" variant="secondary" aria-label={`Add ${label} entry`} onClick={add}>
            <Plus size={14} />
          </Button>
        </div>
      )}
    </div>
  )
}

function FieldRow({ field, doc, readOnly, apply }: { field: ItemField; doc: FrontmatterDoc; readOnly: boolean; apply: (ops: FmOp[]) => void }) {
  const id = useId()
  const value = doc.data[field.key]
  const setOrDelete = (v: unknown, empty: boolean): void => apply([empty ? { op: 'delete', key: field.key } : { op: 'set', key: field.key, value: v }])
  let control: React.ReactNode
  switch (field.type) {
    case 'text':
      control = (
        <Input
          id={id}
          value={typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value)}
          placeholder={field.placeholder}
          disabled={readOnly}
          onChange={(e) => setOrDelete(e.target.value, e.target.value === '')}
        />
      )
      break
    case 'textarea':
      control = (
        <Textarea
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onChange={(e) => setOrDelete(e.target.value, e.target.value === '')}
        />
      )
      break
    case 'number':
      control = (
        <Input
          id={id}
          type="number"
          value={typeof value === 'number' ? String(value) : ''}
          disabled={readOnly}
          onChange={(e) => {
            const n = Number(e.target.value)
            setOrDelete(n, e.target.value === '' || !Number.isFinite(n))
          }}
        />
      )
      break
    case 'select':
      control = (
        <select
          id={id}
          value={typeof value === 'string' ? value : ''}
          disabled={readOnly}
          onChange={(e) => setOrDelete(e.target.value, e.target.value === '')}
          className="h-[30px] w-full rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg focus-visible:border-accent-from disabled:opacity-[0.42]"
        >
          {(field.options ?? []).map((o) => (
            <option key={o} value={o}>
              {o === '' ? '(unset)' : o}
            </option>
          ))}
          {typeof value === 'string' && value !== '' && !(field.options ?? []).includes(value) && <option value={value}>{value}</option>}
        </select>
      )
      break
    case 'boolean':
      control = (
        <Toggle
          id={id}
          aria-label={field.label}
          checked={value === true}
          disabled={readOnly}
          onCheckedChange={(c) => apply([{ op: 'set', key: field.key, value: c }])}
        />
      )
      break
    case 'list': {
      const parsed = parseToolList(value)
      control = (
        <ListField
          label={field.label}
          items={parsed?.items ?? []}
          readOnly={readOnly}
          onChange={(next) => setOrDelete(editToolList(value, next), next.length === 0)}
        />
      )
      break
    }
  }
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-fg-2">
        {field.label}
      </label>
      {control}
      {field.hint && <p className="text-xs text-fg-3">{field.hint}</p>}
    </div>
  )
}

/** Form tab: fields from the kind spec, applied through patchFrontmatter; the body through replaceBody. */
export function ItemForm({
  spec,
  text,
  doc,
  readOnly,
  onTextChange,
  onOpenRaw
}: {
  spec: ItemKindSpec
  text: string
  doc: FrontmatterDoc
  readOnly: boolean
  onTextChange: (t: string) => void
  onOpenRaw: () => void
}): React.JSX.Element {
  const broken = !!doc.error
  const locked = readOnly || broken
  const bodyId = useId()
  const apply = (ops: FmOp[]): void => {
    try {
      onTextChange(patchFrontmatter(text, ops))
    } catch {
      /* unparsable: the form is read-only in that case */
    }
  }
  return (
    <div className="flex flex-col gap-4" data-testid="item-form">
      {broken && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-danger-border bg-danger-bg px-3 py-2 text-base text-danger">
          <span className="min-w-0 flex-1">The frontmatter cannot be parsed ({doc.error!.message}). The form is read-only; fix it in Raw.</span>
          <Button size="sm" variant="secondary" onClick={onOpenRaw}>
            Open Raw
          </Button>
        </div>
      )}
      {spec.fields.map((f) => (
        <FieldRow key={f.key} field={f} doc={doc} readOnly={locked} apply={apply} />
      ))}
      <div className="flex flex-col gap-1">
        <label htmlFor={bodyId} className="text-sm font-medium text-fg-2">
          {spec.kind === 'agent' ? 'System prompt' : 'Instructions'}
        </label>
        <Textarea
          id={bodyId}
          mono
          className="min-h-[200px]"
          value={doc.body}
          disabled={locked}
          onChange={(e) => {
            try {
              onTextChange(replaceBody(text, e.target.value))
            } catch {
              /* read-only when unparsable */
            }
          }}
        />
      </div>
    </div>
  )
}
