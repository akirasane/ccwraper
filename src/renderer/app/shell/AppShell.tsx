import { QueryClientProvider } from '@tanstack/react-query'
import { useEffect, useMemo } from 'react'
import { ChatView } from '@/features/chat/ChatView'
import type { ChatTarget } from '@/features/chat/model/types'
import { initIpcBridge } from '@/lib/ipc-bridge'
import { queryClient } from '@/lib/query-client'
import { useChatStore } from '@/stores/chat-store'
import { cwdKey, useWorkspaceStore } from '@/stores/workspace-store'
import { LeftRail } from './LeftRail'
import { useProjectList } from './ProjectPicker'
import { StatusBar } from './StatusBar'
import { TitleBar } from './TitleBar'

function Notice({ title, body }: { title: string; body: string }): React.JSX.Element {
  return (
    <div className="m-auto max-w-sm px-6 text-center" role="status">
      <h2 className="text-lg font-medium text-fg">{title}</h2>
      {body && <p className="mt-1 text-base text-fg-3">{body}</p>}
    </div>
  )
}

function Shell(): React.JSX.Element {
  const cwd = useWorkspaceStore((s) => s.cwd)
  const activeConvId = useWorkspaceStore((s) => s.activeConvId)
  const loading = useWorkspaceStore((s) => s.loadingSession)
  const newSession = useWorkspaceStore((s) => s.newSession)
  const conv = useChatStore((s) => (activeConvId ? s.convs[activeConvId] : undefined))
  const { projects, isLoading } = useProjectList()

  // Subscribe to main-process session events once for the whole app.
  useEffect(() => {
    if (!window.ccwrap) return
    return initIpcBridge()
  }, [])

  const project = cwd ? projects.find((p) => cwdKey(p.cwd) === cwdKey(cwd)) : undefined
  const missing = !!cwd && !isLoading && project?.exists === false

  // Restore the last project (from localStorage) as a fresh draft once we know it exists.
  useEffect(() => {
    if (cwd && !activeConvId && !isLoading && !missing) newSession()
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
        <main className="flex min-w-0 flex-1 flex-col" data-testid="chat-column">
          {missing ? (
            <Notice
              title="Folder not found"
              body={`${cwd} no longer exists, so sessions cannot be started or resumed here.`}
            />
          ) : !target ? (
            <Notice title="Select a project" body="Choose a project on the left, or open a folder to start." />
          ) : loading ? (
            <Notice title="Loading session..." body="" />
          ) : (
            <ChatView key={target.convId} target={target} />
          )}
        </main>
      </div>
      <StatusBar />
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
