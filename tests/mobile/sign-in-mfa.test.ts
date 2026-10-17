// The mobile app's sign-in, with two-factor — apps/mobile/src/auth/signIn.ts over the REAL
// apps/mobile/src/api/client.ts, under plain bun (no React Native):
//   · expo-secure-store is replaced by an in-memory store (a Bun plugin, before client.ts loads), so
//     "tokens stored" is read from the very store the app writes;
//   · globalThis.fetch is a fake server that answers like the CRMs' POST /api/auth/login and /api/auth/mfa
//     (packages/tenant-backend/src/auth/auth.ts; crm-homecare's and crm-dispensary's forks answer the same
//     way: mfaRequired + challengeId and NO tokens, then 200 / 401 bad_code / 400).
//
//   bun run tests/mobile/sign-in-mfa.test.ts
import { plugin } from 'bun'

const secure = new Map<string, string>()
plugin({
  name: 'fake expo-secure-store',
  setup(build) {
    build.module('expo-secure-store', () => ({
      loader: 'object',
      exports: {
        getItemAsync: async (k: string) => secure.get(k) ?? null,
        setItemAsync: async (k: string, v: string) => {
          // The real SecureStore rejects a non-string — which is what saveTokens(undefined) hit.
          if (typeof v !== 'string') throw new Error(`SecureStore.setItemAsync(${k}) given ${typeof v}`)
          secure.set(k, v)
        },
        deleteItemAsync: async (k: string) => { secure.delete(k) },
      },
    }))
  },
})

const client = await import('../../apps/mobile/src/api/client.ts')
const { signInWithPassword, completeMfaSignIn } = await import('../../apps/mobile/src/auth/signIn.ts')

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

type Answer = { status: number; body: any }
const calls: { url: string; path: string; body: any; auth: string | null }[] = []
let script: (path: string, body: any) => Answer = () => ({ status: 500, body: { error: 'unscripted' } })
globalThis.fetch = (async (input: any, init: any = {}) => {
  const url = String(input)
  const path = new URL(url).pathname
  const body = init.body ? JSON.parse(String(init.body)) : undefined
  const headers = (init.headers || {}) as Record<string, string>
  calls.push({ url, path, body, auth: headers['Authorization'] ?? null })
  const a = script(path, body)
  return new Response(JSON.stringify(a.body), { status: a.status, headers: { 'content-type': 'application/json' } })
}) as any

const ACCESS = 'twomiah_access_token', REFRESH = 'twomiah_refresh_token', URLKEY = 'twomiah_api_url'
const reset = async () => { calls.length = 0; secure.clear(); await client.clearTokens() }
const noTokens = () => !secure.has(ACCESS) && !secure.has(REFRESH) && client.getAccessToken() === null && client.getRefreshToken() === null

const CHALLENGE = {
  mfaRequired: true, challengeId: 'ch_1', expiresAt: '2026-10-17T12:10:00.000Z', methods: ['totp'],
  recoveryCodesAvailable: true, message: 'Enter the code from your authenticator app to finish signing in.',
}
const SESSION = {
  user: { id: 'u1', email: 'tech@acme.test', firstName: 'Tess', lastName: 'Tech', role: 'technician' },
  company: { id: 'co1', name: 'Acme', slug: 'acme', enabledFeatures: [] },
  permissions: ['jobs:read'],
  accessToken: 'AT-2fa', refreshToken: 'RT-2fa',
}
// The shared server's verifyLoginChallenge answers.
const BAD_CODE = { status: 401, body: { error: 'That code was not right. Try again, or use one of your recovery codes. 4 tries left on this request.', code: 'bad_code' } }
const EXPIRED = { status: 400, body: { error: 'That code request has expired. Sign in again.', code: 'challenge_expired' } }

console.log('a password-only account (no two-factor) — unchanged')
{
  await reset()
  script = (p) => p === '/api/auth/login' ? { status: 200, body: { ...SESSION, accessToken: 'AT-pw', refreshToken: 'RT-pw' } } : { status: 404, body: {} }
  const r = await signInWithPassword('https://acme.onrender.com/', 'tech@acme.test', 'pw')
  check('signs in', r.kind === 'signedIn', r)
  check('tokens stored in SecureStore and in memory', secure.get(ACCESS) === 'AT-pw' && secure.get(REFRESH) === 'RT-pw' && client.getAccessToken() === 'AT-pw', [...secure])
  check('server address saved, trailing slash off', secure.get(URLKEY) === 'https://acme.onrender.com' && calls[0]?.url === 'https://acme.onrender.com/api/auth/login', calls[0])
  check('the login body is email + password', calls[0]?.body?.email === 'tech@acme.test' && calls[0]?.body?.password === 'pw')
}

