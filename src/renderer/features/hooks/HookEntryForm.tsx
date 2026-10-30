import { Eye, EyeOff, Plus, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { CodeEditor } from '@/components/editor'
import { Button, Input, Textarea, Toggle } from '@/components/ui'
import { defaultEntry, entryType, isKnownEntryType, KNOWN_ENTRY_TYPES, type KnownEntryType, type RawObj } from './model/hooks-model'

const selectClass =
  'h-[30px] rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg transition-[border-color] duration-fast hover:bg-bg-3 focus:border-accent-from'

const TYPE_LABEL: Record<KnownEntryType, string> = {
  command: 'Command',
  prompt: 'Prompt',
  agent: 'Agent',
  http: 'HTTP request',
  mcp_tool: 'MCP tool'
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex min-w-0 flex-col gap-1">
      <span className="text-sm font-medium text-fg-2">{label}</span>
      {children}
      {hint && <span className="text-xs text-fg-3">{hint}</span>}
    </label>
  )
}

function withKey(entry: RawObj, key: string, value: unknown): RawObj {
  const next: RawObj = { ...entry }
  if (value === undefined) delete next[key]
  else next[key] = value
  return next
}

/** One header row: the value is a password input until revealed, so it never shows by default. */
function HeaderRow({ name, value, onName, onValue, onRemove }: { name: string; value: string; onName: (n: string) => void; onValue: (v: string) => void; onRemove: () => void }) {
  const [shown, setShown] = useState(false)
  return (
    <li className="flex items-center gap-1.5">
      <Input mono aria-label="Header name" value={name} onChange={(e) => onName(e.target.value)} className="w-40" />
      <Input
        mono
        aria-label={`Value of header ${name || '(new)'}`}
        type={shown ? 'text' : 'password'}
        autoComplete="off"
        value={value}
        onChange={(e) => onValue(e.target.value)}
        className="min-w-0 flex-1"
      />
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`${shown ? 'Hide' : 'Reveal'} value of header ${name || '(new)'}`}
        aria-pressed={shown}
        onClick={() => setShown((s) => !s)}
      >
        {shown ? <EyeOff size={13} /> : <Eye size={13} />}
      </Button>
      <Button variant="ghost" size="icon-sm" aria-label={`Remove header ${name || '(new)'}`} onClick={onRemove}>
        <X size={13} />
      </Button>
    </li>
  )
}

function HeadersField({ entry, onChange }: { entry: RawObj; onChange: (e: RawObj) => void }) {
  const headers = entry.headers && typeof entry.headers === 'object' && !Array.isArray(entry.headers) ? (entry.headers as Record<string, unknown>) : {}
  // Rows are kept as an ordered list so renaming a header does not reorder it.
  const rows = Object.entries(headers).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)] as const)
  const commit = (next: Array<readonly [string, string]>) => {
    const obj: Record<string, string> = {}
    for (const [k, v] of next) obj[k] = v
    onChange(withKey(entry, 'headers', next.length === 0 ? undefined : obj))
  }
  return (
    <div className="flex flex-col gap-1.5" role="group" aria-label="Headers">
      <span className="text-sm font-medium text-fg-2">Headers (values hidden until revealed)</span>
      <ul className="flex flex-col gap-1.5">
        {rows.map(([k, v], i) => (
          <HeaderRow
            key={i}
            name={k}
            value={v}
            onName={(n) => commit(rows.map((r, j) => (j === i ? ([n, r[1]] as const) : r)))}
            onValue={(nv) => commit(rows.map((r, j) => (j === i ? ([r[0], nv] as const) : r)))}
            onRemove={() => commit(rows.filter((_, j) => j !== i))}
          />
        ))}
      </ul>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => commit([...rows, [`X-Header-${rows.length + 1}`, ''] as const])}>
        <Plus size={12} /> Add header
      </Button>
    </div>
  )
}

