import * as React from 'react'
import { useChatStore } from '@/stores/chat-store'
import { AssistantMessage } from './AssistantMessage'
import { isAgentTool } from './model/selectors'
import type { ChatItem } from './model/types'
import { SubagentCard } from './tools/SubagentCard'
import { ToolCard } from './tools/ToolCard'
import { UserMessage } from './UserMessage'
import { RewindControl } from './rewind/RewindControl'

function ToolItem({ convId, toolUseId, depth }: { convId: string; toolUseId: string; depth: number }): React.JSX.Element {
  const isAgent = useChatStore((s) => {
    const t = s.convs[convId]?.tools[toolUseId]
    return !!t && isAgentTool(t.name)
  })
  return isAgent ? (
    <SubagentCard
      convId={convId}
      toolUseId={toolUseId}
      depth={depth}
      renderItem={(it, d) => <ItemView convId={convId} item={it} depth={d} />}
    />
  ) : (
    <ToolCard convId={convId} toolUseId={toolUseId} />
  )
}

/** One chat row. Agent / Task tool calls render as a SubagentCard that nests its own children. */
export function ItemView({ convId, item, depth = 0 }: { convId: string; item: ChatItem; depth?: number }): React.JSX.Element {
  switch (item.kind) {
    case 'user':
      return <UserMessage text={item.text} {...(item.images ? { images: item.images } : {})}>
          {item.messageId ? <RewindControl convId={convId} messageId={item.messageId} /> : null}
        </UserMessage>
    case 'assistant':
      return <AssistantMessage item={item} />
    case 'tool':
      return <ToolItem convId={convId} toolUseId={item.toolUseId} depth={depth} />
    case 'error':
      return (
        <div
          role="alert"
          data-testid="error-message"
          className="rounded-md border border-danger-border bg-danger-bg px-3.5 py-2.5 text-base text-danger"
        >
          {item.message}
        </div>
      )
  }
}
