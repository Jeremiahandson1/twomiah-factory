// T32 M16 — "unconfirmed session drop after a manual /api/auth/refresh; worth checking refresh-token
// rotation."
//
// The tester was right to flag it as unconfirmed and right to suspect rotation, because a rotating
// refresh token is the classic way to lose a session: the server issues a new one, something races
// or drops the response, and the old token is already dead.
//
// WHAT I FOUND BY READING IT: this endpoint does not rotate at all. It verifies the refresh token,
// mints a new ACCESS token, and hands back the same refresh token it was given. The stored token
// list is not touched, so there is no window in which a valid session can be killed by refreshing.
// `generateTokens` does mint a fresh refresh token, which this route then throws away.
//
// So I could not find the reported mechanism — and "I read it and it looks fine" is not a closed
// item. This suite exercises the real flow instead, with real bcrypt passwords and real JWTs, so
// that the behaviour is pinned rather than argued:
//
//   · a refresh does NOT invalidate the token it was given          ← the M16 claim, directly
//   · refreshing twice with the same token works both times         ← no rotation, so no race
//   · a second login does not end the first session
//   · the refresh token is not usable as an access token
//
// AND IT IS THE FIRST TEST IN THIS SUITE TO TOUCH /api/auth AT ALL. Login, refresh and the account
// lockout had no coverage, in the module every other request depends on.
//
// NOT COVERED HERE, deliberately and worth saying: `/logout` sits behind `authenticate`, which the
// sandbox replaces with an x-test-user header (tests/harness/runSuite.ts), so revocation-on-logout
// cannot be exercised from here. `/login` and `/refresh` can, because neither uses that middleware
// — login is public and refresh verifies the JWT itself.
import { Hono } from 'hono'
import { eq } from 'drizzle-orm'

// Before the routes are imported: they read these at call time, but setting them first keeps the
// module honest about what it needs.
process.env.JWT_SECRET ||= 't32-access-secret-for-tests-only'
process.env.JWT_REFRESH_SECRET ||= 't32-refresh-secret-for-tests-only'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')

