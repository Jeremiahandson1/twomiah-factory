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

// `ip` is the till's address. The T42 throttle counts PIN misses per shop per ADDRESS — no account is
// locked — so a block that wants a clean counter asks from its own address.
const api = async (method: string, path: string, body?: unknown, token?: string, ip?: string) => {
  const res = await app.request(path, {
    method,
    headers: {
      'content-type': 'application/json',
      // x-test-user is the harness bridge (tests/harness/fixtures/middleware-auth.ts): the REAL
      // middleware still runs when it is absent, so a bearer token is exercised too where it matters.
      ...(token ? (token.includes('.') ? { authorization: 'Bearer ' + token } : { 'x-test-user': token }) : {}),
      ...(ip ? { 'x-forwarded-for': ip } : {}),
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

// ══════════ 5 · T42: a brake, a record, and a refusal that names nobody ═══════════════════════
//
//   "Till PIN security: no per-PIN throttle, no logging of PIN sign-ins (successful or failed), and
//    the 409 'PIN already in use' message reveals which PINs are live, so an insider can guess staff
//    PINs unnoticed."                                                — Dispensary, HIGH
//
// The brake cannot be on the ACCOUNT — claim 2 above is the reason, and it still has to hold after
// this. So it is on the shop + the address + the quarter hour, and these assertions check both
// halves: a guessing run from one till stops, and the OTHER till is untouched by it.
//
// Every address here is its own, so the blocks cannot borrow each other's counter — which is also
// what the fix is for.
console.log('\n══════════ 5 · T42 · the till PIN brake and the security log ══════════')
const secRows = (type: string, ip?: string) => rows(
  ip
    ? sql`SELECT * FROM security_events WHERE event_type = ${type} AND ip_address = ${ip} ORDER BY created_at`
    : sql`SELECT * FROM security_events WHERE event_type = ${type} ORDER BY created_at`,
)
{
  const TILL = '203.0.113.21'
  await setPin(bud1.id, '7403')

  const ok = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '7403' }, undefined, TILL)
  check('a PIN sign-in at the till still works', ok.status === 200 && !!ok.json?.accessToken,
    { status: ok.status, error: ok.json?.error })
  const logged = await secRows('pin_login', TILL)
  check('…and it is LOGGED — this was the only door into the product that left no trace',
    logged.length === 1 && String(logged[0].user_id) === bud1.id, logged.map((r: any) => ({ u: r.user_id, d: r.description })))
  check('…with the person named, and the shop and the address on the row',
    /bud1/i.test(String(logged[0]?.description || '')) && String(logged[0]?.ip_address) === TILL &&
    String(logged[0]?.company_id) === co.id, logged[0])

  const miss = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '8160' }, undefined, TILL)
  check('a PIN belonging to nobody is refused', miss.status === 401, { status: miss.status })
  const missed = await secRows('pin_login_failed', TILL)
  check('…and the miss is logged too, unattributed — the digits matched nobody, so no account owns it',
    missed.length === 1 && missed[0].user_id === null, missed.map((r: any) => ({ u: r.user_id, d: r.description })))
  check('…and the DIGITS SOMEBODY TRIED ARE NOT IN THE LOG — near-misses of a real PIN must not be readable',
    !missed.some((r: any) => /8160/.test(JSON.stringify(r))), missed[0]?.description)
}

