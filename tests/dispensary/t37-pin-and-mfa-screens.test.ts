// The dispensary's PIN and two-factor had no screens, and three things were missing to build them. (T37)
//
// Both features were live on the server and unreachable by a person:
//
//   TWO-FACTOR was BUILT here — mfa_devices and mfa_challenges have been in this schema since before
//   the engine moved into shared auth, /login asks the gate, and /pin-login opens the same challenge.
//   The enrolment routes went to shared and were only ever mounted in crm, and this template renders
//   its own SettingsPage so it did not inherit the shared Two-Factor card either. An owner could be
//   asked for a code they had no way to set up.
//
//   THE PIN had PUT /api/auth/pin and POST /api/auth/pin-login live and validating on every
//   dispensary tenant, with nothing in the frontend mentioning a PIN. So the uniqueness rule, the
//   lockout rules and the "a failed PIN increments nobody" fix from T57 could not be reached at all.
//
// THREE SERVER GAPS A SCREEN NEEDED, each asserted below:
//
//   1. GET /me never said whether a PIN was set. A PIN cannot be read back (bcrypt), so a screen
//      could not tell "set a PIN" from "change your PIN". Now `user.pinSet`.
//   2. There was no way to REMOVE a PIN — it could be set and changed for ever. A budtender
//      finishing a shift on a shared till had no way to take their own quick sign-in off it.
//   3. /pin-login REQUIRED companyId, and a sign-in screen has no way to know it: the id is a cuid
//      the database generates at seed time, so it is not a build-time placeholder, and the only
//      public endpoint carrying it is the customer menu. That requirement is the reason the PIN had
//      endpoints and no screen. It is now optional, resolved only when the table holds exactly one
//      company — read, not assumed.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

// The product mints tokens with process.env.JWT_SECRET; unset in a sandbox every success path 500s
// and an assertion about refusal passes for the wrong reason. (T57, learned the hard way)
process.env.JWT_SECRET ||= 'sandbox-jwt-secret-t37-disp'
process.env.JWT_REFRESH_SECRET ||= 'sandbox-jwt-refresh-secret-t37-disp'

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
  name: 'Leaf & Co', slug: 'leaf-co-pinmfa', email: 'leaf@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()

