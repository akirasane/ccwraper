// Headless verification of sdk-adapter. Run: npm run spike
// Usage: tsx scripts/spike.ts [cwd]   (default cwd: D:\claude-tmp\spike-cwd)
import { startSdkSession, type AdapterSession } from '../src/main/services/sdk-adapter'
import { resolveClaudeExecutable } from '../src/main/paths'
import type { SessionEvent } from '../src/shared/events'

const cwd = process.argv[2] ?? 'D:\\claude-tmp\\spike-cwd'

function summarize(e: SessionEvent): string {
  switch (e.t) {
    case 'init':
      return `init session=${e.sessionId} model=${e.model} tools=${e.tools.length} slash=${e.slashCommands.length} mcp=${JSON.stringify(e.mcp)} cwd=${e.cwd} mode=${e.permissionMode}`
    case 'text_delta':
    case 'thinking_delta':
      return `${e.t} ${JSON.stringify(e.text)}`
    case 'result':
      return `result cost=$${e.costUsd} dur=${e.durationMs}ms turns=${e.turns} err=${e.isError} usage=${JSON.stringify(e.usage)} text=${JSON.stringify(e.resultText)}`
    default:
      return JSON.stringify(e).slice(0, 300)
  }
}

interface Run {
  events: SessionEvent[]
  session: AdapterSession
  waitFor: (pred: (e: SessionEvent) => boolean, ms?: number) => Promise<SessionEvent>
}

async function start(
  label: string,
  prompt: string,
  extra: { resumeId?: string; settingSources?: Array<'user' | 'project' | 'local'>; thinking?: boolean } = {}
): Promise<Run> {
  const events: SessionEvent[] = []
  const waiters: Array<{ pred: (e: SessionEvent) => boolean; res: (e: SessionEvent) => void }> = []
  const session = await startSdkSession({
    cwd,
    prompt,
    permissionMode: 'default',
    ...extra,
    onEvent: (e) => {
      events.push(e)
      console.log(`[${label}] ${summarize(e)}`)
      for (let i = waiters.length - 1; i >= 0; i--) {
        const w = waiters[i]!
        if (w.pred(e)) {
          waiters.splice(i, 1)
          w.res(e)
        }
      }
    }
  })
  const waitFor: Run['waitFor'] = (pred, ms = 90_000) =>
    new Promise((res, rej) => {
      const existing = events.find(pred)
      if (existing) return res(existing)
      const t = setTimeout(() => rej(new Error(`timeout waiting in ${label}`)), ms)
      waiters.push({
        pred,
        res: (e) => {
          clearTimeout(t)
          res(e)
        }
      })
    })
  return { events, session, waitFor }
}

async function main(): Promise<void> {
  console.log('claude binary resolved to:', resolveClaudeExecutable() ?? '(SDK bundled)')
  console.log('cwd:', cwd)

  if (!process.env['SPIKE_SKIP_123']) {
  // 1. Basic prompt: init, streaming deltas, result.
  console.log('\n=== TEST 1: basic prompt ===')
  const a = await start('A', 'Say hi in 3 words. Do not use any tools.')
  await a.waitFor((e) => e.t === 'result')
  const init = a.events.find((e) => e.t === 'init')
  const deltas = a.events.filter((e) => e.t === 'text_delta').length
  console.log(`checks: init=${!!init} textDeltas=${deltas} result=${a.events.some((e) => e.t === 'result')}`)
  const sessionId = init && init.t === 'init' ? init.sessionId : undefined

  // 2. Follow-up in same live session (streaming input).
  console.log('\n=== TEST 2: follow-up send() on same session ===')
  const before = a.events.length
  a.session.send('Now say bye in 2 words. No tools.')
  await a.waitFor((e) => e.t === 'result' && a.events.indexOf(e) >= before)
  a.session.close()
  await a.session.done

  // 3. Resume from a fresh process-level query using the session id.
  console.log('\n=== TEST 3: resume ===')
  if (!sessionId) throw new Error('no session id')
  const b = await start('B', 'What two things did I ask you to say earlier? Answer in one short line, no tools.', {
    resumeId: sessionId
  })
  await b.waitFor((e) => e.t === 'result')
  const bInit = b.events.find((e) => e.t === 'init')
  console.log(`resume init sessionId=${bInit && bInit.t === 'init' ? bInit.sessionId : '?'} (original ${sessionId})`)
  b.session.close()
  await b.session.done

  }

  // 4. Interrupt mid-stream + permission flow (Bash tool should trigger canUseTool in default mode).
  console.log('\n=== TEST 4: permission + interrupt ===')
  // settingSources: [] => no user allow-rules/plugins, so Bash must go through canUseTool (and it is cheaper).
  const c = await start('C', 'Use the Write tool to create a file named hello.txt in the current directory containing exactly: ccwrap-spike. Then reply done.', {
    settingSources: [],
    thinking: true
  })
  const perm = await c.waitFor((e) => e.t === 'permission_request')
  if (perm.t === 'permission_request') {
    console.log('got permission_request for', perm.toolName, '-> allowing')
    c.session.replyPermission(perm.reqId, 'allow')
  }
  await c.waitFor((e) => e.t === 'result')
  console.log(
    `checks: tool_use=${c.events.some((e) => e.t === 'tool_use')} tool_result=${c.events.some((e) => e.t === 'tool_result')} thinking_delta=${c.events.some((e) => e.t === 'thinking_delta')}`
  )

  console.log('\n=== TEST 5: interrupt ===')
  const mark = c.events.length
  c.session.send('Count slowly from 1 to 200, one number per line, no tools.')
  await c.waitFor((e) => e.t === 'text_delta' && c.events.indexOf(e) >= mark)
  await c.session.interrupt()
  const res = await c.waitFor((e) => e.t === 'result' && c.events.indexOf(e) >= mark, 30_000).catch((err) => err)
  console.log('after interrupt, result event:', res instanceof Error ? res.message : summarize(res as SessionEvent))
  c.session.close()
  await c.session.done
  console.log('\nSPIKE DONE')
}

main().then(
  () => process.exit(0),
  (err) => {
    console.error('SPIKE FAILED', err)
    process.exit(1)
  }
)
