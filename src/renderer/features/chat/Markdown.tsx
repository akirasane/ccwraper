import * as React from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { CodeBlock } from './CodeBlock'

const REMARK = [remarkGfm]

function buildComponents(animateBlocks: boolean): Components {
  // While streaming, blocks that appear for the first time fade in from blur (existing DOM nodes are kept by React).
  const tok = animateBlocks ? 'ccw-token' : undefined
  return {
    // The fenced block is rendered by `code`; drop the wrapping <pre>.
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const text = String(children ?? '')
      const m = /language-([\w-]+)/.exec(className ?? '')
      if (m || text.includes('\n')) return <CodeBlock code={text.replace(/\n$/, '')} {...(m ? { lang: m[1]! } : {})} />
      return <code>{children}</code>
    },
    a: ({ href, children }) => (
      <a href={href} target="_blank" rel="noreferrer noopener">
        {children}
      </a>
    ),
    p: ({ children }) => <p className={tok}>{children}</p>,
    li: ({ children }) => <li className={tok}>{children}</li>,
    h1: ({ children }) => <h1 className={tok}>{children}</h1>,
    h2: ({ children }) => <h2 className={tok}>{children}</h2>,
    h3: ({ children }) => <h3 className={tok}>{children}</h3>
  }
}

const STATIC = buildComponents(false)
const ANIMATED = buildComponents(true)

function MarkdownImpl({ text, streaming = false }: { text: string; streaming?: boolean }): React.JSX.Element {
  return (
    <div className="ccw-prose">
      <ReactMarkdown remarkPlugins={REMARK} components={streaming ? ANIMATED : STATIC}>
        {text}
      </ReactMarkdown>
    </div>
  )
}

export const Markdown = React.memo(MarkdownImpl)
