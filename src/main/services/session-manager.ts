import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { ModelOption } from '../../shared/config'
import type { SessionEvent } from '../../shared/events'
import type { PermissionReplyArgs, SessionStartArgs } from '../../shared/ipc'
import { startSdkSession, type AdapterSession, type PermissionModeName } from './sdk-adapter'

export const MAX_SESSIONS = 5

export interface SessionManagerDeps {
  /** Test seam; defaults to the real SDK adapter. */
  startSession?: typeof startSdkSession
}

async function assertDirectory(cwd: string): Promise<void> {
  const st = await stat(cwd).catch(() => undefined)
  if (!st?.isDirectory()) throw new Error(`Working directory not found: ${cwd}`)
}

interface LiveSession {
  localId: string
  adapter: AdapterSession
  sdkSessionId?: string
}

export class SessionManager {
  private sessions = new Map<string, LiveSession>()
  private modelsCache: ModelOption[] | undefined
  constructor(
    private emit: (localId: string, e: SessionEvent) => void,
    private deps: SessionManagerDeps = {}
  ) {}

  async start(args: SessionStartArgs): Promise<{ localId: string }> {
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`Session cap reached (${MAX_SESSIONS})`)
    // Checked here: the SDK's own spawn error for a bad cwd is misleading ("failed to launch ... libc").
    await assertDirectory(args.cwd)
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`Session cap reached (${MAX_SESSIONS})`)
    const localId = randomUUID()
    const live = { localId } as LiveSession
    // Reserve slot before the async start so the cap holds under concurrent calls.
    this.sessions.set(localId, live)
    try {
      live.adapter = await (this.deps.startSession ?? startSdkSession)({
        cwd: args.cwd,
        prompt: args.prompt,
        // Summarized adaptive thinking: without it the CLI returns thinking blocks with empty text.
        thinking: true,
        ...(args.model ? { model: args.model } : {}),
        ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
        ...(args.resumeId ? { resumeId: args.resumeId } : {}),
        ...(args.fork ? { fork: args.fork } : {}),
        onEvent: (e) => {
          if (e.t === 'init') live.sdkSessionId = e.sessionId
          this.emit(localId, e)
        }
      })
    } catch (err) {
      this.sessions.delete(localId)
      throw err
    }
    void live.adapter.done.finally(() => {
      this.sessions.delete(localId)
    })
    return { localId }
  }

  private get(localId: string): LiveSession {
    const s = this.sessions.get(localId)
    if (!s?.adapter) throw new Error(`Unknown or finished session ${localId}`)
    return s
  }

  send(localId: string, text: string): void {
    this.get(localId).adapter.send(text)
  }
  async interrupt(localId: string): Promise<void> {
    // Safe no-op for finished/unknown sessions.
    await this.sessions.get(localId)?.adapter?.interrupt()
  }
  setModel(localId: string, model: string): Promise<void> {
    return this.get(localId).adapter.setModel(model)
  }
  setPermissionMode(localId: string, mode: PermissionModeName): Promise<void> {
    return this.get(localId).adapter.setPermissionMode(mode)
  }
  /** Model list is account-wide, so the first successful fetch is cached for the app lifetime. */
  async supportedModels(localId: string): Promise<ModelOption[]> {
    if (this.modelsCache) return this.modelsCache
    const models = await this.get(localId).adapter.supportedModels()
    this.modelsCache = models
    return models
  }
  permissionReply(a: PermissionReplyArgs): void {
    this.get(a.localId).adapter.replyPermission(a.reqId, a.decision, a.remember, a.updatedInput)
  }
  close(localId: string): void {
    const s = this.sessions.get(localId)
    if (!s) return
    s.adapter?.close()
    this.sessions.delete(localId)
  }
  closeAll(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }
  get size(): number {
    return this.sessions.size
  }
}
