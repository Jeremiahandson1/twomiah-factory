/**
 * Sign-in, which may stop and ask for a code — the two network steps, with no React in them, so a test
 * can run them under plain bun against a fake fetch (tests/mobile/sign-in-mfa.test.ts).
 *
 * Every CRM the app signs in to (the shared auth in packages/tenant-backend, and the forked sign-ins of
 * crm-roof and crm-homecare) answers POST /api/auth/login in one of two ways:
 *   · a session — accessToken + refreshToken at the top level, beside the user (and company);
 *   · `{ mfaRequired: true, challengeId, expiresAt, methods, recoveryCodesAvailable, message }` with NO
 *     tokens, when the account has a verified authenticator.
 * The second is finished by POST /api/auth/mfa `{ challengeId, code }`: 200 is the same body a normal
 * sign-in returns; 401 `{ code: 'bad_code' }` is a wrong code — stay on the code step; 400 is a request
 * that can no longer be completed (expired, spent, unknown, too many tries) — back to the password.
 *
 * Before this the app passed the challenge reply straight to saveTokens(undefined, undefined), so a
 * person with two-factor switched on could not sign in on the phone at all.
 *
 * The completed sign-in is stored by exactly the path a password-only sign-in uses: saveTokens() in
 * api/client.ts, which writes SecureStore.
 */
import { postSignIn, saveApiUrl, saveTokens } from '../api/client'

export interface MfaChallenge {
  challengeId: string
  expiresAt: string | null
  methods: string[]
  recoveryCodesAvailable: boolean
  message: string
}

export type PasswordStep =
  | { kind: 'signedIn'; data: any }
  | { kind: 'mfa'; challenge: MfaChallenge }
  | { kind: 'error'; error: string }

export type CodeStep =
  | { kind: 'signedIn'; data: any; usedRecoveryCode: boolean }
  /** A wrong code: show it under the code field and let them try again. */
  | { kind: 'badCode'; error: string }
  /** The challenge can no longer be completed: back to the password step. */
  | { kind: 'restart'; error: string }
  /** No answer (signal, a server error): stay on the code step; the challenge may still be good. */
  | { kind: 'error'; error: string }

const NO_CONNECTION = 'No connection — check your signal and the server address.'
const unreachable = () => ({ ok: false, status: 0, data: null, error: NO_CONNECTION } as const)

const hasTokens = (d: any) => typeof d?.accessToken === 'string' && d.accessToken !== ''
  && typeof d?.refreshToken === 'string' && d.refreshToken !== ''

/** Step one: the password. Saves the server address first, as sign-in always has. */
export async function signInWithPassword(serverUrl: string, email: string, password: string): Promise<PasswordStep> {
  await saveApiUrl(serverUrl)
  const res = await postSignIn('/api/auth/login', { email, password }).catch(unreachable)
  if (!res.ok) return { kind: 'error', error: res.error || 'Login failed' }
  const d = res.data
  if (d?.mfaRequired === true) {
    if (typeof d.challengeId !== 'string' || !d.challengeId) {
      return { kind: 'error', error: 'The server asked for a code but sent no sign-in request. Try again.' }
    }
    // No tokens in this reply, and none are stored — the sign-in is not finished.
    return {
      kind: 'mfa',
      challenge: {
        challengeId: d.challengeId,
        expiresAt: typeof d.expiresAt === 'string' ? d.expiresAt : null,
        methods: Array.isArray(d.methods) ? d.methods.map(String) : ['totp'],
        recoveryCodesAvailable: d.recoveryCodesAvailable === true,
        message: typeof d.message === 'string' && d.message ? d.message : 'Enter the code from your authenticator app to finish signing in.',
      },
    }
  }
  if (!hasTokens(d)) return { kind: 'error', error: 'The server did not send a session. Try again.' }
  await saveTokens(d.accessToken, d.refreshToken)
  return { kind: 'signedIn', data: d }
}

/**
 * Step two: the code — six digits from an authenticator, or a recovery code (letters and a dash).
 * Spaces are taken out (an authenticator shows "123 456"); the server upper-cases and trims as well.
 */
export async function completeMfaSignIn(challengeId: string, code: string): Promise<CodeStep> {
  const given = code.replace(/\s+/g, '')
  // An empty code is a 400 (`code_required`) on the server, which would read as "start again" — it is
  // not; nothing was sent.
  if (!given) return { kind: 'badCode', error: 'Enter the code from your authenticator app.' }
  const res = await postSignIn('/api/auth/mfa', { challengeId, code: given }).catch(unreachable)
  if (res.ok) {
    const d = res.data
    if (!hasTokens(d)) return { kind: 'error', error: 'The server did not send a session. Try again.' }
    await saveTokens(d.accessToken, d.refreshToken)
    return { kind: 'signedIn', data: d, usedRecoveryCode: d?.usedRecoveryCode === true }
  }
  if (res.status === 401 && res.data?.code === 'bad_code') return { kind: 'badCode', error: res.error || 'That code was not right. Try again.' }
  // 400: expired / spent / unknown / too many tries. A 401 that is NOT bad_code is the account itself
  // ("Account is disabled" between the password and the code) — another code cannot fix either.
  if (res.status === 400 || res.status === 401) return { kind: 'restart', error: res.error || 'That sign-in request is no longer valid. Sign in again.' }
  return { kind: 'error', error: res.error || 'Could not check the code. Try again.' }
}