function TextField({ entry, k, label, onChange, mono, hint, multiline }: { entry: RawObj; k: string; label: string; onChange: (e: RawObj) => void; mono?: boolean; hint?: string; multiline?: boolean }) {
  const v = typeof entry[k] === 'string' ? (entry[k] as string) : ''
  const set = (s: string) => onChange(withKey(entry, k, s === '' ? (k === 'command' || k === 'prompt' || k === 'url' || k === 'server' || k === 'tool' ? '' : undefined) : s))
  return (
    <Field label={label} hint={hint}>
      {multiline ? (
        <Textarea mono={mono} rows={3} value={v} onChange={(e) => set(e.target.value)} />
      ) : (
        <Input mono={mono} value={v} onChange={(e) => set(e.target.value)} />
      )}
    </Field>
  )
}

function NumberField({ entry, k, label, onChange }: { entry: RawObj; k: string; label: string; onChange: (e: RawObj) => void }) {
  const v = typeof entry[k] === 'number' ? String(entry[k]) : ''
  return (
    <Field label={label}>
      <Input
        type="number"
        min={1}
        value={v}
        onChange={(e) => onChange(withKey(entry, k, e.target.value === '' ? undefined : Number(e.target.value)))}
        className="w-28"
      />
    </Field>
  )
}

function BoolField({ entry, k, label, onChange }: { entry: RawObj; k: string; label: string; onChange: (e: RawObj) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Toggle aria-label={label} checked={entry[k] === true} onCheckedChange={(c) => onChange(withKey(entry, k, c ? true : undefined))} />
      <span className="text-sm text-fg-2" aria-hidden>
        {label}
      </span>
    </div>
  )
}

function SelectField({ entry, k, label, options, onChange }: { entry: RawObj; k: string; label: string; options: string[]; onChange: (e: RawObj) => void }) {
  const v = typeof entry[k] === 'string' ? (entry[k] as string) : ''
  return (
    <Field label={label}>
      <select className={selectClass} value={v} onChange={(e) => onChange(withKey(entry, k, e.target.value === '' ? undefined : e.target.value))}>
        <option value="">(default)</option>
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </Field>
  )
}

/** Per-entry JSON box for unknown keys and types. For http entries the headers are left out so secrets stay masked. */
function EntryJson({ entry, onChange }: { entry: RawObj; onChange: (e: RawObj) => void }) {
  const hideHeaders = entryType(entry) === 'http'
  const view = (e: RawObj): string => {
    const copy = { ...e }
    if (hideHeaders) delete copy.headers
    return JSON.stringify(copy, null, 2)
  }
  const [text, setText] = useState(() => view(entry))
  const lastEmitted = useRef(view(entry))
  useEffect(() => {
    const v = view(entry)
    if (v !== lastEmitted.current) {
      lastEmitted.current = v
      setText(v)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry])
  let error: string | undefined
  try {
    const p: unknown = JSON.parse(text)
    if (p === null || typeof p !== 'object' || Array.isArray(p)) error = 'Must be a JSON object'
  } catch (e) {
    error = e instanceof Error ? e.message : String(e)
  }
  return (
    <div className="flex flex-col gap-1">
      <div className="flex h-40 min-h-0 flex-col">
        <CodeEditor
          language="json"
          ariaLabel="Entry JSON"
          value={text}
          onChange={(t) => {
            setText(t)
            try {
              const p: unknown = JSON.parse(t)
              if (p !== null && typeof p === 'object' && !Array.isArray(p)) {
                const next = { ...(p as RawObj) }
                if (hideHeaders && entry.headers !== undefined) next.headers = entry.headers
                lastEmitted.current = t
                onChange(next)
              }
            } catch {
              // keep typing; the entry is only replaced by valid JSON
            }
          }}
        />
      </div>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : (
        hideHeaders && <p className="text-xs text-fg-3">Headers are edited above and are not shown here.</p>
      )}
    </div>
  )
}

