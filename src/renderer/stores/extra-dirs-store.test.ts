import { beforeEach, describe, expect, it } from 'vitest'
import { MAX_EXTRA_DIRS } from '@shared/ipc'
import { dirKey, useExtraDirs } from './extra-dirs-store'

beforeEach(() => {
  window.localStorage.clear()
  useExtraDirs.setState({ byCwd: {} })
})

describe('extra dirs store', () => {
  it('adds, lists per project (slash and case insensitive) and persists', () => {
    expect(useExtraDirs.getState().add('C:\\proj', 'D:\\shared\\lib')).toEqual({ ok: true })
    expect(useExtraDirs.getState().dirsFor('c:/PROJ/')).toEqual(['D:\\shared\\lib'])
    expect(useExtraDirs.getState().dirsFor('C:\\other')).toEqual([])
    const stored = JSON.parse(window.localStorage.getItem('ccwrap.extraDirs.v1')!)
    expect(stored[dirKey('C:\\proj')]).toEqual(['D:\\shared\\lib'])
  })

  it('rejects the project folder itself, duplicates and too many folders', () => {
    const s = useExtraDirs.getState()
    expect(s.add('C:\\proj', 'c:/proj/')).toMatchObject({ ok: false })
    expect(s.add('C:\\proj', 'D:\\a')).toEqual({ ok: true })
    expect(useExtraDirs.getState().add('C:\\proj', 'd:/A/')).toMatchObject({ ok: false, reason: expect.stringMatching(/already added/) })
    for (let i = 1; i < MAX_EXTRA_DIRS; i++) useExtraDirs.getState().add('C:\\proj', `D:\\d${i}`)
    expect(useExtraDirs.getState().add('C:\\proj', 'D:\\one-too-many')).toMatchObject({ ok: false })
  })

  it('removes a folder and drops the project entry when empty', () => {
    useExtraDirs.getState().add('C:\\proj', 'D:\\a')
    useExtraDirs.getState().remove('C:\\proj', 'd:/a')
    expect(useExtraDirs.getState().dirsFor('C:\\proj')).toEqual([])
    expect(JSON.parse(window.localStorage.getItem('ccwrap.extraDirs.v1')!)).toEqual({})
  })
})
