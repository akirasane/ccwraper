import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ConfigFileRef, SettingsScope } from '@shared/config'
import { Button, Chip, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import { isSettingsDirty, subscribeSettingsDirty } from './dirty-guard'
import { SettingsEditor, type SettingsTab } from './SettingsEditor'

const TAB_KEY = 'ccwrap.settings.tab'
const SCOPES: Array<{ id: SettingsScope; label: string }> = [
  { id: 'user', label: 'User' },
  { id: 'project', label: 'Project' },
  { id: 'local', label: 'Local' }
]

function loadTab(): SettingsTab {
  try {
    const v = window.localStorage.getItem(TAB_KEY)
    if (v === 'form' || v === 'raw' || v === 'precedence') return v
  } catch {
    // storage unavailable
  }
  return 'form'
}

export function SettingsPage({ cwd }: { cwd?: string }): React.JSX.Element {
  const [scope, setScope] = useState<SettingsScope>('user')
  const [tab, setTab] = useState<SettingsTab>(loadTab)
  const [pending, setPending] = useState<SettingsScope | null>(null)
  const dirty = useSyncExternalStore(subscribeSettingsDirty, isSettingsDirty)

  const activeScope: SettingsScope = scope !== 'user' && !cwd ? 'user' : scope
  const fileRef: ConfigFileRef = activeScope === 'user' ? { kind: 'settings', scope: 'user' } : { kind: 'settings', scope: activeScope, cwd }

  const changeTab = (t: SettingsTab) => {
    setTab(t)
    try {
      window.localStorage.setItem(TAB_KEY, t)
    } catch {
      // storage unavailable
    }
  }

  const requestScope = (s: SettingsScope) => {
    if (s === activeScope) return
    if (dirty) setPending(s)
    else setScope(s)
  }

  // Unload guard while the buffer has unsaved edits.
  useEffect(() => {
    if (!dirty) return
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', h)
    return () => window.removeEventListener('beforeunload', h)
  }, [dirty])

  return (
    <section className="flex min-h-0 w-full flex-1 flex-col gap-3 px-6 py-5" data-testid="settings-page" aria-label="Settings">
      <header className="flex flex-wrap items-center gap-3">
        <h2 className="text-xl font-medium tracking-[var(--tracking-tight)] text-fg">Settings</h2>
        <div role="group" aria-label="Settings scope" className="flex gap-1.5">
          {SCOPES.map(({ id, label }) => {
            const disabled = id !== 'user' && !cwd
            return (
              <Chip
                key={id}
                variant={id === activeScope ? 'selected' : 'neutral'}
                disabled={disabled}
                onClick={() => requestScope(id)}
                title={disabled ? 'Select a project first' : undefined}
              >
                {label}
              </Chip>
            )
          })}
        </div>
        {cwd && <span className="min-w-0 truncate text-sm text-fg-3" title={cwd}>{cwd}</span>}
      </header>

      <SettingsEditor key={`${activeScope}:${cwd ?? ''}`} fileRef={fileRef} cwd={cwd} tab={tab} onTabChange={changeTab} />

      <Dialog open={pending !== null} onOpenChange={(o) => !o && setPending(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Discard unsaved changes?</DialogTitle>
            <DialogDescription>You have unsaved edits to this settings file. Switching scope will discard them.</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setPending(null)}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (pending) setScope(pending)
                setPending(null)
              }}
            >
              Discard
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
