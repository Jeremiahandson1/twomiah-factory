// T57 — two-factor on the contractor CRM, ported from the dispensary.
//
// WHY IT IS HERE AT ALL. The brief for T35 told the tester to turn MFA on and sign back in. This
// product had no MFA: the shared auth module's whole route list was login / refresh / logout / me /
// permissions / profile / password / forgot / reset, and the login screen had two inputs. Only
// crm-dispensary had the feature, built in T49 H4 after a report found the dispensary shipping
// enrolment screens over a sign-in that ignored them.
//
// So the engine moved to shared auth and this vertical added the two tables. This suite proves the
// port on THIS vertical, because a shared module that works in one template and not another is the
// shape half the findings in this project have had.
//
// THE PROPERTIES WORTH ASSERTING, in the order a person meets them:
//
//   1. nothing changes until enrolment FINISHES. A started-and-abandoned setup must not stop
//      somebody signing in — the failure mode of two-factor is a locked-out business, and that is
//      the one that gets found on a Monday morning.
//   2. the seed is handed over ONCE, by setup. Never by a read.
//   3. a verified authenticator stops sign-in, and the code finishes it.
//   4. recovery codes work once each.
//   5. turning it off needs a live code, not just an open session.
//   6. one person's second factor is not reachable from another person's session.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

// The product mints tokens with process.env.JWT_SECRET; unset in a sandbox, every success path 500s
// and an assertion about refusal passes for the wrong reason. (T57, found the hard way)
process.env.JWT_SECRET ||= 'sandbox-jwt-secret-t57-crm'
process.env.JWT_REFRESH_SECRET ||= 'sandbox-jwt-refresh-secret-t57-crm'

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
  name: 'Two Factor Construction', slug: 'tfc', email: 'tfc@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['projects', 'invoices'],
} as any).returning()

