// Fixture-driven demo conversations for /design. Everything is seeded into the chat store under throwaway
// convIds with NO localId, so no IPC is ever reached (ChatStore.submit/interrupt/replyPermission need one).
import type { SessionEvent } from '@shared/events'
import { eventFixtures } from '@/features/chat/model/fixtures'
import { useChatStore } from '@/stores/chat-store'

export const DEMO_CWD = 'C:\fixture\proj'
export const CONV = {
  tools: 'design-tools',
  edit: 'design-edit',
  approval: 'design-approval',
  composerIdle: 'design-composer-idle',
  composerRunning: 'design-composer-running',
  permission: 'design-permission'
} as const

const init: SessionEvent = {
  t: 'init',
  sessionId: 'design',
  model: 'claude-sonnet-5-5',
  tools: [],
  mcp: [],
  slashCommands: [],
  cwd: DEMO_CWD,
  permissionMode: 'default'
}

const bash = (id: string, command: string): SessionEvent => ({ t: 'tool_use', toolUseId: id, name: 'Bash', input: { command } })

export const toolEvents: SessionEvent[] = [
  init,
  bash('run', 'npm test -- --watch=false'),
  bash('done', 'git status --short'),
  { t: 'tool_result', toolUseId: 'done', content: ' M src/renderer/app/design/DesignPage.tsx\n?? src/renderer/app/design/contrast.ts', isError: false },
  bash('err', 'node scripts/missing.js'),
  { t: 'tool_result', toolUseId: 'err', content: "Error: Cannot find module 'scripts/missing.js'\n    at Module._resolveFilename", isError: true },
  { t: 'tool_use', toolUseId: 'read', name: 'Read', input: { file_path: 'src/renderer/styles/tokens.css', offset: 1, limit: 40 } },
  { t: 'tool_result', toolUseId: 'read', content: '/* ccwraper design tokens */\n:root {\n  color-scheme: dark;\n}', isError: false },
  { t: 'tool_use', toolUseId: 'grep', name: 'Grep', input: { pattern: 'ccw-composer' } },
  { t: 'tool_result', toolUseId: 'grep', content: 'chat.css:12\nComposer.tsx:84', isError: false },
  { t: 'tool_use', toolUseId: 'generic', name: 'WebSearch', input: { query: 'WCAG contrast ratio formula' } },
  { t: 'tool_result', toolUseId: 'generic', content: '3 results', isError: false }
]

const bigEdit = {
  file_path: 'src/renderer/lib/greet.ts',
  old_string: "export function greet(name: string) {\n  return 'Hello ' + name\n}\n",
  new_string:
    "export function greet(name: string, punctuation = '!') {\n  const who = name.trim() || 'world'\n  return `Hello ${who}${punctuation}`\n}\n"
}

export const approvalEvents: SessionEvent[] = [
  init,
  { t: 'tool_use', toolUseId: 'appr', name: 'Edit', input: bigEdit },
  { t: 'status', state: 'waiting_permission' },
  { t: 'permission_request', reqId: 'appr-req', toolName: 'Edit', input: bigEdit, title: 'Edit greet.ts', ruleLabel: 'Edit' }
]

const permIdx = eventFixtures.permissionFlow.findIndex((e) => e.t === 'permission_request')
export const permissionFixtureEvents: SessionEvent[] = eventFixtures.permissionFlow.slice(0, permIdx + 1)

export const permissionBashEvents: SessionEvent[] = [
  init,
  bash('pbash', 'rm -rf node_modules && npm install'),
  { t: 'status', state: 'waiting_permission' },
  {
    t: 'permission_request',
    reqId: 'pbash-req',
    toolName: 'Bash',
    input: { command: 'rm -rf node_modules && npm install' },
    title: 'Run a shell command',
    ruleLabel: 'Bash(rm:*)'
  }
]

const runningEvents: SessionEvent[] = [init, { t: 'status', state: 'running' }]

function seed(convId: string, events: SessionEvent[], localId?: string): void {
  const s = useChatStore.getState()
  if (s.convs[convId]) s.removeConv(convId)
  s.createConv({ convId, cwd: DEMO_CWD, ...(localId ? { localId } : {}) })
  s.seedFromHistory(convId, events)
}

export function seedDemoConvs(): void {
  seed(CONV.tools, toolEvents)
  seed(CONV.edit, eventFixtures.toolEditTurn)
  seed(CONV.approval, approvalEvents)
  seed(CONV.composerIdle, [init])
  seed(CONV.composerRunning, runningEvents)
}

export function seedPermission(kind: 'fixture' | 'bash' | 'edit'): void {
  // A localId is needed so the store resolves the reply locally; the IPC call is shimmed (see withIpcShim).
  seed(
    CONV.permission,
    kind === 'fixture' ? permissionFixtureEvents : kind === 'bash' ? permissionBashEvents : approvalEvents,
    'design-local'
  )
}

export function clearPermission(): void {
  useChatStore.getState().removeConv(CONV.permission)
}

export const MARKDOWN_SAMPLE = [
  '## Markdown rendering',
  '',
  'Prose is **14px** with *1.65* leading, `inline code`, and a [link](https://example.com).',
  '',
  '- Lists use the accent marker',
  '- Tables are GFM',
  '',
  '| Token | Value |',
  '| --- | --- |',
  '| `--dur-base` | 180ms |',
  '| `--radius-md` | 12px |',
  '',
  '```ts',
  'export function clamp(n: number, lo: number, hi: number): number {',
  '  return Math.min(hi, Math.max(lo, n))',
  '}',
  '```'
].join('\n')

export const THINKING_SAMPLE =
  'The user wants a contrast table. I should read the tokens at runtime instead of hardcoding values, then compare against the documented numbers.'

/** While the demo permission dialog is open, permissionReply is a no-op. Returns the restore function. */
export function installIpcShim(): () => void {
  const w = window as unknown as { ccwrap?: { session?: Record<string, unknown> } }
  const prev = w.ccwrap
  w.ccwrap = { ...prev, session: { ...prev?.session, permissionReply: async () => undefined } }
  return () => {
    if (prev === undefined) delete w.ccwrap
    else w.ccwrap = prev
  }
}
