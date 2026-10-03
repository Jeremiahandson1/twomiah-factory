// crm-dispensary — PIN quick-login and two-factor at sign-in, which nothing has ever tested.
//
// WHY THIS SUITE EXISTS. The user asked for MFA and PIN to be exercised. The contractor CRM has
// neither; the dispensary has both, shipped and live, and no suite in any vertical touches them.
// T49 H4 built the login challenge properly — a presentable factor stops sign-in and the tokens are
// issued only after a code. Reading `/pin-login` beside it showed what happens when a second door
// is added later and the rule is only written on the first one.
//
// THE FOUR CLAIMS, each one a thing a shop would feel:
//
//   1. A PIN MUST NOT BYPASS THE SECOND FACTOR. `/login` asks a TOTP-enrolled user for a code.
//      `/pin-login` never calls mfaGateFor, so four digits at the till skipped the factor the owner
//      switched on. A control that one door enforces and another ignores is not a control.
//
//   2. ONE WRONG PIN MUST NOT LOCK OUT THE SHOP. The route tries every PIN-enabled user in turn and
//      increments `pin_attempts` on EACH one that does not match. Five wrong taps therefore locked
//      every budtender out of quick-login for fifteen minutes — and anybody who can reach the
//      endpoint can do it on purpose with five requests and no credentials at all.
//
//   3. A PIN IDENTIFIES ONE PERSON. Nothing stopped two staff sharing 1234; first match wins, so the
//      till would attribute a sale to whoever the loop reached first. On a seed-to-sale regulated
//      counter, every action has to be attributable to the person who took it.
//
//   4. A CODE CANNOT BE GUESSED FOREVER. The challenge lives ten minutes and counted nothing, so a
//      pending challenge accepted unlimited six-digit guesses. /login is capped at 150 per quarter
//      hour; /pin-login and /mfa were under the generic write limit only.
//
// The TOTP codes here are generated with the product's own generator, so the test cannot pass
// against a verifier that disagrees with the thing a phone would show.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { generateTOTPCode, base32Encode } from './src/shared/index.ts'
import crypto from 'crypto'

// The product mints tokens with jwt.sign(..., process.env.JWT_SECRET!) — unset in a sandbox, so every
// route that SUCCEEDS at signing somebody in answers 500 and an assertion about refusal passes for
// the wrong reason. Pin it, the way the server environment is pinned for date-dependent suites.
process.env.JWT_SECRET ||= 'sandbox-jwt-secret-t57'
process.env.JWT_REFRESH_SECRET ||= 'sandbox-jwt-refresh-secret-t57'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'PIN Dispensary', slug: 'pin-disp', email: 'pin@test.local',
  state: 'OH', taxRate: '10', exciseTaxRate: '15', settings: {}, enabledFeatures: [],
} as any).returning()

