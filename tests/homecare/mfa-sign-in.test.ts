// crm-homecare — two-factor sign-in. Home care's sign-in took an email and a password and nothing else, for an agency
// holding clients' medications, care plans and Medicaid IDs.
//
// Every other CRM has had two-factor since T57 through shared auth. Home care forks its sign-in and its schema is one
// agency with `users` (text ids) and no company_id, so the shared engine is given a scope (helpers/mfaScope.ts) and
// home care's own /login asks the gate. THE PAYOFF IS THE SIGN-IN: enrolment answering 201 proves a route is mounted;
// what makes two-factor real is that a verified authenticator CHANGES the password login, and that the code — and only
// the code — finishes it.
process.env.JWT_SECRET ||= 'homecare-mfa-test-secret'
process.env.JWT_REFRESH_SECRET ||= 'homecare-mfa-test-refresh-secret'
import { Hono } from 'hono'
import { sql, eq } from 'drizzle-orm'
import jwt from 'jsonwebtoken'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { agencies, users, auditLog } = await import('./db/schema.ts')
const { generateTOTPCode } = await import('./src/shared/index.ts')
const [ag] = await db.insert(agencies).values({ name: 'Two Step Care', slug: 'two-step-care', state: 'WI', settings: {} } as any).returning()

const PASSWORD = 'CareOwner123!'
const mk = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}@twostep-care.test`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'), firstName: tag, lastName: 'U', role, isActive: true,
} as any).returning())[0]
const owner = await mk('owner', 'olive'), carol = await mk('caregiver', 'carol')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/auth/mfa-devices', (await import('./src/routes/mfa.ts')).default)
// The sandbox's authenticate is a header stub that sets the same context a real token decodes to.
const call = async (who: any, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(who ? { 'x-test-user': who.id, 'x-test-role': who.role, 'x-test-email': who.email, 'x-test-company': ag.id } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const login = (u: any) => call(null, 'POST', '/api/auth/login', { email: u.email, password: PASSWORD })
const step = () => Math.floor(Math.floor(Date.now() / 1000) / 30)
const codeFor = (secret: string) => generateTOTPCode(secret, step())
/** Six digits no window the verifier accepts would produce — a WRONG code that cannot pass by luck. */
const wrongFor = (secret: string) => {
  const live = new Set([-1, 0, 1].map((i) => generateTOTPCode(secret, step() + i)))
  for (let n = 0; ; n++) { const c = String(n).padStart(6, '0'); if (!live.has(c)) return c }
}
const hasTokens = (j: any) => !!j?.accessToken || !!j?.refreshToken

// ══════════ the tables the gate asks for ══════════════════════════════════════════════════════
{
  const r: any = await db.execute(sql`
    SELECT table_name, data_type FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name IN ('mfa_devices', 'mfa_challenges') AND column_name = 'user_id'
     ORDER BY table_name`)
  const rows = (r.rows || r) as any[]
  check('home care has mfa_challenges and mfa_devices (migration 0026 ran)', rows.length === 2, rows)
  check('…keyed to users by text, as users.id is', rows.every((x) => x.data_type === 'text'), rows)
}

// ══════════ no device: a password is enough, exactly as before ═══════════════════════════════
{
  const r = await login(owner)
  check(`no authenticator → sign-in returns tokens (${r.status})`, r.status === 200 && !!r.json?.accessToken && !!r.json?.refreshToken && !r.json?.mfaRequired, r.json)
  check("…with home care's normal reply: user and the agency summary", r.json?.user?.id === owner.id && r.json?.company?.id === ag.id, { user: r.json?.user, company: r.json?.company?.id })
}

// ══════════ enrolment ═════════════════════════════════════════════════════════════════════════
let deviceId = '', secret = '', recovery: string[] = []
{
  const list = await call(owner, 'GET', '/api/auth/mfa-devices/devices')
  check(`GET /api/auth/mfa-devices/devices is mounted and says off (${list.status})`, list.status === 200 && list.json?.active === false, list.json)

  const setup = await call(owner, 'POST', '/api/auth/mfa-devices/setup', {})
  deviceId = setup.json?.deviceId; secret = setup.json?.secret
  check(`setup hands over a seed and a device id (${setup.status})`, setup.status === 201 && !!secret && !!deviceId, setup.json)
  check('…labelled for home care in the authenticator app', String(setup.json?.otpauthUrl || '').includes('Twomiah%20Home%20Care'), setup.json?.otpauthUrl)

  const during = await login(owner)
  check('an UNVERIFIED enrolment does not stop sign-in — nobody is locked out by a QR code they never scanned',
    during.status === 200 && !!during.json?.accessToken && !during.json?.mfaRequired, during.json)

  const wrong = await call(owner, 'POST', '/api/auth/mfa-devices/verify', { deviceId, code: wrongFor(secret) })
  check(`a wrong code does not finish enrolment (${wrong.status})`, wrong.status === 400, wrong.json)

  const done = await call(owner, 'POST', '/api/auth/mfa-devices/verify', { deviceId, code: codeFor(secret) })
  recovery = done.json?.recoveryCodes || []
  check(`the real code (computed by the shared TOTP helper) turns it on (${done.status})`, done.status === 200 && done.json?.active === true, done.json)
  check('…and hands over ten recovery codes, once', recovery.length === 10, recovery.length)

  const rows: any = await db.execute(sql`SELECT DISTINCT company_id FROM mfa_devices WHERE user_id = ${owner.id}`)
  const cids = ((rows.rows || rows) as any[]).map((x) => x.company_id)
  check("the rows carry the agency's one fixed company id — the value sign-in reads them by", cids.length === 1 && cids[0] === 'agency', cids)

  const after = await call(owner, 'GET', '/api/auth/mfa-devices/devices')
  check('the device list never returns the seed', after.status === 200 && !after.text.includes(secret), after.text.slice(0, 200))

  // Home care's audit log reads an Express-shaped req; routes/mfa.ts translates the Hono context for it.
  const logged = await db.select().from(auditLog).where(eq(auditLog.action, 'mfa_enabled'))
  check('turning it on is in the audit log, naming who and for which agency', logged.length === 1 && logged[0].userId === owner.id && logged[0].userEmail === owner.email && logged[0].companyId === ag.id, logged)
}

// ══════════ the payoff: the password alone no longer signs in ═════════════════════════════════
{
  const stopped = await login(owner)
  check(`NOW a password alone gets a challenge (${stopped.status})`, stopped.status === 200 && stopped.json?.mfaRequired === true && !!stopped.json?.challengeId, stopped.json)
  check('…and NO tokens — not an access token, not a refresh token', !hasTokens(stopped.json), Object.keys(stopped.json || {}))
  check('…naming the factor and offering the recovery route', stopped.json?.methods?.includes('totp') && stopped.json?.recoveryCodesAvailable === true, stopped.json)
  // Cleared, so the assertion below can only pass if /mfa stored the token it handed out. (A refresh token signed in the
  // same second as an earlier one is byte-identical — same payload, same iat — so comparing with the old one proves nothing.)
  await db.update(users).set({ refreshToken: null }).where(eq(users.id, owner.id))

  const bad = await call(null, 'POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: wrongFor(secret) })
  check(`a wrong code is 401 bad_code, with no tokens (${bad.status})`, bad.status === 401 && bad.json?.code === 'bad_code' && !hasTokens(bad.json), bad.json)

  const ok = await call(null, 'POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: codeFor(secret) })
  check(`the right code finishes the sign-in with tokens (${ok.status})`, ok.status === 200 && !!ok.json?.accessToken && !!ok.json?.refreshToken, ok.json)
  check('…the same reply a password sign-in gives: user and the agency summary', ok.json?.user?.id === owner.id && ok.json?.user?.role === 'owner' && ok.json?.company?.id === ag.id, { user: ok.json?.user, company: ok.json?.company?.id })
  const decoded: any = (() => { try { return jwt.verify(ok.json?.accessToken, process.env.JWT_SECRET!) } catch { return null } })()
  check('…and the access token is a real one, for this person and this agency', decoded?.userId === owner.id && decoded?.role === 'owner' && decoded?.companyId === ag.id, decoded)
  const [row] = await db.select({ refreshToken: users.refreshToken }).from(users).where(eq(users.id, owner.id))
  check('…and its refresh token is the one stored — /refresh will accept it', !!row?.refreshToken && row.refreshToken === ok.json?.refreshToken, null)

  const again = await call(null, 'POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: codeFor(secret) })
  check(`a spent challenge cannot be used twice (${again.status})`, again.status === 400 && !hasTokens(again.json), again.json)

  const junk = await call(null, 'POST', '/api/auth/mfa', { challengeId: 'not-a-real-challenge', code: '123456' })
  check(`a made-up challenge id is a 400, not a 500 (${junk.status})`, junk.status === 400 && !hasTokens(junk.json), junk.json)
  const empty = await call(null, 'POST', '/api/auth/mfa', {})
  check(`an empty request is a 400 (${empty.status})`, empty.status === 400, empty.json)
}

// ══════════ a recovery code works once ════════════════════════════════════════════════════════
{
  const one = await login(owner)
  const used = await call(null, 'POST', '/api/auth/mfa', { challengeId: one.json?.challengeId, code: recovery[0] })
  check(`a recovery code finishes the sign-in (${used.status})`, used.status === 200 && !!used.json?.accessToken && used.json?.usedRecoveryCode === true, used.json)

  const two = await login(owner)
  const reused = await call(null, 'POST', '/api/auth/mfa', { challengeId: two.json?.challengeId, code: recovery[0] })
  check(`…and only once — the same code again is refused (${reused.status})`, reused.status === 401 && !hasTokens(reused.json), reused.json)

  const left = await call(owner, 'GET', '/api/auth/mfa-devices/devices')
  const codes = (left.json?.devices || []).find((d: any) => d.type === 'backup_codes')
  check('…and the device list counts nine left', codes?.codesLeft === 9, codes)
}

// ══════════ one person's factor is theirs alone ═══════════════════════════════════════════════
{
  const theirs = await call(carol, 'GET', '/api/auth/mfa-devices/devices')
  check("a caregiver's device list does not show the owner's authenticator", theirs.status === 200 && (theirs.json?.devices || []).length === 0 && theirs.json?.active === false, theirs.json)

  const grab = await call(carol, 'DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, { code: codeFor(secret) })
  check(`…and cannot remove it, even holding a valid code (${grab.status})`, grab.status === 404, grab.json)
  const stillOn = await call(owner, 'GET', '/api/auth/mfa-devices/devices')
  check("…the owner's two-factor is still on", stillOn.json?.active === true, stillOn.json)

  const carolIn = await login(carol)
  check("the owner's two-factor does not gate anybody else's sign-in", carolIn.status === 200 && !!carolIn.json?.accessToken && !carolIn.json?.mfaRequired, carolIn.json)

  const verifyOthers = await call(carol, 'POST', '/api/auth/mfa-devices/verify', { deviceId, code: codeFor(secret) })
  check(`…and cannot verify the owner's device as their own (${verifyOthers.status})`, verifyOthers.status === 404, verifyOthers.json)
}

// ══════════ an account deactivated between the password and the code ═════════════════════════
{
  const ch = await login(owner)
  await db.update(users).set({ isActive: false }).where(eq(users.id, owner.id))
  const r = await call(null, 'POST', '/api/auth/mfa', { challengeId: ch.json?.challengeId, code: codeFor(secret) })
  check(`an account deactivated after the password does not get in on the code (${r.status})`, r.status === 401 && !hasTokens(r.json), r.json)
  await db.update(users).set({ isActive: true }).where(eq(users.id, owner.id))
}

// ══════════ turning it off ═══════════════════════════════════════════════════════════════════
{
  const noCode = await call(owner, 'DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, {})
  check(`turning it off needs a code, not just a session (${noCode.status})`, noCode.status === 400, noCode.json)
  const off = await call(owner, 'DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, { code: codeFor(secret) })
  check(`with a code it comes off — after sign-ins have used it (the SET NULL foreign key) (${off.status})`, off.status === 200, off.json)
  const back = await login(owner)
  check('…and a password signs in again', back.status === 200 && !!back.json?.accessToken && !back.json?.mfaRequired, back.json)
}

console.log(`\nhomecare mfa sign-in: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
