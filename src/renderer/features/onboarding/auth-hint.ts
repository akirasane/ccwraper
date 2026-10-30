import { requestRunInTerminal } from '@/lib/terminal-bus'

/** Command typed (never executed) into a terminal for the Sign in action. */
export const SIGN_IN_COMMAND = 'claude auth login'

const AUTH_ERROR = /not logged in|\blog ?in\b|authenticat|invalid api key|\b401\b/i

/** True when a session error message looks like a missing or invalid sign-in (D12). */
export function isAuthError(message: string | undefined): boolean {
  return !!message && AUTH_ERROR.test(message)
}

/** Opens the terminal with `claude auth login` typed but NOT executed (no Enter). */
export function typeSignInCommand(cwd: string): void {
  requestRunInTerminal({ cwd, command: SIGN_IN_COMMAND })
}
