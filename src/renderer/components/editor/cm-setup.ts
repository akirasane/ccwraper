import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
import { json, jsonParseLinter } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { bracketMatching, indentOnInput } from '@codemirror/language'
import { type Diagnostic, linter, lintGutter } from '@codemirror/lint'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { Compartment, EditorState, type Extension } from '@codemirror/state'
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  keymap,
  lineNumbers
} from '@codemirror/view'
import { ccwrapTheme } from './cm-theme'

export type EditorLanguage = 'json' | 'markdown'

export interface ExternalDiagnostic {
  from: number
  to: number
  message: string
  severity: 'error' | 'warning'
}

export const languageCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()

export function languageExtensions(
  language: EditorLanguage,
  getExternal: () => readonly ExternalDiagnostic[]
): Extension {
  const merged = (view: EditorView): Diagnostic[] => {
    const len = view.state.doc.length
    const ext: Diagnostic[] = getExternal().map((d) => {
      const from = Math.max(0, Math.min(d.from, len))
      const to = Math.max(from, Math.min(d.to, len))
      return { from, to, message: d.message, severity: d.severity, source: 'ccwrap' }
    })
    if (language !== 'json') return ext
    return [...jsonParseLinter()(view), ...ext]
  }
  const lint = [linter(merged, { delay: 250 }), lintGutter()]
  return language === 'json'
    ? [json(), lint]
    : [markdown(), EditorView.lineWrapping, lint]
}

export function readOnlyExtensions(readOnly: boolean): Extension {
  // editable stays true so keyboard users can still focus, select and search.
  return [
    EditorView.contentAttributes.of({ 'aria-readonly': readOnly ? 'true' : 'false' }),
    EditorState.readOnly.of(readOnly)
  ]
}

export interface BaseSetupOptions {
  ariaLabel: string
  onSave: () => void
}

/** Ctrl+S (Mod-s) runs onSave. Tab is not captured so keyboard users can leave the editor. */
export function baseExtensions({ ariaLabel, onSave }: BaseSetupOptions): Extension {
  return [
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    history(),
    drawSelection(),
    indentOnInput(),
    bracketMatching(),
    highlightSelectionMatches(),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSave()
          return true
        }
      },
      ...searchKeymap,
      ...historyKeymap,
      ...defaultKeymap
    ]),
    EditorView.contentAttributes.of({ 'aria-label': ariaLabel, 'aria-multiline': 'true' }),
    ccwrapTheme
  ]
}
