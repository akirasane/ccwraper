import { useEffect, useRef, useState } from 'react'
import { removePending, useSessionStore } from '../../stores/session-store'

export function RawLogPage(): React.JSX.Element {
  const { localId, status, events, pending, setLocalId, push, clear } = useSessionStore()
  const [cwd, setCwd] = useState('')
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState<string | null>(null)
  const logEnd = useRef<HTMLDivElement>(null)

  useEffect(() => window.ccwrap.session.onEvent((p) => push(p.localId, p.event)), [push])
  useEffect(() => {
    logEnd.current?.scrollIntoView({ block: 'end' })
  }, [events.length])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const submit = (): Promise<void> =>
    run(async () => {
      const text = prompt.trim()
      if (!text) return
      setPrompt('')
      if (localId) await window.ccwrap.session.send({ localId, text })
      else {
        if (!cwd) throw new Error('Pick a working directory first')
        const r = await window.ccwrap.session.start({ cwd, prompt: text })
        setLocalId(r.localId)
      }
    })

  const reply = (reqId: string, decision: 'allow' | 'deny'): Promise<void> =>
    run(async () => {
      if (!localId) return
      await window.ccwrap.session.permissionReply({ localId, reqId, decision })
      removePending(reqId)
    })

  return (
    <div className="flex h-full flex-col gap-2 p-3">
      <div className="flex items-center gap-2">
        <input
          className="flex-1 rounded-lg border border-white/10 bg-[var(--bg-1)] px-2 py-1"
          placeholder="Working directory"
          value={cwd}
          readOnly={!!localId}
          onChange={(e) => setCwd(e.target.value)}
        />
        <button
          className="rounded-lg border border-white/10 bg-[var(--bg-2)] px-3 py-1"
          disabled={!!localId}
          onClick={() => void run(async () => setCwd((await window.ccwrap.dialog.pickDirectory()) ?? cwd))}
        >
          Browse
        </button>
        <span className="text-[var(--text-secondary)]">status: {status}</span>
        <button
          className="rounded-lg border border-white/10 bg-[var(--bg-2)] px-3 py-1"
          disabled={!localId}
          onClick={() => void run(() => window.ccwrap.session.interrupt(localId!))}
        >
          Interrupt
        </button>
        <button
          className="rounded-lg border border-white/10 bg-[var(--bg-2)] px-3 py-1"
          onClick={() => {
            if (localId) void window.ccwrap.session.close(localId)
            setLocalId(null)
            clear()
          }}
        >
          New session
        </button>
      </div>

      <div className="flex-1 overflow-auto rounded-xl border border-white/10 bg-[var(--bg-1)] p-2 font-mono text-[12px]">
        {events.map((le) => (
          <div key={le.n} className="whitespace-pre-wrap break-all border-b border-white/5 py-0.5">
            <span className="text-[var(--text-tertiary)]">{le.n} </span>
            {JSON.stringify(le.event)}
          </div>
        ))}
        <div ref={logEnd} />
      </div>

      {pending.map((p) => (
        <div key={p.reqId} className="rounded-xl border border-amber-400/30 bg-amber-400/10 p-3">
          <div className="mb-1 font-semibold">Permission: {p.title ?? p.toolName}</div>
          <pre className="mb-2 max-h-40 overflow-auto text-[12px]">{JSON.stringify(p.input, null, 2)}</pre>
          <button
            className="mr-2 rounded-lg bg-emerald-500/80 px-3 py-1 text-black"
            onClick={() => void reply(p.reqId, 'allow')}
          >
            Allow
          </button>
          <button className="rounded-lg bg-red-500/80 px-3 py-1" onClick={() => void reply(p.reqId, 'deny')}>
            Deny
          </button>
        </div>
      ))}

      {error && <div className="text-red-400">{error}</div>}

      <div className="flex gap-2">
        <textarea
          className="flex-1 rounded-lg border border-white/10 bg-[var(--bg-1)] p-2"
          rows={2}
          placeholder={localId ? 'Send a follow-up...' : 'Prompt (starts a new session)'}
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              void submit()
            }
          }}
        />
        <button
          className="rounded-lg bg-gradient-to-r from-violet-500 to-blue-500 px-4 py-1"
          onClick={() => void submit()}
        >
          Send
        </button>
      </div>
    </div>
  )
}
