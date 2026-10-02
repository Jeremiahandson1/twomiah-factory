// crm-dispensary — T49 H4: two-factor was never asked for at sign-in.
//
// The product had the whole of MFA except the part that matters: enrolment screens, an authenticator
// secret, SMS codes, recovery codes, and a "Require MFA for all users" policy switch — and
// POST /api/auth/login handed out tokens for an email and a password, every time. An owner who
// turned two-factor on believed the account holding the tax filings, the payroll rates and the
// compliance records was protected by it. It was protected by the password alone. A security control
// that reports itself as on while doing nothing is worse than not having it, because the owner stops
// worrying about the password.
//
// It also meant the brief's recovery-code test could not be run: the codes existed and nothing
// accepted them.
//
// ── the part this file exists to protect ────────────────────────────────────────────────────────
//
// The failure mode of getting this wrong is locking every user out of a live shop, so the FIRST
// assertions here are the ones that say sign-in still works. The rule is "is there a factor that can
// be PRESENTED", not "is MFA configured":
//
//   nothing enrolled                → straight in
//   backup codes ALONE              → straight in. Recovery codes are recovery FOR a factor, not a
//                                     factor; nobody carries them. This is the state the real owner
//                                     account is in, and challenging it would have locked them out
//                                     of their own shop the moment this deployed.
//   a verified authenticator        → challenged
//   policy on, nothing enrolled     → straight in, and told to enrol. Switching a policy on must not
//                                     lock out the people it applies to before they can enrol.
import { Hono } from 'hono'
import { sql, eq } from 'drizzle-orm'
import crypto from 'crypto'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user } from './db/schema.ts'
import { generateTOTPCode, base32Encode } from './src/shared/index.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

// This is the only suite that signs in for real, so it is the only one that needs a signing key.
// generateTokens() reads these at call time; without them every token-minting path 500s with
// "secretOrPrivateKey must have a value" — which is the environment, not the code.
process.env.JWT_SECRET ||= 'test-jwt-secret-not-a-real-one'
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-not-a-real-one'

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-t49mfa', email: 'mfa@test.local', state: 'OH',
} as any).returning()

const PASSWORD = 'TestPass123!'
const hash = await Bun.password.hash(PASSWORD)
const mkUser = async (tag: string, role = 'owner') => (await db.insert(user).values({
  email: `${tag}@test.local`, passwordHash: hash, firstName: tag, lastName: 'U', role, companyId: co.id, isActive: true,
} as any).returning())[0]

