import { Hono } from 'hono'

import jwt from 'jsonwebtoken'
import { z } from 'zod'
import crypto from 'crypto'
const uuidv4 = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
// `asc` is for resolving which shop a bare PIN belongs to — the oldest company row, matching
// routes/menu.ts's resolveSlug. See POST /pin-login. (T37)
import { eq, and, gt, asc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { storeTimeZone, storeDateString } from '../utils/isoTime.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'
import { callerIp, recordSecurityEvent } from '../utils/securityEvents.ts'
import { passwordSchema } from '../shared/index.ts'
import { sql } from 'drizzle-orm'  // for the security_events row the code step writes
// Two-factor at sign-in. The gate answers "is there a factor to ask for", which is not the same
// question as "is MFA configured" — see shared auth/mfa.ts. (T49 H4)
import { mfaGateFor, openLoginChallenge, verifyLoginChallenge } from '../shared/index.ts'

/**
 * One place that writes a security_events row, so every credential change is logged the same way.
 *
 * T41: "PIN changes, 2FA setup and logins are not audited." The sign-in code step already wrote one
 * of these inline; this is that same INSERT, named, so the PIN and enrolment paths can use it too
 * without each growing its own copy.
 *
 * Never throws: an audit write that fails must not take the operation down with it. A credential
 * change that succeeded and went unlogged is bad; one that is rolled back because the log was
 * unavailable is worse.
 */
// callerIp and the security-event writer moved to utils/securityEvents.ts, which is now the only
// place that INSERTs into security_events. There were NINE copies of that statement and none of them
// stored the user agent. (T51 follow-up — see the file for why.)

/**
 * THE TILL PIN HAD NO BRAKE AND NO RECORD. (T42, dispensary HIGH)
 *
 *   "Till PIN security: no per-PIN throttle, no logging of PIN sign-ins (successful or failed), and
 *    the 409 'PIN already in use' message reveals which PINs are live, so an insider can guess staff
 *    PINs unnoticed."
 *
 * THE BRAKE HAS TO BE SOMEWHERE OTHER THAN THE ACCOUNT, and that is what made this awkward. T57
 * removed per-user counting on a miss, for a good reason that still holds: a failed PIN is
 * UNATTRIBUTABLE — four digits that matched nobody name no account — so counting the miss against
 * every PIN-holder let five anonymous requests lock the whole counter out of quick sign-in. The old
 * comment pointed at "the rate limiter on this route (index.ts)", which is a generic write limit
 * measured in the hundreds: no help against somebody standing at a till trying 1234, 1111, 2580.
 *
 * So the brake is on the SOURCE: this company, this address, this quarter hour. Nobody's account
 * locks, the email-and-password door stays open and is named in the refusal, and a guessing run stops
 * after ten misses.
 *
 * COUNTED OUT OF security_events, not out of a Map in memory. A per-process counter resets on every
 * deploy and every restart — and each tenant runs its own small instance, so "restart to clear the
 * brake" would be a feature of the hosting. The log is the record the shop can also READ: the
 * failures appear on the Security Events screen, which is the second half of this finding.
 *
 * The threshold is deliberately well clear of a fumble. A budtender mis-taps two or three times; ten
 * misses from one address inside fifteen minutes is somebody trying PINs.
 */
const PIN_FAIL_WINDOW_MINUTES = 15
const PIN_FAIL_LIMIT = 10
const PIN_COLLISION_LIMIT = 5

/** How many PIN misses this address has made at this shop inside the window. */
async function recentPinFailures(companyId: string, ip: string): Promise<number> {
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM security_events
      WHERE company_id = ${companyId}
        AND event_type = 'pin_login_failed'
        AND ip_address = ${ip}
        AND created_at > NOW() - (${PIN_FAIL_WINDOW_MINUTES} || ' minutes')::interval
    `)
    return Number((r.rows || r)[0]?.n || 0)
  } catch {
    // A counter that cannot be read must not shut the till. Fail open and let the miss be logged.
    return 0
  }
}

/** The same question for PIN COLLISIONS, which are how a PIN could be enumerated. */
async function recentPinCollisions(companyId: string, userId: string): Promise<number> {
  try {
    const r: any = await db.execute(sql`
      SELECT COUNT(*)::int AS n FROM security_events
      WHERE company_id = ${companyId}
        AND event_type = 'pin_collision'
        AND user_id = ${userId}
        AND created_at > NOW() - (${PIN_FAIL_WINDOW_MINUTES} || ' minutes')::interval
    `)
    return Number((r.rows || r)[0]?.n || 0)
  } catch {
    return 0
  }
}

const app = new Hono()

const generateTokens = (userId: string, companyId: string, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh', jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// Multi-device sessions. user.refresh_token used to hold ONE token, overwritten on every login —
// so signing in on a second device (or a second browser tab logging in, or an API script
// logging in as the same account) silently invalidated the first device's refresh token, and
// 15 minutes later that device was thrown to the login screen mid-shift (go-live QA M-4).
// The column now holds a JSON array of the user's live refresh tokens (newest last, capped),
// which also lets logout revoke only the device that logged out.
const MAX_SESSIONS_PER_USER = 10
const parseTokenList = (raw: string | null | undefined): string[] => {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [raw] } catch { return [raw] }
}
const stillValid = (token: string) => { try { jwt.verify(token, process.env.JWT_REFRESH_SECRET!); return true } catch { return false } }
async function storeRefreshToken(userId: string, token: string, extra: Record<string, any> = {}) {
  const [row] = await db.select({ refreshToken: user.refreshToken }).from(user).where(eq(user.id, userId)).limit(1)
  const live = parseTokenList(row?.refreshToken).filter((t) => t !== token && stillValid(t))
  const next = [...live, token].slice(-MAX_SESSIONS_PER_USER)
  await db.update(user).set({ refreshToken: JSON.stringify(next), updatedAt: new Date(), ...extra } as any).where(eq(user.id, userId))
}
async function revokeRefreshToken(userId: string, token: string | null | undefined) {
  if (!token) { await db.update(user).set({ refreshToken: null, updatedAt: new Date() }).where(eq(user.id, userId)); return }
  const [row] = await db.select({ refreshToken: user.refreshToken }).from(user).where(eq(user.id, userId)).limit(1)
  const next = parseTokenList(row?.refreshToken).filter((t) => t !== token && stillValid(t))
  await db.update(user).set({ refreshToken: next.length ? JSON.stringify(next) : null, updatedAt: new Date() }).where(eq(user.id, userId))
}

app.post('/signup', async (c) => {
  // SECURITY: self-serve signup is DISABLED. A tenant is ONE company, provisioned by the Twomiah
  // Factory; this route used to create a second company + owner login in the same database with no
  // auth. Kept as a 403 stub for any old caller (same as /register).
  return c.json({ error: 'Self-serve signup is disabled. Accounts are provisioned by Twomiah.' }, 403)
})

// Legacy register endpoint (keep for backwards compatibility)
app.post('/register', async (c) => {
  // SECURITY: public self-registration is DISABLED on deployed single-tenant
  // CRMs. This legacy endpoint created a brand-new company + owner account
  // with NO auth, invite, or rate limit. Users are added by an admin via
  // Settings -> Users. Kept as a 403 stub for any old caller.
  return c.json({ error: 'Public registration is disabled' }, 403)
})

// Login
app.post('/login', async (c) => {
  const loginSchema = z.object({ email: z.string().email(), password: z.string() })
  const loginBody = await c.req.json()
  if (loginBody.email && typeof loginBody.email === 'string') loginBody.email = loginBody.email.toLowerCase().trim()
  const data = loginSchema.parse(loginBody)

  const normalizedEmail = data.email

  const [foundUser] = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1)

  if (!foundUser) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }
  if (!foundUser.isActive) {
    return c.json({ error: 'Account is disabled' }, 401)
  }

  // Per-account lockout: 10 consecutive failures → 15-minute lock. The per-IP limiter alone never
  // stopped a run that rotates addresses (37 attempts sailed through in QA). Same message for a
  // locked account whether or not the password is right, so the lock leaks nothing. (SALON-H5)
  const LOCK_AFTER = 10, LOCK_MS = 15 * 60 * 1000
  const lockedUntilMs = (foundUser as any).lockedUntil ? new Date((foundUser as any).lockedUntil).getTime() : 0
  if (lockedUntilMs > Date.now()) {
    const mins = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000))
    return c.json({ error: `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, 423)
  }
  const valid = await Bun.password.verify(data.password, foundUser.passwordHash)

  if (!valid) {
    const fails = (Number((foundUser as any).failedLoginCount) || 0) + 1
    const lock = fails >= LOCK_AFTER
    await db.update(user).set({ failedLoginCount: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null } as any).where(eq(user.id, foundUser.id))
    return c.json({ error: lock ? 'Too many failed sign-in attempts. Try again in 15 minutes.' : 'Invalid email or password' }, lock ? 423 : 401)
  }
  if ((Number((foundUser as any).failedLoginCount) || 0) > 0 || lockedUntilMs) await db.update(user).set({ failedLoginCount: 0, lockedUntil: null } as any).where(eq(user.id, foundUser.id))

  // Fetch company separately
  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // ── the password was right; is there a second factor to ask for? ─────────────────────────────
  //
  // T49 H4: there never was a question here. The product had enrolment screens, an authenticator
  // secret, SMS codes, recovery codes and a "Require MFA for all users" switch, and this route
  // handed out tokens for an email and a password every time. An owner who turned two-factor on
  // believed the account holding the tax filings, the payroll rates and the compliance records was
  // protected by it; it was protected by the password alone.
  //
  // mfaGateFor() asks whether a factor can actually be PRESENTED, not whether MFA is configured —
  // see shared auth/mfa.ts for why that distinction is the difference between a working shop and
  // a locked-out one.
  const gate = await mfaGateFor(db, foundUser.companyId, foundUser.id)
  if (gate.required) {
    const { challengeId, expiresAt } = await openLoginChallenge(db, foundUser.companyId, foundUser.id)
    // No tokens. Nothing about the account beyond what is needed to finish signing in.
    return c.json({
      mfaRequired: true,
      challengeId,
      expiresAt,
      methods: gate.methods,
      recoveryCodesAvailable: gate.hasRecoveryCodes,
      message: 'Enter the code from your authenticator app to finish signing in.',
    }, 200)
  }

  // The tokens are minted inside signedInPayload, which both this step and the code step call —
  // issuing them here as well would store two refresh tokens for one sign-in.

  return c.json(await signedInPayload(foundUser, foundCompany, gate))
})

