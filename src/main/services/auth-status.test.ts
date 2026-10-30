import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CliOptions, CliResult, CliRunner } from './claude-cli'
import { AuthStatusService, mapAuthStatus } from './auth-status'

const fx = (n: string): string => readFileSync(join(__dirname, '../../../tests/fixtures/auth', n), 'utf8')

function runner(res: CliResult | (() => Promise<CliResult>)): { run: CliRunner; calls: { args: string[]; opts: CliOptions }[] } {
  const calls: { args: string[]; opts: CliOptions }[] = []
  return {
    calls,
    run: async (args, opts) => {
      calls.push({ args, opts })
      return typeof res === 'function' ? res() : res
    }
  }
}

describe('mapAuthStatus', () => {
  it('maps the signed-in fixture and drops account details', () => {
    const m = mapAuthStatus(fx('signed-in-subscription.json'))
    expect(m).toEqual({ state: 'signed_in', method: 'subscription' })
    expect(JSON.stringify(m)).not.toContain('SENTINEL')
  })
  it('maps the signed-out fixture', () => {
    expect(mapAuthStatus(fx('signed-out.json'))).toEqual({ state: 'signed_out' })
  })
  it('api key and other methods', () => {
    expect(mapAuthStatus('{"loggedIn":true,"authMethod":"api_key"}')).toEqual({ state: 'signed_in', method: 'api_key' })
    expect(mapAuthStatus('{"loggedIn":"true","authMethod":"sso"}')).toEqual({ state: 'signed_in', method: 'other' })
    expect(mapAuthStatus('{"authMethod":"api_key"}')).toEqual({ state: 'signed_in', method: 'api_key' })
  })
  it('unknown shapes and garbage give unknown', () => {
    expect(mapAuthStatus('nope').state).toBe('unknown')
    expect(mapAuthStatus('[1]').state).toBe('unknown')
    expect(mapAuthStatus('{"x":1}').state).toBe('unknown')
  })
})

describe('AuthStatusService', () => {
  it('runs auth status --json with a 10 s timeout and a sandbox env', async () => {
    const r = runner({ code: 1, stdout: fx('signed-out.json'), stderr: '' })
    const env = { CLAUDE_CONFIG_DIR: 'D:\\claude-tmp\\p4-auth-sandbox' }
    const s = await new AuthStatusService(r.run, { env, cwd: 'C:\\x' }).get()
    expect(s.state).toBe('signed_out')
    expect(r.calls[0]!.args).toEqual(['auth', 'status', '--json'])
    expect(r.calls[0]!.opts.timeoutMs).toBe(10_000)
    expect(r.calls[0]!.opts.env).toBe(env)
  })

  it('result has no keys beyond the contract', async () => {
    const r = runner({ code: 0, stdout: fx('signed-in-subscription.json'), stderr: '' })
    const s = await new AuthStatusService(r.run).get()
    const allowed = new Set(['state', 'method', 'checkedAt', 'reason'])
    expect(Object.keys(s).every((k) => allowed.has(k))).toBe(true)
    expect(JSON.stringify(s)).not.toMatch(/SENTINEL|email|org/i)
  })

  it('caches for 60 s and refresh bypasses', async () => {
    let t = 1000
    const r = runner({ code: 0, stdout: '{"loggedIn":true}', stderr: '' })
    const svc = new AuthStatusService(r.run, { now: () => t })
    await svc.get()
    t += 59_000
    await svc.get()
    expect(r.calls).toHaveLength(1)
    await svc.get(true)
    expect(r.calls).toHaveLength(2)
    t += 61_000
    await svc.get()
    expect(r.calls).toHaveLength(3)
  })

  it('dedupes concurrent calls', async () => {
    const r = runner(async () => ({ code: 0, stdout: '{"loggedIn":true}', stderr: '' }))
    const svc = new AuthStatusService(r.run)
    await Promise.all([svc.get(), svc.get(true)])
    expect(r.calls).toHaveLength(1)
  })

  it('missing binary, timeout and thrown runner give unknown', async () => {
    const a = await new AuthStatusService(runner({ code: -1, stdout: '', stderr: 'claude binary not found' }).run).get()
    expect(a.state).toBe('unknown')
    expect(a.reason).toBeTruthy()
    const b = await new AuthStatusService(async () => {
      throw new Error('boom SENTINEL')
    }).get()
    expect(b).toMatchObject({ state: 'unknown', reason: 'check failed' })
    const c = await new AuthStatusService(runner({ code: 0, stdout: 'not json', stderr: '' }).run).get()
    expect(c.state).toBe('unknown')
  })
})
