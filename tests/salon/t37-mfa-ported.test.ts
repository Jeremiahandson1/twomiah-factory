// The salon's Settings → Security offered two-factor and every enrolment request 404'd. (T37)
//
// I moved two-factor out of crm-dispensary into shared auth last session, wired crm, and stopped. The
// Two-Factor card is rendered by the SHARED SettingsPage, and this template uses the 12-line wrapper
// around it — so the card was on screen here while /api/auth/mfa-devices/* was never mounted.
// Verified against the live tenants before the port: of ten, only ctrtest answered 200 on
// /api/auth/mfa-devices/devices; saltest, fstest, lndtest, evttest, rvtest, vettest and basictest all
// answered 404 with the card showing.
//
// WHY A TEST HERE AND NOT ONLY IN tests/crm. tests/crm/t57-mfa.test.ts already covers the engine in
// depth (32 assertions) and would go on passing however broken the other verticals were — it tests
// the one template I wired by hand. scripts/check-mfa-screen-has-api.ts (#194) now refuses the
// mount/wiring/tables being absent, but a guard reads source: it cannot say the thing RUNS. This runs
// it, in a vertical I ported mechanically rather than by hand.
//
// THE PAYOFF ASSERTION IS THE SIGN-IN. Enrolment returning 201 proves a route is mounted; it does not
// prove the feature works. What makes two-factor real is that a verified authenticator CHANGES the
// password login — and that path runs through shared auth's gate asking this template's database for
// the mfa_devices table, which is the part the port had to get right.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

// The product mints tokens with process.env.JWT_SECRET; unset in a sandbox, every success path 500s
// with "secretOrPrivateKey must have a value" and an assertion about refusal passes for the wrong
// reason. tests/crm/t57-mfa.test.ts learned this the hard way and I left it out of this file, so the
// three token-issuing assertions below 500'd on the first run — not the port, the environment.
process.env.JWT_SECRET ||= 'sandbox-jwt-secret-t37-salon'
process.env.JWT_REFRESH_SECRET ||= 'sandbox-jwt-refresh-secret-t37-salon'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user } = await import('./db/schema.ts')
const { generateTOTPCode } = await import('./src/shared/index.ts')

const [co] = await db.insert(company).values({
  name: 'Shear Luck', slug: 'shear-luck-mfa', email: 'shear@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()

const PASSWORD = 'ChairOne123!'
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@shear.local`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
  firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/auth/mfa-devices', (await import('./src/routes/mfa.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown, who?: any) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const codeFor = (secret: string) => generateTOTPCode(secret, Math.floor(Math.floor(Date.now() / 1000) / 30))

// ══════════ the tables the gate asks for ══════════════════════════════════════════════════════
//
// shared auth/mfa.ts decides whether two-factor is POSSIBLE by querying information_schema for these
// two tables. The sandbox builds the schema the way a tenant does, so their presence here is the
// migration and the reconcile both doing their job for this template.
{
  const r: any = await db.execute(sql`
    SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name IN ('mfa_devices', 'mfa_challenges')
     ORDER BY table_name`)
  const names = ((r as any).rows || r).map((x: any) => x.table_name)
  check('this template has mfa_challenges and mfa_devices', names.length === 2, names)
}

// ══════════ enrolment is reachable AT ALL — the 404 this test exists for ══════════════════════
let deviceId = '', secret = ''
{
  const list = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  check('GET /api/auth/mfa-devices/devices is MOUNTED (it answered 404 on saltest)', list.status === 200,
    { status: list.status, body: list.text?.slice(0, 160) })
  check('…and says two-factor is not active yet', list.json?.active === false, { active: list.json?.active })

  const setup = await api('POST', '/api/auth/mfa-devices/setup', {}, owner)
  check('setup hands over a seed and a device id', setup.status === 201 && !!setup.json?.secret && !!setup.json?.deviceId,
    { status: setup.status, body: setup.text?.slice(0, 160) })
  deviceId = setup.json?.deviceId
  secret = setup.json?.secret

  // The issuer is this vertical's own, not the contractor's — the wiring is per template and an
  // authenticator app shows this string next to the code.
  check("…and the authenticator entry is labelled for THIS vertical, not 'Twomiah Contractor'",
    /^otpauth:\/\/totp\//.test(String(setup.json?.otpauthUrl || ''))
      && String(setup.json?.otpauthUrl).includes('Twomiah%20Salon'),
    setup.json?.otpauthUrl)
}

// ══════════ an unfinished enrolment must not lock anybody out ════════════════════════════════
{
  const during = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('an UNVERIFIED enrolment does not stop sign-in — the lockout failure mode',
    during.status === 200 && !!during.json?.accessToken && !during.json?.mfaRequired,
    { mfaRequired: during.json?.mfaRequired, hasToken: !!during.json?.accessToken })
}

// ══════════ the payoff: a verified factor changes the password login ═════════════════════════
{
  const wrong = await api('POST', '/api/auth/mfa-devices/verify', { deviceId, code: '000000' }, owner)
  check('a wrong code does not finish enrolment', wrong.status === 400, { status: wrong.status, code: wrong.json?.code })

  const done = await api('POST', '/api/auth/mfa-devices/verify', { deviceId, code: codeFor(secret) }, owner)
  check('the real code finishes it', done.status === 200 && done.json?.active === true, { status: done.status, body: done.text?.slice(0, 160) })
  check('…and hands over recovery codes', Array.isArray(done.json?.recoveryCodes) && done.json.recoveryCodes.length === 10,
    { n: done.json?.recoveryCodes?.length })

  // THIS is the assertion that says the port is real rather than merely mounted.
  const stopped = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('NOW a password alone is not enough on the SALON',
    stopped.status === 200 && stopped.json?.mfaRequired === true && !stopped.json?.accessToken,
    { mfaRequired: stopped.json?.mfaRequired, hasToken: !!stopped.json?.accessToken })
  check('…and the challenge names the factor', stopped.json?.methods?.includes('totp'), stopped.json?.methods)

  const finished = await api('POST', '/api/auth/mfa', { challengeId: stopped.json?.challengeId, code: codeFor(secret) })
  check('…and the code completes the sign-in', finished.status === 200 && !!finished.json?.accessToken, { status: finished.status, body: finished.text?.slice(0, 160) })

  // The seed must never come back out after enrolment.
  const after = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  check('the device list never returns the seed', !after.text.includes(secret), after.text?.slice(0, 200))
  check('…and reports two-factor active', after.json?.active === true, { active: after.json?.active })
}

// ══════════ turning it off, which is where the missing FK bit the contractor ══════════════════
//
// mfa_challenges.device_id needs ON DELETE SET NULL: a challenge row records that a sign-in happened
// and the device it used may be removed later. Without it, removing an authenticator somebody had
// actually signed in with answered 409. A sign-in HAS happened above, so this exercises it.
{
  const gone = await api('DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, { code: codeFor(secret) }, owner)
  check('an authenticator that has been SIGNED IN WITH can still be removed (the ON DELETE SET NULL)',
    gone.status === 200, { status: gone.status, body: gone.text?.slice(0, 200) })

  const back = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('…and the password signs you in again afterwards', back.status === 200 && !!back.json?.accessToken,
    { status: back.status, mfaRequired: back.json?.mfaRequired })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