/**
 * Finish a sign-in that stopped for a code.
 *
 * PUBLIC on purpose: the caller has no token yet — that is the whole point of being here. What
 * stands in for authentication is the challenge id, which is single-use, expires in ten minutes,
 * and was created only after a correct password. (T49 H4)
 *
 * Recovery codes are accepted here and burned on use. The brief asked for "an old code refused, a
 * new code accepted once, the same code refused the second time" and there was nowhere to type one;
 * this is that place.
 */
app.post('/mfa', async (c) => {
  const schema = z.object({ challengeId: z.string().min(1), code: z.string().min(1) })
  const parsed = schema.safeParse(await c.req.json().catch(() => ({})))
  if (!parsed.success) {
    return c.json({ error: 'Send the challenge id and the code from your authenticator or a recovery code.', code: 'code_required' }, 400)
  }

  const outcome = await verifyLoginChallenge(db, parsed.data.challengeId, parsed.data.code)
  if (!outcome.ok) {
    // 401 for a wrong code, 400 for a request that can no longer be completed — a screen shows the
    // first in the code field and sends the reader back to the start for the second.
    return c.json({ error: outcome.error, code: outcome.code }, outcome.code === 'bad_code' ? 401 : 400)
  }

  const [mfaUser] = await db.select().from(user).where(eq(user.id, outcome.userId)).limit(1)
  if (!mfaUser || !mfaUser.isActive) return c.json({ error: 'Account is disabled' }, 401)
  const [mfaCompany] = await db.select().from(company).where(eq(company.id, mfaUser.companyId)).limit(1)
  if (!mfaCompany) return c.json({ error: 'Company not found' }, 404)

  // A recovery code being spent is a security event: it means the authenticator was not to hand,
  // and it is the thing an owner wants to see if it happens and they did not do it.
  // Through the one writer, so this event carries the user agent and a parsed ip like the rest.
  // recordSecurityEvent swallows its own failures — a sign-in is never failed for want of an event
  // row. (T51 follow-up)
  await recordSecurityEvent(
    c, mfaUser.companyId, mfaUser.id,
    outcome.usedRecoveryCode ? 'mfa_recovery_code_used' : 'mfa_login_verified',
    outcome.usedRecoveryCode ? 'warning' : 'info',
    outcome.usedRecoveryCode ? 'Signed in with a recovery code' : 'Signed in with two-factor',
  )

  const gate = await mfaGateFor(db, mfaUser.companyId, mfaUser.id)
  return c.json({ ...(await signedInPayload(mfaUser, mfaCompany, gate)), usedRecoveryCode: outcome.usedRecoveryCode })
})

