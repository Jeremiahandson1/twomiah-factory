// The shared screens send the session's token on the FIRST sign-in. (Run 4, HIGH 1, 10/16)
//
//   Tester: "Onboarding wizard step 3 (Branded Email) failed on the FIRST sign-in: 'Access token required' (HTTP 401 on
//   three /api/email-aliases saves). After a page reload the same step saved (201)."
//
// Home care signs in through a client of its own (frontend/src/services/api.ts), which writes the session to
// localStorage 'accessToken'/'refreshToken'. The shared screens (EmailAliasesStep, Plan & Billing, Email, Google
// reviews…) use the shared singleton (packages/tenant-ui/src/api/client.ts), which copied those keys ONCE, when the
// page loaded — before anyone had signed in — and so sent no Authorization header until a reload re-read them.
// Dispensary, roof and the store keep clients of their own too. The shared client now reads the stored session when a
// request goes. This drives the real module against an in-memory localStorage and a recording fetch.
import { readFileSync } from 'node:fs'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}
const ROOT = process.env.FACTORY_ROOT || '../../'

// ── a browser: storage that may be unreadable (private mode), and a server that wants a token
const store = new Map<string, string>()
let storageBroken = false
;(globalThis as any).localStorage = {
  getItem: (k: string) => { if (storageBroken) throw new Error('SecurityError'); return store.has(k) ? store.get(k)! : null },
  setItem: (k: string, v: string) => { if (storageBroken) throw new Error('SecurityError'); store.set(k, String(v)) },
  removeItem: (k: string) => { if (storageBroken) throw new Error('SecurityError'); store.delete(k) },
}
const seen: Array<{ url: string; auth: string | null; body?: any }> = []
const valid = new Set<string>()
globalThis.fetch = (async (url: any, init?: any) => {
  const auth = new Headers(init?.headers).get('authorization')
  seen.push({ url: String(url), auth, body: init?.body })
  const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } })
  if (String(url).endsWith('/api/auth/refresh')) {
    const { refreshToken } = JSON.parse(init.body)
    if (refreshToken !== 'R2') return json({ error: 'Invalid refresh token' }, 401)
    valid.add('A3'); return json({ accessToken: 'A3', refreshToken: 'R3' })
  }
  const tok = auth?.replace(/^Bearer /, '')
  if (!tok) return json({ error: 'Access token required' }, 401)
  if (!valid.has(tok)) return json({ error: 'Invalid or expired token' }, 401)
  return json({ ok: true }, 201)
}) as any

// The page loads signed out: the shared singleton is built now, with nothing stored.
const { ApiClient } = await import(ROOT + 'packages/tenant-ui/src/api/client.ts')
const shared = new ApiClient({ baseUrl: '' })

{
  // Home care's login (services/api.ts setTokens) stores the session after the shared client was built.
  store.set('accessToken', 'A1'); store.set('refreshToken', 'R1'); valid.add('A1')
  // A session the client thinks is dead ends with an event; record it rather than crash, so a broken client FAILS here.
  const events: string[] = []
  ;(globalThis as any).window = { dispatchEvent: (e: any) => { events.push(e?.type); return true }, location: { pathname: '/crm', assign() {} } }
  const res = await shared.raw('/api/email-aliases', { method: 'POST', body: JSON.stringify({ alias: 'support' }) }).catch((e: any) => ({ status: `threw: ${e?.message}` }) as any)
  check(`first sign-in: the shared screen's save carries the token home care stored after the page loaded (${res.status})`, res.status === 201 && seen.at(-1)?.auth === 'Bearer A1', seen.at(-1))
}
{
  // Home care's own client refreshes (the server rotates both tokens); the shared screen's next call uses the new one.
  store.set('accessToken', 'A2'); store.set('refreshToken', 'R2'); valid.delete('A1'); valid.add('A2')
  const res = await shared.raw('/api/email-aliases')
  check('a refresh made by the other client is picked up — no stale token, no 401', res.status === 201 && seen.at(-1)?.auth === 'Bearer A2', seen.at(-1))
  // And when the shared client must refresh, it presents the CURRENT refresh token, not the one from page load.
  valid.delete('A2')
  const r2 = await shared.raw('/api/email-aliases')
  const refresh = seen.filter((s) => s.url.endsWith('/api/auth/refresh')).at(-1)
  check(`its own refresh sends the stored (rotated) refresh token, and the replay succeeds (${r2.status})`, r2.status === 201 && JSON.parse(refresh?.body || '{}').refreshToken === 'R2' && seen.at(-1)?.auth === 'Bearer A3' && store.get('accessToken') === 'A3', { refresh, last: seen.at(-1) })
}
{
  // Signed out by the other client: the shared client holds nothing either.
  store.delete('accessToken'); store.delete('refreshToken')
  await shared.raw('/api/email-aliases').catch(() => null)
  check('signed out elsewhere: the shared client sends no token', seen.at(-1)?.auth === null, seen.at(-1))
}
{
  // Private mode: storage throws. The client still works from what it was given.
  storageBroken = true
  shared.setTokens('A3', 'R3')
  const res = await shared.raw('/api/email-aliases')
  check(`storage unreadable: the in-memory session is used (${res.status})`, res.status === 201 && seen.at(-1)?.auth === 'Bearer A3', seen.at(-1))
  storageBroken = false
}
{
  // The writer the shared client relies on: home care's own client stores the session under the same two keys.
  const api = readFileSync(ROOT + 'templates/crm-homecare/frontend/src/services/api.ts', 'utf8')
  check("home care's client writes the session to the keys the shared client reads", /localStorage\.setItem\('accessToken', accessToken\)/.test(api) && /localStorage\.setItem\('refreshToken', refreshToken\)/.test(api))
  const step = readFileSync(ROOT + 'packages/tenant-ui/src/onboarding/steps/EmailAliasesStep.tsx', 'utf8').replace(/\r\n/g, '\n')
  check('the wizard step saves through the shared client (api.raw), the path proven above', /api\.raw\(/.test(step))
}

console.log(`\nhomecare-first-sign-in-token: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
