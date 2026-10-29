import type { CcwrapApi } from '../shared/ipc'
declare global {
  interface Window {
    ccwrap: CcwrapApi
  }
}
export {}
