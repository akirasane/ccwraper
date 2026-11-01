import type { AppView } from '@/stores/workspace-store'

/**
 * App-side handling of slash commands, found by probing the SDK (see docs/P5-FINDINGS.md):
 * - `/context /cost /usage /config k=v /mcp /agents` are answered by the CLI as text: pass through.
 * - `/help /memory /permissions` come back "isn't available in this environment": the app does them.
 * - `/clear` is silent in the CLI, so the app also has to clear the visible transcript.
 */
export type SlashAction =
  | { kind: 'clear' }
  | { kind: 'view'; view: AppView }
  | { kind: 'model'; model: string }
  | { kind: 'palette' }

/** Bare commands that open an app page instead of being sent to the model. */
const VIEW_COMMANDS: Record<string, AppView> = {
  memory: 'memory',
  permissions: 'settings',
  config: 'settings',
  settings: 'settings',
  mcp: 'mcp',
  agents: 'agents',
  hooks: 'hooks',
  skills: 'skills'
}

/** Returns the action for an app-handled command, or null to send the text to the session unchanged. */
export function routeSlash(text: string, userCommands?: ReadonlySet<string>): SlashAction | null {
  const t = text.trim()
  if (!t.startsWith('/')) return null
  const m = /^\/([A-Za-z][\w:-]*)(?:\s+([\s\S]*))?$/.exec(t)
  if (!m) return null
  const name = m[1]!.toLowerCase()
  const args = (m[2] ?? '').trim()
  // A project / user command that shares a built-in's name wins: the session knows about it, we do not.
  if (userCommands?.has(name)) return null
  if (name === 'model') return args ? { kind: 'model', model: args } : null
  if (args) return null // `/config key=value`, `/mcp ...` etc. belong to the CLI
  if (name === 'clear') return { kind: 'clear' }
  if (name === 'help') return { kind: 'palette' }
  const view = VIEW_COMMANDS[name]
  return view ? { kind: 'view', view } : null
}
