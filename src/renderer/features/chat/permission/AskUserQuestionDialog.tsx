import * as React from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Kbd
} from '@/components/ui'
import type { PendingPermission } from '@/features/chat/model/types'
import { cn } from '@/lib/cn'
import { useChatStore } from '@/stores/chat-store'

export interface AskOption {
  label: string
  description: string
  preview?: string
}
export interface AskQuestion {
  question: string
  header: string
  options: AskOption[]
  multiSelect: boolean
}

/** Defensive parse of the AskUserQuestion tool input (the model controls it). */
export function parseQuestions(input: unknown): AskQuestion[] {
  const qs = (input as { questions?: unknown } | null)?.questions
  if (!Array.isArray(qs)) return []
  const out: AskQuestion[] = []
  for (const q of qs) {
    if (!q || typeof q !== 'object') continue
    const r = q as Record<string, unknown>
    if (typeof r.question !== 'string') continue
    const options: AskOption[] = []
    for (const o of Array.isArray(r.options) ? r.options : []) {
      const ob = (o ?? {}) as Record<string, unknown>
      if (typeof ob.label !== 'string') continue
      options.push({
        label: ob.label,
        description: typeof ob.description === 'string' ? ob.description : '',
        ...(typeof ob.preview === 'string' && ob.preview ? { preview: ob.preview } : {})
      })
    }
    out.push({
      question: r.question,
      header: typeof r.header === 'string' ? r.header : '',
      options,
      multiSelect: r.multiSelect === true
    })
  }
  return out
}

interface Answer {
  picked: string[] // option labels, in click order
  otherOn: boolean
  other: string
}
const EMPTY: Answer = { picked: [], otherOn: false, other: '' }

/** The answer string for one question, or '' while unanswered. Multi-select answers are comma-separated. */
function answerText(q: AskQuestion, a: Answer): string {
  const parts = q.options.map((o) => o.label).filter((l) => a.picked.includes(l))
  const other = a.other.trim()
  if (a.otherOn && other) parts.push(other)
  return q.multiSelect ? parts.join(', ') : (parts[0] ?? '')
}

