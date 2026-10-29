import { Check, Copy } from 'lucide-react'
import * as React from 'react'
import { Button } from '@/components/ui'
import { highlightToHtml, resolveLang } from '@/lib/highlight'

/** Fenced code block: plain text first, shiki HTML once the (lazy) highlighter is ready. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }): React.JSX.Element {
  const [html, setHtml] = React.useState<string | undefined>()
  const [copied, setCopied] = React.useState(false)
  const supported = resolveLang(lang) !== undefined

  React.useEffect(() => {
    if (!supported) return
    let cancelled = false
    // Debounced so a streaming block is not re-highlighted on every delta.
    const t = setTimeout(() => {
      highlightToHtml(code, lang)
        .then((h) => {
          if (!cancelled && h) setHtml(h)
        })
        .catch(() => {
          /* fall back to plain text */
        })
    }, 120)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [code, lang, supported])

  const copy = (): void => {
    void navigator.clipboard?.writeText(code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1400)
    })
  }

  return (
    <div
      data-testid="code-block"
      data-lang={lang ?? ''}
      className="not-prose overflow-hidden rounded-md border border-border bg-bg-1 shadow-[var(--highlight-inset)]"
    >
      <div className="flex h-8 items-center justify-between border-b border-border bg-bg-2 pl-3 pr-1">
        <span className="font-mono text-xs text-fg-3">{lang || 'text'}</span>
        <Button variant="ghost" size="icon-sm" aria-label="Copy code" onClick={copy}>
          {copied ? <Check size={13} /> : <Copy size={13} />}
        </Button>
      </div>
      <div className="overflow-x-auto px-3 py-2.5 font-mono text-sm leading-[1.6]">
        {html ? (
          <div data-highlighted="true" dangerouslySetInnerHTML={{ __html: html }} />
        ) : (
          <pre className="m-0 whitespace-pre">
            <code>{code}</code>
          </pre>
        )}
      </div>
    </div>
  )
}
