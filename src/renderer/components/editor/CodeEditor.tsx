import { lazy, Suspense } from 'react'

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

// CodeMirror lives in its own chunk (P2 D3); importing this module never pulls it into the main bundle.
const Impl = lazy(() => import('./CodeEditorImpl'))

export function CodeEditor(props: CodeEditorProps): React.JSX.Element {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Suspense
        fallback={
          <div
            role="status"
            aria-busy="true"
            className="flex-1 rounded-sm border border-border bg-bg-1 p-2 text-xs text-fg-3"
          >
            Loading editor...
          </div>
        }
      >
        <Impl {...props} />
      </Suspense>
    </div>
  )
}

export default CodeEditor
