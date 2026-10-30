import { Plus, X } from 'lucide-react'
import { useId, useMemo, useState } from 'react'
import { PermissionModeSchema } from '@shared/permission-mode'
import { SettingsFormSchema } from '@shared/config-schemas'
import type { ModelOption } from '@shared/config'
import { Button, Input, Toggle } from '@/components/ui'
import { MaskedValue } from './Masked'
import { applyPatch, getAt, type PatchOp } from './model/settings-patch'

const MODES = PermissionModeSchema.options
const FALLBACK_MODELS: ModelOption[] = ['default', 'sonnet', 'opus', 'haiku'].map((v) => ({ value: v, displayName: v }))

export function loadCachedModels(): ModelOption[] {
  try {
    const raw = window.localStorage.getItem('ccwrap.models')
    if (raw) {
      const v: unknown = JSON.parse(raw)
      if (Array.isArray(v)) {
        const list = v.filter((m): m is ModelOption => !!m && typeof (m as ModelOption).value === 'string')
        if (list.length > 0) return list
      }
    }
  } catch {
    // unavailable storage or bad cache: fall back
  }
  return FALLBACK_MODELS
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-md border border-border bg-bg-1 p-3" aria-label={title}>
      <div>
        <h3 className="text-md font-medium text-fg">{title}</h3>
        {hint && <p className="mt-0.5 text-sm text-fg-3">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

function strArray(v: unknown): string[] {
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []
}

function StringList({
  label,
  items,
  readOnly,
  onChange,
  placeholder
}: {
  label: string
  items: string[]
  readOnly: boolean
  onChange: (next: string[]) => void
  placeholder?: string
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
      <span className="text-sm font-medium text-fg-2">{label}</span>
      <ul className="flex flex-col gap-1" aria-label={`${label} rules`}>
        {items.map((it, i) => (
          <li key={`${it}:${i}`} className="flex items-center gap-1.5 rounded-sm border border-border bg-bg-2 pl-2">
            <code className="min-w-0 flex-1 truncate py-1 font-mono text-sm text-fg">{it}</code>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-label={`Remove ${it} from ${label}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              <X size={13} />
            </Button>
          </li>
        ))}
        {items.length === 0 && <li className="text-sm text-fg-3">None</li>}
      </ul>
      <div className="flex gap-1.5">
        <Input
          mono
          value={draft}
          disabled={readOnly}
          placeholder={placeholder}
          aria-label={`New ${label}`}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button variant="secondary" disabled={readOnly || !draft.trim()} onClick={add} aria-label={`Add ${label}`}>
          <Plus size={13} /> Add
        </Button>
      </div>
    </div>
  )
}

function EnvTable({
  env,
  readOnly,
  onPatch
}: {
  env: Record<string, string>
  readOnly: boolean
  onPatch: (ops: PatchOp[]) => void
}) {
  const [k, setK] = useState('')
  const [v, setV] = useState('')
  const entries = Object.entries(env)
  const add = () => {
    const key = k.trim()
    if (!key) return
    onPatch([{ op: 'set', path: ['env', key], value: v }])
    setK('')
    setV('')
  }
  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-col gap-1" aria-label="Environment variables">
        {entries.map(([name, value]) => (
          <li key={name} className="flex items-center gap-2 rounded-sm border border-border bg-bg-2 px-2 py-0.5">
            <code className="w-48 shrink-0 truncate font-mono text-sm text-fg">{name}</code>
            <span className="min-w-0 flex-1">
              <MaskedValue value={String(value)} label={name} />
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              disabled={readOnly}
              aria-label={`Remove ${name}`}
              onClick={() => onPatch([{ op: 'delete', path: ['env', name] }])}
            >
              <X size={13} />
            </Button>
          </li>
        ))}
        {entries.length === 0 && <li className="text-sm text-fg-3">None</li>}
      </ul>
      <div className="flex gap-1.5">
        <Input mono value={k} disabled={readOnly} placeholder="NAME" aria-label="New variable name" onChange={(e) => setK(e.target.value)} />
        <Input
          mono
          type="password"
          autoComplete="off"
          value={v}
          disabled={readOnly}
          placeholder="value"
          aria-label="New variable value"
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              add()
            }
          }}
        />
        <Button variant="secondary" disabled={readOnly || !k.trim()} onClick={add} aria-label="Add variable">
          <Plus size={13} /> Add
        </Button>
      </div>
    </div>
  )
}

export interface FormTabProps {
  text: string
  /** Parsed object, or undefined when the buffer does not parse (form becomes read-only). */
  value: Record<string, unknown> | undefined
  parseError?: string
  onTextChange: (next: string) => void
  onOpenRaw: () => void
}

export function FormTab({ text, value, parseError, onTextChange, onOpenRaw }: FormTabProps): React.JSX.Element {
  const readOnly = value === undefined
  const obj = value ?? {}
  const listId = useId()
  const models = useMemo(loadCachedModels, [])

  const patch = (ops: PatchOp[]) => {
    if (readOnly) return
    onTextChange(applyPatch(text, ops))
  }
  const setList = (path: string[], next: string[]) =>
    patch([next.length === 0 ? { op: 'delete', path } : { op: 'set', path, value: next }])

  const issues = useMemo(() => {
    if (readOnly) return []
    const r = SettingsFormSchema.safeParse(obj)
    return r.success ? [] : r.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
  }, [obj, readOnly])

  const model = getAt(obj, ['model'])
  const mode = getAt(obj, ['permissions', 'defaultMode'])
  const envRaw = getAt(obj, ['env'])
  const env: Record<string, string> =
    envRaw && typeof envRaw === 'object' && !Array.isArray(envRaw)
      ? Object.fromEntries(Object.entries(envRaw as object).map(([a, b]) => [a, typeof b === 'string' ? b : JSON.stringify(b)]))
      : {}
  const cleanup = getAt(obj, ['cleanupPeriodDays'])
  const enableAll = getAt(obj, ['enableAllProjectMcpServers'])

  return (
    <div className="flex flex-col gap-3" data-testid="settings-form">
      {readOnly && (
        <div role="alert" className="flex flex-wrap items-center gap-2 rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-base text-warn">
          <span>
            This file does not parse as a JSON object, so the form is read-only{parseError ? ` (${parseError})` : ''}.
          </span>
          <Button size="sm" variant="secondary" onClick={onOpenRaw}>
            Open Raw JSON
          </Button>
        </div>
      )}
      {issues.length > 0 && (
        <ul className="rounded-md border border-warn-border bg-warn-bg px-3 py-2 text-sm text-warn" aria-label="Schema warnings">
          {issues.map((i) => (
            <li key={i}>{i}</li>
          ))}
        </ul>
      )}

      <Section title="Model" hint="Alias or full model id. Leave empty to use the default.">
        <Input
          mono
          list={listId}
          value={typeof model === 'string' ? model : ''}
          disabled={readOnly}
          aria-label="Model"
          placeholder="default"
          onChange={(e) =>
            patch([e.target.value === '' ? { op: 'delete', path: ['model'] } : { op: 'set', path: ['model'], value: e.target.value }])
          }
        />
        <datalist id={listId}>
          {models.map((m) => (
            <option key={m.value} value={m.value}>
              {m.displayName}
            </option>
          ))}
        </datalist>
      </Section>

      <Section title="Permissions" hint="Rules merge across scopes. Deny beats ask beats allow.">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium text-fg-2">Default mode</span>
          <select
            aria-label="Default mode"
            disabled={readOnly}
            value={typeof mode === 'string' ? mode : ''}
            onChange={(e) =>
              patch([
                e.target.value === ''
                  ? { op: 'delete', path: ['permissions', 'defaultMode'] }
                  : { op: 'set', path: ['permissions', 'defaultMode'], value: e.target.value }
              ])
            }
            className="h-[30px] w-60 rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg focus:border-accent-from disabled:opacity-[0.42]"
          >
            <option value="">(unset)</option>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        {(['allow', 'ask', 'deny'] as const).map((k) => (
          <StringList
            key={k}
            label={k}
            items={strArray(getAt(obj, ['permissions', k]))}
            readOnly={readOnly}
            placeholder={k === 'allow' ? 'Bash(npm run test:*)' : undefined}
            onChange={(next) => setList(['permissions', k], next)}
          />
        ))}
        <StringList
          label="Additional directories"
          items={strArray(getAt(obj, ['permissions', 'additionalDirectories']))}
          readOnly={readOnly}
          onChange={(next) => setList(['permissions', 'additionalDirectories'], next)}
        />
      </Section>

      <Section title="Environment" hint="Values are hidden until revealed.">
        <EnvTable env={env} readOnly={readOnly} onPatch={patch} />
      </Section>

      <Section title="General">
        <label className="flex items-center gap-2">
          <span className="w-56 text-sm font-medium text-fg-2">Cleanup period (days)</span>
          <Input
            type="number"
            min={0}
            className="w-24"
            disabled={readOnly}
            aria-label="Cleanup period days"
            value={typeof cleanup === 'number' ? String(cleanup) : ''}
            onChange={(e) => {
              const n = e.target.value
              patch([n === '' ? { op: 'delete', path: ['cleanupPeriodDays'] } : { op: 'set', path: ['cleanupPeriodDays'], value: Number(n) }])
            }}
          />
        </label>
      </Section>

      <Section title="Project MCP servers" hint="Controls which servers from .mcp.json may start.">
        <label className="flex items-center gap-2">
          <Toggle
            aria-label="Enable all project MCP servers"
            disabled={readOnly}
            checked={enableAll === true}
            onCheckedChange={(c) => patch([{ op: 'set', path: ['enableAllProjectMcpServers'], value: c }])}
          />
          <span className="text-base text-fg">Enable all project MCP servers</span>
        </label>
        <StringList
          label="Enabled .mcp.json servers"
          items={strArray(getAt(obj, ['enabledMcpjsonServers']))}
          readOnly={readOnly}
          onChange={(next) => setList(['enabledMcpjsonServers'], next)}
        />
        <StringList
          label="Disabled .mcp.json servers"
          items={strArray(getAt(obj, ['disabledMcpjsonServers']))}
          readOnly={readOnly}
          onChange={(next) => setList(['disabledMcpjsonServers'], next)}
        />
      </Section>
    </div>
  )
}