console.log('two-factor: login → mfaRequired → code → tokens')
{
  await reset()
  script = (p, b) => p === '/api/auth/login' ? { status: 200, body: CHALLENGE }
    : p === '/api/auth/mfa' && b.challengeId === 'ch_1' && b.code === '123456' ? { status: 200, body: SESSION }
    : BAD_CODE
  const r1 = await signInWithPassword('https://acme.onrender.com', 'tech@acme.test', 'pw')
  check('the password step returns the challenge', r1.kind === 'mfa' && r1.challenge.challengeId === 'ch_1', r1)
  check('…with the recovery-code hint and the message', r1.kind === 'mfa' && r1.challenge.recoveryCodesAvailable === true && /authenticator/.test(r1.challenge.message) && r1.challenge.methods[0] === 'totp')
  check('NO tokens stored after the password step', noTokens(), [...secure])
  check('nothing else called — no /me, no /mfa yet', calls.length === 1)

  const r2 = await completeMfaSignIn('ch_1', ' 123 456 ')
  check('the code step signs in', r2.kind === 'signedIn' && r2.data?.user?.id === 'u1', r2)
  check('POST /api/auth/mfa with { challengeId, code } — spaces out of the code', calls[1]?.path === '/api/auth/mfa' && calls[1]?.body?.challengeId === 'ch_1' && calls[1]?.body?.code === '123456', calls[1])
  check('tokens stored in SecureStore — the same keys a password sign-in uses', secure.get(ACCESS) === 'AT-2fa' && secure.get(REFRESH) === 'RT-2fa', [...secure])
  check('…and in memory, so the next request carries them', client.getAccessToken() === 'AT-2fa' && client.getRefreshToken() === 'RT-2fa')
  check('usedRecoveryCode false for an authenticator code', r2.kind === 'signedIn' && r2.usedRecoveryCode === false)
}

console.log('a recovery code (letters and a dash) goes through as typed')
{
  await reset()
  script = (p, b) => p === '/api/auth/mfa' && b.code === 'ABCDE-FGHJK' ? { status: 200, body: { ...SESSION, usedRecoveryCode: true } } : BAD_CODE
  const r = await completeMfaSignIn('ch_1', 'ABCDE-FGHJK')
  check('accepted, and reported as a spent recovery code', r.kind === 'signedIn' && r.usedRecoveryCode === true, r)
  check('tokens stored', secure.get(ACCESS) === 'AT-2fa')
}

console.log('a wrong code: the error, no tokens, stay on the code step')
{
  await reset()
  script = () => BAD_CODE
  const r = await completeMfaSignIn('ch_1', '000000')
  check('badCode (not restart) — the screen keeps the code field', r.kind === 'badCode', r)
  check('the server\'s words are shown', r.kind === 'badCode' && /4 tries left/.test(r.error), r)
  check('no tokens stored', noTokens(), [...secure])

  // A refresh token left over in memory must not turn the 401 into "refresh and send the code again" —
  // that spends two of the challenge's five tries on one tap.
  await client.saveTokens('OLD-AT', 'OLD-RT')
  calls.length = 0
  script = (p) => p === '/api/auth/refresh' ? { status: 200, body: { accessToken: 'NEW-AT', refreshToken: 'NEW-RT' } } : BAD_CODE
  const r2 = await completeMfaSignIn('ch_1', '000000')
  check('a wrong code is sent ONCE, with no token refresh', r2.kind === 'badCode' && calls.length === 1 && calls[0].path === '/api/auth/mfa', calls.map((c) => c.path))
  check('a wrong PASSWORD is not refreshed-and-retried either', await (async () => {
    calls.length = 0
    script = (p) => p === '/api/auth/refresh' ? { status: 200, body: { accessToken: 'NEW-AT', refreshToken: 'NEW-RT' } } : { status: 401, body: { error: 'Invalid email or password' } }
    const r3 = await signInWithPassword('https://acme.onrender.com', 'tech@acme.test', 'nope')
    return r3.kind === 'error' && r3.error === 'Invalid email or password' && calls.length === 1
  })(), calls.map((c) => c.path))
  // Other calls still refresh on a 401 — the option is only on the sign-in doors.
  calls.length = 0
  let n = 0
  script = (p) => p === '/api/auth/refresh' ? { status: 200, body: { accessToken: 'NEW-AT', refreshToken: 'NEW-RT' } } : (n++ === 0 ? { status: 401, body: {} } : { status: 200, body: { ok: 1 } })
  const r4 = await client.get('/api/jobs')
  check('an ordinary request still refreshes and retries on 401', r4.ok && calls.map((c) => c.path).join(',') === '/api/jobs,/api/auth/refresh,/api/jobs', calls.map((c) => c.path))
}