/**
 * Everything a client needs on a successful sign-in — built in ONE place so the password step and
 * the code step cannot answer with two different shapes. A second-step response that is subtly
 * different from the first is how a login flow half-works.
 */
async function signedInPayload(foundUser: any, foundCompany: any, gate?: { enrolmentRequired: boolean }) {
  // Same list /me returns, so a screen can ask "may this person do X" from the moment they sign in
  // rather than rendering editable fields and a Save button that the API will refuse. (T42 L1-L3)
  const { getPermissions: getPerms, getExtraPermissions: getExtra } = await import('../middleware/permissions.ts')
  const permissions = await effectivePermissions(getPerms, getExtra, foundUser.id, foundUser.role)
  const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
  await storeRefreshToken(foundUser.id, tokens.refreshToken, { lastLogin: new Date() })

  return {
    permissions,
    // The policy wants a second factor and this person has enrolled none. Reported so a screen can
    // insist; it does NOT bar the door, because switching a policy on must not lock out the people
    // it applies to before they have had a chance to enrol. (T49 H4)
    ...(gate?.enrolmentRequired ? { mfaEnrolmentRequired: true } : {}),
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, role: foundUser.role, avatar: foundUser.avatar },
    company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, logo: foundCompany.logo, primaryColor: foundCompany.primaryColor, enabledFeatures: foundCompany.enabledFeatures, settings: foundCompany.settings, phone: foundCompany.phone, email: foundCompany.email, address: foundCompany.address, city: foundCompany.city, state: foundCompany.state, zip: foundCompany.zip, website: foundCompany.website, taxRate: (foundCompany as any).taxRate, localTaxRate: (foundCompany as any).localTaxRate, exciseTaxRate: (foundCompany as any).exciseTaxRate, purchaseLimitOz: (foundCompany as any).purchaseLimitOz, visionUrl: process.env.VISION_URL || null, vertical: 'dispensary',
      // The store's own clock, so no screen has to guess the shop's date from the viewer's laptop.
      // A manager in Central looking at an Ohio store at 23:10 asked Analytics for "2026-09-27"
      // while the till, the compliance report and the server had already rolled to the 28th —
      // Today showed $0.00 against a dashboard reading $718.75. (T42 M1)
      timeZone: storeTimeZone(foundCompany),
      today: storeDateString(new Date(), storeTimeZone(foundCompany)) },
    ...tokens,
  }
}

