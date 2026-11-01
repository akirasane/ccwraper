import { describe, expect, it } from 'vitest'
import type { Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import { mapMessage, normalizeCommands, startSdkSession, type QueryImpl } from './sdk-adapter'

function fakeQuery(supported?: () => Promise<unknown>): { impl: QueryImpl; end: () => void } {
  let end!: () => void
  const finished = new Promise<void>((r) => (end = r))
  const impl: QueryImpl = () => {
    const q = {
      [Symbol.asyncIterator]() {
        return {
          next: async () => {
            await finished
            return { value: undefined, done: true as const }
          }
        }
      },
      interrupt: async () => {},
      close: () => end(),
      ...(supported ? { supportedCommands: supported } : {})
    }
    return q as unknown as Query
  }
  return { impl, end }
}

const RAW = [
  { name: 'compact', description: 'Summarize', argumentHint: '[x]', builtin: true },
  { name: 'usage', description: 'Usage', argumentHint: '', aliases: ['cost'], builtin: true },
  { name: 'p:skill', description: 'S', argumentHint: '' },
  { bogus: true }
]

describe('slash commands in the adapter', () => {
  it('emits a commands event from supportedCommands()', async () => {
    const events: SessionEvent[] = []
    const f = fakeQuery(async () => RAW)
    const s = await startSdkSession({ cwd: 'C:\\x', prompt: 'hi', queryImpl: f.impl, onEvent: (e) => events.push(e) })
    await new Promise((r) => setTimeout(r, 0))
    const ev = events.find((e) => e.t === 'commands')
    expect(ev).toEqual({
      t: 'commands',
      commands: [
        { name: 'compact', description: 'Summarize', argumentHint: '[x]', builtin: true },
        { name: 'usage', description: 'Usage', argumentHint: '', aliases: ['cost'], builtin: true },
        { name: 'p:skill', description: 'S', argumentHint: '' }
      ]
    })
    s.close()
    await s.done
  })

  it('swallows a rejection and a missing method (no commands event, no error)', async () => {
    for (const supported of [() => Promise.reject(new Error('nope')), undefined]) {
      const events: SessionEvent[] = []
      const f = fakeQuery(supported)
      const s = await startSdkSession({ cwd: 'C:\\x', prompt: 'hi', queryImpl: f.impl, onEvent: (e) => events.push(e) })
      await new Promise((r) => setTimeout(r, 0))
      expect(events.some((e) => e.t === 'commands' || e.t === 'error')).toBe(false)
      s.close()
      await s.done
    }
  })

  it('maps a mid-session commands_changed push', () => {
    const ev = mapMessage(
      { type: 'system', subtype: 'commands_changed', commands: RAW } as unknown as SDKMessage,
      { msgId: '' }
    )
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ t: 'commands' })
  })

  it('normalizeCommands rejects non-lists', () => {
    expect(normalizeCommands(undefined)).toBeUndefined()
    expect(normalizeCommands('x')).toBeUndefined()
  })
})
