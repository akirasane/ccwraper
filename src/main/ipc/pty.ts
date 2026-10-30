import { ipcMain, webContents } from 'electron'
import type { IpcMainEvent, IpcMainInvokeEvent, WebContents } from 'electron'
import {
  PtyCloseSchema,
  PtyOpenSchema,
  PtyResizeSchema,
  PtyWriteSchema,
  IpcChannels
} from '../../shared/ipc'
import type { PtyOpenResult, ShellProfile } from '../../shared/config'
import { PtyService } from '../services/pty-service'
import type { Disposer } from './dispose'
import { removeHandlers } from './dispose'

export interface PtyIpcDeps {
  send: (channel: string, payload: unknown) => void
  /** Test seam. */
  service?: PtyService
}

function sendTo(ownerId: number, channel: string, payload: unknown): void {
  const wc = webContents.fromId(ownerId)
  if (wc && !wc.isDestroyed()) wc.send(channel, payload)
}

export function registerPtyIpc(deps: PtyIpcDeps): Disposer {
  const service =
    deps.service ??
    new PtyService({
      emitData: (ownerId, p) => sendTo(ownerId, IpcChannels.ptyData, p),
      emitExit: (ownerId, p) => sendTo(ownerId, IpcChannels.ptyExit, p)
    })

  const hooked = new Set<number>()
  const hook = (wc: WebContents): void => {
    if (hooked.has(wc.id)) return
    hooked.add(wc.id)
    const id = wc.id
    const kill = (): void => service.closeOwner(id)
    wc.once('destroyed', () => {
      kill()
      hooked.delete(id)
    })
    wc.on('render-process-gone', kill)
    wc.on('did-start-navigation', (details: { isMainFrame?: boolean; isSameDocument?: boolean }) => {
      if (details.isMainFrame && !details.isSameDocument) kill()
    })
  }

  ipcMain.handle(IpcChannels.ptyListShells, (): ShellProfile[] => service.listShells())
  ipcMain.handle(IpcChannels.ptyOpen, (e: IpcMainInvokeEvent, raw: unknown): PtyOpenResult => {
    const a = PtyOpenSchema.parse(raw)
    const res = service.open(a.shellId, a.cwd, a.cols, a.rows, e.sender.id)
    hook(e.sender)
    return res
  })
  ipcMain.handle(IpcChannels.ptyClose, (e: IpcMainInvokeEvent, raw: unknown): void => {
    const a = PtyCloseSchema.parse(raw)
    service.close(a.ptyId, e.sender.id)
  })
  ipcMain.on(IpcChannels.ptyWrite, (e: IpcMainEvent, raw: unknown) => {
    const a = PtyWriteSchema.safeParse(raw)
    if (a.success) service.write(a.data.ptyId, a.data.data, e.sender.id)
  })
  ipcMain.on(IpcChannels.ptyResize, (e: IpcMainEvent, raw: unknown) => {
    const a = PtyResizeSchema.safeParse(raw)
    if (a.success) service.resize(a.data.ptyId, a.data.cols, a.data.rows, e.sender.id)
  })

  const removeInvoke = removeHandlers(IpcChannels.ptyListShells, IpcChannels.ptyOpen, IpcChannels.ptyClose)
  return () => {
    removeInvoke()
    ipcMain.removeAllListeners(IpcChannels.ptyWrite)
    ipcMain.removeAllListeners(IpcChannels.ptyResize)
    service.closeAll()
  }
}