// PIN Login (for POS quick-login — budtenders switch fast without full email/password)
app.post('/pin-login', async (c) => {
  /**
   * `companyId` is OPTIONAL, and that is what makes a PIN screen possible. (T37)
   *
   * It was required, and a sign-in screen has no way to know it: the id is a cuid the database
   * generates at seed time, so it is not a build-time placeholder the generator can substitute, and
   * the only public endpoint carrying it is the customer menu — which a till should not have to
   * depend on to let a budtender tap in. That is why the PIN had endpoints and no screen.
   *
   * WHICH SHOP: THE OLDEST ROW, not "the only row".
   *
   * My first version of this required exactly one company and refused otherwise — and disptest
   * answered "This server holds more than one shop", because it carries a second company row. That
   * is the same wrong turn routes/menu.ts already took and already corrected; its `resolveSlug`
   * says so in as many words:
   *
   *     "A tenant database is one dispensary; a second row is QA debris or an enterprise import,
   *      and either way the seeded shop is the oldest. 'Exactly one row' was the first version of
   *      this and it was too strict — the live test tenant carries two, so its own page was still
   *      told 'Company slug is required'."
   *
   * So this follows that rule rather than inventing a second answer to the same question: order by
   * createdAt and take the first. An explicit companyId still wins, so every existing caller is
   * unaffected.
   */
  const pinSchema = z.object({ pin: z.string().min(4).max(8), companyId: z.string().optional() })
  const data = pinSchema.parse(await c.req.json())

  let companyId = data.companyId
  if (!companyId) {
    const [seeded] = await db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    if (!seeded) return c.json({ error: 'This server has no shop set up yet.', code: 'no_company' }, 400)
    companyId = seeded.id
  }

  /**
   * The brake, before any hash is checked. (T42 — see the note beside PIN_FAIL_LIMIT.)
   *
   * It bounds GUESSING and nothing else: it is keyed on the address, no account is locked, and the
   * refusal names the door that is still open. A till that has genuinely been mis-tapped ten times in
   * a quarter of an hour can still be signed into with an email and a password.
   */
  const ip = callerIp(c)
  if (await recentPinFailures(companyId, ip) >= PIN_FAIL_LIMIT) {
    await recordSecurityEvent(c, companyId, null, 'brute_force_detected', 'critical',
      `Too many wrong till PINs from ${ip} — quick sign-in paused for ${PIN_FAIL_WINDOW_MINUTES} minutes`)
    return c.json({
      error: `Too many wrong PINs from this device. Quick sign-in is paused for a few minutes — sign in with your email and password instead.`,
      code: 'pin_throttled',
    }, 429)
  }

  // Find users in this company who have a PIN set
  const users = await db.select().from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
  const usersWithPin = users.filter(u => u.pinHash)

  if (usersWithPin.length === 0) {
    await recordSecurityEvent(c, companyId, null, 'pin_login_failed', 'warning',
      'Till PIN entered, and no account in this shop has quick sign-in switched on')
    return c.json({ error: 'No PIN-enabled users found' }, 404)
  }

  /**
   * ONE WRONG PIN USED TO LOCK OUT THE WHOLE COUNTER. (T57)
   *
   * The loop tried every PIN-enabled user and, for each one the PIN did not match, incremented THAT
   * user's `pin_attempts` and locked them after five. So five wrong taps — one person fumbling, or
   * anybody at all sending five requests with no credentials — locked every budtender out of quick
   * login for fifteen minutes. The suite proved it: two budtenders, five tries at a PIN belonging to
   * nobody, both at `attempts = 5` and both answered "Invalid PIN" afterwards.
   *
   * A failed PIN entry is UNATTRIBUTABLE: the digits are all we have, and they matched nobody, so
   * there is no user whose counter should move. Nothing is incremented on a miss. What bounds
   * guessing is the rate limiter on this route (index.ts) — a brake that slows an attacker without
   * handing them a way to shut the shop.
   *
   * A user's own lockout still applies when their PIN DOES match (below), which is the case where we
   * know whose it is.
   */
  for (const u of usersWithPin) {
    const valid = await Bun.password.verify(data.pin, u.pinHash!)
    if (!valid) continue

    // It is this person's PIN. Their own lockout is the one that counts.
    if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) {
      return c.json({
        error: 'This PIN is locked for a few minutes after too many wrong tries. Sign in with your email and password instead.',
        code: 'pin_locked',
      }, 423)
    }

    /**
     * …AND A PIN DOES NOT SKIP THE SECOND FACTOR. (T57)
     *
     * `/login` has asked a TOTP-enrolled user for a code since T49 H4. This route minted tokens
     * straight away, so four digits at the till walked past the factor the owner switched on — the
     * suite signed the owner in with a PIN and got a full access token while the password door was
     * correctly refusing one. A control that one door enforces and another ignores is not a control.
     *
     * The same gate, the same challenge, the same POST /api/auth/mfa to finish. The till still works;
     * it just finishes the way the other door does.
     */
    const pinGate = await mfaGateFor(db, u.companyId, u.id)
    if (pinGate.required) {
      const { challengeId, expiresAt } = await openLoginChallenge(db, u.companyId, u.id)
      return c.json({
        mfaRequired: true,
        challengeId,
        expiresAt,
        methods: pinGate.methods,
        recoveryCodesAvailable: pinGate.hasRecoveryCodes,
        message: 'Enter the code from your authenticator app to finish signing in.',
      }, 200)
    }

    await db.update(user).set({ pinAttempts: 0, lastLogin: new Date(), updatedAt: new Date() } as any).where(eq(user.id, u.id))

    // A sign-in at the till is a sign-in. It was the only door into this product that left no trace,
    // which on a seed-to-sale counter is the trace that matters most. (T42)
    await recordSecurityEvent(c, u.companyId, u.id, 'pin_login', 'info',
      `${[u.firstName, u.lastName].filter(Boolean).join(' ') || u.email} signed in at the till with a PIN`)

    const [foundCompany] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
    if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

    const tokens = generateTokens(u.id, u.companyId, u.email, u.role)
    await storeRefreshToken(u.id, tokens.refreshToken)

    return c.json({
      user: { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, avatar: u.avatar },
      company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, enabledFeatures: foundCompany.enabledFeatures },
      ...tokens,
    })
  }

  /**
   * A miss, logged. The DIGITS ARE NEVER RECORDED — storing the PIN somebody tried would hand an
   * attacker the near-misses of every real PIN out of the log the manager can read.
   *
   * `user_id` is null because this is the unattributable case T57 describes: the digits matched
   * nobody. What the row carries is the shop, the address and the time, which is exactly what the
   * throttle above counts and what a manager needs to see a guessing run.
   */
  await recordSecurityEvent(c, companyId, null, 'pin_login_failed', 'warning',
    `A till PIN was entered that belongs to nobody in this shop (attempt from ${ip})`)
  return c.json({ error: 'Invalid PIN' }, 401)
})

