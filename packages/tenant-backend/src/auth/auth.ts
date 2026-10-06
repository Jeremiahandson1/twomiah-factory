// Auth routes — login / refresh / logout / me / permissions / password change / forgot + reset —
// one implementation for every CRM. The template injects its db, user + company tables, the
// authenticate middleware, its permissions helpers, email + logger services and a small options block.
//
// Sessions: 15-minute access JWT (JWT_SECRET) + 7-day refresh JWT (JWT_REFRESH_SECRET). user.refreshToken
// holds a JSON list of the user's live refresh tokens (multi-device, newest last, capped) so signing in on a
// second device never logs the first one out; logout revokes only the device that logged out (or every
// session when the client sends no token). No refresh-token rotation: rotating on every access refresh
// races concurrent tabs and logs the loser out mid-work.
import { Hono } from 'hono'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import { mfaGateFor, openLoginChallenge, verifyLoginChallenge } from './mfa.ts'
import crypto from 'crypto'
import { eq, and, gt } from 'drizzle-orm'
import { redactCompanySettings, isPrivilegedRole } from './redactSettings'
import { companyRowTimeZone } from '../time/businessDay'

export interface AuthTables { user: any; company: any }
export interface AuthOptions {
  /** Reported as company.vertical to the frontend + mobile app (e.g. 'contractor', 'fieldservice', 'salon'). */
  vertical: string
  /** Exterior Visualizer URL reported as company.visionUrl — contractor/roofer only; omit elsewhere. */
  visionUrl?: () => string | null
  /** Lock the account after this many consecutive failed sign-ins. Default 10. */
  lockAfter?: number
  /** How long the lock lasts, in ms. Default 15 minutes. */
  lockMs?: number
}
export interface AuthDeps {
  db: any
  tables: AuthTables
  authenticate: any
  permissions: {
    getPermissions: (role: string) => string[]
    normalizeRole: (role: string) => string
    hasPermission: (role: string, permission: string, extra?: string[]) => boolean
    ROLE_HIERARCHY: string[]
    /** This vertical's word for a rung, for anything a person reads. Absent → the id is used. */
    roleLabel?: (role: string) => string
    /**
     * The extra permissions an owner granted this ONE person in Settings › Users. Optional only so a
     * template that has not wired it still compiles; without it /me answers the role list, which is
     * narrower than what the guards actually allow. (Field Service T30 M-R1)
     */
    getExtraPermissions?: (userId: string | undefined) => Promise<string[]>
  }
  emailService: { sendPasswordReset: (to: string, data: Record<string, unknown>) => Promise<unknown> }
  logger: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void; error: (msg: string, meta?: any) => void }
  /**
   * The template's audit service — `{ log, ACTIONS, ENTITIES }`. Optional, so a template that has
   * not been rewired keeps working rather than failing to start. (T41)
   *
   * "PIN changes, 2FA setup and logins are not audited." — dispensary
   * "Audit Log action filters return nothing for every option (… Login, Settings Changed …)." — the
   *  filter offered Login because somebody expected sign-ins to be there. They were not.
   *
   * An audit log with no sign-ins cannot answer the first question anybody asks after a breach:
   * when did this account last get used, and from where. A FAILED sign-in matters as much as a
   * successful one — a run of them against one account is what an attack looks like from here.
   *
   * No password, no token and no reset code is ever recorded.
   */
  audit?: { log: (entry: any) => any; ACTIONS?: Record<string, string>; ENTITIES?: Record<string, string> }
  options: AuthOptions
}

/** The one password rule for every CRM: at least 8 characters with at least one letter and one number. */
export const PASSWORD_RULE_TEXT = 'Password must be at least 8 characters and include at least one letter and one number'
export const passwordSchema = z.string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/(?=.*[A-Za-z])(?=.*\d)/, 'Password must include at least one letter and one number')

const MAX_SESSIONS_PER_USER = 10
const ACCESS_TTL = '15m', REFRESH_TTL = '7d'

export const generateTokens = (userId: string, companyId: string, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET!, { expiresIn: ACCESS_TTL })
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh', jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, { expiresIn: REFRESH_TTL })
  return { accessToken, refreshToken }
}
const parseTokenList = (raw: string | null | undefined): string[] => {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((t) => typeof t === 'string') : [raw] } catch { return [raw] }
}
const stillValid = (token: string) => { try { jwt.verify(token, process.env.JWT_REFRESH_SECRET!); return true } catch { return false } }