console.log('an expired / spent challenge (400): back to the password, no tokens')
{
  await reset()
  script = () => EXPIRED
  const r = await completeMfaSignIn('ch_1', '123456')
  check('restart', r.kind === 'restart', r)
  check('the server\'s words are shown', r.kind === 'restart' && r.error === 'That code request has expired. Sign in again.')
  check('no tokens stored', noTokens())
  script = () => ({ status: 400, body: { error: 'That code was not right, and this sign-in request has had 5 tries. Sign in again to get a new code.', code: 'too_many_attempts' } })
  check('too many tries (400) is a restart too', (await completeMfaSignIn('ch_1', '111111')).kind === 'restart')
  script = () => ({ status: 401, body: { error: 'Account is disabled' } })
  const rd = await completeMfaSignIn('ch_1', '123456')
  check('a 401 that is not bad_code (account disabled) is a restart, not "try another code"', rd.kind === 'restart' && rd.error === 'Account is disabled', rd)
}

console.log('edges')
{
  await reset()
  const r = await completeMfaSignIn('ch_1', '   ')
  check('an empty code is not sent (the server\'s 400 would read as "start again")', r.kind === 'badCode' && calls.length === 0, r)

  script = () => ({ status: 503, body: { error: 'Service Unavailable' } })
  const r2 = await completeMfaSignIn('ch_1', '123456')
  check('a server error stays on the code step (not restart, not badCode)', r2.kind === 'error' && noTokens(), r2)

  const realFetch = globalThis.fetch
  globalThis.fetch = (async () => { throw new TypeError('Network request failed') }) as any
  const r3 = await completeMfaSignIn('ch_1', '123456')
  const r4 = await signInWithPassword('https://acme.onrender.com', 'a@b.c', 'pw')
  globalThis.fetch = realFetch
  check('no signal on the code step: an error, stay, no tokens', r3.kind === 'error' && /No connection/.test(r3.error) && noTokens(), r3)
  check('no signal on the password step: an error', r4.kind === 'error' && /No connection/.test(r4.error), r4)

  script = () => ({ status: 200, body: { mfaRequired: true } })
  const r5 = await signInWithPassword('https://acme.onrender.com', 'a@b.c', 'pw')
  check('a challenge with no id is an error, not a code step that can never finish', r5.kind === 'error' && noTokens(), r5)

  script = () => ({ status: 200, body: { user: SESSION.user } })
  const r6 = await signInWithPassword('https://acme.onrender.com', 'a@b.c', 'pw')
  check('a 200 with no tokens is an error, and nothing is written', r6.kind === 'error' && noTokens(), r6)

  // Home care's /mfa reply: tokens + user + company, no permissions — still a session.
  script = () => ({ status: 200, body: { accessToken: 'AT-hc', refreshToken: 'RT-hc', user: { id: 'cg1', email: 'cg@care.test', firstName: 'C', lastName: 'G', role: 'caregiver' }, company: { id: 'ag', name: 'Care' } } })
  const r7 = await completeMfaSignIn('ch_hc', '123456')
  check('home care\'s reply shape signs in and stores its tokens', r7.kind === 'signedIn' && secure.get(ACCESS) === 'AT-hc', r7)
}

console.log('the screen and the context use these (source)')
{
  const { readFileSync } = await import('fs')
  const ctx = readFileSync(new URL('../../apps/mobile/src/auth/AuthContext.tsx', import.meta.url), 'utf8')
  const screen = readFileSync(new URL('../../apps/mobile/app/(auth)/login.tsx', import.meta.url), 'utf8')
  check('AuthContext signs in through signIn.ts, and saves no tokens itself', /signInWithPassword\(/.test(ctx) && /completeMfaSignIn\(/.test(ctx) && !/saveTokens\(/.test(ctx))
  check('the login screen calls completeMfa and has the code field', /completeMfa\(/.test(screen) && /textContentType=\{useRecovery \? 'none' : 'oneTimeCode'\}/.test(screen) && /autoComplete=\{useRecovery \? 'off' : 'one-time-code'\}/.test(screen))
  check('six digits get the number pad; a recovery code the full keyboard', /keyboardType=\{useRecovery \? 'default' : 'number-pad'\}/.test(screen))
  check('a restart goes back to the password step', /result\.restart\)\s*\{\s*backToPassword\(/.test(screen))
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
