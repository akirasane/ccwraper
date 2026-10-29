import * as React from 'react'
import { cn } from '@/lib/cn'
import { Markdown } from './Markdown'

/**
 * Assistant prose. While `streaming`, new blocks fade in (blur 2px -> 0, 240ms) and a gradient caret
 * trails the last block; both stop under prefers-reduced-motion (see chat.css).
 */
export function StreamingText({ text, streaming = false }: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <div data-testid="streaming-text" data-streaming={streaming ? 'true' : 'false'} className={cn(streaming && 'ccw-streaming')}>
      <Markdown text={text} streaming={streaming} />
    </div>
  )
}
