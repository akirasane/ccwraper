import type { McpScope, McpServerEntry } from '@shared/config'
import { McpServerConfigSchema } from '@shared/config-schemas'

export type FormTransport = 'stdio' | 'http' | 'sse'
export interface KvRow {
  id: number
  key: string
  value: string
}

export interface ServerForm {
  name: string
  scope: McpScope
  transport: FormTransport
  command: string
  args: string[]
  env: KvRow[]
  url: string
  headers: KvRow[]
}

export const NAME_RE = /^[A-Za-z0-9_.-]{1,64}$/
export const MASK = '••••••'

let rowSeq = 1
export const newRow = (key = '', value = ''): KvRow => ({ id: rowSeq++, key, value })

export const emptyForm = (scope: McpScope): ServerForm => ({
  name: '',
  scope,
  transport: 'stdio',
  command: '',
  args: [],
  env: [],
  url: '',
  headers: []
})

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

function rowsFrom(v: unknown): KvRow[] {
  if (!isRecord(v)) return []
  return Object.entries(v).map(([k, val]) => newRow(k, String(val)))
}

export function formFromEntry(e: McpServerEntry): ServerForm {
  const c = e.config
  const transport: FormTransport = e.transport === 'http' || e.transport === 'sse' ? e.transport : 'stdio'
  return {
    name: e.name,
    scope: e.scope,
    transport,
    command: typeof c['command'] === 'string' ? c['command'] : '',
    args: Array.isArray(c['args']) ? c['args'].map(String) : [],
    env: rowsFrom(c['env']),
    url: typeof c['url'] === 'string' ? c['url'] : '',
    headers: rowsFrom(c['headers'])
  }
}

function recordFromRows(rows: KvRow[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const r of rows) if (r.key.trim()) out[r.key.trim()] = r.value
  return out
}

/** Merge the form fields over `base` (the stored config) so unknown keys survive an edit. */
export function configFromForm(f: ServerForm, base: Record<string, unknown> = {}): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base }
  if (f.transport === 'stdio') {
    delete out['url']
    delete out['headers']
    delete out['type']
    out['command'] = f.command.trim()
    const args = f.args.filter((a) => a !== '')
    if (args.length) out['args'] = args
    else delete out['args']
    const env = recordFromRows(f.env)
    if (Object.keys(env).length) out['env'] = env
    else delete out['env']
  } else {
    delete out['command']
    delete out['args']
    delete out['env']
    out['type'] = f.transport
    out['url'] = f.url.trim()
    const headers = recordFromRows(f.headers)
    if (Object.keys(headers).length) out['headers'] = headers
    else delete out['headers']
  }
  return out
}

export interface ValidationResult {
  config?: Record<string, unknown>
  errors: Record<string, string>
}

/** Validate a config object against the frozen zod schema; `name` is checked here too. */
export function validateConfig(name: string, config: unknown, needName = true): ValidationResult {
  const errors: Record<string, string> = {}
  if (needName && !NAME_RE.test(name)) errors['name'] = 'Use 1-64 letters, digits, dot, dash or underscore'
  const parsed = McpServerConfigSchema.safeParse(config)
  if (!parsed.success) {
    for (const issue of parsed.error.issues) {
      const path = issue.path[0]
      const key = path === 'command' ? 'command' : path === 'url' ? 'url' : 'config'
      if (errors[key]) continue
      errors[key] =
        key === 'command'
          ? 'Command is required'
          : key === 'url'
            ? 'Enter a valid URL, e.g. https://host/mcp'
            : 'Config does not match a stdio, http or sse server'
    }
    // Union errors repeat per branch; if command and url both failed on an empty form, keep the relevant one.
    if (isRecord(config)) {
      if (config['type'] === undefined || config['type'] === 'stdio') delete errors['url']
      else delete errors['command']
    }
  }
  if (Object.keys(errors).length) return { errors }
  return { errors, config: config as Record<string, unknown> }
}

export function parseJsonConfig(text: string): { value?: Record<string, unknown>; error?: string } {
  try {
    const v: unknown = JSON.parse(text)
    if (!isRecord(v)) return { error: 'Config must be a JSON object' }
    return { value: v }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'Invalid JSON' }
  }
}

export function formFromConfig(base: ServerForm, config: Record<string, unknown>): ServerForm {
  const t = config['type']
  const transport: FormTransport = t === 'http' || t === 'sse' ? t : 'stdio'
  return {
    ...base,
    transport,
    command: typeof config['command'] === 'string' ? config['command'] : '',
    args: Array.isArray(config['args']) ? config['args'].map(String) : [],
    env: rowsFrom(config['env']),
    url: typeof config['url'] === 'string' ? config['url'] : '',
    headers: rowsFrom(config['headers'])
  }
}

/** One-line summary of how the server is reached (never includes env or header values). */
export function summarize(e: McpServerEntry): string {
  const c = e.config
  if (typeof c['url'] === 'string') return c['url']
  const cmd = typeof c['command'] === 'string' ? c['command'] : ''
  const args = Array.isArray(c['args']) ? c['args'].map(String).join(' ') : ''
  return [cmd, args].filter(Boolean).join(' ')
}

/** Names of env/header keys present, for the list (values stay masked). */
export function secretKeys(e: McpServerEntry): string[] {
  const out: string[] = []
  for (const k of ['env', 'headers']) {
    const v = e.config[k]
    if (isRecord(v)) out.push(...Object.keys(v))
  }
  return out
}

function detectIndent(text: string): number | string {
  const m = /^\n?[{[]\s*\n([ \t]+)\S/.exec(text)
  return m?.[1] ?? 2
}

/**
 * Approve / reject a project server by patching settings.local.json text.
 * Keeps every other key; only the two documented arrays change.
 */
export function patchApproval(
  text: string,
  name: string,
  decision: 'approve' | 'reject'
): { text: string } | { error: string } {
  let root: Record<string, unknown> = {}
  if (text.trim()) {
    try {
      const v: unknown = JSON.parse(text)
      if (!isRecord(v)) return { error: 'settings.local.json is not a JSON object' }
      root = v
    } catch {
      return { error: 'settings.local.json is not valid JSON; fix it in the settings editor first' }
    }
  }
  const arr = (k: string): string[] => (Array.isArray(root[k]) ? (root[k] as unknown[]).map(String) : [])
  const enabled = arr('enabledMcpjsonServers').filter((n) => n !== name)
  const disabled = arr('disabledMcpjsonServers').filter((n) => n !== name)
  if (decision === 'approve') enabled.push(name)
  else disabled.push(name)
  if (enabled.length || 'enabledMcpjsonServers' in root) root['enabledMcpjsonServers'] = enabled
  if (disabled.length || 'disabledMcpjsonServers' in root) root['disabledMcpjsonServers'] = disabled
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const out = JSON.stringify(root, null, detectIndent(text)) + '\n'
  return { text: eol === '\r\n' ? out.replaceAll('\n', '\r\n') : out }
}

export const SCOPE_ORDER: McpScope[] = ['local', 'project', 'user']
export const SCOPE_LABEL: Record<McpScope, string> = {
  local: 'Local',
  project: 'Project (.mcp.json)',
  user: 'User'
}
