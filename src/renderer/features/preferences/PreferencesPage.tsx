import { useQuery, useQueryClient } from '@tanstack/react-query'
import * as React from 'react'
import type { AppPrefs, AppPrefsPatch, HotkeyStatus } from '@shared/app'
import type { ShellId, ShellProfile } from '@shared/config'
import type { AppInfo } from '@shared/events'
import { useModePrefs } from '@/features/chat/mode/mode-prefs'
import { Button, Input, Toggle, fieldClass } from '@/components/ui'
import { cn } from '@/lib/cn'
import { AutoResumeCard } from '@/features/autoresume/AutoResumeCard'
import { useTerminalStore } from '@/features/terminal/terminal-store'
import { describeUpdate, useUpdateState } from '@/features/updates/use-update-state'
import { acceleratorFromEvent } from './accelerator'

const PREFS_KEY = ['prefs'] as const

function Section({ title, id, children }: { title: string; id: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <section aria-labelledby={id} data-testid={`prefs-${id}`} className="border-b border-border py-5 last:border-b-0">
      <h3 id={id} className="mb-2 text-md font-medium text-fg">
        {title}
      </h3>
      <div className="divide-y divide-border">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  htmlFor,
  children
}: {
  label: string
  hint?: string
  htmlFor?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="flex items-center gap-4 py-2.5">
      <div className="min-w-0 flex-1">
        <label htmlFor={htmlFor} className="text-base text-fg">
          {label}
        </label>
        {hint && <div className="text-sm text-fg-3">{hint}</div>}
      </div>
      {children}
    </div>
  )
}

function usePrefs() {
  const qc = useQueryClient()
  const query = useQuery<AppPrefs>({ queryKey: PREFS_KEY, queryFn: () => window.ccwrap.prefs.get(), retry: false })
  const [hotkey, setHotkey] = React.useState<HotkeyStatus | undefined>()
  const [saveError, setSaveError] = React.useState<string | undefined>()

  React.useEffect(() => {
    const off = window.ccwrap.prefs?.onChanged?.((p) => qc.setQueryData(PREFS_KEY, p))
    return off
  }, [qc])

  const set = React.useCallback(
    async (patch: AppPrefsPatch): Promise<void> => {
      setSaveError(undefined)
      try {
        const res = await window.ccwrap.prefs.set(patch)
        qc.setQueryData(PREFS_KEY, res.prefs)
        useModePrefs.getState().set(res.prefs.allowBypassMode === true)
        setHotkey(res.hotkey)
      } catch (err) {
        setSaveError(err instanceof Error ? err.message : 'Could not save preferences.')
      }
    },
    [qc]
  )
  return { prefs: query.data, loadError: query.isError, hotkey, saveError, set }
}

function AcceleratorInput({
  value,
  disabled,
  onCommit
}: {
  value: string
  disabled?: boolean
  onCommit: (accelerator: string) => void
}): React.JSX.Element {
  const [message, setMessage] = React.useState<string | undefined>()
  const [capturing, setCapturing] = React.useState(false)

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>): void => {
    const plain = !e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey
    // Keep keyboard navigation: a bare Tab moves focus, a bare Escape leaves the field.
    if (plain && e.key === 'Tab') return
    if (plain && e.key === 'Escape') {
      e.currentTarget.blur()
      return
    }
    e.preventDefault()
    const r = acceleratorFromEvent(e.nativeEvent)
    if (r.kind === 'pending') return
    if (r.kind === 'error') {
      setMessage(r.message)
      return
    }
    setMessage(undefined)
    if (r.accelerator !== value) onCommit(r.accelerator)
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Input
        mono
        readOnly
        disabled={disabled}
        value={capturing ? 'Press a shortcut...' : value}
        aria-label="Global shortcut"
        aria-describedby={message ? 'hotkey-capture-error' : undefined}
        error={!!message}
        data-testid="hotkey-input"
        className="w-52 cursor-pointer text-center"
        onFocus={() => setCapturing(true)}
        onBlur={() => {
          setCapturing(false)
          setMessage(undefined)
        }}
        onKeyDown={onKeyDown}
      />
      {message && (
        <span id="hotkey-capture-error" role="alert" data-testid="hotkey-capture-error" className="text-sm text-danger">
          {message}
        </span>
      )}
    </div>
  )
}

