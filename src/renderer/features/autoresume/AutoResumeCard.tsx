import { useEffect, useState } from 'react'
import { DEFAULT_AUTO_RESUME_PROMPT } from '@shared/app'
import type { AutoResumePrefs } from '@shared/app'
import { Textarea, Toggle } from '@/components/ui'

/**
 * Preferences card for "Auto-resume after usage limit". Self-contained: reads and saves through
 * window.ccwrap.prefs. The Preferences page only mounts it (no props).
 */
export function AutoResumeCard(): React.JSX.Element {
  const [prefs, setPrefs] = useState<AutoResumePrefs>({ enabled: false, prompt: DEFAULT_AUTO_RESUME_PROMPT })
  const [draft, setDraft] = useState(DEFAULT_AUTO_RESUME_PROMPT)
  const [error, setError] = useState<string | undefined>()

  useEffect(() => {
    let alive = true
    const api = window.ccwrap?.prefs
    if (!api) return
    void api
      .get()
      .then((p) => {
        if (!alive) return
        setPrefs(p.autoResume)
        setDraft(p.autoResume.prompt)
      })
      .catch(() => {})
    const off = api.onChanged((p) => {
      if (alive) setPrefs(p.autoResume)
    })
    return () => {
      alive = false
      off()
    }
  }, [])

  const save = async (patch: Partial<AutoResumePrefs>): Promise<void> => {
    setError(undefined)
    try {
      const r = await window.ccwrap.prefs.set({ autoResume: patch })
      setPrefs(r.prefs.autoResume)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const commitPrompt = (): void => {
    const next = draft.trim()
    if (next !== prefs.prompt) void save({ prompt: next })
  }

  return (
    <section
      data-testid="autoresume-card"
      aria-labelledby="autoresume-title"
      className="rounded-md border border-border bg-bg-1 p-4"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h3 id="autoresume-title" className="text-base font-medium text-fg">
            Auto-resume after usage limit
          </h3>
          <p className="mt-1 text-sm text-fg-3">
            When your plan limit (for example the 5-hour limit) stops a session, that tab waits and sends the message
            below once the limit resets. It only works while ccwraper is running; it never approves permission
            requests.
          </p>
        </div>
        <Toggle
          aria-label="Auto-resume after usage limit"
          checked={prefs.enabled}
          onCheckedChange={(enabled) => void save({ enabled })}
        />
      </div>
      <label htmlFor="autoresume-prompt" className="mt-3 block text-sm text-fg-2">
        Continuation message
      </label>
      <Textarea
        id="autoresume-prompt"
        value={draft}
        rows={2}
        maxLength={2000}
        placeholder={DEFAULT_AUTO_RESUME_PROMPT}
        disabled={!prefs.enabled}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commitPrompt}
        className="mt-1"
      />
      <p className="mt-1 text-xs text-fg-3">
        At most 3 automatic resumes per session per hour. Leave empty to use the default.
      </p>
      {error && (
        <p role="alert" className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  )
}
