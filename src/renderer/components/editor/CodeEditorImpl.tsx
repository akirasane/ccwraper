import { forceLinting } from '@codemirror/lint'
import { Annotation, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { useEffect, useRef } from 'react'
import {
  baseExtensions,
  languageCompartment,
  languageExtensions,
  loadLanguage,
  parserCompartment,
  readOnlyCompartment,
  readOnlyExtensions
} from './cm-setup'
import type { CodeEditorProps } from './CodeEditor'

const external = Annotation.define<boolean>()

/** CodeMirror 6 implementation of CodeEditor. Loaded lazily through CodeEditor.tsx. */
export default function CodeEditorImpl({
  value,
  onChange,
  language,
  ariaLabel,
  readOnly = false,
  diagnostics,
  onSave
}: CodeEditorProps): React.JSX.Element {
  const host = useRef<HTMLDivElement>(null)
  const view = useRef<EditorView | null>(null)
  // Latest props for callbacks created once per mount.
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const diagRef = useRef(diagnostics ?? [])
  onChangeRef.current = onChange
  onSaveRef.current = onSave
  diagRef.current = diagnostics ?? []
  const initial = useRef({ value, language, readOnly, ariaLabel })

  // Created once per mount; destroyed on unmount (StrictMode mounts, destroys, mounts again).
  useEffect(() => {
    const init = initial.current
    const v = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: init.value,
        extensions: [
          baseExtensions({ ariaLabel: init.ariaLabel, onSave: () => onSaveRef.current?.() }),
          languageCompartment.of(languageExtensions(init.language, () => diagRef.current)),
          parserCompartment.of([]),
          readOnlyCompartment.of(readOnlyExtensions(init.readOnly)),
          EditorView.updateListener.of((u) => {
            if (u.docChanged && !u.transactions.some((tr) => tr.annotation(external))) {
              onChangeRef.current(u.state.doc.toString())
            }
          })
        ]
      })
    })
    view.current = v
    return () => {
      v.destroy()
      view.current = null
    }
  }, [])

  // Controlled value: apply only when it differs from the document.
  useEffect(() => {
    const v = view.current
    if (!v) return
    const cur = v.state.doc.toString()
    if (cur !== value) {
      v.dispatch({ changes: { from: 0, to: cur.length, insert: value }, annotations: external.of(true) })
    }
  }, [value])

  useEffect(() => {
    view.current?.dispatch({ effects: readOnlyCompartment.reconfigure(readOnlyExtensions(readOnly)) })
  }, [readOnly])

  useEffect(() => {
    view.current?.dispatch({
      effects: [
        languageCompartment.reconfigure(languageExtensions(language, () => diagRef.current)),
        parserCompartment.reconfigure([])
      ]
    })
    let cancelled = false
    void loadLanguage(language).then((ext) => {
      const v = view.current
      if (cancelled || !v) return
      v.dispatch({ effects: parserCompartment.reconfigure(ext) })
      forceLinting(v)
    })
    return () => {
      cancelled = true
    }
  }, [language])

  useEffect(() => {
    if (view.current) forceLinting(view.current)
  }, [diagnostics])

  return <div ref={host} className="min-h-0 flex-1 overflow-hidden" data-testid="code-editor" />
}
