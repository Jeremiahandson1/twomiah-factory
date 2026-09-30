import { Hono } from 'hono'

import jwt from 'jsonwebtoken'
import { z } from 'zod'
import crypto from 'crypto'
const uuidv4 = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { storeTimeZone, storeDateString } from '../utils/isoTime.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'
import { passwordSchema } from '../shared/index.ts'
import { sql } from 'drizzle-orm'  // for the security_events row the code step writes
// Two-factor at sign-in. The gate answers "is there a factor to ask for", which is not the same
// question as "is MFA configured" — see services/loginMfa.ts. (T49 H4)
import { mfaGateFor, openLoginChallenge, verifyLoginChallenge } from '../services/loginMfa.ts'

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
  // see services/loginMfa.ts for why that distinction is the difference between a working shop and
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
  try {
    await db.execute(sql`
      INSERT INTO security_events (id, company_id, event_type, severity, description, user_id, ip_address, created_at)
      VALUES (gen_random_uuid(), ${mfaUser.companyId},
        ${outcome.usedRecoveryCode ? 'mfa_recovery_code_used' : 'mfa_login_verified'},
        ${outcome.usedRecoveryCode ? 'warning' : 'info'},
        ${outcome.usedRecoveryCode ? 'Signed in with a recovery code' : 'Signed in with two-factor'},
        ${mfaUser.id}, ${c.req.header('x-forwarded-for') || 'unknown'}, NOW())
    `)
  } catch { /* never fail a sign-in for want of an event row */ }

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
  const pinSchema = z.object({ pin: z.string().min(4).max(8), companyId: z.string() })
  const data = pinSchema.parse(await c.req.json())

  // Find users in this company who have a PIN set
  const users = await db.select().from(user).where(and(eq(user.companyId, data.companyId), eq(user.isActive, true)))
  const usersWithPin = users.filter(u => u.pinHash)

  if (usersWithPin.length === 0) {
    return c.json({ error: 'No PIN-enabled users found' }, 404)
  }

  // Try each user's PIN (in practice, PINs should be unique per company)
  for (const u of usersWithPin) {
    // Check lockout
    if (u.pinLockedUntil && new Date(u.pinLockedUntil) > new Date()) {
      continue // Skip locked users
    }

    const valid = await Bun.password.verify(data.pin, u.pinHash!)
    if (valid) {
      // Reset attempts on success
      await db.update(user).set({ pinAttempts: 0, lastLogin: new Date(), updatedAt: new Date() } as any).where(eq(user.id, u.id))

      const [foundCompany] = await db.select().from(company).where(eq(company.id, u.companyId)).limit(1)
      if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

      const tokens = generateTokens(u.id, u.companyId, u.email, u.role)
      await storeRefreshToken(u.id, tokens.refreshToken)

      return c.json({
        user: { id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, role: u.role, avatar: u.avatar },
        company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, enabledFeatures: foundCompany.enabledFeatures },
        ...tokens,
      })
    } else {
      // Increment failed attempts
      const attempts = (u.pinAttempts ?? 0) + 1
      const lockUntil = attempts >= 5 ? new Date(Date.now() + 15 * 60 * 1000) : null // Lock for 15 min after 5 failures
      await db.update(user).set({ pinAttempts: attempts, pinLockedUntil: lockUntil, updatedAt: new Date() } as any).where(eq(user.id, u.id))
    }
  }

  return c.json({ error: 'Invalid PIN' }, 401)
})

// Set/update PIN (authenticated users only)
app.put('/pin', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const pinSchema = z.object({ pin: z.string().min(4).max(8) })
  const data = pinSchema.parse(await c.req.json())

  const pinHash = await Bun.password.hash(data.pin, 'bcrypt')
  await db.update(user).set({ pinHash, pinAttempts: 0, pinLockedUntil: null, updatedAt: new Date() } as any).where(eq(user.id, currentUser.userId))

  return c.json({ message: 'PIN updated' })
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
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, phone: foundUser.phone, role: normalizeRole(foundUser.role), avatar: foundUser.avatar },
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
