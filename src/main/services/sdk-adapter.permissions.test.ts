import { describe, expect, it } from 'vitest'
import type { Options, PermissionResult, PermissionUpdate, Query, SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import type { SessionEvent } from '../../shared/events'
import { mapMessage, ruleLabelFrom, startSdkSession, type QueryImpl } from './sdk-adapter'

const msg = (m: unknown): SDKMessage => m as SDKMessage

/** A controllable stand-in for the SDK Query. */
function makeFake() {
  const queue: SDKMessage[] = []
  let wake: (() => void) | null = null
  let ended = false
  let canUseTool: Options['canUseTool']
  const fake = {
    interruptCalls: 0,
    push(m: unknown) {
      queue.push(msg(m))
      wake?.()
    },
    end() {
      ended = true
      wake?.()
    },
    async callTool(name: string, input: unknown, suggestions?: PermissionUpdate[]): Promise<PermissionResult> {
      const ac = new AbortController()
      return (await canUseTool!(name, input as Record<string, unknown>, {
        signal: ac.signal,
        toolUseID: 't1',
        ...(suggestions ? { suggestions } : {})
      } as never)) as PermissionResult
    }
  }
  const impl: QueryImpl = ({ options }) => {
    canUseTool = options.canUseTool
    const q = {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          while (queue.length) yield queue.shift()!
          if (ended) return
          await new Promise<void>((r) => (wake = r))
          wake = null
        }
      },
      interrupt: async () => {
        fake.interruptCalls++
      },
      setModel: async () => {},
      setPermissionMode: async () => {},
      close: () => fake.end()
    }
    return q as unknown as Query
  }
  return { fake, impl }
}

const sugg: PermissionUpdate[] = [
  {
    type: 'addRules',
    rules: [{ toolName: 'Bash', ruleContent: 'npm test:*' }],
    behavior: 'allow',
    destination: 'projectSettings'
  }
]

async function setup() {
  const { fake, impl } = makeFake()
  const events: SessionEvent[] = []
  const s = await startSdkSession({
    cwd: 'C:\\fixture\\proj',
    prompt: 'hi',
    queryImpl: impl,
    onEvent: (e) => events.push(e)
  })
  return { fake, s, events }
}

const requestId = (events: SessionEvent[]): string => {
  const p = events.find((e) => e.t === 'permission_request')
  if (p?.t !== 'permission_request') throw new Error('no permission_request')
  return p.reqId
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 20))

const errorResult = {
  type: 'result',
  subtype: 'error_during_execution',
  total_cost_usd: 0,
  duration_ms: 1,
  num_turns: 1,
  is_error: true,
  usage: {}
}

describe('ruleLabelFrom', () => {
  it('formats rule with and without content', () => {
    expect(ruleLabelFrom(sugg)).toBe('Bash(npm test:*)')
    expect(
      ruleLabelFrom([{ type: 'addRules', rules: [{ toolName: 'Write' }], behavior: 'allow', destination: 'session' }])
    ).toBe('Write')
    expect(ruleLabelFrom(undefined)).toBeUndefined()
    expect(ruleLabelFrom([{ type: 'setMode', mode: 'plan', destination: 'session' }])).toBeUndefined()
  })
})

describe('permission flow', () => {
  it('emits ruleLabel and maps always -> localSettings', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'npm test' }, sugg)
    expect(events.find((e) => e.t === 'permission_request')).toMatchObject({
      toolName: 'Bash',
      ruleLabel: 'Bash(npm test:*)'
    })
    s.replyPermission(requestId(events), 'allow', 'always')
    expect(await p).toMatchObject({
      behavior: 'allow',
      updatedPermissions: [{ type: 'addRules', destination: 'localSettings' }]
    })
    s.close()
  })

  it('maps session -> session destination', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'npm test' }, sugg)
    s.replyPermission(requestId(events), 'allow', 'session')
    expect(await p).toMatchObject({ updatedPermissions: [{ destination: 'session' }] })
    s.close()
  })

  it('once -> no updatedPermissions', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'x' }, sugg)
    s.replyPermission(requestId(events), 'allow', 'once')
    const r = await p
    expect(r.behavior).toBe('allow')
    expect('updatedPermissions' in r).toBe(false)
    s.close()
  })

  it('always without suggestions: no ruleLabel, no updatedPermissions', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'x' })
    expect(events.find((e) => e.t === 'permission_request')).not.toHaveProperty('ruleLabel')
    s.replyPermission(requestId(events), 'allow', 'always')
    const r = await p
    expect(r.behavior).toBe('allow')
    expect('updatedPermissions' in r).toBe(false)
    s.close()
  })

  it('deny', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'x' }, sugg)
    s.replyPermission(requestId(events), 'deny', 'always')
    expect(await p).toMatchObject({ behavior: 'deny' })
    s.close()
  })

  it('passes updatedInput through', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'x' })
    s.replyPermission(requestId(events), 'allow', 'once', { command: 'y' })
    expect(await p).toMatchObject({ behavior: 'allow', updatedInput: { command: 'y' } })
    s.close()
  })
})

describe('interrupt', () => {
  it('is a no-op when idle', async () => {
    const { fake, s, events } = await setup()
    fake.push({ ...errorResult, subtype: 'success', result: 'ok', is_error: false })
    await tick()
    expect(events.some((e) => e.t === 'result')).toBe(true)
    await s.interrupt()
    expect(fake.interruptCalls).toBe(0)
    s.close()
  })

  it('denies pending permissions with interrupt:true; interrupted result ends idle, not error', async () => {
    const { fake, s, events } = await setup()
    const p = fake.callTool('Bash', { command: 'x' }, sugg)
    await s.interrupt()
    expect(await p).toMatchObject({ behavior: 'deny', interrupt: true })
    expect(fake.interruptCalls).toBe(1)
    fake.push(errorResult)
    await tick()
    const statuses = events.flatMap((e) => (e.t === 'status' ? [e.state] : []))
    expect(statuses).not.toContain('error')
    expect(statuses[statuses.length - 1]).toBe('idle')
    s.close()
  })
})

describe('result contextWindow', () => {
  const result = {
    type: 'result',
    subtype: 'success',
    result: 'ok',
    total_cost_usd: 1,
    duration_ms: 1,
    num_turns: 1,
    is_error: false,
    usage: {},
    modelUsage: { 'model-a': { contextWindow: 200000 }, 'model-b': { contextWindow: 1000000 } }
  }
  it('uses the init model entry', () => {
    const state: { msgId: string; model?: string } = { msgId: '' }
    mapMessage(
      msg({
        type: 'system',
        subtype: 'init',
        session_id: 's',
        model: 'model-a',
        tools: [],
        mcp_servers: [],
        slash_commands: [],
        cwd: 'c',
        permissionMode: 'default'
      }),
      state
    )
    expect(mapMessage(msg(result), state)[0]).toMatchObject({ contextWindow: 200000 })
  })
  it('falls back to the max entry, or omits when absent', () => {
    expect(mapMessage(msg(result), { msgId: '' })[0]).toMatchObject({ contextWindow: 1000000 })
    expect(mapMessage(msg({ ...result, modelUsage: {} }), { msgId: '' })[0]).not.toHaveProperty('contextWindow')
  })
})