// Set/update PIN (authenticated users only)
app.put('/pin', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  /**
   * DIGITS. `string().min(4).max(8)` accepted 'abcd'. (T41)
   *
   * A till PIN is typed on a numeric keypad at a counter, and the sign-in screen's input strips
   * anything that is not a digit — so a PIN containing letters could be SET through the API and
   * then never entered through the UI that exists to enter it. T41: "The PIN API accepts
   * non-numeric PINs ('abcd')."
   */
  const pinSchema = z.object({ pin: z.string().regex(/^\d{4,8}$/, 'A PIN must be 4 to 8 digits.') })
  const data = pinSchema.parse(await c.req.json())

  /**
   * A READ-ONLY SEAT HAS NO TILL TO SIGN IN TO. (T41)
   *
   *   "PUT /api/auth/pin succeeds for the viewer (and accepted a weak '4141')."
   *
   * Quick sign-in exists so somebody standing at a counter — a budtender, a driver at the van, a
   * manager covering the floor — can get in with four digits instead of a password. A `viewer` is
   * the read-only reporting seat: it rings nothing, opens no drawer and has no shift. Letting it
   * hold a PIN only does one thing, which is reduce that account from a password to four digits.
   */
  if (currentUser?.role === 'viewer') {
    return c.json({
      error: 'Quick sign-in is for the people who work the counter. A read-only account signs in with its password.',
      code: 'pin_not_for_role',
    }, 403)
  }

  /**
   * …AND NOT A PIN ANYBODY WOULD TRY FIRST. (T41)
   *
   * `/pin-login` has only the digits to go on: it walks every PIN-enabled user and the first match
   * wins. That makes a guessable PIN worse here than on a phone — a stranger at the counter does not
   * need to know WHOSE PIN it is, only that somebody in the shop used 1234. Five wrong taps lock one
   * account, and the lockout counts per account, so trying one popular PIN against a shop of twelve
   * people costs an attacker nothing.
   *
   * Refused: one repeated digit (1111), a straight run up or down (1234, 4321, 9876), and a repeated
   * pair, which is how '4141' got in. Not a dictionary — just the handful a person tries first.
   */
  const pin = data.pin
  const weak = (() => {
    if (/^(\d)\1+$/.test(pin)) return 'the same digit over and over'
    const digits = [...pin].map(Number)
    const run = (step: number) => digits.every((d, i) => i === 0 || d === digits[i - 1] + step)
    if (run(1) || run(-1)) return 'digits in a straight run'
    // A repeated pair or triple: 4141, 123123. Only when the block genuinely repeats to the end.
    for (const size of [2, 3]) {
      if (pin.length % size !== 0 || pin.length === size) continue
      const block = pin.slice(0, size)
      if (pin === block.repeat(pin.length / size)) return 'a short pattern repeated'
    }
    return null
  })()
  if (weak) {
    return c.json({
      error: `That PIN is ${weak}, which is one of the first a stranger would try at the counter. `
        + 'Quick sign-in matches on the digits alone, so pick something that is not a pattern.',
      code: 'pin_too_weak',
    }, 400)
  }

  /**
   * A PIN IDENTIFIES ONE PERSON. (T57)
   *
   * `/pin-login` has only the digits to go on: it walks the PIN-enabled users and the first match
   * wins. Nothing stopped two budtenders both choosing 1234 — and then the till attributes the sale,
   * the till drawer and the compliance record to whichever of them the loop reached first. On a
   * seed-to-sale counter every action has to be attributable to the person who took it, so the
   * uniqueness the old comment described as "in practice" is enforced here.
   *
   * Checked by VERIFYING against each other hash rather than comparing hashes: bcrypt salts, so two
   * rows holding the same PIN do not look alike.
   */
  /**
   * …AND THE REFUSAL MUST NOT SAY WHOSE. (T42)
   *
   *   "the 409 'PIN already in use' message reveals which PINs are live, so an insider can guess
   *    staff PINs unnoticed."
   *
   * The old message was "Somebody else in this shop already uses that PIN", which turns this endpoint
   * into an oracle: set 1234, read the answer, and you know a colleague's PIN without ever going near
   * the till. The uniqueness rule itself has to stay — a PIN that points at two people means the till
   * cannot say who rang a sale, which on a regulated counter is the whole point of it — so the
   * refusal stays and the DISCLOSURE goes:
   *
   *   · the wording no longer asserts that anybody holds it, only that this one cannot be used;
   *   · every collision writes a `pin_collision` row, so trying PINs here is visible to the manager
   *     where before it was silent;
   *   · five collisions from one account in fifteen minutes stops the endpoint, so the oracle cannot
   *     be read in bulk.
   *
   * WHAT IS STILL TRUE, AND NOT PRETENDED OTHERWISE: a refusal is one bit, and a patient insider can
   * still learn "this PIN is taken" one guess at a time. Removing the leak entirely means removing
   * the uniqueness requirement, which means the till asking WHO before it asks for four digits —
   * a change to how the counter is used, not a change to this handler. Named in the commit rather
   * than half-built here.
   *
   * Checked by VERIFYING against each other hash rather than comparing hashes: bcrypt salts, so two
   * rows holding the same PIN do not look alike.
   */
  const others = await db.select().from(user)
    .where(and(eq(user.companyId, currentUser.companyId), eq(user.isActive, true)))
  for (const other of others) {
    if (other.id === currentUser.userId || !other.pinHash) continue
    if (await Bun.password.verify(data.pin, other.pinHash)) {
      if (await recentPinCollisions(currentUser.companyId, currentUser.userId) >= PIN_COLLISION_LIMIT) {
        await recordSecurityEvent(c, currentUser.companyId, currentUser.userId, 'suspicious_activity', 'critical',
          'Repeatedly tried till PINs that could not be used — setting a PIN is paused for this account')
        return c.json({
          error: 'Too many attempts. Wait a few minutes before choosing another PIN.',
          code: 'pin_throttled',
        }, 429)
      }
      await recordSecurityEvent(c, currentUser.companyId, currentUser.userId, 'pin_collision', 'warning',
        'Tried to set a till PIN that cannot be used in this shop')
      return c.json({
        error: 'That PIN cannot be used at this shop. Choose a different one — a PIN has to point at one person, or the till cannot say who rang a sale.',
        code: 'pin_in_use',
      }, 409)
    }
  }

  const [before] = await db.select({ h: user.pinHash }).from(user).where(eq(user.id, currentUser.userId)).limit(1)
  const pinHash = await Bun.password.hash(data.pin, 'bcrypt')
  await db.update(user).set({ pinHash, pinAttempts: 0, pinLockedUntil: null, updatedAt: new Date() } as any).where(eq(user.id, currentUser.userId))

  // A PIN is a way into the till, so setting or changing one belongs in the security log. T41: "PIN
  // changes, 2FA setup and logins are not audited." The DIGITS are never recorded — only the event.
  await recordSecurityEvent(c, currentUser.companyId, currentUser.userId,
    before?.h ? 'pin_changed' : 'pin_set', 'info', before?.h ? 'Changed their till PIN' : 'Set a till PIN')

  return c.json({ message: 'PIN updated', pinSet: true })
})