export function AskUserQuestionDialog({ convId, req }: { convId: string; req: PendingPermission }): React.JSX.Element {
  const replyPermission = useChatStore((s) => s.replyPermission)
  const queued = useChatStore((s) => s.convs[convId]?.pending.length ?? 0)
  const questions = React.useMemo(() => parseQuestions(req.input), [req.input])
  const [answers, setAnswers] = React.useState<Answer[]>(() => questions.map(() => EMPTY))
  const [focused, setFocused] = React.useState<Record<number, string>>({})
  const baseId = React.useId()

  const set = (i: number, patch: (a: Answer) => Answer): void =>
    setAnswers((prev) => prev.map((a, j) => (j === i ? patch(a) : a)))

  const texts = questions.map((q, i) => answerText(q, answers[i] ?? EMPTY))
  const ready = questions.length > 0 && texts.every((t) => t !== '')

  const skip = (): void => void replyPermission(convId, req.reqId, 'deny')
  const submit = (): void => {
    if (!ready) return
    const map: Record<string, string> = {}
    const annotations: Record<string, { preview: string }> = {}
    questions.forEach((q, i) => {
      map[q.question] = texts[i]!
      const a = answers[i] ?? EMPTY
      // A preview is only meaningful for a single, option-based choice.
      if (!q.multiSelect && !a.otherOn) {
        const p = q.options.find((o) => o.label === a.picked[0])?.preview
        if (p) annotations[q.question] = { preview: p }
      }
    })
    const input = req.input && typeof req.input === 'object' ? (req.input as Record<string, unknown>) : {}
    void replyPermission(convId, req.reqId, 'allow', 'once', {
      ...input,
      answers: map,
      ...(Object.keys(annotations).length ? { annotations } : {})
    })
  }

  return (
    <Dialog open onOpenChange={(o) => !o && skip()}>
      <DialogContent
        showClose={false}
        aria-describedby={`${baseId}-desc`}
        data-testid="ask-dialog"
        className="flex max-h-[85vh] w-[640px] flex-col"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => {
          // Esc inside the free-text field only leaves the field; a second Esc skips.
          const t = e.target
          if (t instanceof HTMLElement && t.tagName === 'INPUT' && (t as HTMLInputElement).type === 'text') {
            e.preventDefault()
            t.blur()
          }
        }}
      >
        <DialogHeader>
          <div className="flex items-center gap-2">
            <DialogTitle>{req.title ?? 'Claude has a question'}</DialogTitle>
            {queued > 1 && (
              <span className="rounded-full border border-warn-border bg-warn-bg px-1.5 text-xs text-warn tabular-nums">
                +{queued - 1} more
              </span>
            )}
          </div>
          <DialogDescription id={`${baseId}-desc`}>
            Answer to continue, or skip to let Claude proceed without an answer.
          </DialogDescription>
        </DialogHeader>
        <div className="-mr-2 flex min-h-0 flex-col gap-5 overflow-y-auto pr-2">
          {questions.map((q, i) => {
            const a = answers[i] ?? EMPTY
            const gid = `${baseId}-q${i}`
            const shown = focused[i] ?? (!q.multiSelect ? a.picked[0] : undefined)
            const preview = q.options.find((o) => o.label === shown)?.preview
            return (
              <fieldset key={i} className="min-w-0 border-0 p-0" data-testid={`ask-q-${i}`}>
                <legend className="mb-2 flex flex-wrap items-center gap-2 p-0">
                  {q.header && (
                    <span className="rounded-full border border-border bg-bg-2 px-2 py-0.5 text-xs text-fg-2">
                      {q.header}
                    </span>
                  )}
                  <span className="text-base font-medium text-fg">{q.question}</span>
                </legend>
                <div className={cn('grid gap-3', preview !== undefined && 'sm:grid-cols-[1fr_1fr]')}>
                  <div className="flex flex-col gap-1.5" role={q.multiSelect ? 'group' : 'radiogroup'} aria-label={q.question}>
                    {q.options.map((o) => {
                      const checked = a.picked.includes(o.label)
                      return (
                        <label
                          key={o.label}
                          className={cn(
                            'flex cursor-pointer items-start gap-2.5 rounded-sm border px-2.5 py-2 transition-colors duration-fast',
                            'has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent-text',
                            checked ? 'border-accent-from bg-bg-3' : 'border-border bg-bg-1 hover:bg-bg-2'
                          )}
                        >
                          <input
                            type={q.multiSelect ? 'checkbox' : 'radio'}
                            name={gid}
                            checked={checked}
                            onFocus={() => setFocused((f) => ({ ...f, [i]: o.label }))}
                            onChange={() =>
                              set(i, (x) =>
                                q.multiSelect
                                  ? { ...x, picked: checked ? x.picked.filter((l) => l !== o.label) : [...x.picked, o.label] }
                                  : { ...x, picked: [o.label], otherOn: false }
                              )
                            }
                            className="mt-0.5 size-4 shrink-0 cursor-pointer accent-[var(--accent-from)]"
                          />
                          <span className="min-w-0">
                            <span className="block text-base text-fg">{o.label}</span>
                            {o.description && <span className="block text-sm text-fg-3">{o.description}</span>}
                          </span>
                        </label>
                      )
                    })}
                    <div
                      className={cn(
                        'flex items-center gap-2.5 rounded-sm border px-2.5 py-2',
                        a.otherOn ? 'border-accent-from bg-bg-3' : 'border-border bg-bg-1'
                      )}
                    >
                      <input
                        type={q.multiSelect ? 'checkbox' : 'radio'}
                        name={gid}
                        id={`${gid}-other`}
                        aria-label="Other"
                        checked={a.otherOn}
                        onFocus={() => setFocused((f) => ({ ...f, [i]: '' }))}
                        onChange={() =>
                          set(i, (x) =>
                            q.multiSelect ? { ...x, otherOn: !x.otherOn } : { ...x, picked: [], otherOn: true }
                          )
                        }
                        className="size-4 shrink-0 cursor-pointer accent-[var(--accent-from)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent-text"
                      />
                      <label htmlFor={`${gid}-other`} className="shrink-0 cursor-pointer text-base text-fg">
                        Other
                      </label>
                      <input
                        type="text"
                        aria-label={`Other answer for: ${q.question}`}
                        placeholder="Type your own answer"
                        value={a.other}
                        onChange={(e) =>
                          set(i, (x) => ({
                            ...x,
                            other: e.target.value,
                            otherOn: true,
                            picked: q.multiSelect ? x.picked : []
                          }))
                        }
                        className="h-7 min-w-0 flex-1 rounded-sm border border-border-strong bg-bg-2 px-2 text-base text-fg placeholder:text-fg-muted focus:border-accent-from focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-text"
                      />
                    </div>
                  </div>
                  {preview !== undefined && (
                    <pre
                      data-testid={`ask-preview-${i}`}
                      className="max-h-[220px] overflow-auto whitespace-pre rounded-sm border border-border bg-bg-1 p-2.5 font-mono text-sm text-fg-2"
                    >
                      {preview}
                    </pre>
                  )}
                </div>
              </fieldset>
            )
          })}
          {questions.length === 0 && <p className="text-sm text-fg-3">This question could not be displayed.</p>}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={skip}>
            Skip <Kbd>Esc</Kbd>
          </Button>
          <Button variant="primary" disabled={!ready} onClick={submit}>
            Submit
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
