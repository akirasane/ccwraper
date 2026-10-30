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
    }
  | { t: 'error'; message: string }

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
}