/**
 * Turn quick sign-in off for yourself. (T37)
 *
 * A PIN could be set and changed and never removed, so somebody who had one was stuck with one —
 * and a budtender finishing a shift on a shared till had no way to take their own quick sign-in off
 * that counter. Clearing the hash is the whole operation; the attempt counter and any lockout go
 * with it, because they describe a PIN that no longer exists.
 *
 * Self-scoped, like PUT /pin: this removes the CALLER's PIN. Removing somebody else's is a Team
 * action and deliberately not reachable from here.
 */
app.delete('/pin', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const [me] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!me) return c.json({ error: 'User not found' }, 404)
  if (!me.pinHash) return c.json({ error: 'You do not have a PIN set.', code: 'no_pin' }, 400)

  await db.update(user).set({ pinHash: null, pinAttempts: 0, pinLockedUntil: null, updatedAt: new Date() } as any).where(eq(user.id, currentUser.userId))
  await recordSecurityEvent(c, currentUser.companyId, currentUser.userId, 'pin_removed', 'info', 'Turned their till PIN off')
  return c.json({ message: 'Quick sign-in is off for your account.', pinSet: false })
})

// Refresh token
app.post('/refresh', async (c) => {
  // No refresh-token ROTATION here. The DB stores a single refresh token;
  // rotating it on every access-token refresh races with concurrent
  // requests and multiple tabs — the loser presents a now-stale token,
  // gets 401, and is logged out mid-work. Issue a fresh access token and
  // keep the same refresh token (still expires on its own 7d clock).
  const { refreshToken } = await c.req.json()
  if (!refreshToken) return c.json({ error: 'Refresh token required' }, 401)

  let decoded: any
  try { decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) }
  catch { return c.json({ error: 'Invalid refresh token' }, 401) }

  const [foundUser] = await db.select().from(user).where(eq(user.id, decoded.userId)).limit(1)
  if (!foundUser || !foundUser.isActive || !parseTokenList(foundUser.refreshToken).includes(refreshToken)) {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }

  const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)

  return c.json({ accessToken: tokens.accessToken, refreshToken })
})