const PASSWORD = 'correct-horse-7'
const [co] = await db.insert(company).values({
  name: 'Session Co', slug: 'session-co', email: 's@test.local', state: 'OH', settings: { timezone: 'UTC' },
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner@session.local', passwordHash: await Bun.password.hash(PASSWORD),
  firstName: 'Nadia', lastName: 'Session', role: 'owner', companyId: co.id, isActive: true,
} as any).returning()

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const post = async (path: string, body?: unknown, headers: Record<string, string> = {}) => {
  const res = await app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

// ══════════ login issues a usable pair ════════════════════════════════════════════════════════════
const login = await post('/api/auth/login', { email: 'owner@session.local', password: PASSWORD })
check('a correct password signs in', login.status === 200, { status: login.status, body: login.text?.slice(0, 200) })
check('…and returns an access token', typeof login.json?.accessToken === 'string' && login.json.accessToken.length > 20, { got: typeof login.json?.accessToken })
check('…and a refresh token', typeof login.json?.refreshToken === 'string' && login.json.refreshToken.length > 20, { got: typeof login.json?.refreshToken })
check('…and the permission list the screen gates on', Array.isArray(login.json?.permissions) && login.json.permissions.includes('*'), { permissions: login.json?.permissions })
check('…and never the password hash', !/passwordHash|password_hash/.test(login.text), { leak: /passwordHash/.test(login.text) })

const first = login.json?.refreshToken as string

// The token really is stored against the user — the refresh route checks membership of this list,
// so if login did not store it, every refresh would 401 and that WOULD be M16.
{
  const [row] = await db.select().from(user).where(eq(user.id, owner.id))
  const stored = (() => { try { const v = JSON.parse(row.refreshToken || 'null'); return Array.isArray(v) ? v : [row.refreshToken] } catch { return [row.refreshToken] } })()
  check('login stored the refresh token against the user', stored.includes(first), { count: stored.length })
}

// ══════════ THE M16 CLAIM, DIRECTLY ══════════════════════════════════════════════════════════════
{
  const r1 = await post('/api/auth/refresh', { refreshToken: first })
  check('a manual refresh succeeds', r1.status === 200, { status: r1.status, body: r1.text?.slice(0, 200) })
  /*
   * A WORKING access token, not a DIFFERENT one.
   *
   * My first version asserted `!== login.accessToken` and failed: a JWT's `iat`/`exp` have
   * one-second resolution, so refreshing in the same second as the login produces a byte-identical
   * token. That is correct JWT behaviour and not worth asserting against — what matters is that the
   * token verifies and carries the right claims, which is what a caller depends on.
   */
  const jwtLib = (await import('jsonwebtoken')).default
  let claims: any = null
  try { claims = jwtLib.verify(r1.json?.accessToken, process.env.JWT_SECRET!) } catch { /* left null */ }
  check('…and returns an access token that verifies against the access secret', !!claims, { token: String(r1.json?.accessToken).slice(0, 24) })
  check('…carrying the user, the company and the role the guards read', claims?.userId === owner.id && claims?.companyId === co.id && claims?.role === 'owner',
    { userId: claims?.userId, companyId: claims?.companyId, role: claims?.role })
  check('…and it is an ACCESS token, so it is not accepted by the refresh route', (await post('/api/auth/refresh', { refreshToken: r1.json?.accessToken })).status === 401)
  check('…and hands back the SAME refresh token — it does not rotate', r1.json?.refreshToken === first, { changed: r1.json?.refreshToken !== first })

  // THE SESSION DOES NOT DROP. If refreshing invalidated the token it was given — the mechanism the
  // report suspected — this second call would 401.
  const r2 = await post('/api/auth/refresh', { refreshToken: first })
  check('THE SAME REFRESH TOKEN STILL WORKS AFTERWARDS — no session drop', r2.status === 200, { status: r2.status, body: r2.text?.slice(0, 200) })

  const r3 = await post('/api/auth/refresh', { refreshToken: r1.json?.refreshToken })
  check('…and so does the one the refresh returned (they are the same token)', r3.status === 200, { status: r3.status })

  const [row] = await db.select().from(user).where(eq(user.id, owner.id))
  check('…and refreshing did not touch the stored token list', (row.refreshToken || '').includes(first), { stored: (row.refreshToken || '').slice(0, 40) })
}

// ══════════ a refresh that SHOULD be refused ═════════════════════════════════════════════════════
{
  const none = await post('/api/auth/refresh', {})
  check('a refresh with no token is 401', none.status === 401, { status: none.status })

  const junk = await post('/api/auth/refresh', { refreshToken: 'not-a-jwt' })
  check('a refresh with a malformed token is 401', junk.status === 401, { status: junk.status })

  // Signed with the ACCESS secret rather than the refresh secret: a token of the right shape that
  // this endpoint must not accept.
  const jwt = (await import('jsonwebtoken')).default
  const wrongSecret = jwt.sign({ userId: owner.id, companyId: co.id, type: 'refresh' }, process.env.JWT_SECRET!, { expiresIn: '7d' })
  const wrong = await post('/api/auth/refresh', { refreshToken: wrongSecret })
  check('a token signed with the ACCESS secret is refused', wrong.status === 401, { status: wrong.status })

  // Correctly signed, never issued — so it is not in the user's stored list.
  const unissued = jwt.sign({ userId: owner.id, companyId: co.id, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  const never = await post('/api/auth/refresh', { refreshToken: unissued })
  check('a correctly-signed token that was never ISSUED is refused', never.status === 401, { status: never.status })

  const expired = jwt.sign({ userId: owner.id, companyId: co.id, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '-1s' })
  const old = await post('/api/auth/refresh', { refreshToken: expired })
  check('an expired token is refused', old.status === 401, { status: old.status })
}

// ══════════ one session does not end another ═════════════════════════════════════════════════════
{
  const second = await post('/api/auth/login', { email: 'owner@session.local', password: PASSWORD })
  check('the same user can sign in a second time', second.status === 200, { status: second.status })
  check('…with a DIFFERENT refresh token', second.json?.refreshToken !== first, { same: second.json?.refreshToken === first })

  const stillFirst = await post('/api/auth/refresh', { refreshToken: first })
  check('…and the FIRST session still refreshes — a new login does not sign the old one out', stillFirst.status === 200, { status: stillFirst.status })
  const stillSecond = await post('/api/auth/refresh', { refreshToken: second.json?.refreshToken })
  check('…and so does the second', stillSecond.status === 200, { status: stillSecond.status })
}

// ══════════ a disabled account cannot refresh its way back in ════════════════════════════════════
{
  const [other] = await db.insert(user).values({
    email: 'leaver@session.local', passwordHash: await Bun.password.hash(PASSWORD),
    firstName: 'Ola', lastName: 'Leaver', role: 'manager', companyId: co.id, isActive: true,
  } as any).returning()
  const theirLogin = await post('/api/auth/login', { email: 'leaver@session.local', password: PASSWORD })
  check('a second user signs in', theirLogin.status === 200, { status: theirLogin.status })

  await db.update(user).set({ isActive: false }).where(eq(user.id, other.id))
  const afterDisable = await post('/api/auth/refresh', { refreshToken: theirLogin.json?.refreshToken })
  check('once the account is disabled, its refresh token stops working', afterDisable.status === 401, { status: afterDisable.status })
  const loginAfter = await post('/api/auth/login', { email: 'leaver@session.local', password: PASSWORD })
  check('…and it cannot sign in again either', loginAfter.status === 401, { status: loginAfter.status })
}

// ══════════ the lockout, which also had no coverage ══════════════════════════════════════════════
{
  const [target] = await db.insert(user).values({
    email: 'locked@session.local', passwordHash: await Bun.password.hash(PASSWORD),
    firstName: 'Reza', lastName: 'Lock', role: 'field', companyId: co.id, isActive: true,
  } as any).returning()

  let lockedAt = 0
  for (let i = 1; i <= 12; i++) {
    const bad = await post('/api/auth/login', { email: 'locked@session.local', password: 'wrong-every-time' })
    if (bad.status === 423) { lockedAt = i; break }
    if (bad.status !== 401) { check(`attempt ${i} answered 401 or 423`, false, { status: bad.status, body: bad.text?.slice(0, 160) }); break }
  }
  check('repeated wrong passwords lock the account (at the 10th)', lockedAt === 10, { lockedAt })

  // THE POINT OF THE LOCK: it must not leak whether the password was right.
  const rightButLocked = await post('/api/auth/login', { email: 'locked@session.local', password: PASSWORD })
  check('…and a CORRECT password is refused the same way while locked', rightButLocked.status === 423, { status: rightButLocked.status })
  check('…with a message that tells you to wait, not whether you got it right', /try again in/i.test(rightButLocked.json?.error || ''), { error: rightButLocked.json?.error })

  const [row] = await db.select().from(user).where(eq(user.id, target.id))
  check('the lock has an expiry rather than being permanent', !!row.lockedUntil && new Date(row.lockedUntil).getTime() > Date.now(), { lockedUntil: row.lockedUntil })

  // And it clears: with the lock expired, the right password works again and the counter resets.
  await db.update(user).set({ lockedUntil: new Date(Date.now() - 1000) }).where(eq(user.id, target.id))
  const afterWait = await post('/api/auth/login', { email: 'locked@session.local', password: PASSWORD })
  check('once the lock expires the right password works again', afterWait.status === 200, { status: afterWait.status, body: afterWait.text?.slice(0, 160) })
  const [cleared] = await db.select().from(user).where(eq(user.id, target.id))
  check('…and the failure counter is back to zero', Number(cleared.failedLoginCount || 0) === 0, { failedLoginCount: cleared.failedLoginCount })
}

// ══════════ an unknown email answers exactly like a wrong password ═══════════════════════════════
{
  const ghost = await post('/api/auth/login', { email: 'nobody@session.local', password: PASSWORD })
  const wrongPw = await post('/api/auth/login', { email: 'owner@session.local', password: 'nope-nope-nope' })
  check('an unknown email and a wrong password give the same status', ghost.status === wrongPw.status, { ghost: ghost.status, wrongPw: wrongPw.status })
  check('…and the same message, so the form does not confirm which emails exist',
    ghost.json?.error === wrongPw.json?.error, { ghost: ghost.json?.error, wrongPw: wrongPw.json?.error })
}

console.log(`\n${failed === 0 ? 'PASS' : 'FAIL'} — ${passed} passed, ${failed} failed`)
if (failed) process.exit(1)
