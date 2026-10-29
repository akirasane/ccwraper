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
  | { t: 'text_delta'; msgId: string; text: string }
  | { t: 'thinking_delta'; msgId: string; text: string }
  | { t: 'assistant_message'; msgId: string; blocks: Block[]; parentToolUseId?: string }
  | { t: 'tool_use'; toolUseId: string; name: string; input: unknown; parentToolUseId?: string }
  | { t: 'tool_result'; toolUseId: string; content: string; isError: boolean }
  | { t: 'permission_request'; reqId: string; toolName: string; input: unknown; title?: string }
  | { t: 'status'; state: SessionStatus }
  | {
      t: 'result'
      costUsd: number
      durationMs: number
      turns: number
      usage: Usage
      isError: boolean
      resultText?: string
    }
  | { t: 'error'; message: string }