// Logout — revokes THIS device's refresh token when the client sends it; with no token in the
// body (older clients) every session for the user is revoked, as before.
app.post('/logout', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  await revokeRefreshToken(currentUser.userId, typeof body?.refreshToken === 'string' ? body.refreshToken : null)
  return c.json({ message: 'Logged out' })
})

/** Role list plus the per-user grants, deduped — what the guards decide on, so what the screen is told. */
const effectivePermissions = async (
  getPermissions: (role: string) => string[],
  getExtraPermissions: (userId: string | undefined) => Promise<string[]>,
  userId: string,
  role: string,
): Promise<string[]> => {
  const base = getPermissions(role)
  if (base.includes('*')) return base
  const extra = (await getExtraPermissions(userId)) || []
  return Array.from(new Set([...base, ...extra]))
}

// Get current user
app.get('/me', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!foundUser) return c.json({ error: 'User not found' }, 404)

  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Import permissions
  const { getPermissions, normalizeRole, getExtraPermissions } = await import('../middleware/permissions.ts')
  // The grants an owner handed this ONE person in Settings > Users count too: hasPermission() honours
  // them, so a list without them is narrower than what the guards actually allow. (T30 M-R1)
  const permissions = await effectivePermissions(getPermissions, getExtraPermissions, foundUser.id, foundUser.role)

  return c.json({
    /**
     * `pinSet` — whether this person has a till PIN, NOT the PIN. (T37)
     *
     * A screen cannot offer "change your PIN" or "turn quick sign-in off" without knowing whether
     * there is one, and nothing answered that question: the PIN endpoints existed with no way to
     * read their state, which is half of why the dispensary never had a PIN screen at all. A boolean
     * is the whole answer — the hash never leaves the server.
     */
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, phone: foundUser.phone, role: normalizeRole(foundUser.role), avatar: foundUser.avatar, pinSet: !!foundUser.pinHash },
    company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, logo: foundCompany.logo, primaryColor: foundCompany.primaryColor, enabledFeatures: foundCompany.enabledFeatures, settings: foundCompany.settings, phone: foundCompany.phone, email: foundCompany.email, address: foundCompany.address, city: foundCompany.city, state: foundCompany.state, zip: foundCompany.zip, website: foundCompany.website, taxRate: (foundCompany as any).taxRate, localTaxRate: (foundCompany as any).localTaxRate, exciseTaxRate: (foundCompany as any).exciseTaxRate, purchaseLimitOz: (foundCompany as any).purchaseLimitOz, visionUrl: process.env.VISION_URL || null, vertical: 'dispensary',
      // The store's own clock, so no screen has to guess the shop's date from the viewer's laptop.
      // A manager in Central looking at an Ohio store at 23:10 asked Analytics for "2026-09-27"
      // while the till, the compliance report and the server had already rolled to the 28th —
      // Today showed $0.00 against a dashboard reading $718.75. (T42 M1)
      timeZone: storeTimeZone(foundCompany),
      today: storeDateString(new Date(), storeTimeZone(foundCompany)) },
    permissions,
  })
})

