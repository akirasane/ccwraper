// PLACEHOLDER (WP0). Owned by WP5. Frozen props: { target: ChatTarget }.
import type { ChatTarget } from './model/types'

export function ChatView({ target }: { target: ChatTarget }): React.JSX.Element {
  return (
    <div data-testid="chat-view" data-conv-id={target.convId}>
      ChatView placeholder
    </div>
  )
}
