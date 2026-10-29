import { describe, expect, it } from 'vitest'
import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk'
import { mapMessage } from './sdk-adapter'
import { normalizeCwdKey } from '../paths'

// Hand-written minimal messages; cast because the SDK types carry many unrelated required fields.
const msg = (m: unknown): SDKMessage => m as SDKMessage

describe('mapMessage', () => {
  it('maps init', () => {
    const state = { msgId: '' }
    const ev = mapMessage(
      msg({
        type: 'system',
        subtype: 'init',
        session_id: 's1',
        model: 'm',
        tools: ['Bash'],
        mcp_servers: [{ name: 'x', status: 'connected' }],
        slash_commands: ['help'],
        cwd: 'C:\\fixture\\proj',
        permissionMode: 'default'
      }),
      state
    )
    expect(ev).toEqual([
      {
        t: 'init',
        sessionId: 's1',
        model: 'm',
        tools: ['Bash'],
        mcp: [{ name: 'x', status: 'connected' }],
        slashCommands: ['help'],
        cwd: 'C:\\fixture\\proj',
        permissionMode: 'default'
      }
    ])
  })

  it('tracks msgId and maps text/thinking deltas', () => {
    const state = { msgId: '' }
    mapMessage(msg({ type: 'stream_event', event: { type: 'message_start', message: { id: 'msg_1' } } }), state)
    const t = mapMessage(
      msg({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text: 'hi' } } }),
      state
    )
    const k = mapMessage(
      msg({
        type: 'stream_event',
        event: { type: 'content_block_delta', delta: { type: 'thinking_delta', thinking: 'hmm' } }
      }),
      state
    )
    expect(t).toEqual([{ t: 'text_delta', msgId: 'msg_1', text: 'hi' }])
    expect(k).toEqual([{ t: 'thinking_delta', msgId: 'msg_1', text: 'hmm' }])
  })

  it('maps assistant blocks and emits tool_use', () => {
    const ev = mapMessage(
      msg({
        type: 'assistant',
        parent_tool_use_id: null,
        message: {
          id: 'msg_2',
          content: [
            { type: 'thinking', thinking: 'plan' },
            { type: 'text', text: 'ok' },
            { type: 'tool_use', id: 'tu1', name: 'Bash', input: { command: 'ls' } }
          ]
        }
      }),
      { msgId: '' }
    )
    expect(ev.map((e) => e.t)).toEqual(['assistant_message', 'tool_use'])
    expect(ev[1]).toEqual({ t: 'tool_use', toolUseId: 'tu1', name: 'Bash', input: { command: 'ls' } })
  })

  it('maps user tool_result', () => {
    const ev = mapMessage(
      msg({
        type: 'user',
        message: { content: [{ type: 'tool_result', tool_use_id: 'tu1', content: 'out', is_error: true }] }
      }),
      { msgId: '' }
    )
    expect(ev).toEqual([{ t: 'tool_result', toolUseId: 'tu1', content: 'out', isError: true }])
  })

  it('tool_result image blocks become a placeholder, never base64 text', () => {
    const ev = mapMessage(
      msg({
        type: 'user',
        message: {
          content: [
            {
              type: 'tool_result',
              tool_use_id: 'tu2',
              content: [
                { type: 'text', text: 'shot taken' },
                { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'AAAA'.repeat(50) } }
              ]
            }
          ]
        }
      }),
      { msgId: '' }
    )
    expect(ev).toEqual([{ t: 'tool_result', toolUseId: 'tu2', content: 'shot taken\n[image: image/jpeg]', isError: false }])
  })

  it('maps result to result + idle status', () => {
    const ev = mapMessage(
      msg({
        type: 'result',
        subtype: 'success',
        result: 'done',
        total_cost_usd: 0.12,
        duration_ms: 50,
        num_turns: 1,
        is_error: false,
        usage: { input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }
      }),
      { msgId: '' }
    )
    expect(ev[0]).toMatchObject({ t: 'result', costUsd: 0.12, isError: false, resultText: 'done' })
    expect(ev[1]).toEqual({ t: 'status', state: 'idle' })
  })
})

describe('normalizeCwdKey', () => {
  it('strips trailing separators and is case-insensitive on Windows', () => {
    const a = normalizeCwdKey('D:\\Dev\\Proj\\')
    const b = normalizeCwdKey('D:\\Dev\\Proj')
    expect(a).toBe(b)
    if (process.platform === 'win32') expect(normalizeCwdKey('d:\\dev\\PROJ')).toBe(a)
  })
})