{
  // A guessing run from one address. Nine more misses takes this address to ten inside the window.
  const RUN = '198.51.100.44'
  for (let i = 0; i < 10; i++) {
    await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: String(90000 + i) }, undefined, RUN)
  }
  const run = await secRows('pin_login_failed', RUN)
  check('ten misses from one address are all logged', run.length === 10, run.length)

  const stopped = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '90011' }, undefined, RUN)
  check('…and the eleventh is refused with 429, not another "Invalid PIN"',
    stopped.status === 429 && stopped.json?.code === 'pin_throttled', { status: stopped.status, code: stopped.json?.code })
  check('…and the refusal names the door that is still open, so nobody is stranded mid-shift',
    /email/i.test(String(stopped.json?.error || '')) && /password/i.test(String(stopped.json?.error || '')), stopped.json?.error)
  const alarm = await secRows('brute_force_detected', RUN)
  check('…and it raises a critical Security Event the manager can see', alarm.length >= 1 && alarm[0].severity === 'critical',
    alarm.map((r: any) => r.severity))

  // The brake is on the SOURCE. A real PIN from the SAME address is held back…
  const realFromRun = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '7403' }, undefined, RUN)
  check('…a real PIN from that same device is held back while the brake is on',
    realFromRun.status === 429, { status: realFromRun.status })

  // …and NO ACCOUNT IS LOCKED, which is the T57 property this must not break.
  const a1 = await attemptsOf(bud1.id)
  check('…while bud1\'s account is not locked and not counted against — the T57 rule still holds',
    a1.attempts === 0 && !a1.lockedUntil, a1)
  const otherTill = await api('POST', '/api/auth/pin-login', { companyId: co.id, pin: '7403' }, undefined, '203.0.113.99')
  check('…and the till at the other end of the counter signs in perfectly normally',
    otherTill.status === 200 && !!otherTill.json?.accessToken, { status: otherTill.status, error: otherTill.json?.error })
  const pwd = await api('POST', '/api/auth/login', { email: bud1.email, password: PASSWORD }, undefined, RUN)
  check('…and email and password still work from the throttled device', pwd.status === 200 && !!pwd.json?.accessToken,
    { status: pwd.status })
}

{
  // The oracle: setting a PIN that somebody else holds.
  const token = (await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })).json?.accessToken
    // the owner owes a second factor, so sign in through the challenge
  let ownerToken = token
  if (!ownerToken) {
    const st = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
    const devs = await rows(sql`SELECT secret FROM mfa_devices WHERE user_id = ${owner.id} AND type = 'totp'`)
    const fin = await api('POST', '/api/auth/mfa', { challengeId: st.json?.challengeId, code: codeFor(String(devs[0].secret)) })
    ownerToken = fin.json?.accessToken
  }
  check('the owner has a token to set a PIN with', !!ownerToken, { hasToken: !!ownerToken })

  const clash = await api('PUT', '/api/auth/pin', { pin: '7403' }, ownerToken)   // 7403 is bud1's
  check('a PIN another person holds is still refused — a PIN has to point at one person',
    clash.status === 409 && clash.json?.code === 'pin_in_use', { status: clash.status, code: clash.json?.code })
  check('…but the refusal NO LONGER SAYS SOMEBODY ELSE HOLDS IT',
    !/somebody else|someone else|already (uses|in use)/i.test(String(clash.json?.error || '')), clash.json?.error)
  check('…and still tells the person what to do about it',
    /different/i.test(String(clash.json?.error || '')), clash.json?.error)
  const collisions = await secRows('pin_collision')
  check('…and the attempt is logged against the account that made it, so reading the oracle is visible',
    collisions.length >= 1 && String(collisions[collisions.length - 1].user_id) === owner.id,
    collisions.map((r: any) => ({ u: r.user_id, d: r.description })))
  check('…without recording the digits that were tried',
    !collisions.some((r: any) => /7403/.test(JSON.stringify(r))), collisions[0]?.description)

  // Five collisions is as far as it goes, so the oracle cannot be read in bulk.
  for (let i = 0; i < 5; i++) await api('PUT', '/api/auth/pin', { pin: '7403' }, ownerToken)
  const bulk = await api('PUT', '/api/auth/pin', { pin: '7403' }, ownerToken)
  check('…and a run of them stops with 429 rather than answering again',
    bulk.status === 429 && bulk.json?.code === 'pin_throttled', { status: bulk.status, code: bulk.json?.code })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
