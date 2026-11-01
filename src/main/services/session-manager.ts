import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import type { ModelOption } from '../../shared/config'
import type { SessionEvent, SessionStatus } from '../../shared/events'
import type { ImageAttachment, PermissionReplyArgs, RewindResult, SessionStartArgs } from '../../shared/ipc'
import type { PluginRegistry } from './plugin-registry'
import { BYPASS_DISABLED, startSdkSession, type AdapterSession, type PermissionModeName } from './sdk-adapter'

export const MAX_SESSIONS = 5

export interface SessionManagerDeps {
  /** Test seam; defaults to the real SDK adapter. */
  startSession?: typeof startSdkSession
  /** Fed from `init.plugins` by WP1; WP0 only wires the constructor arg. */
  registry?: PluginRegistry
  /** Reads the allowBypassMode preference at call time. Defaults to off. */
  allowBypass?: () => boolean
  /** Reads the claudeInChrome preference at call time. Defaults to off. */
  chrome?: () => boolean
  /** Receives every SDK rate_limit_info from any session (usage-limit bars). */
  onRateLimitInfo?: (info: unknown) => void
}

async function assertDirectory(cwd: string): Promise<void> {
  const st = await stat(cwd).catch(() => undefined)
  if (!st?.isDirectory()) throw new Error(`Working directory not found: ${cwd}`)
}

interface LiveSession {
  localId: string
  cwd: string
  adapter: AdapterSession
  sdkSessionId?: string
  /** Last `status` event; undefined until the first one. */
  status?: SessionStatus
  /** Running non-hidden task ids (from task_started / task_ended / session_closed). */
  tasks: Set<string>
}

const TASK_TERMINAL = new Set(['completed', 'failed', 'stopped', 'killed'])

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
    const extraDirs = args.additionalDirectories ?? []
    for (const d of extraDirs) await assertDirectory(d)
    if (this.sessions.size >= MAX_SESSIONS) throw new Error(`Session cap reached (${MAX_SESSIONS})`)
    const allowBypass = this.deps.allowBypass?.() === true
    if (args.permissionMode === 'bypassPermissions' && !allowBypass) throw new Error(BYPASS_DISABLED)
    const localId = randomUUID()
    const live = { localId, cwd: args.cwd, tasks: new Set<string>() } as LiveSession
    // Reserve slot before the async start so the cap holds under concurrent calls.
    this.sessions.set(localId, live)
    try {
      live.adapter = await (this.deps.startSession ?? startSdkSession)({
        cwd: args.cwd,
        prompt: args.prompt,
        ...(args.images?.length ? { images: args.images } : {}),
        ...(args.messageId ? { messageId: args.messageId } : {}),
        ...(extraDirs.length ? { additionalDirectories: extraDirs } : {}),
        // Summarized adaptive thinking: without it the CLI returns thinking blocks with empty text.
        thinking: true,
        ...(args.model ? { model: args.model } : {}),
        ...(args.permissionMode ? { permissionMode: args.permissionMode } : {}),
        ...(allowBypass ? { allowBypass: true } : {}),
        ...(this.deps.chrome?.() === true ? { chrome: true } : {}),
        ...(args.resumeId ? { resumeId: args.resumeId } : {}),
        ...(args.fork ? { fork: args.fork } : {}),
        ...(this.deps.onRateLimitInfo ? { onRateLimitInfo: this.deps.onRateLimitInfo } : {}),
        onEvent: (e) => {
          if (e.t === 'init') {
            live.sdkSessionId = e.sessionId
            if (e.plugins) this.deps.registry?.update(e.plugins)
          }
          this.track(live, e)
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

  /** Keeps the facts busyCount() needs; runs before the event is emitted. */
  private track(live: LiveSession, e: SessionEvent): void {
    switch (e.t) {
      case 'status':
        live.status = e.state
        break
      case 'task_started':
        if (!e.hidden) live.tasks.add(e.taskId)
        break
      case 'task_updated':
        if (e.status && TASK_TERMINAL.has(e.status)) live.tasks.delete(e.taskId)
        break
      case 'task_ended':
        live.tasks.delete(e.taskId)
        break
      case 'session_closed':
        live.tasks.clear()
        live.status = 'idle'
        break
      default:
        break
    }
  }

  /** cwd and SDK session id of a live session (undefined for unknown or finished ones). */
  info(localId: string): { cwd: string; sdkSessionId?: string } | undefined {
    const s = this.sessions.get(localId)
    if (!s) return undefined
    return { cwd: s.cwd, ...(s.sdkSessionId ? { sdkSessionId: s.sdkSessionId } : {}) }
  }

  /** Sessions that are working: a running turn, a pending permission, or a running non-hidden background task. */
  busyCount(): number {
    let n = 0
    for (const s of this.sessions.values()) {
      if (s.status === 'running' || s.status === 'waiting_permission' || s.tasks.size > 0) n++
    }
    return n
  }

  private get(localId: string): LiveSession {
    const s = this.sessions.get(localId)
    if (!s?.adapter) throw new Error(`Unknown or finished session ${localId}`)
    return s
  }

  send(localId: string, text: string, images?: ImageAttachment[], messageId?: string): void {
    this.get(localId).adapter.send(text, images, messageId)
  }
  rewind(localId: string, messageId: string, dryRun: boolean): Promise<RewindResult> {
    return this.get(localId).adapter.rewindFiles(messageId, dryRun)
  }
  async interrupt(localId: string): Promise<void> {
    // Safe no-op for finished/unknown sessions.
    await this.sessions.get(localId)?.adapter?.interrupt()
  }
  setModel(localId: string, model: string): Promise<void> {
    return this.get(localId).adapter.setModel(model)
  }
  setPermissionMode(localId: string, mode: PermissionModeName): Promise<void> {
    if (mode === 'bypassPermissions' && this.deps.allowBypass?.() !== true) return Promise.reject(new Error(BYPASS_DISABLED))
    return this.get(localId).adapter.setPermissionMode(mode)
  }
  /** Model list is account-wide, so the first successful fetch is cached for the app lifetime. */
  async supportedModels(localId: string): Promise<ModelOption[]> {
    if (this.modelsCache) return this.modelsCache
    const models = await this.get(localId).adapter.supportedModels()
    this.modelsCache = models
    return models
  }
  stopTask(localId: string, taskId: string): Promise<void> {
    return this.get(localId).adapter.stopTask(taskId)
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