const PASSWORD = 'CounterPass123!'
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@pin.local`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
  firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]

const owner = await mkUser('owner', 'owner')
const bud1 = await mkUser('user', 'bud1')
const bud2 = await mkUser('user', 'bud2')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown, token?: string) => {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      // x-test-user is the harness bridge (tests/harness/fixtures/middleware-auth.ts): the REAL
      // middleware still runs when it is absent, so a bearer token is exercised too where it matters.
      ...(token ? (token.includes('.') ? { authorization: 'Bearer ' + token } : { 'x-test-user': token }) : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}

const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
const attemptsOf = async (id: string) => {
  const [r] = await rows(sql`SELECT pin_attempts, pin_locked_until FROM "user" WHERE id = ${id}`)
  return { attempts: Number(r?.pin_attempts ?? 0), lockedUntil: r?.pin_locked_until ?? null }
}
/** A TOTP device, enrolled the way routes/security.ts enrols one. */
const enrolTotp = async (userId: string) => {
  const secret = base32Encode(crypto.randomBytes(20))
  await db.execute(sql`
    INSERT INTO mfa_devices (id, user_id, company_id, type, name, secret, is_verified, created_at)
    VALUES (gen_random_uuid(), ${userId}, ${co.id}, 'totp', 'Authenticator', ${secret}, true, NOW())
  `)
  return secret
}
const codeFor = (secret: string) => generateTOTPCode(secret, Math.floor(Math.floor(Date.now() / 1000) / 30))
const setPin = async (userId: string, pin: string) => {
  await db.execute(sql`
    UPDATE "user" SET pin_hash = ${await Bun.password.hash(pin, 'bcrypt')},
      pin_attempts = 0, pin_locked_until = NULL WHERE id = ${userId}
  `)
}

// ══════════ the login challenge works, so the comparison below means something ═════════════════
console.log('\n══════════ sign-in with a second factor (T49 H4, never tested until now) ══════════')
{
  const secret = await enrolTotp(owner.id)
  const stopped = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('a TOTP-enrolled user is not handed tokens for a password alone',
    stopped.status === 200 && stopped.json?.mfaRequired === true && !stopped.json?.accessToken,
    { mfaRequired: stopped.json?.mfaRequired, hasToken: !!stopped.json?.accessToken })
  check('…and the challenge says which factor to present', Array.isArray(stopped.json?.methods) && stopped.json.methods.includes('totp'), stopped.json?.methods)

  const wrong = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: '000000' })
  check('a wrong code is refused', wrong.status === 401 && wrong.json?.code === 'bad_code', { status: wrong.status, code: wrong.json?.code })

  const right = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: codeFor(secret) })
  check('…and the real code finishes the sign-in', right.status === 200 && !!right.json?.accessToken, { status: right.status, hasToken: !!right.json?.accessToken })

  const again = await api('POST', '/api/auth/mfa', { challengeId: stopped.json.challengeId, code: codeFor(secret) })
  check('…and the challenge is single-use', again.status === 400 && again.json?.code === 'challenge_not_found', { status: again.status, code: again.json?.code })
}

// ══════════ 1 · a PIN must not bypass the second factor ═══════════════════════════════════════
console.log('\n══════════ 1 · the till door and the second factor ══════════')
{
  await setPin(owner.id, '4821')   // owner has a verified TOTP device from the block above
  const viaPin = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '4821' })
  check('a PIN does NOT hand tokens to an account that owes a second factor',
    !(viaPin.status === 200 && viaPin.json?.accessToken),
    { status: viaPin.status, hasToken: !!viaPin.json?.accessToken })
  check('…it opens the same challenge the password door opens',
    viaPin.status === 200 && viaPin.json?.mfaRequired === true && !!viaPin.json?.challengeId,
    { mfaRequired: viaPin.json?.mfaRequired, challengeId: !!viaPin.json?.challengeId })

  if (viaPin.json?.challengeId) {
    const devs = await rows(sql`SELECT secret FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'totp'`)
    const done = await api('POST', '/api/auth/mfa', { challengeId: viaPin.json.challengeId, code: codeFor(String(devs[0].secret)) })
    check('…and the code finishes it, so the till still works', done.status === 200 && !!done.json?.accessToken,
      { status: done.status, hasToken: !!done.json?.accessToken })
  }
}

// ══════════ 2 · one wrong PIN must not lock out the shop ══════════════════════════════════════
console.log('\n══════════ 2 · five wrong taps and the whole counter ══════════')
{
  await setPin(bud1.id, '1111')
  await setPin(bud2.id, '2719')
  for (const u of [bud1, bud2]) {
    const a = await attemptsOf(u.id)
    check(`${u.firstName} starts clean`, a.attempts === 0 && !a.lockedUntil, a)
  }

  // Somebody fat-fingers a PIN that belongs to nobody, five times.
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '9999' })

  const a1 = await attemptsOf(bud1.id)
  const a2 = await attemptsOf(bud2.id)
  check('a wrong PIN does not count against bud1, who did not type it', a1.attempts === 0 && !a1.lockedUntil, a1)
  check('…nor against bud2', a2.attempts === 0 && !a2.lockedUntil, a2)

  const still1 = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '1111' })
  check('…and bud1 can still sign in at the till', still1.status === 200 && !!still1.json?.accessToken,
    { status: still1.status, error: still1.json?.error })
  const still2 = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '2719' })
  check('…and so can bud2', still2.status === 200 && !!still2.json?.accessToken,
    { status: still2.status, error: still2.json?.error })

  const nobody = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '9999' })
  check('…while a PIN belonging to nobody is still refused', nobody.status === 401, { status: nobody.status })
}

// ══════════ 3 · a PIN identifies one person ═══════════════════════════════════════════════════
console.log('\n══════════ 3 · two budtenders, one PIN ══════════')
{
  const token = (await api('POST', '/api/auth/login', { email: bud1.email, password: PASSWORD })).json?.accessToken
  check('bud1 can sign in with a password to set a PIN', !!token, { hasToken: !!token })
  /**
   * The digits in this block are deliberately arbitrary-looking. (T41)
   *
   * It used to clash on '2222' and then set '3333', and PUT /api/auth/pin now refuses a PIN that is
   * the same digit over and over — so the uniqueness check was passing for the wrong reason: both
   * calls were being refused as WEAK, and the test could no longer tell a clash from a weak PIN.
   * setPin() above writes the hash straight to the row, so it is unaffected and the pin-login
   * assertions keep their own digits.
   */
  const clash = await api('PUT', '/api/auth/pin', { pin: '2719' }, token)   // 2719 is bud2's
  check('a PIN already in use in this shop is refused', clash.status === 400 || clash.status === 409,
    { status: clash.status, body: clash.text?.slice(0, 160) })
  check('…and says why, in terms a manager can act on', /already|in use|different/i.test(JSON.stringify(clash.json)), clash.json)
  const ownPin = await api('PUT', '/api/auth/pin', { pin: '4836' }, token)
  check('…while an unused PIN is accepted', ownPin.status === 200, { status: ownPin.status, body: ownPin.text?.slice(0, 120) })
}

// ══════════ 4 · a code cannot be guessed forever ══════════════════════════════════════════════
console.log('\n══════════ 4 · guessing at the challenge ══════════')
{
  const secret = await enrolTotp(bud2.id)
  const stopped = await api('POST', '/api/auth/login', { email: bud2.email, password: PASSWORD })
  check('bud2 now owes a code too', stopped.json?.mfaRequired === true, { mfaRequired: stopped.json?.mfaRequired })
  const id = stopped.json?.challengeId

  let refusals = 0, lastStatus = 0, lastCode = ''
  for (let i = 0; i < 12; i++) {
    const r = await api('POST', '/api/auth/mfa', { challengeId: id, code: String(100000 + i) })
    lastStatus = r.status; lastCode = r.json?.code
    if (r.status === 401 || r.status === 400) refusals++
  }
  check('every wrong guess is refused', refusals === 12, { refusals })
  check('…and the challenge stops accepting guesses before the tenth',
    lastCode !== 'bad_code', { lastStatus, lastCode })

  // …and once a challenge is burned by too many guesses, the real code must not revive it.
  const real = await api('POST', '/api/auth/mfa', { challengeId: id, code: codeFor(secret) })
  check('…a spent challenge is not revived by the correct code', real.status === 400,
    { status: real.status, code: real.json?.code })

  // The person can always start again — a lockout that cannot be escaped is the other failure.
  const fresh = await api('POST', '/api/auth/login', { email: bud2.email, password: PASSWORD })
  const ok = await api('POST', '/api/auth/mfa', { challengeId: fresh.json?.challengeId, code: codeFor(secret) })
  check('…and a fresh sign-in still works', ok.status === 200 && !!ok.json?.accessToken, { status: ok.status })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
