import { QueryClientProvider } from '@tanstack/react-query'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import { ChatView } from '@/features/chat/ChatView'
import type { ChatTarget } from '@/features/chat/model/types'
import { useFsChangedInvalidation } from '@/lib/config-queries'
import { FirstRunCard } from '@/features/onboarding/FirstRunCard'
import { CloseTabDialog } from '@/features/tabs/CloseTabDialog'
import { BypassConfirmDialog } from '@/features/chat/mode/choose-mode'
import { useAutoResume } from '@/features/autoresume/autoresume'
import { readPersistedTabs, startTabPersistence } from '@/features/tabs/tab-persist'
import { useBackgroundAttention } from '@/features/tabs/use-background-attention'
import { useTabShortcuts } from '@/features/tabs/use-tab-shortcuts'
import { initIpcBridge } from '@/lib/ipc-bridge'
import { queryClient } from '@/lib/query-client'
import { setTerminalOpener } from '@/lib/terminal-bus'
import { Button, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui'
import { useChatStore } from '@/stores/chat-store'
import { useDirtyRegistry } from '@/stores/dirty-registry'
import { cwdKey, useWorkspaceStore } from '@/stores/workspace-store'
import { LeftRail } from './LeftRail'
import { useProjectList } from './ProjectPicker'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

// Lazy so chat startup does not pay for the config pages or the terminal (xterm, CodeMirror).
const SettingsPage = lazy(() => import('@/features/settings/SettingsPage').then((m) => ({ default: m.SettingsPage })))
const McpPage = lazy(() => import('@/features/mcp/McpPage').then((m) => ({ default: m.McpPage })))
const MemoryPage = lazy(() => import('@/features/memory/MemoryPage').then((m) => ({ default: m.MemoryPage })))
const SkillsPage = lazy(() => import('@/features/items/SkillsPage').then((m) => ({ default: m.SkillsPage })))
const AgentsPage = lazy(() => import('@/features/items/AgentsPage').then((m) => ({ default: m.AgentsPage })))
const HooksPage = lazy(() => import('@/features/hooks/HooksPage').then((m) => ({ default: m.HooksPage })))
const UsagePage = lazy(() => import('@/features/usage/UsagePage').then((m) => ({ default: m.UsagePage })))
const GitPage = lazy(() => import('@/features/git/GitPage').then((m) => ({ default: m.GitPage })))
const PreferencesPage = lazy(() =>
  import('@/features/preferences/PreferencesPage').then((m) => ({ default: m.PreferencesPage }))
)
const CommandPalette = lazy(() =>
  import('@/features/palette/CommandPalette').then((m) => ({ default: m.CommandPalette }))
)
const TerminalPanel = lazy(() =>
  import('@/features/terminal/TerminalPanel').then((m) => ({ default: m.TerminalPanel }))
)

function Notice({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="m-auto max-w-sm px-6 text-center" role="status">
      <h2 className="text-lg font-medium text-fg">{title}</h2>
      {body && <p className="mt-1 text-base text-fg-3">{body}</p>}
    </div>
  )
}

/** Asks before a view or project change throws away unsaved edits (settings, CLAUDE.md). */
function DiscardGuard(): React.JSX.Element {
  const pending = useDirtyRegistry((s) => s.pending !== null)
  const confirm = useDirtyRegistry((s) => s.confirm)
  const cancel = useDirtyRegistry((s) => s.cancel)
  return (
    <Dialog open={pending} onOpenChange={(o) => !o && cancel()}>
      <DialogContent data-testid="discard-guard">
        <DialogHeader>
          <DialogTitle>Discard unsaved changes?</DialogTitle>
          <DialogDescription>You have unsaved edits. Leaving this view will discard them.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={cancel}>
            Keep editing
          </Button>
          <Button variant="danger" onClick={confirm}>
            Discard
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function Shell(): React.JSX.Element {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const loading = useWorkspaceStore((s) => s.loadingSession)
  const view = useWorkspaceStore((s) => s.view)
  const terminalOpen = useWorkspaceStore((s) => s.terminalOpen)
  const toggleTerminal = useWorkspaceStore((s) => s.toggleTerminal)
  // Mount the terminal on first open and keep it mounted (hidden) afterwards so ptys and xterm survive.
  const [terminalMounted, setTerminalMounted] = useState(false)
  const closeTerminal = useCallback(() => {
    if (useWorkspaceStore.getState().terminalOpen) useWorkspaceStore.getState().toggleTerminal()
  }, [])
  const newSession = useWorkspaceStore((s) => s.newSession)
  const conv = useChatStore((s) => (activeConvId ? s.convs[activeConvId] : undefined))
  const { projects, isLoading } = useProjectList()

  // Subscribe to main-process session events once for the whole app.
  useEffect(() => {
    if (!window.ccwrap) return
    return initIpcBridge()
  }, [])

  useFsChangedInvalidation()
  useTabShortcuts()
  useBackgroundAttention()

  // Bring back last session's history tabs (transcripts load lazily), then keep tabs.v1 up to date.
  useEffect(() => {
    const saved = readPersistedTabs()
    if (saved) useWorkspaceStore.getState().restoreTabs(saved)
    return startTabPersistence()
  }, [])

  // Auto-resume after a usage limit; must come after the tab restore above so saved pauses find their tabs.
  useAutoResume()

  // Watch the active project's config files in main.
  useEffect(() => {
    void window.ccwrap?.config?.watchProject(cwd ?? null)?.catch(() => {})
  }, [cwd])

  useEffect(() => {
    if (terminalOpen) setTerminalMounted(true)
  }, [terminalOpen])

  // "Run in terminal" (chat -> terminal bus) must open the panel even if it was closed.
  useEffect(() => {
    setTerminalOpener(() => {
      if (!useWorkspaceStore.getState().terminalOpen) useWorkspaceStore.getState().toggleTerminal()
    })
    return () => setTerminalOpener(undefined)
  }, [])

  // Ctrl+` toggles the terminal.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && !e.altKey && !e.metaKey && !e.shiftKey && (e.code === 'Backquote' || e.key === '`')) {
        e.preventDefault()
        toggleTerminal()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [toggleTerminal])

  const project = cwd ? projects.find((p) => cwdKey(p.cwd) === cwdKey(cwd)) : undefined
  const missing = !!cwd && !isLoading && project?.exists === false

  // Restore the last project (from localStorage) as a fresh draft once we know it exists.
  useEffect(() => {
    if (cwd && !activeConvId && !isLoading && !missing && !useWorkspaceStore.getState().activeConvId) newSession()
  }, [cwd, activeConvId, isLoading, missing, newSession])

  const target = useMemo<ChatTarget | undefined>(
    () =>
      conv
        ? { convId: conv.convId, cwd: conv.cwd, localId: conv.localId, resumeSessionId: conv.resumeSessionId }
        : undefined,
    [conv?.convId, conv?.cwd, conv?.localId, conv?.resumeSessionId] // eslint-disable-line react-hooks/exhaustive-deps
  )

  return (
    <div data-testid="app-shell" className="flex h-screen flex-col bg-bg-0 text-fg">
      <TitleBar />
      <div className="flex min-h-0 flex-1">
        <LeftRail disabled={missing} />
        <div className="flex min-w-0 flex-1 flex-col">
          <main className="flex min-h-0 min-w-0 flex-1 flex-col" data-testid="chat-column">
            {view !== 'chat' && (
              <Suspense fallback={<Notice title="Loading..." body="" />}>
                {view === 'settings' && <SettingsPage cwd={cwd} />}
                {view === 'mcp' && <McpPage cwd={cwd} />}
                {view === 'memory' && <MemoryPage cwd={cwd} />}
                {view === 'skills' && <SkillsPage cwd={cwd} />}
                {view === 'agents' && <AgentsPage cwd={cwd} />}
                {view === 'hooks' && <HooksPage cwd={cwd} />}
                {view === 'usage' && <UsagePage cwd={cwd} />}
                {view === 'git' && <GitPage cwd={cwd} />}
                {view === 'preferences' && <PreferencesPage />}
              </Suspense>
            )}
            {/* Chat stays mounted (hidden) while another view is open so composer drafts and scroll survive. */}
            <div className={view === 'chat' ? 'contents' : 'hidden'}>
              {missing ? (
                <Notice
                  title="Folder not found"
                  body={`${cwd} no longer exists, so sessions cannot be started or resumed here.`}
                />
              ) : !target ? (
                <div className="m-auto flex w-full max-w-md flex-col gap-4 px-6">
                  <FirstRunCard cwd={cwd} />
                  <Notice title="Select a project" body="Choose a project on the left, or open a folder to start." />
                </div>
              ) : loading ? (
                <Notice title="Loading session..." body="" />
              ) : (
                <ChatView key={target.convId} target={target} />
              )}
            </div>
          </main>
          <div data-testid="terminal-slot" className={terminalOpen ? 'shrink-0' : 'hidden'}>
            {terminalMounted && (
              <Suspense fallback={null}>
                <TerminalPanel cwd={cwd} onClose={closeTerminal} />
              </Suspense>
            )}
          </div>
        </div>
      </div>
      <StatusBar />
      <DiscardGuard />
      <CloseTabDialog />
      <BypassConfirmDialog />
      <Suspense fallback={null}>
        <CommandPalette />
      </Suspense>
    </div>
  )
}

export function AppShell(): React.JSX.Element {
  return (
    <QueryClientProvider client={queryClient}>
      <Shell />
    </QueryClientProvider>
  )
}
