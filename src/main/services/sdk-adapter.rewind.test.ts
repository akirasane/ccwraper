import { describe, expect, it, vi } from 'vitest'
import type { Query, SDKUserMessage } from '@anthropic-ai/claude-agent-sdk'
import { startSdkSession, type QueryImpl } from './sdk-adapter'

const ID = '11111111-1111-4111-8111-111111111111'

function harness(rewind?: (id: string, o?: { dryRun?: boolean }) => Promise<unknown>): {
  impl: QueryImpl
  prompts: SDKUserMessage[]
  options: () => Record<string, unknown>
  end: () => void
} {
  const prompts: SDKUserMessage[] = []
  let opts: Record<string, unknown> = {}
  let end!: () => void
  const finished = new Promise<void>((r) => (end = r))
  const impl = vi.fn((arg: { prompt: AsyncIterable<SDKUserMessage>; options: Record<string, unknown> }) => {
    opts = arg.options
    void (async () => {
      for await (const m of arg.prompt) prompts.push(m)
    })()
    const q = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          await finished
          return { value: undefined, done: true as const }
        }
      }),
      interrupt: async () => {},
      close: () => end(),
      ...(rewind ? { rewindFiles: rewind } : {})
    }
    return q as unknown as Query
  }) as unknown as QueryImpl
  return { impl, prompts, options: () => opts, end }
}

describe('file checkpointing / rewind', () => {
  it('enables checkpointing and stamps the message id on the initial and later user messages', async () => {
    const h = harness()
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', messageId: ID, queryImpl: h.impl, onEvent: () => {} })
    s.send('again', undefined, '22222222-2222-4222-8222-222222222222')
    await new Promise((r) => setTimeout(r, 0))
    expect(h.options()['enableFileCheckpointing']).toBe(true)
    expect(h.prompts.map((p) => p.uuid)).toEqual([ID, '22222222-2222-4222-8222-222222222222'])
    s.close()
  })

  it('passes dryRun through and returns the SDK result', async () => {
    const rewind = vi.fn(async () => ({ canRewind: true, filesChanged: ['a.ts'], insertions: 2, deletions: 1 }))
    const h = harness(rewind)
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: h.impl, onEvent: () => {} })
    const dry = await s.rewindFiles(ID, true)
    expect(rewind).toHaveBeenCalledWith(ID, { dryRun: true })
    expect(dry).toEqual({ canRewind: true, filesChanged: ['a.ts'], insertions: 2, deletions: 1 })
    s.close()
  })

  it('refuses a real rewind while a turn is running but allows the preview', async () => {
    const rewind = vi.fn(async () => ({ canRewind: true }))
    const h = harness(rewind)
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: h.impl, onEvent: () => {} })
    s.send('work') // marks the session running
    const real = await s.rewindFiles(ID, false)
    expect(real.canRewind).toBe(false)
    expect(real.error).toMatch(/finish/)
    expect(rewind).not.toHaveBeenCalled()
    expect((await s.rewindFiles(ID, true)).canRewind).toBe(true)
    s.close()
  })

  it('turns SDK errors and a missing API into canRewind:false', async () => {
    const h = harness(async () => {
      throw new Error('No checkpoint found')
    })
    const s = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: h.impl, onEvent: () => {} })
    expect(await s.rewindFiles(ID, true)).toEqual({ canRewind: false, error: 'No checkpoint found' })
    s.close()
    const h2 = harness()
    const s2 = await startSdkSession({ cwd: 'C:/x', prompt: 'hi', queryImpl: h2.impl, onEvent: () => {} })
    expect((await s2.rewindFiles(ID, true)).canRewind).toBe(false)
    s2.close()
  })
})
