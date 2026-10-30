import { HighlightStyle, syntaxHighlighting } from '@codemirror/language'
import type { Extension } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { tags as t } from '@lezer/highlight'

// Only CSS variables from styles/tokens.css. No literal colors here (the no-hex test enforces it).
const accentSel = 'color-mix(in srgb, var(--accent-from) 25%, transparent)'

export const ccwrapEditorTheme = EditorView.theme(
  {
    '&': {
      color: 'var(--text-primary)',
      backgroundColor: 'var(--bg-1)',
      fontSize: 'var(--text-sm)',
      border: '1px solid var(--border)',
      borderRadius: 'var(--radius-sm)',
      height: '100%'
    },
    '&.cm-focused': { outline: 'none', boxShadow: 'var(--accent-ring)' },
    '.cm-scroller': { fontFamily: 'var(--font-mono)', lineHeight: '1.6', overflow: 'auto' },
    '.cm-content': { caretColor: 'var(--accent-text)', padding: '8px 0' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: 'var(--accent-text)', borderLeftWidth: '2px' },
    '&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection':
      { backgroundColor: accentSel },
    '.cm-activeLine': { backgroundColor: 'var(--bg-2)' },
    '.cm-gutters': {
      backgroundColor: 'var(--bg-1)',
      color: 'var(--text-tertiary)',
      border: 'none',
      borderRight: '1px solid var(--border)'
    },
    '.cm-activeLineGutter': { backgroundColor: 'var(--bg-2)', color: 'var(--text-secondary)' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'var(--accent-tint)',
      outline: '1px solid var(--accent-text)'
    },
    '.cm-nonmatchingBracket': { color: 'var(--danger)' },
    '.cm-searchMatch': { backgroundColor: 'var(--warn-bg)', outline: '1px solid var(--warn-border)' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'var(--accent-tint)' },
    '.cm-panels': {
      backgroundColor: 'var(--bg-2)',
      color: 'var(--text-primary)',
      borderColor: 'var(--border)'
    },
    '.cm-panels.cm-panels-bottom': { borderTop: '1px solid var(--border)' },
    '.cm-panel input, .cm-panel button, .cm-panel label': { fontSize: 'var(--text-xs)' },
    '.cm-panel input.cm-textfield': {
      backgroundColor: 'var(--bg-1)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-xs)'
    },
    '.cm-panel input.cm-textfield:focus-visible, .cm-panel button:focus-visible, .cm-panel input[type=checkbox]:focus-visible':
      { outline: '2px solid var(--accent-text)', outlineOffset: '1px' },
    '.cm-panel button': {
      backgroundImage: 'none',
      backgroundColor: 'var(--bg-3)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-xs)'
    },
    '.cm-tooltip': {
      backgroundColor: 'var(--bg-3)',
      color: 'var(--text-primary)',
      border: '1px solid var(--border-strong)',
      borderRadius: 'var(--radius-xs)'
    },
    '.cm-tooltip-lint': { fontSize: 'var(--text-xs)' },
    '.cm-diagnostic-error': { borderLeft: '3px solid var(--danger)' },
    '.cm-diagnostic-warning': { borderLeft: '3px solid var(--warn)' },
    '.cm-lintRange-error': { backgroundImage: 'none', textDecoration: 'underline wavy var(--danger)' },
    '.cm-lintRange-warning': { backgroundImage: 'none', textDecoration: 'underline wavy var(--warn)' },
    '.cm-lint-marker-error': { content: 'none', backgroundColor: 'var(--danger)', borderRadius: '50%' },
    '.cm-lint-marker-warning': { content: 'none', backgroundColor: 'var(--warn)', borderRadius: '50%' }
  },
  { dark: true }
)

export const ccwrapHighlightStyle = HighlightStyle.define([
  { tag: [t.propertyName, t.definition(t.propertyName)], color: 'var(--accent-text)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: [t.number, t.bool, t.null, t.atom], color: 'var(--warn)' },
  { tag: [t.keyword, t.operatorKeyword], color: 'var(--info)' },
  { tag: [t.punctuation, t.separator, t.bracket, t.operator], color: 'var(--text-secondary)' },
  { tag: [t.comment, t.meta], color: 'var(--text-tertiary)', fontStyle: 'italic' },
  { tag: t.heading, color: 'var(--text-primary)', fontWeight: '600' },
  { tag: t.strong, fontWeight: '700' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.strikethrough, textDecoration: 'line-through' },
  { tag: [t.link, t.url], color: 'var(--info)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--accent-text)' },
  { tag: t.quote, color: 'var(--text-secondary)' },
  { tag: t.invalid, color: 'var(--danger)' }
])

export const ccwrapTheme: Extension = [ccwrapEditorTheme, syntaxHighlighting(ccwrapHighlightStyle)]
