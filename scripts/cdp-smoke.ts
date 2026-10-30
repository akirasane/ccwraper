// CDP smoke test of the built app: visits every view, opens the terminal, saves screenshots.
// Run: npm run build && npm run smoke
// Env (all optional):
//   CCWRAP_SMOKE_SHOTS   screenshot dir            (default D:\claude-tmp\p3-shots)
//   CCWRAP_SMOKE_CWD     project to select         (default D:\claude-tmp\p3-live)
//   CCWRAP_SMOKE_PORT    debugging port            (default 9333)
//   CCWRAP_SMOKE_DATA    --user-data-dir           (default D:\claude-tmp\p3-smoke-ud)
//   CLAUDE_CONFIG_DIR    point the app at a sandboxed Claude config (recommended; do NOT redirect USERPROFILE/HOME)
//   CCWRAP_SMOKE_LIVE=1  also run one cheap haiku subagent turn and check the live activity UI (opt-in: needs a
//                        login, costs about $0.02, and the CLI loads the user's own hooks and plugins)
// Without CCWRAP_SMOKE_LIVE the script never sends a chat message and never clicks save/add/remove/create,
// so it is safe on a real config too.
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Cdp, launchApp, sleep, waitFor } from './cdp-client'

const shots = process.env['CCWRAP_SMOKE_SHOTS'] ?? 'D:\\claude-tmp\\p3-shots'
const cwd = process.env['CCWRAP_SMOKE_CWD'] ?? 'D:\\claude-tmp\\p3-live'
const port = Number(process.env['CCWRAP_SMOKE_PORT'] ?? 9333)
const userData = process.env['CCWRAP_SMOKE_DATA'] ?? 'D:\\claude-tmp\\p3-smoke-ud'

