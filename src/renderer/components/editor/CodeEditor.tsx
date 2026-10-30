// PLACEHOLDER (WP0): a <textarea> with the frozen props. WP5 replaces it with CodeMirror 6.
export interface CodeEditorDiagnostic {
  from: number
  to: number
  message: string
  severity: 'error' | 'warning'
}

export interface CodeEditorProps {
  value: string
  onChange: (value: string) => void
  language: 'json' | 'markdown'
  ariaLabel: string
  readOnly?: boolean
  diagnostics?: CodeEditorDiagnostic[]
  /** Bound to Ctrl+S. */
  onSave?: () => void
}

export function CodeEditor({ value, onChange, ariaLabel, readOnly, diagnostics, onSave }: CodeEditorProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <textarea
        aria-label={ariaLabel}
        className="min-h-0 flex-1 resize-none rounded-sm border border-border bg-bg-1 p-2 font-mono text-sm text-fg"
        spellCheck={false}
        readOnly={readOnly}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (onSave && e.ctrlKey && e.key.toLowerCase() === 's') {
            e.preventDefault()
            onSave()
          }
        }}
      />
      {diagnostics && diagnostics.length > 0 && (
        <ul className="mt-1 text-xs text-fg-3">
          {diagnostics.map((d, i) => (
            <li key={i}>{d.message}</li>
          ))}
        </ul>
      )}
    </div>
  )
}