const PASSWORD = 'SiteOffice123!'
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@tfc.local`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
  firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const pm = await mkUser('manager', 'pm')

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
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ══════════ 1 · an unfinished enrolment changes nothing ═══════════════════════════════════════
console.log('\n══════════ 1 · starting enrolment must not lock anybody out ══════════')
let deviceId = ''
let secret = ''
{
  const before = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('with nothing enrolled, a password signs you in', before.status === 200 && !!before.json?.accessToken,
    { status: before.status, hasToken: !!before.json?.accessToken })

  const setup = await api('POST', '/api/auth/mfa-devices/setup', {}, owner)
  check('setup hands over a seed and a device id', setup.status === 201 && !!setup.json?.secret && !!setup.json?.deviceId,
    { status: setup.status, body: setup.text?.slice(0, 160) })
  check('…and the otpauth URL an authenticator scans', /^otpauth:\/\/totp\//.test(String(setup.json?.otpauthUrl || '')), setup.json?.otpauthUrl)
  deviceId = setup.json.deviceId
  secret = setup.json.secret

  const during = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('…and an UNVERIFIED enrolment does not stop sign-in — the lockout failure mode',
    during.status === 200 && !!during.json?.accessToken && !during.json?.mfaRequired,
    { mfaRequired: during.json?.mfaRequired, hasToken: !!during.json?.accessToken })
}

// ══════════ 2 · the seed is handed over once ═══════════════════════════════════════════════════
console.log('\n══════════ 2 · the seed is never read back ══════════')
{
  const list = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  check('the device list answers', list.status === 200 && Array.isArray(list.json?.devices), { status: list.status })
  check('…and carries no secret', !/"secret"|${secret}/.test(list.text) && !list.text.includes(secret), list.text?.slice(0, 200))
  check('…and says two-factor is not active yet', list.json?.active === false, { active: list.json?.active })
}

// ══════════ 3 · a verified authenticator stops sign-in ════════════════════════════════════════
console.log('\n══════════ 3 · the challenge ══════════')
let recovery: string[] = []
{
  const wrong = await api('POST', '/api/auth/mfa-devices/verify', { deviceId, code: '000000' }, owner)
  check('a wrong code does not finish enrolment', wrong.status === 400 && wrong.json?.code === 'bad_code',
    { status: wrong.status, code: wrong.json?.code })

  const done = await api('POST', '/api/auth/mfa-devices/verify', { deviceId, code: codeFor(secret) }, owner)
  check('the real code finishes it', done.status === 200 && done.json?.active === true, { status: done.status, body: done.text?.slice(0, 160) })
  check('…and hands over recovery codes, once', Array.isArray(done.json?.recoveryCodes) && done.json.recoveryCodes.length === 10,
    { n: done.json?.recoveryCodes?.length })
  recovery = done.json.recoveryCodes

  const stopped = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('NOW a password alone is not enough', stopped.status === 200 && stopped.json?.mfaRequired === true && !stopped.json?.accessToken,
    { mfaRequired: stopped.json?.mfaRequired, hasToken: !!stopped.json?.accessToken })
  check('…and the challenge names the factor and the recovery route',
    stopped.json?.methods?.includes('totp') && stopped.json?.recoveryCodesAvailable === true, stopped.json?.methods)

  const bad = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: '123456' })
  check('a wrong code at the challenge is refused', bad.status === 401 && bad.json?.code === 'bad_code', { status: bad.status, code: bad.json?.code })
  check('…and says how many tries are left', /tries left|try left/.test(String(bad.json?.error)), bad.json?.error)

  const finished = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: codeFor(secret) })
  check('…and the right code signs you in', finished.status === 200 && !!finished.json?.accessToken, { status: finished.status })
  check('…with the permission list the screens read', Array.isArray(finished.json?.permissions) && finished.json.permissions.length > 0,
    { n: finished.json?.permissions?.length })

  // Five wrong codes spend the challenge, and a fresh sign-in still works.
  const fresh = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  let last: any = null
  for (let i = 0; i < 5; i++) last = await api('POST', '/api/auth/mfa', { challengeId: fresh.json.challengeId, code: String(200000 + i) })
  check('five wrong codes spend the challenge', last?.json?.code === 'too_many_attempts', { code: last?.json?.code })
  const dead = await api('POST', '/api/auth/mfa', { challengeId: fresh.json.challengeId, code: codeFor(secret) })
  check('…and the correct code cannot revive it', dead.status === 400, { status: dead.status, code: dead.json?.code })
  const again = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  const ok = await api('POST', '/api/auth/mfa', { challengeId: again.json.challengeId, code: codeFor(secret) })
  check('…while signing in again works, so a typo is not a lockout', ok.status === 200 && !!ok.json?.accessToken, { status: ok.status })
}

// ══════════ 4 · a recovery code works once ════════════════════════════════════════════════════
console.log('\n══════════ 4 · recovery codes ══════════')
{
  const one = recovery[0]
  const stopped = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  const used = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: one })
  check('a recovery code finishes a sign-in', used.status === 200 && !!used.json?.accessToken, { status: used.status })
  check('…and says it was one', used.json?.usedRecoveryCode === true, { usedRecoveryCode: used.json?.usedRecoveryCode })

  const second = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  const reused = await api('POST', '/api/auth/mfa', { challengeId: second.json.challengeId, code: one })
  check('…and the SAME code is refused the second time', reused.status === 401, { status: reused.status, code: reused.json?.code })

  const another = await api('POST', '/api/auth/mfa', { challengeId: second.json.challengeId, code: recovery[1] })
  check('…while the next code still works', another.status === 200 && !!another.json?.accessToken, { status: another.status })

  const list = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  const codes = list.json?.devices?.find((d: any) => d.type === 'backup_codes')
  check('…and the screen can see how many are left', Number(codes?.codesLeft) === 8, { codesLeft: codes?.codesLeft })
}

// ══════════ 5 · turning it off needs a live code ══════════════════════════════════════════════
console.log('\n══════════ 5 · turning it off ══════════')
{
  const noCode = await api('DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, {}, owner)
  check('an open session alone cannot remove the second factor',
    noCode.status === 400 && noCode.json?.code === 'code_required', { status: noCode.status, code: noCode.json?.code })

  const wrong = await api('DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, { code: '000000' }, owner)
  check('…nor a wrong code', wrong.status === 400 && wrong.json?.code === 'bad_code', { status: wrong.status, code: wrong.json?.code })

  const gone = await api('DELETE', `/api/auth/mfa-devices/devices/${deviceId}`, { code: codeFor(secret) }, owner)
  check('…and a live code does', gone.status === 200 && gone.json?.removed === true, { status: gone.status, body: gone.text?.slice(0, 140) })

  const left = await rows(sql`SELECT type FROM mfa_devices WHERE user_id = ${owner.id}`)
  check('…taking the recovery codes with it — they are recovery FOR a factor that is gone',
    left.length === 0, left.map((r: any) => r.type))

  const back = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('…and the password alone signs you in again', back.status === 200 && !!back.json?.accessToken, { status: back.status })
}

// ══════════ 6 · one person's factor is not another person's business ══════════════════════════
console.log('\n══════════ 6 · scope ══════════')
{
  const setup = await api('POST', '/api/auth/mfa-devices/setup', {}, pm)
  const pmDevice = setup.json.deviceId
  const pmSecret = setup.json.secret
  await api('POST', '/api/auth/mfa-devices/verify', { deviceId: pmDevice, code: codeFor(pmSecret) }, pm)

  const peek = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  check("the owner's device list does not contain the manager's authenticator",
    !(peek.json?.devices || []).some((d: any) => d.id === pmDevice), peek.json?.devices?.map((d: any) => d.id))

  const steal = await api('DELETE', `/api/auth/mfa-devices/devices/${pmDevice}`, { code: codeFor(pmSecret) }, owner)
  check("…and the owner cannot remove the manager's second factor, even with the manager's code",
    steal.status === 400 || steal.status === 404, { status: steal.status, body: steal.text?.slice(0, 140) })

  const stillThere = await rows(sql`SELECT id FROM mfa_devices WHERE id = ${pmDevice}`)
  check('…and it is still enrolled', stillThere.length === 1, { rows: stillThere.length })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
