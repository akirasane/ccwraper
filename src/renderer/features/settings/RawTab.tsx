import { useMemo } from 'react'
import { SettingsFormSchema } from '@shared/config-schemas'
import { CodeEditor, type CodeEditorDiagnostic } from '@/components/editor'
import type { ParseResult } from './model/settings-patch'

/** Best-effort offset of a schema issue: the last path segment as a quoted key, else the file start. */
function locate(text: string, path: PropertyKey[]): { from: number; to: number } {
  for (let i = path.length - 1; i >= 0; i--) {
    const seg = path[i]
    if (typeof seg !== 'string') continue
    const needle = `"${seg}"`
    const at = text.indexOf(needle)
    if (at >= 0) return { from: at, to: at + needle.length }
  }
  return { from: 0, to: Math.min(1, text.length) }
}

export function schemaWarnings(text: string, parsed: ParseResult): CodeEditorDiagnostic[] {
  if (!parsed.ok || text.trim() === '') return []
  const r = SettingsFormSchema.safeParse(parsed.value)
  if (r.success) return []
  return r.error.issues.map((i) => ({
    ...locate(text, i.path),
    message: `${i.path.join('.') || '(root)'}: ${i.message}`,
    severity: 'warning' as const
  }))
}

export interface RawTabProps {
  text: string
  parsed: ParseResult
  onChange: (t: string) => void
  onSave: () => void
}

export function RawTab({ text, parsed, onChange, onSave }: RawTabProps): React.JSX.Element {
  const diagnostics = useMemo(() => schemaWarnings(text, parsed), [text, parsed])
  return (
    <div className="flex min-h-[320px] flex-1 flex-col gap-2" data-testid="settings-raw">
      <CodeEditor value={text} onChange={onChange} language="json" ariaLabel="Raw settings JSON" diagnostics={diagnostics} onSave={onSave} />
      {!parsed.ok ? (
        <p role="alert" className="text-sm text-danger">
          Invalid JSON: {parsed.message}. Saving is disabled until this is fixed.
        </p>
      ) : diagnostics.length > 0 ? (
        <ul className="text-sm text-warn" aria-label="Schema warnings">
          {diagnostics.map((d) => (
            <li key={d.message}>{d.message} (warning, does not block saving)</li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