// Get user permissions
app.get('/permissions', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const { getPermissions, normalizeRole, hasPermission, ROLE_HIERARCHY, getExtraPermissions } = await import('../middleware/permissions.ts')
  const role = normalizeRole(currentUser.role)
  const permissions = await effectivePermissions(getPermissions, getExtraPermissions, currentUser.userId, currentUser.role)

  return c.json({
    role,
    roleLevel: ROLE_HIERARCHY.indexOf(role),
    permissions,
    can: {
      manageTeam: hasPermission(role, 'team:create'),
      manageFinancials: hasPermission(role, 'invoices:create'),
      approveTime: hasPermission(role, 'time:approve'),
      deleteCompany: hasPermission(role, 'company:delete'),
    },
  })
})

// Change password
app.put('/password', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  // One password rule for every CRM (shared passwordSchema): 8+ chars with a letter and a number.
  const changeSchema = z.object({ currentPassword: z.string(), newPassword: passwordSchema })
  const data = changeSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!foundUser) return c.json({ error: 'User not found' }, 404)
  const valid = await Bun.password.verify(data.currentPassword, foundUser.passwordHash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 400)

  const passwordHash = await Bun.password.hash(data.newPassword, 'bcrypt')
  await db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password changed successfully' })
})

// Forgot password
app.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  // Validate the format (400) like /login does; the "if that email exists" response below stays
  // generic so this still never reveals whether an account exists. (go-live QA L-9)
  if (!email || !z.string().email().safeParse(email).success) {
    return c.json({ error: 'A valid email address is required' }, 400)
  }
  const [foundUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)

  if (foundUser) {
    const resetToken = uuidv4()
    const resetCode = Math.random().toString().substring(2, 8) // 6-digit code

    await db.update(user).set({ resetToken, resetTokenExp: new Date(Date.now() + 3600000), updatedAt: new Date() }).where(eq(user.id, foundUser.id))

    // Send email
    try {
      await emailService.sendPasswordReset(email, {
        firstName: foundUser.firstName,
        resetToken,
        resetCode,
      })
      logger.info('Password reset email sent', { email })
    } catch (emailErr) {
      logger.error('Email error', { action: 'sendPasswordResetEmail', email })
    }
  }

  return c.json({ message: 'If that email exists, a reset link has been sent.' })
})

// Reset password
app.post('/reset-password', async (c) => {
  const resetSchema = z.object({ token: z.string(), password: passwordSchema })
  const data = resetSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(and(eq(user.resetToken, data.token), gt(user.resetTokenExp, new Date()))).limit(1)
  if (!foundUser) return c.json({ error: 'Invalid or expired reset token' }, 400)

  // A reset is how a user recovers from a stolen password: every signed-in device is logged out and a
  // pending lockout is cleared, same as the shared auth module.
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  await db.update(user).set({ passwordHash, resetToken: null, resetTokenExp: null, refreshToken: null, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() } as any).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password reset successfully' })
})

export default app
