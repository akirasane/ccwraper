// Zod-free. A copy of the SDK's HOOK_EVENTS (33 names in 0.3.312); sdk-settings.test.ts asserts equality
// with the runtime export so an SDK bump fails loudly.
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PostToolBatch',
  'Notification',
  'UserPromptSubmit',
  'UserPromptExpansion',
  'SessionStart',
  'SessionEnd',
  'Stop',
  'StopFailure',
  'SubagentStart',
  'SubagentStop',
  'PreCompact',
  'PostCompact',
  'PreModelSwitch',
  'PostModelSwitch',
  'PermissionRequest',
  'PermissionDenied',
  'Setup',
  'TeammateIdle',
  'TaskCreated',
  'TaskCompleted',
  'Elicitation',
  'ElicitationResult',
  'ConfigChange',
  'WorktreeCreate',
  'WorktreeRemove',
  'InstructionsLoaded',
  'CwdChanged',
  'FileChanged',
  'DirectoryAdded',
  'MessageDisplay'
] as const

export type HookEventName = (typeof HOOK_EVENTS)[number]

/** Events whose matcher is a tool name or a regex over tool names. */
export const TOOL_MATCHER_EVENTS: readonly HookEventName[] = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionRequest',
  'PermissionDenied'
]

const TOOL_HINT = 'Tool name or regex, for example Bash or Edit|Write'

export const MATCHER_HINTS: Partial<Record<HookEventName, string>> = {
  PreToolUse: TOOL_HINT,
  PostToolUse: TOOL_HINT,
  PostToolUseFailure: TOOL_HINT,
  PermissionRequest: TOOL_HINT,
  PermissionDenied: TOOL_HINT,
  SessionStart: 'startup|resume|clear|compact',
  PreCompact: 'manual|auto',
  PostCompact: 'manual|auto',
  SubagentStart: 'Agent type',
  SubagentStop: 'Agent type'
}
