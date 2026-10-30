import { mkdir, mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { IpcChannels } from '../../shared/ipc'

const handlers = new Map<string, (e: unknown, raw: unknown) => unknown>()
vi.mock('electron', () => ({
  app: { getPath: () => { throw new Error('app.getPath must not be used with injected seams') } },
  ipcMain: {
    handle: (ch: string, fn: (e: unknown, raw: unknown) => unknown) => void handlers.set(ch, fn),
    removeHandler: (ch: string) => void handlers.delete(ch)
  }
}))

import { createConfigPaths } from '../paths'
import { PluginRegistry } from '../services/plugin-registry'
import { registerItemsIpc } from './items'

let root: string
let dispose: () => void
const call = async (ch: string, raw: unknown): Promise<any> => handlers.get(ch)!({}, raw)

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'ccwrap-ipc-items-'))
  await mkdir(join(root, 'home'), { recursive: true })
  dispose = registerItemsIpc({
    send: () => undefined,
    registry: new PluginRegistry(),
    paths: createConfigPaths({ CLAUDE_CONFIG_DIR: join(root, 'home', '.claude') }, join(root, 'home')),
    trashRoot: join(root, 'userData', 'trash'),
    backupDir: join(root, 'userData', 'backups')
  })
})
afterEach(async () => {
  dispose()
  await rm(root, { recursive: true, force: true })
})

describe('items IPC', () => {
  it('registers the four channels and removes them on dispose', () => {
    for (const ch of [IpcChannels.itemsList, IpcChannels.itemsCreate, IpcChannels.itemsRename, IpcChannels.itemsDelete])
      expect(handlers.has(ch)).toBe(true)
    dispose()
    expect(handlers.size).toBe(0)
    dispose = registerItemsIpc({ send: () => undefined, registry: new PluginRegistry(), paths: createConfigPaths({}, root), trashRoot: root, backupDir: root })
  })

  it('create -> list -> delete round trip through the handlers', async () => {
    const text = '---\nname: demo\n---\nbody\n'
    const created = await call(IpcChannels.itemsCreate, { kind: 'agent', scope: 'user', name: 'demo', text })
    expect(created.ok).toBe(true)
    const list = await call(IpcChannels.itemsList, { kind: 'agent' })
    expect(list.items.map((i: { name: string }) => i.name)).toEqual(['demo'])
    const del = await call(IpcChannels.itemsDelete, { ref: created.ref, baseHash: created.snapshot.hash })
    expect(del.ok).toBe(true)
    expect(del.trashPath.startsWith(join(root, 'userData', 'trash'))).toBe(true)
    expect(await stat(join(root, 'home', '.claude', 'agents', 'demo.md')).then(() => true, () => false)).toBe(false)
  })

  it('schema validation rejects traversal before the service runs', async () => {
    await expect(call(IpcChannels.itemsCreate, { kind: 'command', scope: 'user', name: 'a/../../b', text: '' })).rejects.toThrow()
    await expect(call(IpcChannels.itemsDelete, { ref: { kind: 'agent', scope: 'user', name: '..\\x' }, baseHash: 'h' })).rejects.toThrow()
    await expect(call(IpcChannels.itemsList, { kind: 'bogus' })).rejects.toThrow()
  })
})
