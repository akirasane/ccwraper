import { defaultKeymap, history, historyKeymap } from '@codemirror/commands'
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
export const parserCompartment = new Compartment()
export const readOnlyCompartment = new Compartment()

/**
 * Synchronous part of a language: external diagnostics, gutter, wrapping. The parser
 * (loadLanguage) arrives later so the base chunk stays free of lang-html / lang-js / lang-css.
 */
export function languageExtensions(
  language: EditorLanguage,
  getExternal: () => readonly ExternalDiagnostic[]
): Extension {
  const external = (view: EditorView): Diagnostic[] => {
    const len = view.state.doc.length
    return getExternal().map((d) => {
      const from = Math.max(0, Math.min(d.from, len))
      const to = Math.max(from, Math.min(d.to, len))
      return { from, to, message: d.message, severity: d.severity, source: 'ccwrap' }
    })
  }
  const lint = [linter(external, { delay: 250 }), lintGutter()]
  return language === 'json' ? lint : [EditorView.lineWrapping, lint]
}

/** Loads the parser (and for JSON its parse linter) on demand, in its own chunk. */
export async function loadLanguage(language: EditorLanguage): Promise<Extension> {
  if (language === 'json') {
    const m = await import('@codemirror/lang-json')
    return [m.json(), linter(m.jsonParseLinter(), { delay: 250 })]
  }
  const m = await import('@codemirror/lang-markdown')
  return m.markdown()
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
