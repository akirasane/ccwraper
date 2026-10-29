import { describe, expect, it } from 'vitest'
import messages from '../../../tests/fixtures/history/messages.json'
import { mapHistoryMessage, mapHistoryMessages, userPromptText, type RawSessionMessage } from './sdk-history'

const msgs = messages as RawSessionMessage[]

describe('userPromptText', () => {
  it('keeps real prompts and strips system reminders', () => {
    expect(userPromptText('hello')).toBe('hello')
    expect(userPromptText('<system-reminder>x</system-reminder>\nhi')).toBe('hi')
  })
  it('drops meta wrappers', () => {
    expect(userPromptText('<system-reminder>x</system-reminder>')).toBeUndefined()
    expect(userPromptText('<local-command-stdout>out</local-command-stdout>')).toBeUndefined()
    expect(userPromptText('<local-command-caveat>c</local-command-caveat>')).toBeUndefined()
    expect(userPromptText('[Request interrupted by user]')).toBeUndefined()
  })
  it('compacts command wrappers', () => {
    expect(userPromptText('<command-name>/model</command-name><command-args>opus</command-args>')).toBe('/model opus')
  })
})

describe('mapHistoryMessages', () => {
  const events = mapHistoryMessages(msgs)

  it('only real prompts become user_message (meta, subagent and interrupt turns do not)', () => {
    const users = events.filter((e) => e.t === 'user_message').map((e) => (e.t === 'user_message' ? e.text : ''))
    expect(users).toEqual(['/model sonnet', 'Fix the bug in a.ts', 'Thanks'])
  })

  it('keeps order and coalesces split assistant entries into one message', () => {
    expect(events.map((e) => e.t)).toEqual([
      'user_message',
      'user_message',
      'assistant_message',
      'tool_use',
      'tool_result',
      'assistant_message',
      'tool_use',
      'tool_result',
      'user_message'
    ])
    expect(events.find((e) => e.t === 'assistant_message')).toMatchObject({
      msgId: 'msg_1',
      blocks: [
        { type: 'thinking', text: 'plan it' },
        { type: 'text', text: 'Let me edit.' },
        { type: 'tool_use', toolUseId: 'toolu_edit', name: 'Edit' }
      ]
    })
  })

  it('pairs tool_use with tool_result by id and keeps Edit old/new strings', () => {
    const use = events.find((e) => e.t === 'tool_use' && e.toolUseId === 'toolu_edit')
    expect(use).toMatchObject({ input: { old_string: 'const a = 1', new_string: 'const a = 2' } })
    expect(events.find((e) => e.t === 'tool_result' && e.toolUseId === 'toolu_edit')).toMatchObject({
      content: 'File edited',
      isError: false
    })
    expect(events.find((e) => e.t === 'tool_result' && e.toolUseId === 'toolu_bash')).toMatchObject({
      content: 'boom',
      isError: true
    })
  })

  it('ignores unknown blocks, system entries and malformed messages without throwing', () => {
    expect(JSON.stringify(events)).not.toContain('mystery_block')
    const bad = { type: 'assistant', uuid: 'x', session_id: 's', parent_tool_use_id: null, message: 'garbage' }
    expect(mapHistoryMessage(bad as RawSessionMessage)).toEqual([])
    expect(mapHistoryMessage({ ...bad, type: 'system' } as RawSessionMessage)).toEqual([])
    expect(mapHistoryMessage({ ...bad, type: 'user', message: null } as RawSessionMessage)).toEqual([])
  })
})
