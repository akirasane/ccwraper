import * as React from 'react'
import type { ChatItem } from './model/types'
import { StreamingText } from './StreamingText'
import { ThinkingBlock } from './ThinkingBlock'

type AssistantItem = Extract<ChatItem, { kind: 'assistant' }>

function AssistantMessageImpl({ item }: { item: AssistantItem }): React.JSX.Element {
  const lastIdx = item.parts.length - 1
  return (
    <div data-testid="assistant-message" className="flex flex-col gap-2">
      {item.parts.map((p, i) => {
        if (p.kind === 'thinking') {
          return (
            <ThinkingBlock
              key={i}
              text={p.text}
              active={item.streaming && p.endedAt === undefined}
              {...(p.startedAt !== undefined ? { startedAt: p.startedAt } : {})}
              {...(p.endedAt !== undefined ? { endedAt: p.endedAt } : {})}
            />
          )
        }
        return <StreamingText key={i} text={p.text} streaming={item.streaming && i === lastIdx} />
      })}
    </div>
  )
}

export const AssistantMessage = React.memo(AssistantMessageImpl)
