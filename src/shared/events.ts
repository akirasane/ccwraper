// Normalized session events. Plain serializable data; no SDK types here.

export type Block =
  | { type: 'text'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'tool_use'; toolUseId: string; name: string; input: unknown }

export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

export type SessionStatus = 'idle' | 'running' | 'waiting_permission' | 'error'

export type TaskStatus = 'pending' | 'running' | 'completed' | 'failed' | 'stopped' | 'killed' | 'paused'

export type SessionEvent =
  | {
      t: 'init'
      sessionId: string
      model: string
      tools: string[]
      mcp: { name: string; status: string }[]
      slashCommands: string[]
      cwd: string
      permissionMode?: string
      agents?: string[]
      skills?: string[]
      plugins?: { name: string; path: string; version?: string }[]
    }
  /** History replay only; live prompts are added optimistically by the renderer. */
  | { t: 'user_message'; text: string; uuid?: string }
  | { t: 'text_delta'; msgId: string; text: string }
  | { t: 'thinking_delta'; msgId: string; text: string }
  | { t: 'assistant_message'; msgId: string; blocks: Block[]; parentToolUseId?: string }
  | { t: 'tool_use'; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  | { t: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { t: 'permission_request'; reqId: string; toolName: string; input: unknown; title?: string; ruleLabel?: string; ruleLabels?: string[] }
  | { t: 'status'; state: SessionStatus }
  | {
      t: 'result'
      costUsd: number
      durationMs: number
      turns: number
      usage: Usage
      isError: boolean
      resultText?: string
      /** Context window of the session model (from SDK modelUsage); undefined when unknown. */
      contextWindow?: number
      durationApiMs?: number
      /** Sum over result.modelUsage (cumulative session, main + subagents). */
      sessionUsage?: Usage & { costUsd: number; thinkingTokens?: number }
      /** result.modelUsage mapped per model (cumulative for this query process). */
      modelUsage?: Record<string, Usage & { costUsd: number }>
    }
  | { t: 'error'; message: string }
  /** The SDK query loop ended (process exit / crash / close): no further task events can arrive. */
  | { t: 'session_closed' }
  | {
      t: 'usage_live'
      /** latest main-thread call: prompt (input + cache read + cache creation), exact */
      contextTokens: number
      /** output of that call: exact after its message_delta, else estimated */
      contextOutputTokens: number
      contextExact: boolean
      /** sum over this turn's calls (main + subagent streams) */
      turn: Usage
      exact: boolean
      apiCalls: number
    }
  | {
      t: 'task_started'
      taskId: string
      toolUseId?: string
      description: string
      subagentType?: string
      taskType?: string
      parentTaskId?: string
      depth?: number
      background?: boolean
      ambient?: boolean
      hidden?: boolean
    }
  | {
      t: 'task_progress'
      taskId: string
      toolUseId?: string
      totalTokens: number
      toolUses: number
      durationMs: number
      lastToolName?: string
      summary?: string
    }
  | { t: 'task_updated'; taskId: string; status?: TaskStatus; description?: string; error?: string; background?: boolean }
  | {
      t: 'task_ended'
      taskId: string
      toolUseId?: string
      status: 'completed' | 'failed' | 'stopped'
      summary?: string
      totalTokens?: number
      toolUses?: number
      durationMs?: number
    }
  | { t: 'tool_progress'; toolUseId: string; toolName: string; parentToolUseId?: string; elapsedMs: number; taskId?: string }

// ---- WP0 frozen contracts (history / app info). Change only via the lead. ----

/** A project (distinct cwd) derived from session history. key = normalizeCwdKey(cwd); cwd = most recent spelling. */
export interface ProjectInfo {
  key: string
  cwd: string
  exists: boolean
  sessionCount: number
  lastModified: number
}

/** One resumable session. title = customTitle ?? summary ?? firstPrompt. */
export interface HistorySessionInfo {
  sessionId: string
  title: string
  firstPrompt?: string
  cwd: string
  gitBranch?: string
  lastModified: number
  createdAt?: number
  fileSize?: number
}

export interface AppInfo {
  claudePath?: string
  claudeVersion?: string
  claudeSource: 'env' | 'user' | 'bundled'
  sdkVersion: string
  platform: string
  /** Where deleted skills / commands / agents are moved (under userData). */
  trashDir?: string
  version: string
  electronVersion: string
  packaged: boolean
  userDataDir: string
}
