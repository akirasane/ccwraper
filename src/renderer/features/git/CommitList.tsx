import { useVirtualizer } from '@tanstack/react-virtual'
import { Check, Copy } from 'lucide-react'
import * as React from 'react'
import type { GitCommit } from '@shared/git'
import { Button } from '@/components/ui'

const ROW_H = 44

function fmtDate(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' })
}

export function CommitList({ commits }: { commits: GitCommit[] }): React.JSX.Element {
  const [copied, setCopied] = React.useState<string | undefined>()
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const virtual = commits.length > 200
  const virtualizer = useVirtualizer({
    count: virtual ? commits.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_H,
    overscan: 10
  })

  const copy = (hash: string): void => {
    void Promise.resolve(navigator.clipboard?.writeText(hash))
      .catch(() => undefined)
      .then(() => {
        setCopied(hash)
        setTimeout(() => setCopied((c) => (c === hash ? undefined : c)), 1500)
      })
  }

  const row = (c: GitCommit): React.JSX.Element => (
    <div key={c.hash} data-testid="commit-row" className="flex h-11 items-center gap-3 px-4 text-sm">
      <span className="w-16 shrink-0 font-mono text-accent-text">{c.short}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-fg" title={c.subject}>
          {c.subject}
        </div>
        <div className="truncate text-2xs text-fg-3">
          {c.author} · {fmtDate(c.date)}
        </div>
      </div>
      <Button
        variant="ghost"
        size="icon-sm"
        aria-label={`Copy hash ${c.short}`}
        title="Copy hash"
        onClick={() => copy(c.hash)}
      >
        {copied === c.hash ? <Check size={13} aria-hidden /> : <Copy size={13} aria-hidden />}
      </Button>
    </div>
  )

  if (commits.length === 0) return <p className="p-4 text-base text-fg-3">No commits yet.</p>
  if (!virtual) {
    return (
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Recent commits">
        {commits.map(row)}
      </div>
    )
  }
  return (
    <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto py-1" aria-label="Recent commits">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
        {virtualizer.getVirtualItems().map((v) => {
          const c = commits[v.index]
          if (!c) return null
          return (
            <div
              key={v.key}
              style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: ROW_H, transform: `translateY(${v.start}px)` }}
            >
              {row(c)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