function ThresholdInput({ value, onCommit }: { value: number; onCommit: (n: number) => void }): React.JSX.Element {
  const [text, setText] = React.useState(String(value))
  React.useEffect(() => setText(String(value)), [value])
  const commit = (): void => {
    const n = Math.min(3600, Math.max(0, Math.round(Number(text))))
    if (!Number.isFinite(n) || text.trim() === '') {
      setText(String(value))
      return
    }
    setText(String(n))
    if (n !== value) onCommit(n)
  }
  return (
    <div className="flex items-center gap-2">
      <Input
        id="turn-done-min"
        type="number"
        min={0}
        max={3600}
        step={1}
        value={text}
        data-testid="turn-done-min"
        className="w-20 text-right"
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && commit()}
      />
      <span className="text-sm text-fg-3">seconds</span>
    </div>
  )
}

function NotificationsSection({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => void }): React.JSX.Element {
  const n = prefs.notifications
  const sub = !n.enabled
  const toggle = (id: string, label: string, hint: string, key: 'permission' | 'turnDone' | 'backgroundTask' | 'flashTaskbar') => (
    <Row label={label} hint={hint} htmlFor={id}>
      <Toggle
        id={id}
        checked={n[key]}
        disabled={sub}
        data-testid={id}
        onCheckedChange={(v) => set({ notifications: { [key]: v } })}
      />
    </Row>
  )
  return (
    <Section id="notifications" title="Notifications">
      <Row label="Desktop notifications" hint="Only shown while the window is not focused." htmlFor="notif-enabled">
        <Toggle
          id="notif-enabled"
          checked={n.enabled}
          data-testid="notif-enabled"
          onCheckedChange={(v) => set({ notifications: { enabled: v } })}
        />
      </Row>
      {toggle('notif-permission', 'Approval needed', 'When Claude waits for a permission.', 'permission')}
      {toggle('notif-turnDone', 'Turn finished', 'When a long turn completes.', 'turnDone')}
      <Row label="Only if the turn took at least" htmlFor="turn-done-min">
        <ThresholdInput
          value={n.turnDoneMinSeconds}
          onCommit={(v) => set({ notifications: { turnDoneMinSeconds: v } })}
        />
      </Row>
      {toggle('notif-backgroundTask', 'Background task ended', 'When an agent finishes in the background.', 'backgroundTask')}
      {toggle('notif-flashTaskbar', 'Flash the taskbar', 'When approval is needed.', 'flashTaskbar')}
    </Section>
  )
}

function HotkeySection({
  prefs,
  hotkey,
  set
}: {
  prefs: AppPrefs
  hotkey: HotkeyStatus | undefined
  set: (p: AppPrefsPatch) => void
}): React.JSX.Element {
  return (
    <Section id="hotkey" title="Global hotkey">
      <Row
        label="Show or hide ccwraper"
        hint="Works from any app. Off by default because it takes the shortcut system-wide."
        htmlFor="hotkey-enabled"
      >
        <Toggle
          id="hotkey-enabled"
          checked={prefs.hotkey.enabled}
          data-testid="hotkey-enabled"
          onCheckedChange={(v) => set({ hotkey: { enabled: v } })}
        />
      </Row>
      <Row label="Shortcut" hint="Focus the field and press the keys.">
        <AcceleratorInput
          value={prefs.hotkey.accelerator}
          onCommit={(accelerator) => set({ hotkey: { accelerator } })}
        />
      </Row>
      {hotkey?.error && (
        <p role="alert" data-testid="hotkey-error" className="py-2 text-sm text-danger">
          {hotkey.error}
        </p>
      )}
      {hotkey && !hotkey.error && hotkey.enabled && hotkey.registered && (
        <p role="status" data-testid="hotkey-ok" className="py-2 text-sm text-fg-3">
          Registered.
        </p>
      )}
    </Section>
  )
}

