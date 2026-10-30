import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react'
import { useId, useState } from 'react'
import type { McpScope, McpServerEntry } from '@shared/config'
import { CodeEditor } from '@/components/editor'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input
} from '@/components/ui'
import {
  configFromForm,
  emptyForm,
  formFromConfig,
  formFromEntry,
  newRow,
  parseJsonConfig,
  SCOPE_LABEL,
  validateConfig,
  type FormTransport,
  type KvRow,
  type ServerForm
} from './mcp-model'

export interface McpSubmit {
  scope: McpScope
  name: string
  newName?: string
  config: Record<string, unknown>
}

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Existing entry when editing; undefined when adding. */
  entry?: McpServerEntry
  hasProject: boolean
  onSubmit: (v: McpSubmit) => Promise<{ ok: true } | { ok: false; message: string; output?: string }>
}

const labelCls = 'text-sm font-medium text-fg-2'
const errCls = 'text-sm text-danger'

function KvEditor(props: {
  label: string
  rows: KvRow[]
  onChange: (rows: KvRow[]) => void
  secret: boolean
}): React.JSX.Element {
  const { label, rows, onChange, secret } = props
  const [shown, setShown] = useState<Record<number, boolean>>({})
  const set = (id: number, patch: Partial<KvRow>): void => onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)))
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className={labelCls}>{label}</legend>
      {rows.map((r, i) => (
        <div key={r.id} className="flex items-center gap-1.5">
          <Input
            mono
            aria-label={`${label} name ${i + 1}`}
            placeholder="NAME"
            value={r.key}
            onChange={(e) => set(r.id, { key: e.target.value })}
          />
          <Input
            mono
            aria-label={`${label} value ${i + 1}`}
            placeholder="value"
            type={secret && !shown[r.id] ? 'password' : 'text'}
            autoComplete="off"
            value={r.value}
            onChange={(e) => set(r.id, { value: e.target.value })}
          />
          {secret && (
            <Button
              variant="ghost"
              size="icon-md"
              aria-label={`${shown[r.id] ? 'Hide' : 'Reveal'} ${label} value ${i + 1}`}
              onClick={() => setShown((s) => ({ ...s, [r.id]: !s[r.id] }))}
            >
              {shown[r.id] ? <EyeOff size={14} /> : <Eye size={14} />}
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon-md"
            aria-label={`Remove ${label} row ${i + 1}`}
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
          >
            <Trash2 size={14} />
          </Button>
        </div>
      ))}
      <div>
        <Button size="sm" variant="ghost" onClick={() => onChange([...rows, newRow()])}>
          <Plus size={12} /> Add {label.toLowerCase()}
        </Button>
      </div>
    </fieldset>
  )
}

