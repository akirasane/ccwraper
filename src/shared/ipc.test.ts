import { describe, expect, it } from 'vitest'
import { IpcChannels } from './channels'
import { HistoryListSchema, HistoryLoadSchema } from './ipc'

describe('ipc contracts', () => {
  it('declares the history/app channels', () => {
    expect(IpcChannels.historyListProjects).toBe('history:listProjects')
    expect(IpcChannels.historyList).toBe('history:list')
    expect(IpcChannels.historyLoad).toBe('history:load')
    expect(IpcChannels.appInfo).toBe('app:info')
  })

  it('validates history args', () => {
    expect(HistoryListSchema.safeParse({ cwd: 'C:\\x' }).success).toBe(true)
    expect(HistoryListSchema.safeParse({ cwd: '' }).success).toBe(false)
    expect(HistoryLoadSchema.safeParse({ sessionId: 's1' }).success).toBe(true)
    expect(HistoryLoadSchema.safeParse({}).success).toBe(false)
  })
})