export function createAuthRoutes(deps: AuthDeps) {
  const { db, tables: { user, company }, authenticate, permissions, emailService, logger, options } = deps

  /**
   * A sign-in event. Never throws — an unlogged sign-in is bad, a refused one because the log was
   * unavailable is worse, and this runs on the hottest path in the product.
   *
   * The CONTEXT is passed so resolveActor can read the IP and user-agent: "signed in" with no
   * address is the one detail that makes the entry worth keeping. The acting user is given
   * explicitly because on a failed attempt there IS no session to read it from.
   */
  function logAuth(c: any, action: string, who: { id?: string | null; email?: string | null; companyId?: string | null }, description: string, metadata: Record<string, unknown> = {}) {
    if (!deps.audit?.log) return
    try {
      /**
       * WHO SIGNED IN, ON THE ROW THAT SAYS SOMEBODY SIGNED IN. (T58)
       *
       *   Owner: "login rows have user_email null."
       *
       * They did, on every one of them. audit.log works out the actor with resolveActor(req), which
       * reads `c.get('user')` — and on a sign-in request there IS no session yet: that is the whole
       * point of the request. So user_name and user_email were null on precisely the events where
       * knowing the person matters most, and on a FAILED attempt there is never a session at all.
       *
       * logAuth has always known who it is; it just had no way to say so. Rather than teach thirteen
       * template audit services a new argument, the actor is handed over in the shape resolveActor
       * already understands — a plain object carrying `user` — while header lookups still delegate to
       * the real context, so the IP and user-agent on the row stay the ones the request arrived with.
       */
      const actorCtx = {
        user: { userId: who.id ?? null, id: who.id ?? null, email: who.email ?? null, companyId: who.companyId ?? null },
        req: { header: (name: string) => (typeof c?.req?.header === 'function' ? c.req.header(name) : null) },
      }
      deps.audit.log({
        action,
        entity: deps.audit.ENTITIES?.USER ?? 'user',
        entityId: who.id ?? null,
        entityName: who.email ?? null,
        metadata: { description, ...metadata },
        userId: who.id ?? null,
        companyId: who.companyId ?? null,
        req: actorCtx,
      })
    } catch { /* see above */ }
  }
  const LOCK_AFTER = options.lockAfter ?? 10, LOCK_MS = options.lockMs ?? 15 * 60 * 1000
  const app = new Hono()

  // One company payload for login AND /me — the frontend's trial gate reads settings.trialEndsAt and falls
  // back to createdAt + 30 days, so both must be present on both responses.
  // `role` decides two things: secrets are stripped for EVERYONE, and the shop's commercial terms
  // (plan, monthly amount, billing status, seats) are kept for whoever settles the bill. T45 M27
  // asked whether a Stripe secret ever reaches a client — it did, to every role, the moment an
  // owner filled in the Merch tab. See auth/redactSettings.ts.
  const companyPayload = (c: any, role?: unknown) => ({
    id: c.id, name: c.name, slug: c.slug, logo: c.logo, primaryColor: c.primaryColor,
    phone: c.phone, email: c.email, address: c.address, city: c.city, state: c.state, zip: c.zip, website: c.website,
    enabledFeatures: c.enabledFeatures,
    settings: redactCompanySettings(c.settings, { privileged: isPrivilegedRole(role) }),
    // The clock the shop keeps its books on, resolved here rather than in the browser. Every figure
    // the server reports is bucketed on it, so a screen rendering a timestamp with the viewer's own
    // zone shows a different time from the one on the receipt — T45 M24 read an order at 11:01 AM in
    // Central that the Ohio till rang at 12:01 PM. AnalyticsPage was already reaching for
    // company.timeZone and getting undefined, so its own store-day fix had quietly been falling back
    // to the viewer's calendar since it shipped.
    timeZone: companyRowTimeZone(c),
    createdAt: c.createdAt,
    visionUrl: options.visionUrl ? options.visionUrl() : null,
    vertical: options.vertical,
  })
  // roleLabel: the vertical's own word for this rung. The id stays "field" — every gate in the fleet is
  // written against it — but /api/auth/me was telling a salon stylist their role was "field", which is
  // scaffolding wording from the trades. Anything a PERSON reads should use roleLabel. (Salon T29 L5)
  const roleLabelOf = (role: string) => (permissions as any)?.roleLabel?.(role) ?? role

  /**
   * Everything this person may do: the role's list plus the grants an owner gave them by name. This is
   * what the guards decide on (hasPermission takes `extra`), so it is what the screen has to be told —
   * a menu built from the role list alone hides the button from exactly the person who was let through
   * on purpose. (Field Service T30 M-R1)
   */
  const effectivePermissions = async (userId: string, role: string): Promise<string[]> => {
    const base = permissions.getPermissions(role)
    if (base.includes('*')) return base
    const extra = (await permissions.getExtraPermissions?.(userId)) || []
    return Array.from(new Set([...base, ...extra]))
  }
  const userPayload = (u: any, role: string) => ({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone, role, roleLabel: roleLabelOf(role), avatar: u.avatar })

  async function storeRefreshToken(userId: string, token: string, extra: Record<string, any> = {}) {
    const [row] = await db.select({ refreshToken: user.refreshToken }).from(user).where(eq(user.id, userId)).limit(1)
    const live = parseTokenList(row?.refreshToken).filter((t) => t !== token && stillValid(t))
    const next = [...live, token].slice(-MAX_SESSIONS_PER_USER)
    await db.update(user).set({ refreshToken: JSON.stringify(next), updatedAt: new Date(), ...extra }).where(eq(user.id, userId))
  }
  async function revokeRefreshToken(userId: string, token: string | null | undefined) {
    if (!token) { await db.update(user).set({ refreshToken: null, updatedAt: new Date() }).where(eq(user.id, userId)); return }
    const [row] = await db.select({ refreshToken: user.refreshToken }).from(user).where(eq(user.id, userId)).limit(1)
    const next = parseTokenList(row?.refreshToken).filter((t) => t !== token && stillValid(t))
    await db.update(user).set({ refreshToken: next.length ? JSON.stringify(next) : null, updatedAt: new Date() }).where(eq(user.id, userId))
  }

  // SECURITY: self-serve signup / registration is DISABLED. A tenant is ONE company, provisioned by the
  // Twomiah Factory; these routes used to create a second company + owner login in the same database with
  // no auth. Kept as 403 stubs for any old caller. Users are added by an admin via Settings → Users.
  app.post('/signup', (c) => c.json({ error: 'Self-serve signup is disabled. Accounts are provisioned by Twomiah.' }, 403))
  app.post('/register', (c) => c.json({ error: 'Public registration is disabled' }, 403))

  app.post('/login', async (c) => {
    const loginSchema = z.object({ email: z.string().email(), password: z.string() })
    const loginBody = await c.req.json().catch(() => ({} as any))
    if (loginBody.email && typeof loginBody.email === 'string') loginBody.email = loginBody.email.toLowerCase().trim()
    const data = loginSchema.parse(loginBody)

    const [foundUser] = await db.select().from(user).where(eq(user.email, data.email)).limit(1)
    if (!foundUser) return c.json({ error: 'Invalid email or password' }, 401)
    if (!foundUser.isActive) return c.json({ error: 'Account is disabled' }, 401)

    // Per-account lockout: N consecutive failures → timed lock. The per-IP limiter alone never stopped a
    // run that rotates addresses. Same message for a locked account whether or not the password is right,
    // so the lock leaks nothing.
    const lockedUntilMs = foundUser.lockedUntil ? new Date(foundUser.lockedUntil).getTime() : 0
    if (lockedUntilMs > Date.now()) {
      const mins = Math.max(1, Math.ceil((lockedUntilMs - Date.now()) / 60000))
      return c.json({ error: `Too many failed sign-in attempts. Try again in ${mins} minute${mins === 1 ? '' : 's'}.` }, 423)
    }
    const valid = await Bun.password.verify(data.password, foundUser.passwordHash)
    if (!valid) {
      const fails = (Number(foundUser.failedLoginCount) || 0) + 1
      const lock = fails >= LOCK_AFTER
      await db.update(user).set({ failedLoginCount: lock ? 0 : fails, lockedUntil: lock ? new Date(Date.now() + LOCK_MS) : null }).where(eq(user.id, foundUser.id))
      const mins = Math.round(LOCK_MS / 60000)
      // A run of these against one account is what an attack looks like from the log's side, so the
      // attempt NUMBER is recorded and the lock is called out when it trips.
      logAuth(c, deps.audit?.ACTIONS?.LOGIN_FAILED ?? 'login_failed',
        { id: foundUser.id, email: foundUser.email, companyId: foundUser.companyId },
        lock ? 'Wrong password; the account is now locked' : 'Wrong password', { attempt: fails, locked: lock })
      return c.json({ error: lock ? `Too many failed sign-in attempts. Try again in ${mins} minutes.` : 'Invalid email or password' }, lock ? 423 : 401)
    }
    if ((Number(foundUser.failedLoginCount) || 0) > 0 || lockedUntilMs) await db.update(user).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(user.id, foundUser.id))

    const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
    if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

    /**
     * THE PASSWORD WAS RIGHT; IS THERE A SECOND FACTOR TO ASK FOR? (T57, ported from T49 H4)
     *
     * The dispensary has asked this since T49, when a report found it had enrolment screens, an
     * authenticator secret, recovery codes and a "Require MFA for all users" switch while this route
     * handed out tokens for an email and a password every time. Every other vertical still did.
     *
     * `mfaGateFor` asks whether a factor can actually be PRESENTED, not whether MFA is configured —
     * and answers "no factor" when the vertical has no mfa_devices table at all, which is what makes
     * landing this in shared auth safe for the templates that have not added one. See auth/mfa.ts.
     */
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

    const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
    await storeRefreshToken(foundUser.id, tokens.refreshToken, { lastLogin: new Date() })
    logAuth(c, deps.audit?.ACTIONS?.LOGIN ?? 'login',
      { id: foundUser.id, email: foundUser.email, companyId: foundUser.companyId }, 'Signed in', { role: foundUser.role })

    /**
     * `permissions` on the LOGIN response too, not only on /me. (T32, found while closing M16)
     *
     * AuthContext says it out loud — "Login does not carry the list in every CRM; checkAuth() fills
     * it in either way" — and that was true: this route returned user + company + tokens and
     * nothing else, so `can()` answered false for one round trip after signing in. Every write
     * control gated on a permission was therefore HIDDEN on the first render, which is exactly the
     * shape of the bug the T32 M9 gating was added to avoid (a control that lies about what you
     * may do), just in the other direction.
     *
     * The same `effectivePermissions` /me uses, so the two answers cannot disagree. Adding a field
     * breaks no caller, and the client already reads it when present.
     */
    return c.json({
      user: userPayload(foundUser, foundUser.role),
      company: companyPayload(foundCompany, permissions.normalizeRole(foundUser.role)),
      permissions: await effectivePermissions(foundUser.id, foundUser.role),
      ...(gate.enrolmentRequired ? { mfaEnrolmentRequired: true } : {}),
      ...tokens,
    })
  })

  /**
   * Finish a sign-in that stopped for a code. (T57)
   *
   * PUBLIC on purpose: the caller has no token yet — that is the whole point of being here. What
   * stands in for authentication is the challenge id, which is single-use, expires in ten minutes,
   * takes five wrong codes at most, and was created only after a correct password.
   *
   * Recovery codes are accepted here and burned on use.
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

    const tokens = generateTokens(mfaUser.id, mfaUser.companyId, mfaUser.email, mfaUser.role)
    await storeRefreshToken(mfaUser.id, tokens.refreshToken, { lastLogin: new Date() })
    // The same event, reached the other way: password, then a second factor. Recorded distinctly so
    // the log says whether two-factor was actually used.
    logAuth(c, deps.audit?.ACTIONS?.LOGIN ?? 'login',
      { id: mfaUser.id, email: mfaUser.email, companyId: mfaUser.companyId }, 'Signed in with two-factor',
      { role: mfaUser.role, secondFactor: true })
    return c.json({
      user: userPayload(mfaUser, mfaUser.role),
      company: companyPayload(mfaCompany, permissions.normalizeRole(mfaUser.role)),
      permissions: await effectivePermissions(mfaUser.id, mfaUser.role),
      // So a screen can tell somebody they have one fewer recovery code than they did.
      ...(outcome.usedRecoveryCode ? { usedRecoveryCode: true } : {}),
      ...tokens,
    })
  })

  app.post('/refresh', async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    const refreshToken = body?.refreshToken
    if (!refreshToken || typeof refreshToken !== 'string') return c.json({ error: 'Refresh token required' }, 401)

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

  app.post('/logout', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const body = await c.req.json().catch(() => ({} as any))
    await revokeRefreshToken(currentUser.userId, typeof body?.refreshToken === 'string' ? body.refreshToken : null)
    logAuth(c, deps.audit?.ACTIONS?.LOGOUT ?? 'logout',
      { id: currentUser.userId, email: currentUser.email, companyId: currentUser.companyId },
      typeof body?.refreshToken === 'string' ? 'Signed out of this device' : 'Signed out of every device')
    return c.json({ message: 'Logged out' })
  })

  app.get('/me', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
    if (!foundUser) return c.json({ error: 'User not found' }, 404)
    const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
    if (!foundCompany) return c.json({ error: 'Company not found' }, 404)
    return c.json({
      user: userPayload(foundUser, permissions.normalizeRole(foundUser.role)),
      company: companyPayload(foundCompany, permissions.normalizeRole(foundUser.role)),
      permissions: await effectivePermissions(foundUser.id, foundUser.role),
    })
  })

  app.get('/permissions', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const role = permissions.normalizeRole(currentUser.role)
    return c.json({
      role,
      roleLevel: permissions.ROLE_HIERARCHY.indexOf(role),
      permissions: await effectivePermissions(currentUser.userId, currentUser.role),
      can: {
        manageTeam: permissions.hasPermission(role, 'team:create'),
        manageFinancials: permissions.hasPermission(role, 'invoices:create'),
        approveTime: permissions.hasPermission(role, 'time:approve'),
        deleteCompany: permissions.hasPermission(role, 'company:delete'),
      },
    })
  })

  // Your own name and phone. Settings › Profile could only READ these — the only way to correct a misspelled
  // name was to ask an admin, and an owner had nobody to ask. (Contractor T14 M7)
  //
  // Exactly the fields an admin can already change on someone else (company PUT /users/:id), minus the
  // privileged ones: role, isActive and permission grants stay with an admin, and email is not editable by
  // anyone — it is the login identity and there is no re-verification flow to make changing it safe.
  app.put('/profile', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const parsed = z.object({
      firstName: z.string().trim().min(1, 'First name is required').max(100),
      lastName: z.string().trim().min(1, 'Last name is required').max(100),
      phone: z.string().trim().max(40).optional().nullable(),
    }).safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message || 'Invalid profile' }, 400)
    const data = parsed.data
    // A cleared phone is absent, not an empty string — otherwise "" is stored and every reader has to treat
    // it as if it were null anyway.
    const [updated] = await db.update(user)
      .set({ firstName: data.firstName, lastName: data.lastName, phone: data.phone ? data.phone : null, updatedAt: new Date() })
      .where(eq(user.id, currentUser.userId)).returning()
    if (!updated) return c.json({ error: 'User not found' }, 404)
    return c.json({ user: userPayload(updated, permissions.normalizeRole(updated.role)) })
  })

  app.put('/password', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const data = z.object({ currentPassword: z.string(), newPassword: passwordSchema }).parse(await c.req.json().catch(() => ({})))
    const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
    if (!foundUser) return c.json({ error: 'User not found' }, 404)
    const valid = await Bun.password.verify(data.currentPassword, foundUser.passwordHash)
    if (!valid) return c.json({ error: 'Current password is incorrect' }, 400)
    const passwordHash = await Bun.password.hash(data.newPassword, 'bcrypt')
    await db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, foundUser.id))
    logAuth(c, deps.audit?.ACTIONS?.PASSWORD_CHANGE ?? 'password_change',
      { id: foundUser.id, email: foundUser.email, companyId: foundUser.companyId }, 'Changed their own password')
    return c.json({ message: 'Password changed successfully' })
  })

  app.post('/forgot-password', async (c) => {
    const body = await c.req.json().catch(() => ({} as any))
    const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
    // Validate the format (400) like /login does; the response below stays generic so this never
    // reveals whether an account exists.
    if (!email || !z.string().email().safeParse(email).success) {
      return c.json({ error: 'A valid email address is required' }, 400)
    }
    const [foundUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)
    if (foundUser && foundUser.isActive) {
      const resetToken = crypto.randomUUID()
      const resetCode = Math.floor(100000 + Math.random() * 900000).toString()
      const resetTokenExp = new Date(Date.now() + 60 * 60 * 1000)
      await db.update(user).set({ resetToken, resetTokenExp, updatedAt: new Date() }).where(eq(user.id, foundUser.id))
      try {
        await emailService.sendPasswordReset(email, { firstName: foundUser.firstName, resetToken, resetCode })
        logger.info('Password reset email sent', { email })
      } catch (emailErr) {
        logger.error('Email error', { action: 'sendPasswordResetEmail', email })
      }
    }
    return c.json({ message: 'If that email exists, a reset link has been sent.' })
  })

  app.post('/reset-password', async (c) => {
    const data = z.object({ token: z.string(), password: passwordSchema }).parse(await c.req.json().catch(() => ({})))
    const [foundUser] = await db.select().from(user).where(and(eq(user.resetToken, data.token), gt(user.resetTokenExp, new Date()))).limit(1)
    if (!foundUser) return c.json({ error: 'Invalid or expired reset token' }, 400)
    const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
    // A password reset also ends every existing session and clears any lockout — the person proved
    // control of the mailbox, so whoever was hammering the old password is out.
    await db.update(user).set({ passwordHash, resetToken: null, resetTokenExp: null, refreshToken: null, failedLoginCount: 0, lockedUntil: null, updatedAt: new Date() }).where(eq(user.id, foundUser.id))
    return c.json({ message: 'Password reset successfully' })
  })

  return app
}