const PASSWORD = 'CounterTop123!'
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@leaf.local`, passwordHash: await Bun.password.hash(PASSWORD, 'bcrypt'),
  firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const bud = await mkUser('user', 'bud')

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.route('/api/auth/mfa-devices', (await import('./src/routes/mfa.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown, who?: any) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', ...(who ? { 'x-test-user': who.id } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const codeFor = (secret: string) => generateTOTPCode(secret, Math.floor(Math.floor(Date.now() / 1000) / 30))

// ══════════ 1 · /me tells a screen whether a PIN is set ══════════════════════════════════════
console.log('\n══════════ the PIN screen can read its own state ══════════')
{
  const me = await api('GET', '/api/auth/me', undefined, bud)
  check('/me answers', me.status === 200, { status: me.status })
  check('…and says pinSet: false before one is chosen', me.json?.user?.pinSet === false, { pinSet: me.json?.user?.pinSet })
  check('…and never carries the hash itself', !/pinHash|pin_hash/.test(me.text), me.text?.slice(0, 160))
}

// ══════════ 2 · set, change, and the uniqueness rule the till depends on ═════════════════════
console.log('\n══════════ setting a PIN ══════════')
{
  const short = await api('PUT', '/api/auth/pin', { pin: '12' }, bud)
  check('three digits or fewer is refused', short.status >= 400, { status: short.status })

  const set = await api('PUT', '/api/auth/pin', { pin: '4821' }, bud)
  check('a budtender can set a PIN', set.status === 200, { status: set.status, body: set.text?.slice(0, 160) })
  check('…and the response says it is set, so the screen need not re-fetch', set.json?.pinSet === true, set.json)

  const me = await api('GET', '/api/auth/me', undefined, bud)
  check('…and /me now says pinSet: true', me.json?.user?.pinSet === true, { pinSet: me.json?.user?.pinSet })

  // The rule that makes a PIN attributable: a sale has to point at one person.
  const clash = await api('PUT', '/api/auth/pin', { pin: '4821' }, owner)
  check('a SECOND person cannot take the same PIN', clash.status === 409 && clash.json?.code === 'pin_in_use',
    { status: clash.status, code: clash.json?.code })
  check('…and the refusal explains the till, which is why the screen shows it verbatim',
    /already uses that PIN/i.test(String(clash.json?.error)) && /who rang a sale/i.test(String(clash.json?.error)),
    clash.json?.error)

  const own = await api('PUT', '/api/auth/pin', { pin: '4821' }, bud)
  check('…but the same person may re-save their own PIN', own.status === 200, { status: own.status })
}

// ══════════ 3 · signing in with it, WITHOUT a companyId ══════════════════════════════════════
console.log('\n══════════ the counter signs in ══════════')
{
  // THE ASSERTION THE SCREEN EXISTS FOR. A sign-in page cannot know the company id.
  const ok = await api('POST', '/api/auth/pin-login', { pin: '4821' })
  check('a PIN alone signs in — no companyId, which a login screen cannot know',
    ok.status === 200 && !!ok.json?.accessToken, { status: ok.status, body: ok.text?.slice(0, 180) })
  check('…as the right person', ok.json?.user?.id === bud.id, { got: ok.json?.user?.email })

  // The old contract still works, so nothing that already sent it breaks.
  const explicit = await api('POST', '/api/auth/pin-login', { pin: '4821', companyId: co.id })
  check('…and an explicit companyId still works', explicit.status === 200 && !!explicit.json?.accessToken, { status: explicit.status })

  const wrong = await api('POST', '/api/auth/pin-login', { pin: '9999' })
  check('a PIN belonging to nobody is refused', wrong.status >= 400 && !wrong.json?.accessToken, { status: wrong.status })

  /**
   * A SECOND COMPANY ROW MUST NOT BREAK THE TILL. (T37)
   *
   * My first version of the resolution required EXACTLY one company and refused otherwise. It
   * passed every test here — the sandbox has one — and then disptest answered "This server holds
   * more than one shop", because the live tenant carries a second row from an old round. That is
   * the identical wrong turn routes/menu.ts took and corrected: a tenant database is one shop, a
   * second row is QA debris, and the seeded shop is the OLDEST. This fixture reproduces the live
   * tenant rather than the clean sandbox, so the too-strict version cannot come back green.
   */
  const [debris] = await db.insert(company).values({
    name: 'QA debris', slug: 'qa-debris-second-row', email: 'debris@test.local', state: 'OH',
    settings: {}, enabledFeatures: [],
  } as any).returning()
  const withDebris = await api('POST', '/api/auth/pin-login', { pin: '4821' })
  check('a bare PIN still signs in when a SECOND company row exists — the oldest is the shop',
    withDebris.status === 200 && !!withDebris.json?.accessToken, { status: withDebris.status, body: withDebris.text?.slice(0, 180) })
  check('…and it is still the right person', withDebris.json?.user?.id === bud.id, { got: withDebris.json?.user?.email })
  await db.execute(sql`DELETE FROM company WHERE id = ${debris.id}`)

  // T57: a failed PIN must increment NOBODY — the digits matched no one, so there is no counter to
  // move, and five wrong taps used to lock every budtender out of quick login.
  for (let i = 0; i < 5; i++) await api('POST', '/api/auth/pin-login', { pin: '9999' })
  const rows: any = await db.execute(sql`SELECT email, pin_attempts, pin_locked_until FROM "user" WHERE company_id = ${co.id} ORDER BY email`)
  const r = ((rows as any).rows || rows)
  check('five wrong taps lock nobody out — a failed PIN is unattributable',
    r.every((x: any) => Number(x.pin_attempts ?? 0) === 0 && !x.pin_locked_until), r)
  const still = await api('POST', '/api/auth/pin-login', { pin: '4821' })
  check('…and the real PIN still works afterwards', still.status === 200 && !!still.json?.accessToken, { status: still.status })
}

// ══════════ 4 · turning quick sign-in off ════════════════════════════════════════════════════
console.log('\n══════════ removing a PIN ══════════')
{
  const gone = await api('DELETE', '/api/auth/pin', undefined, bud)
  check('a budtender can turn their own quick sign-in off', gone.status === 200 && gone.json?.pinSet === false,
    { status: gone.status, body: gone.text?.slice(0, 160) })

  const me = await api('GET', '/api/auth/me', undefined, bud)
  check('…/me says pinSet: false again', me.json?.user?.pinSet === false, { pinSet: me.json?.user?.pinSet })

  const after = await api('POST', '/api/auth/pin-login', { pin: '4821' })
  check('…and those digits no longer sign anybody in', after.status >= 400 && !after.json?.accessToken,
    { status: after.status, body: after.text?.slice(0, 140) })

  const twice = await api('DELETE', '/api/auth/pin', undefined, bud)
  check('removing a PIN that is not there says so rather than pretending', twice.status === 400 && twice.json?.code === 'no_pin',
    { status: twice.status, code: twice.json?.code })

  // The password is untouched by any of this.
  const pw = await api('POST', '/api/auth/login', { email: bud.email, password: PASSWORD })
  check('the password still signs in', pw.status === 200 && !!pw.json?.accessToken, { status: pw.status })
}

// ══════════ 5 · two-factor enrolment, finally reachable on the dispensary ═════════════════════
console.log('\n══════════ two-factor, on the vertical where it was built ══════════')
{
  const list = await api('GET', '/api/auth/mfa-devices/devices', undefined, owner)
  check('GET /api/auth/mfa-devices/devices is MOUNTED (it answered 404 on disptest)', list.status === 200,
    { status: list.status, body: list.text?.slice(0, 160) })

  const setup = await api('POST', '/api/auth/mfa-devices/setup', {}, owner)
  check('setup hands over a seed and a device id', setup.status === 201 && !!setup.json?.secret, { status: setup.status })
  const deviceId = setup.json?.deviceId, secret = setup.json?.secret
  check("…labelled for the dispensary, not 'Twomiah Contractor'",
    String(setup.json?.otpauthUrl || '').includes('Twomiah%20Dispensary'), setup.json?.otpauthUrl)

  const done = await api('POST', '/api/auth/mfa-devices/verify', { deviceId, code: codeFor(secret) }, owner)
  check('a real code finishes enrolment', done.status === 200 && done.json?.active === true, { status: done.status })

  const stopped = await api('POST', '/api/auth/login', { email: owner.email, password: PASSWORD })
  check('NOW the password alone does not sign the owner in', stopped.json?.mfaRequired === true && !stopped.json?.accessToken,
    { mfaRequired: stopped.json?.mfaRequired })

  const finished = await api('POST', '/api/auth/mfa', { challengeId: stopped.json?.challengeId, code: codeFor(secret) })
  check('…and the code completes it', finished.status === 200 && !!finished.json?.accessToken, { status: finished.status })
}

// ══════════ 6 · a PIN is not a way around a second factor ════════════════════════════════════
//
// The point of the whole design: /pin-login asks the same gate and opens the same challenge. If a
// PIN could skip two-factor it would be a hole, not a convenience.
console.log('\n══════════ the PIN does not bypass two-factor ══════════')
{
  await api('PUT', '/api/auth/pin', { pin: '7731' }, owner)
  const viaPin = await api('POST', '/api/auth/pin-login', { pin: '7731' })
  check('the owner has two-factor on, so a PIN sign-in ALSO stops for a code',
    viaPin.status === 200 && viaPin.json?.mfaRequired === true && !viaPin.json?.accessToken,
    { status: viaPin.status, mfaRequired: viaPin.json?.mfaRequired, hasToken: !!viaPin.json?.accessToken })
  check('…and it opens a real challenge the same code step can finish', !!viaPin.json?.challengeId, viaPin.json?.challengeId ? 'present' : viaPin.text?.slice(0, 160))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
