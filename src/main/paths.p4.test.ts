import { afterEach, describe, expect, it } from 'vitest'
import {
  isInsideAsar,
  pickClaudeExecutable,
  prefsPath,
  resetClaudeBinaryCache,
  resolveClaudeExecutable,
  sdkSearchStarts,
  toUnpackedPath,
  transcriptsRoot,
  usageCachePath,
  usageLedgerPath,
  windowStatePath
} from './paths'

const WIN_ASAR = 'C:\\Users\\u\\AppData\\Local\\Programs\\ccwraper\\resources\\app.asar\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe'
const WIN_UNPACKED = 'C:\\Users\\u\\AppData\\Local\\Programs\\ccwraper\\resources\\app.asar.unpacked\\node_modules\\@anthropic-ai\\claude-agent-sdk-win32-x64\\claude.exe'

describe('asar helpers', () => {
  it('detects paths inside app.asar (either separator)', () => {
    expect(isInsideAsar(WIN_ASAR)).toBe(true)
    expect(isInsideAsar('/opt/x/resources/app.asar/out/main')).toBe(true)
    expect(isInsideAsar('C:\\x\\resources\\app.asar')).toBe(true)
  })
  it('does not treat unpacked or unrelated paths as inside the archive', () => {
    expect(isInsideAsar(WIN_UNPACKED)).toBe(false)
    expect(isInsideAsar('D:\\proj\\node_modules\\x\\claude.exe')).toBe(false)
    expect(isInsideAsar('D:\\my.app.asar.old\\x')).toBe(false)
  })
  it('maps app.asar to app.asar.unpacked and is idempotent', () => {
    expect(toUnpackedPath(WIN_ASAR)).toBe(WIN_UNPACKED)
    expect(toUnpackedPath(WIN_UNPACKED)).toBe(WIN_UNPACKED)
    expect(toUnpackedPath('/r/app.asar/node_modules/p/claude')).toBe('/r/app.asar.unpacked/node_modules/p/claude')
    expect(toUnpackedPath('D:\\proj\\node_modules\\x')).toBe('D:\\proj\\node_modules\\x')
  })
})

describe('sdkSearchStarts', () => {
  it('searches cwd then the module dir outside an asar', () => {
    expect(sdkSearchStarts('D:\\repo', 'D:\\repo\\out\\main')).toEqual(['D:\\repo', 'D:\\repo\\out\\main'])
  })
  it('never starts at cwd inside an asar', () => {
    const dir = 'C:\\r\\resources\\app.asar\\out\\main'
    expect(sdkSearchStarts('D:\\foreign', dir)).toEqual([dir])
  })
})

describe('pickClaudeExecutable', () => {
  it('prefers the chosen user/env binary', () => {
    expect(pickClaudeExecutable({ path: 'C:\\u\\claude.exe', source: 'user' }, WIN_ASAR)).toBe('C:\\u\\claude.exe')
  })
  it('maps the bundled asar path to the unpacked one', () => {
    expect(pickClaudeExecutable({ source: 'bundled' }, WIN_ASAR)).toBe(WIN_UNPACKED)
  })
  it('returns a plain dev path unchanged and undefined when nothing is installed', () => {
    expect(pickClaudeExecutable({ source: 'bundled' }, 'D:\\repo\\node_modules\\p\\claude.exe')).toBe('D:\\repo\\node_modules\\p\\claude.exe')
    expect(pickClaudeExecutable({ source: 'bundled' }, undefined)).toBeUndefined()
  })
})

describe('CCWRAP_CLAUDE_SOURCE=bundled', () => {
  const prev = { src: process.env['CCWRAP_CLAUDE_SOURCE'], p: process.env['CCWRAP_CLAUDE_PATH'] }
  afterEach(() => {
    if (prev.src === undefined) delete process.env['CCWRAP_CLAUDE_SOURCE']
    else process.env['CCWRAP_CLAUDE_SOURCE'] = prev.src
    if (prev.p === undefined) delete process.env['CCWRAP_CLAUDE_PATH']
    else process.env['CCWRAP_CLAUDE_PATH'] = prev.p
    resetClaudeBinaryCache()
  })
  it('forces the bundled binary even when CCWRAP_CLAUDE_PATH is set', () => {
    process.env['CCWRAP_CLAUDE_SOURCE'] = 'bundled'
    process.env['CCWRAP_CLAUDE_PATH'] = process.execPath
    resetClaudeBinaryCache()
    const exe = resolveClaudeExecutable()
    expect(exe).toBeDefined()
    expect(exe).not.toBe(process.execPath)
    expect(exe!.toLowerCase()).toContain('claude-agent-sdk-')
  })
})

describe('P4 userData and transcript paths', () => {
  it('names the userData files', () => {
    expect(prefsPath('D:\\ud')).toMatch(/prefs\.json$/)
    expect(windowStatePath('D:\\ud')).toMatch(/window-state\.json$/)
    expect(usageCachePath('D:\\ud')).toMatch(/usage-cache\.json$/)
    expect(usageLedgerPath('D:\\ud')).toMatch(/usage-ledger\.jsonl$/)
  })
  it('transcriptsRoot follows CLAUDE_CONFIG_DIR, else <home>/.claude/projects', () => {
    expect(transcriptsRoot({ CLAUDE_CONFIG_DIR: 'D:\\cfg' }, 'D:\\home').replaceAll('\\', '/')).toMatch(/cfg\/projects$/)
    expect(transcriptsRoot({}, 'D:\\home').replaceAll('\\', '/')).toMatch(/home\/\.claude\/projects$/)
  })
})