async function main(): Promise<void> {
  mkdirSync(shots, { recursive: true })
  mkdirSync(cwd, { recursive: true })
  const app = launchApp({ port, userDataDir: userData })
  let failed = 0
  const step = async (name: string, fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
      console.log(`ok    ${name}`)
    } catch (e) {
      failed++
      console.log(`FAIL  ${name}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
  try {
    const cdp = await Cdp.connect(port)
    await waitFor(cdp, `document.getElementById('root')?.children.length > 0`, 20_000, 'root rendered')
    await cdp.eval(`localStorage.setItem('ccwrap.lastCwd', ${JSON.stringify(cwd)})`)
    await cdp.send('Page.reload')
    await sleep(1500)
    await waitFor(cdp, `document.querySelector('[data-testid=app-shell]')`, 20_000, 'app shell')

    await step('fonts applied', async () => {
      const r = await cdp.eval<{ sans: boolean; mono: boolean; body: string }>(`(async () => {
        await document.fonts.load('13px "Geist Variable"'); await document.fonts.load('13px "Geist Mono Variable"')
        return { sans: document.fonts.check('13px "Geist Variable"'), mono: document.fonts.check('13px "Geist Mono Variable"'), body: getComputedStyle(document.body).fontFamily }
      })()`)
      if (!r.sans || !r.mono || !/Geist/.test(r.body)) throw new Error(JSON.stringify(r))
    })
    await cdp.screenshot(join(shots, 'smoke-chat.png'))

    for (const [label, testId, file] of [
      ['Settings', 'settings-page', 'smoke-settings.png'],
      ['MCP', 'mcp-page', 'smoke-mcp.png'],
      ['Memory', 'memory-page', 'smoke-memory.png'],
      ['Skills', 'skills-page', 'smoke-skills.png'],
      ['Agents', 'agents-page', 'smoke-agents.png'],
      ['Hooks', 'hooks-page', 'smoke-hooks.png']
    ] as const) {
      await step(`view ${label}`, async () => {
        if (!(await cdp.clickSel('nav button, aside button', label))) throw new Error('nav button not found')
        await waitFor(cdp, `document.querySelector('[data-testid=${testId}]')`, 15_000, testId)
        await sleep(800)
        await cdp.screenshot(join(shots, file))
      })
    }

    await step('Commands tab of Skills', async () => {
      if (!(await cdp.clickSel('nav button', 'Skills'))) throw new Error('nav button not found')
      await waitFor(cdp, `document.querySelector('[data-testid=skills-page]')`, 15_000, 'skills-page')
      if (!(await cdp.clickSel('[role=tablist] [role=tab]', 'Commands'))) throw new Error('Commands tab not found')
      await sleep(800)
      await waitFor(cdp, `document.querySelector('[data-testid=skills-page]')?.innerText.includes('command')`, 10_000, 'commands list or empty state')
      await cdp.screenshot(join(shots, 'smoke-commands.png'))
    })

    await step('Hooks scopes and Effective view (read only)', async () => {
      if (!(await cdp.clickSel('nav button', 'Hooks'))) throw new Error('nav button not found')
      await waitFor(cdp, `document.querySelector('[data-testid=hooks-page]')`, 15_000, 'hooks-page')
      await waitFor(cdp, `document.querySelector('[data-testid=hooks-safety-banner]')`, 10_000, 'safety banner')
      for (const scope of ['Project', 'Local', 'Effective']) {
        if (!(await cdp.clickSel('[data-testid=hooks-page] button', scope))) throw new Error(`${scope} tab not found`)
        await sleep(400)
      }
      await waitFor(cdp, `document.querySelector('[data-testid=hooks-effective]')`, 10_000, 'effective view')
      await cdp.screenshot(join(shots, 'smoke-hooks-effective.png'))
    })

    await step('editor chunk loads lazily (Settings Raw JSON)', async () => {
      if (!(await cdp.clickSel('nav button, aside button', 'Settings'))) throw new Error('nav button not found')
      await waitFor(cdp, `document.querySelector('[data-testid=settings-page]')`, 15_000, 'settings-page')
      if (!(await cdp.clickSel('[role=tab]', 'Raw JSON'))) throw new Error('Raw JSON tab not found')
      await waitFor(cdp, `document.querySelector('.cm-editor')`, 15_000, 'codemirror')
    })
    await cdp.clickSel('nav button', 'Sessions')

    if (process.env['CCWRAP_SMOKE_LIVE'] === '1') {
      await step('LIVE: haiku subagent turn shows working row, subagent card and exact tokens', async () => {
        await cdp.clickSel('button', 'New session')
        await sleep(600)
        await cdp.clickSel('button[aria-label^="Model:"]')
        await sleep(400)
        if (!(await cdp.clickSel('[role=menu] *, [role=menuitem] *', 'Haiku 5.5')) && !(await cdp.clickSel('[role=menu] *, [role=menuitem] *', 'Haiku'))) throw new Error('Haiku not in the model menu')
        await cdp.clickSel('textarea[aria-label=Message]')
        await cdp.insertText('Use the Agent tool once (general-purpose) to count the files in the current directory with Glob, then reply with just the number.')
        await cdp.key('Enter', { code: 'Enter', vk: 13 })
        await waitFor(cdp, `document.querySelector('[data-testid=working-indicator]')`, 30_000, 'working row')
        await waitFor(cdp, `document.querySelector('[data-testid=subagent-card]')`, 60_000, 'subagent card')
        await cdp.screenshot(join(shots, 'smoke-live-running.png'))
        await waitFor(cdp, `document.querySelector('[data-testid=status-state]')?.innerText === 'Idle' && !document.querySelector('[data-testid=working-indicator]')`, 120_000, 'turn finished')
        const r = await cdp.eval<{ card: string; turn: string | null; ctx: string | null }>(`({
          card: document.querySelector('[data-testid=subagent-card]').innerText,
          turn: document.querySelector('[data-testid=status-turn]')?.innerText ?? null,
          ctx: document.querySelector('[data-testid=status-ctx]')?.innerText ?? null })`)
        if (!/Done/.test(r.card)) throw new Error('subagent card not Done: ' + r.card)
        if (r.turn && r.turn.includes('~')) throw new Error('estimate marker left after the turn: ' + r.turn)
        await cdp.screenshot(join(shots, 'smoke-live-done.png'))
      })
    }

    await step('terminal toggle (Ctrl+Backquote)', async () => {
      await cdp.key('`', { code: 'Backquote', ctrl: true, vk: 192 })
      await waitFor(cdp, `document.querySelector('[data-testid=terminal-panel]')`, 15_000, 'terminal panel')
      await sleep(2500)
      await cdp.screenshot(join(shots, 'smoke-terminal.png'))
      await cdp.key('`', { code: 'Backquote', ctrl: true, vk: 192 })
    })
    cdp.close()
  } finally {
    app.stop()
  }
  if (failed > 0) {
    console.log(`${failed} step(s) failed`)
    process.exitCode = 1
  } else console.log('smoke passed; screenshots in ' + shots)
}

void main()