export function HookEntryForm({ entry, onChange }: { entry: RawObj; onChange: (e: RawObj) => void }): React.JSX.Element {
  const t = entryType(entry)
  const known = isKnownEntryType(t)
  const [showJson, setShowJson] = useState(!known)

  const changeType = (next: string) => {
    if (!isKnownEntryType(next)) return
    const fresh = defaultEntry(next)
    for (const k of ['timeout', 'statusMessage'] as const) if (entry[k] !== undefined) fresh[k] = entry[k]
    onChange(fresh)
  }

  return (
    <div className="flex flex-col gap-3">
      <Field label="Type">
        <select className={`${selectClass} w-48`} value={t} onChange={(e) => changeType(e.target.value)} aria-label="Hook type">
          {!known && <option value={t}>{t || '(none)'} (unknown type)</option>}
          {KNOWN_ENTRY_TYPES.map((k) => (
            <option key={k} value={k}>
              {TYPE_LABEL[k]}
            </option>
          ))}
        </select>
      </Field>

      {t === 'command' && (
        <>
          <TextField entry={entry} k="command" label="Command" mono onChange={onChange} hint="Runs automatically when the event fires. ccwraper never runs it." />
          <div className="flex flex-wrap items-end gap-3">
            <SelectField entry={entry} k="shell" label="Shell" options={['bash', 'powershell']} onChange={onChange} />
            <NumberField entry={entry} k="timeout" label="Timeout (seconds)" onChange={onChange} />
            <SelectField entry={entry} k="onFailure" label="On failure" options={['continue', 'block']} onChange={onChange} />
          </div>
          <TextField entry={entry} k="if" label="Condition (if)" mono onChange={onChange} />
          <TextField entry={entry} k="statusMessage" label="Status message" onChange={onChange} />
          <div className="flex flex-wrap gap-4">
            <BoolField entry={entry} k="async" label="Async" onChange={onChange} />
            <BoolField entry={entry} k="asyncRewake" label="Async rewake" onChange={onChange} />
            <BoolField entry={entry} k="once" label="Once" onChange={onChange} />
          </div>
        </>
      )}

      {(t === 'prompt' || t === 'agent') && (
        <>
          <TextField entry={entry} k="prompt" label="Prompt" multiline onChange={onChange} />
          <div className="flex flex-wrap items-end gap-3">
            <TextField entry={entry} k="model" label="Model" onChange={onChange} />
            <NumberField entry={entry} k="timeout" label="Timeout (seconds)" onChange={onChange} />
          </div>
          {t === 'prompt' && <BoolField entry={entry} k="continueOnBlock" label="Continue on block" onChange={onChange} />}
          <TextField entry={entry} k="statusMessage" label="Status message" onChange={onChange} />
        </>
      )}

      {t === 'http' && (
        <>
          <TextField entry={entry} k="url" label="URL" mono onChange={onChange} hint="Called automatically when the event fires." />
          <HeadersField entry={entry} onChange={onChange} />
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Allowed env vars (comma separated)">
              <Input
                mono
                value={Array.isArray(entry.allowedEnvVars) ? (entry.allowedEnvVars as unknown[]).join(', ') : ''}
                onChange={(e) => {
                  const list = e.target.value.split(',').map((s) => s.trim()).filter(Boolean)
                  onChange(withKey(entry, 'allowedEnvVars', list.length === 0 ? undefined : list))
                }}
              />
            </Field>
            <NumberField entry={entry} k="timeout" label="Timeout (seconds)" onChange={onChange} />
            <SelectField entry={entry} k="onFailure" label="On failure" options={['continue', 'block']} onChange={onChange} />
          </div>
        </>
      )}

      {t === 'mcp_tool' && (
        <>
          <div className="flex flex-wrap gap-3">
            <TextField entry={entry} k="server" label="MCP server" mono onChange={onChange} />
            <TextField entry={entry} k="tool" label="Tool" mono onChange={onChange} />
            <NumberField entry={entry} k="timeout" label="Timeout (seconds)" onChange={onChange} />
          </div>
          <p className="text-xs text-fg-3">Tool input is edited in the JSON box below (input).</p>
        </>
      )}

      {!known && <p className="text-sm text-fg-3">This hook type is not known to this version. Edit it in the JSON box; it is kept as is.</p>}

      <div className="flex flex-col gap-1.5">
        <Button size="sm" variant="ghost" className="self-start" aria-expanded={showJson} onClick={() => setShowJson((s) => !s)}>
          {showJson ? 'Hide entry JSON' : 'Entry JSON (other keys)'}
        </Button>
        {showJson && <EntryJson entry={entry} onChange={onChange} />}
      </div>
    </div>
  )
}