export function McpServerDialog({ open, onOpenChange, entry, hasProject, onSubmit }: Props): React.JSX.Element {
  const editing = Boolean(entry)
  const [form, setForm] = useState<ServerForm>(() => (entry ? formFromEntry(entry) : emptyForm(hasProject ? 'local' : 'user')))
  const [jsonMode, setJsonMode] = useState(false)
  const [jsonText, setJsonText] = useState('')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<{ message: string; output?: string } | undefined>()
  const uid = useId()
  const base = entry?.config ?? {}
  const patch = (p: Partial<ServerForm>): void => setForm((f) => ({ ...f, ...p }))

  const toggleJson = (): void => {
    if (!jsonMode) {
      setJsonText(JSON.stringify(configFromForm(form, base), null, 2))
      setJsonMode(true)
      return
    }
    const r = parseJsonConfig(jsonText)
    if (!r.value) {
      setErrors({ config: r.error ?? 'Invalid JSON' })
      return
    }
    setErrors({})
    setForm((f) => formFromConfig(f, r.value as Record<string, unknown>))
    setJsonMode(false)
  }

  const submit = async (): Promise<void> => {
    let config: unknown
    if (jsonMode) {
      const r = parseJsonConfig(jsonText)
      if (!r.value) {
        setErrors({ config: r.error ?? 'Invalid JSON' })
        return
      }
      config = r.value
    } else {
      config = configFromForm(form, base)
    }
    const v = validateConfig(form.name, config)
    setErrors(v.errors)
    if (!v.config) return
    setBusy(true)
    setFailure(undefined)
    try {
      const res = await onSubmit({
        scope: form.scope,
        name: entry ? entry.name : form.name,
        ...(entry && form.name !== entry.name ? { newName: form.name } : {}),
        config: v.config
      })
      if (res.ok) onOpenChange(false)
      else setFailure({ message: res.message, ...(res.output ? { output: res.output } : {}) })
    } finally {
      setBusy(false)
    }
  }

  const idName = `${uid}-name`
  const idScope = `${uid}-scope`
  const idTransport = `${uid}-transport`
  const idCmd = `${uid}-cmd`
  const idUrl = `${uid}-url`

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent className="max-h-[85vh] w-[600px] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? `Edit ${entry?.name}` : 'Add MCP server'}</DialogTitle>
          <DialogDescription>
            {editing ? 'Changes are applied with the claude CLI (remove, then add).' : 'The server is added with the claude CLI.'}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1">
            <label htmlFor={idName} className={labelCls}>
              Name
            </label>
            <Input
              id={idName}
              mono
              value={form.name}
              error={Boolean(errors['name'])}
              aria-describedby={errors['name'] ? `${idName}-err` : undefined}
              onChange={(e) => patch({ name: e.target.value })}
            />
            {errors['name'] && (
              <p id={`${idName}-err`} className={errCls}>
                {errors['name']}
              </p>
            )}
          </div>

          <div className="flex gap-3">
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={idScope} className={labelCls}>
                Scope
              </label>
              <select
                id={idScope}
                className="h-[30px] rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg disabled:opacity-[0.42]"
                value={form.scope}
                disabled={editing}
                onChange={(e) => patch({ scope: e.target.value as McpScope })}
              >
                {(['local', 'project', 'user'] as McpScope[]).map((s) => (
                  <option key={s} value={s} disabled={s !== 'user' && !hasProject}>
                    {SCOPE_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor={idTransport} className={labelCls}>
                Transport
              </label>
              <select
                id={idTransport}
                className="h-[30px] rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg disabled:opacity-[0.42]"
                value={form.transport}
                disabled={jsonMode}
                onChange={(e) => patch({ transport: e.target.value as FormTransport })}
              >
                <option value="stdio">stdio</option>
                <option value="http">http</option>
                <option value="sse">sse</option>
              </select>
            </div>
          </div>

          {jsonMode ? (
            <div className="flex h-56 flex-col gap-1">
              <span className={labelCls}>Config (JSON)</span>
              <CodeEditor language="json" ariaLabel="Server config JSON" value={jsonText} onChange={setJsonText} />
              {errors['config'] && <p className={errCls}>{errors['config']}</p>}
              {errors['command'] && <p className={errCls}>{errors['command']}</p>}
              {errors['url'] && <p className={errCls}>{errors['url']}</p>}
            </div>
          ) : form.transport === 'stdio' ? (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={idCmd} className={labelCls}>
                  Command
                </label>
                <Input
                  id={idCmd}
                  mono
                  placeholder="npx"
                  value={form.command}
                  error={Boolean(errors['command'])}
                  onChange={(e) => patch({ command: e.target.value })}
                />
                {errors['command'] && <p className={errCls}>{errors['command']}</p>}
              </div>
              <fieldset className="flex flex-col gap-1.5">
                <legend className={labelCls}>Arguments</legend>
                {form.args.map((a, i) => (
                  <div key={i} className="flex items-center gap-1.5">
                    <Input
                      mono
                      aria-label={`Argument ${i + 1}`}
                      value={a}
                      onChange={(e) => patch({ args: form.args.map((x, j) => (j === i ? e.target.value : x)) })}
                    />
                    <Button
                      variant="ghost"
                      size="icon-md"
                      aria-label={`Remove argument ${i + 1}`}
                      onClick={() => patch({ args: form.args.filter((_, j) => j !== i) })}
                    >
                      <Trash2 size={14} />
                    </Button>
                  </div>
                ))}
                <div>
                  <Button size="sm" variant="ghost" onClick={() => patch({ args: [...form.args, ''] })}>
                    <Plus size={12} /> Add argument
                  </Button>
                </div>
              </fieldset>
              <KvEditor label="Environment" rows={form.env} onChange={(env) => patch({ env })} secret />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label htmlFor={idUrl} className={labelCls}>
                  URL
                </label>
                <Input
                  id={idUrl}
                  mono
                  placeholder="https://example.com/mcp"
                  value={form.url}
                  error={Boolean(errors['url'])}
                  onChange={(e) => patch({ url: e.target.value })}
                />
                {errors['url'] && <p className={errCls}>{errors['url']}</p>}
              </div>
              <KvEditor label="Headers" rows={form.headers} onChange={(headers) => patch({ headers })} secret />
            </>
          )}

          {failure && (
            <div role="alert" className="rounded-sm border border-danger-border bg-danger-bg p-2 text-sm text-danger">
              <p className="font-medium">{failure.message}</p>
              {failure.output && <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-xs">{failure.output}</pre>}
            </div>
          )}
        </div>

        <DialogFooter className="justify-between">
          <Button variant="ghost" onClick={toggleJson} disabled={busy}>
            {jsonMode ? 'Form' : 'JSON'}
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void submit()} disabled={busy}>
              {busy ? 'Working...' : editing ? 'Save' : 'Add server'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