const app = new Hono()
app.route('/api/auth', (await import('./src/routes/auth.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const post = async (path: string, body: unknown) => {
  const res = await app.request(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const login = (email: string, password = PASSWORD) => post('/api/auth/login', { email, password })
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

// ══════════ nobody gets locked out ══════════════════════════════════════════════════════════════
{
  const plain = await mkUser('plain')
  const r = await login(plain.email)
  check('H4: an account with nothing enrolled signs in as before', r.status === 200 && !!r.json?.accessToken,
    { status: r.status, mfaRequired: r.json?.mfaRequired })
  check('H4: …and is not asked for a code', !r.json?.mfaRequired, r.json?.mfaRequired)
  check('H4: …and gets the usual payload', !!r.json?.user?.id && !!r.json?.company?.id && Array.isArray(r.json?.permissions), Object.keys(r.json || {}))
}

// Backup codes alone — the state the real owner account is in. This is the assertion that would
// have caught locking them out.
let recoveryUser: any
const RECOVERY_CODES = ['AAAA1111', 'BBBB2222']
{
  recoveryUser = await mkUser('recovery')
  await db.execute(sql`
    INSERT INTO mfa_devices (id, company_id, user_id, type, backup_codes, is_verified, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${recoveryUser.id}, 'backup_codes',
      ${JSON.stringify(RECOVERY_CODES.map((c) => crypto.createHash('sha256').update(c).digest('hex')))}::jsonb, true, NOW())
  `)
  const r = await login(recoveryUser.email)
  check('H4: recovery codes ALONE do not challenge — nobody carries them', r.status === 200 && !!r.json?.accessToken,
    { status: r.status, mfaRequired: r.json?.mfaRequired, body: r.json?.error })
}

// ══════════ a real factor IS challenged ═════════════════════════════════════════════════════════
let totpUser: any
let secret = ''
{
  totpUser = await mkUser('totp')
  secret = base32Encode(crypto.randomBytes(20))
  await db.execute(sql`
    INSERT INTO mfa_devices (id, company_id, user_id, type, secret, is_verified, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${totpUser.id}, 'totp', ${secret}, true, NOW())
  `)
  // …and recovery codes too, like a real enrolment.
  await db.execute(sql`
    INSERT INTO mfa_devices (id, company_id, user_id, type, backup_codes, is_verified, created_at)
    VALUES (gen_random_uuid(), ${co.id}, ${totpUser.id}, 'backup_codes',
      ${JSON.stringify(RECOVERY_CODES.map((c) => crypto.createHash('sha256').update(c).digest('hex')))}::jsonb, true, NOW())
  `)

  const r = await login(totpUser.email)
  check('H4: an enrolled authenticator IS challenged', r.json?.mfaRequired === true, { status: r.status, body: r.json })
  check('H4: …and NO tokens come back with the challenge', !r.json?.accessToken && !r.json?.refreshToken, Object.keys(r.json || {}))
  check('H4: …nor anything about the account beyond finishing sign-in', !r.json?.user && !r.json?.permissions, Object.keys(r.json || {}))
  check('H4: …the screen is told which factors to offer', Array.isArray(r.json?.methods) && r.json.methods.includes('totp'), r.json?.methods)
  check('H4: …and that a recovery code would work', r.json?.recoveryCodesAvailable === true, r.json?.recoveryCodesAvailable)
  check('H4: …with a challenge id to answer', typeof r.json?.challengeId === 'string' && r.json.challengeId.length > 10, r.json?.challengeId)

  const wrongPw = await login(totpUser.email, 'not-the-password')
  check('H4: a wrong password is still refused BEFORE any challenge exists', wrongPw.status === 401 && !wrongPw.json?.challengeId,
    { status: wrongPw.status, body: wrongPw.json })
}

// ══════════ the code step ═══════════════════════════════════════════════════════════════════════
{
  const started = await login(totpUser.email)
  const challengeId = started.json?.challengeId

  const bad = await post('/api/auth/mfa', { challengeId, code: '000000' })
  check('H4: a wrong code is refused', bad.status === 401 && bad.json?.code === 'bad_code', { status: bad.status, body: bad.json })
  check('H4: …and still no tokens', !bad.json?.accessToken, Object.keys(bad.json || {}))

  const step = Math.floor(Math.floor(Date.now() / 1000) / 30)
  const good = await post('/api/auth/mfa', { challengeId, code: generateTOTPCode(secret, step) })
  check('H4: the right authenticator code signs in', good.status === 200 && !!good.json?.accessToken, { status: good.status, body: good.json?.error })
  check('H4: …and returns the SAME payload the password step would have',
    !!good.json?.user?.id && !!good.json?.company?.id && Array.isArray(good.json?.permissions) && !!good.json?.refreshToken,
    Object.keys(good.json || {}))

  // Single use: the challenge is spent.
  const replay = await post('/api/auth/mfa', { challengeId, code: generateTOTPCode(secret, step) })
  check('H4: a spent challenge cannot be replayed', replay.status === 400 && replay.json?.code === 'challenge_not_found',
    { status: replay.status, body: replay.json })
}

// ══════════ recovery codes — the brief's test, which had nowhere to run ═════════════════════════
{
  const started = await login(totpUser.email)
  const challengeId = started.json?.challengeId

  const used = await post('/api/auth/mfa', { challengeId, code: RECOVERY_CODES[0] })
  check('H4: a recovery code is ACCEPTED — this is what nothing could do before', used.status === 200 && !!used.json?.accessToken,
    { status: used.status, body: used.json?.error })
  check('H4: …and says so, because it is worth noticing', used.json?.usedRecoveryCode === true, used.json?.usedRecoveryCode)

  // …and is burned. The brief asked for exactly this and there was nowhere to type one.
  const again = await login(totpUser.email)
  const reuse = await post('/api/auth/mfa', { challengeId: again.json?.challengeId, code: RECOVERY_CODES[0] })
  check('H4: the same recovery code is refused the second time', reuse.status === 401 && reuse.json?.code === 'bad_code',
    { status: reuse.status, body: reuse.json })

  const third = await login(totpUser.email)
  const other = await post('/api/auth/mfa', { challengeId: third.json?.challengeId, code: RECOVERY_CODES[1] })
  check('H4: …while an unused one still works', other.status === 200 && !!other.json?.accessToken, { status: other.status, body: other.json?.error })

  const [dev] = await rows(sql`SELECT backup_codes FROM mfa_devices WHERE user_id = ${totpUser.id} AND type = 'backup_codes'`)
  const left = Array.isArray(dev?.backup_codes) ? dev.backup_codes : JSON.parse(dev?.backup_codes || '[]')
  check('H4: …and both spent codes are gone from the account', left.length === 0, left.length)
}

// ══════════ a policy that requires MFA must not bar the door ════════════════════════════════════
{
  await db.update(company).set({ settings: { requireMfa: true } } as any).where(eq(company.id, co.id))
  const bare = await mkUser('policy')
  const r = await login(bare.email)
  check('H4: a policy requiring MFA does not lock out someone who has not enrolled yet',
    r.status === 200 && !!r.json?.accessToken, { status: r.status, body: r.json })
  check('H4: …but it does say an enrolment is owed', r.json?.mfaEnrolmentRequired === true, r.json?.mfaEnrolmentRequired)

  // …and someone WITH a factor is still challenged under the same policy.
  const stillChallenged = await login(totpUser.email)
  check('H4: …while an enrolled account is still challenged', stillChallenged.json?.mfaRequired === true, stillChallenged.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
