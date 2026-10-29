// Lazy shiki highlighter: JS regex engine only (the CSP blocks WASM), fixed language set,
// colors come from CSS variables (--shiki-*, defined in features/chat/chat.css from the design tokens).
import type { HighlighterCore } from 'shiki/core'

const LOADERS: Record<string, () => Promise<unknown>> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  sql: () => import('shiki/langs/sql.mjs')
}

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  sh: 'bash',
  shell: 'bash',
  shellscript: 'bash',
  zsh: 'bash',
  ps1: 'powershell',
  pwsh: 'powershell',
  py: 'python',
  yml: 'yaml',
  md: 'markdown',
  jsonc: 'json'
}

export const SUPPORTED_LANGS = Object.keys(LOADERS)

/** Maps a fence info string to a supported language id, or undefined (rendered as plain text). */
export function resolveLang(lang: string | undefined): string | undefined {
  if (!lang) return undefined
  const l = lang.toLowerCase()
  const id = ALIASES[l] ?? l
  return id in LOADERS ? id : undefined
}

const THEME = 'ccw'
let highlighterPromise: Promise<HighlighterCore> | undefined
const loaded = new Set<string>()

function getHighlighter(): Promise<HighlighterCore> {
  highlighterPromise ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] = await Promise.all([
      import('shiki/core'),
      import('shiki/engine/javascript')
    ])
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: THEME, variablePrefix: '--shiki-', fontStyle: true })],
      langs: [],
      engine: createJavaScriptRegexEngine()
    })
  })()
  return highlighterPromise
}

/** Highlights `code` to an HTML string (token spans only). Resolves undefined for unknown languages. */
export async function highlightToHtml(code: string, lang: string | undefined): Promise<string | undefined> {
  const id = resolveLang(lang)
  if (!id) return undefined
  const hl = await getHighlighter()
  if (!loaded.has(id)) {
    const mod = (await LOADERS[id]!()) as { default: Parameters<HighlighterCore['loadLanguage']>[0] }
    await hl.loadLanguage(mod.default)
    loaded.add(id)
  }
  return hl.codeToHtml(code, { lang: id, theme: THEME })
}