function ShellSection(): React.JSX.Element {
  const defaultShell = useTerminalStore((s) => s.defaultShell)
  const setDefaultShell = useTerminalStore((s) => s.setDefaultShell)
  const shells = useQuery<ShellProfile[]>({
    queryKey: ['pty', 'shells'],
    queryFn: async () => (await window.ccwrap.pty?.listShells?.()) ?? [],
    retry: false
  })
  const list = shells.data ?? []
  const value = defaultShell ?? list.find((s) => s.isDefault)?.id ?? list[0]?.id ?? ''
  return (
    <Section id="terminal" title="Terminal">
      <Row label="Default shell" hint="Used when a new terminal tab opens." htmlFor="default-shell">
        <select
          id="default-shell"
          data-testid="default-shell"
          value={value}
          disabled={list.length === 0}
          className={cn(fieldClass, 'h-[30px] w-52')}
          onChange={(e) => setDefaultShell(e.target.value as ShellId)}
        >
          {list.length === 0 && <option value="">No shells found</option>}
          {list.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </Row>
    </Section>
  )
}

function UpdatesSection({ prefs, set }: { prefs: AppPrefs; set: (p: AppPrefsPatch) => void }): React.JSX.Element {
  const state = useUpdateState()
  const info = useQuery<AppInfo>({ queryKey: ['app', 'info'], queryFn: () => window.ccwrap.app.info(), retry: false })
  const [checking, setChecking] = React.useState(false)
  const disabled = state.kind === 'disabled'
  const check = (): void => {
    setChecking(true)
    void Promise.resolve(window.ccwrap.update.check())
      .catch(() => {})
      .finally(() => setChecking(false))
  }
  return (
    <Section id="updates" title="Updates">
      <Row label="Current version" htmlFor="update-check">
        <span data-testid="update-current" className="font-mono text-sm text-fg-2">
          {info.data ? `${info.data.version}${info.data.packaged ? '' : ' (dev)'}` : '...'}
        </span>
      </Row>
      <Row label="Status">
        <span
          role="status"
          data-testid="update-status"
          data-kind={state.kind}
          className={cn('max-w-xs text-right text-sm', state.kind === 'error' ? 'text-danger' : 'text-fg-3')}
        >
          {describeUpdate(state)}
        </span>
      </Row>
      <Row label="Check now" hint="Looks for a newer release on GitHub.">
        <Button
          id="update-check"
          size="sm"
          data-testid="update-check"
          disabled={disabled || checking || state.kind === 'checking' || state.kind === 'downloading'}
          onClick={check}
        >
          Check for updates
        </Button>
      </Row>
      <Row label="Check for updates automatically" hint="At startup and every few hours." htmlFor="update-auto">
        <Toggle
          id="update-auto"
          checked={prefs.autoUpdate}
          data-testid="update-auto"
          onCheckedChange={(v) => set({ autoUpdate: v })}
        />
      </Row>
    </Section>
  )
}

function Field({ label, value, testId }: { label: string; value: string | undefined; testId: string }): React.JSX.Element {
  return (
    <div className="flex gap-4 py-2 text-base">
      <dt className="w-32 shrink-0 text-fg-3">{label}</dt>
      <dd data-testid={testId} className="min-w-0 flex-1 break-all font-mono text-sm text-fg-2">
        {value || 'unknown'}
      </dd>
    </div>
  )
}

function AboutSection(): React.JSX.Element {
  const info = useQuery<AppInfo>({ queryKey: ['app', 'info'], queryFn: () => window.ccwrap.app.info(), retry: false })
  const i = info.data
  return (
    <Section id="about" title="About">
      {!i ? (
        <p className="py-2 text-base text-fg-3">{info.isError ? 'App info is unavailable.' : 'Loading...'}</p>
      ) : (
        <dl>
          <Field label="ccwraper" value={`${i.version}${i.packaged ? '' : ' (dev)'}`} testId="about-version" />
          <Field label="Electron" value={i.electronVersion} testId="about-electron" />
          <Field label="Claude Code" value={i.claudeVersion} testId="about-claude-version" />
          <Field label="Claude source" value={i.claudeSource} testId="about-claude-source" />
          <Field label="Claude path" value={i.claudePath} testId="about-claude-path" />
          <Field label="Agent SDK" value={i.sdkVersion} testId="about-sdk" />
          <Field label="Data folder" value={i.userDataDir} testId="about-userdata" />
          <Field label="Trash folder" value={i.trashDir} testId="about-trash" />
        </dl>
      )}
    </Section>
  )
}

export function PreferencesPage(): React.JSX.Element {
  const { prefs, loadError, hotkey, saveError, set } = usePrefs()
  return (
    <div data-testid="preferences-page" className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl px-6 py-6">
        <h2 className="text-lg font-medium text-fg">Preferences</h2>
        {saveError && (
          <p role="alert" data-testid="prefs-save-error" className="mt-2 text-sm text-danger">
            {saveError}
          </p>
        )}
        {!prefs ? (
          <p role="status" className="mt-4 text-base text-fg-3">
            {loadError ? 'Preferences could not be loaded.' : 'Loading...'}
          </p>
        ) : (
          <>
            <NotificationsSection prefs={prefs} set={(p) => void set(p)} />
            <HotkeySection prefs={prefs} hotkey={hotkey} set={(p) => void set(p)} />
            <UpdatesSection prefs={prefs} set={(p) => void set(p)} />
            <Section id="statusbar" title="Status bar">
              <Row
                label="Show usage limits"
                hint="5-hour and 7-day subscription usage with a reset countdown. Updates after the first message of a session."
                htmlFor="show-limits"
              >
                <Toggle
                  id="show-limits"
                  checked={prefs.showLimitsBar}
                  data-testid="show-limits"
                  onCheckedChange={(v) => void set({ showLimitsBar: v })}
                />
              </Row>
              <Row
                label="Show caveman badge"
                hint="Token savings from the caveman plugin. Read-only: ccwraper only reads the plugin's status files."
                htmlFor="show-caveman"
              >
                <Toggle
                  id="show-caveman"
                  checked={prefs.showCavemanBadge}
                  data-testid="show-caveman"
                  onCheckedChange={(v) => void set({ showCavemanBadge: v })}
                />
              </Row>
            </Section>
            <Section id="bypass" title="Permission modes">
              <Row
                label="Allow Bypass mode (dangerous)"
                hint="Adds Bypass to the mode menu. In Bypass every tool call runs without asking, including shell commands and file deletes. Each use still asks you to confirm, and it is never remembered across restarts."
                htmlFor="allow-bypass"
              >
                <Toggle
                  id="allow-bypass"
                  checked={prefs.allowBypassMode}
                  data-testid="allow-bypass"
                  onCheckedChange={(v) => void set({ allowBypassMode: v })}
                />
              </Row>
            </Section>
            <Section id="chrome" title="Browser testing">
              <Row
                label="Claude in Chrome"
                hint="Starts new sessions with --chrome so Claude can drive your own Chrome (needs the Claude in Chrome extension, logged in). Applies to new sessions only. For an isolated browser, add Playwright from the MCP page instead."
                htmlFor="claude-in-chrome"
              >
                <Toggle
                  id="claude-in-chrome"
                  checked={prefs.claudeInChrome}
                  data-testid="claude-in-chrome"
                  onCheckedChange={(v) => void set({ claudeInChrome: v })}
                />
              </Row>
            </Section>
            <Section id="quit" title="Quit confirmation">
              <Row
                label="Confirm before quitting while work is running"
                hint="Asks first if a session or background agent is busy."
                htmlFor="confirm-quit"
              >
                <Toggle
                  id="confirm-quit"
                  checked={prefs.confirmQuitWhileRunning}
                  data-testid="confirm-quit"
                  onCheckedChange={(v) => void set({ confirmQuitWhileRunning: v })}
                />
              </Row>
            </Section>
          </>
        )}
        <ShellSection />
        {/* Usage limit: the lead mounts <AutoResumeCard /> (features/autoresume, WP14) inside this section. */}
        <section aria-label="Usage limit" data-testid="prefs-usage-limit" className="border-b border-border empty:hidden">
          <AutoResumeCard />
        </section>
        <AboutSection />
      </div>
    </div>
  )
}
