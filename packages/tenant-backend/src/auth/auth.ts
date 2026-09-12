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
import crypto from 'crypto'
import { eq, and, gt } from 'drizzle-orm'

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
  }
  emailService: { sendPasswordReset: (to: string, data: Record<string, unknown>) => Promise<unknown> }
  logger: { info: (msg: string, meta?: any) => void; warn: (msg: string, meta?: any) => void; error: (msg: string, meta?: any) => void }
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
  const LOCK_AFTER = options.lockAfter ?? 10, LOCK_MS = options.lockMs ?? 15 * 60 * 1000
  const app = new Hono()

  // One company payload for login AND /me — the frontend's trial gate reads settings.trialEndsAt and falls
  // back to createdAt + 30 days, so both must be present on both responses.
  const companyPayload = (c: any) => ({
    id: c.id, name: c.name, slug: c.slug, logo: c.logo, primaryColor: c.primaryColor,
    phone: c.phone, email: c.email, address: c.address, city: c.city, state: c.state, zip: c.zip, website: c.website,
    enabledFeatures: c.enabledFeatures, settings: c.settings, createdAt: c.createdAt,
    visionUrl: options.visionUrl ? options.visionUrl() : null,
    vertical: options.vertical,
  })
  const userPayload = (u: any, role: string) => ({ id: u.id, email: u.email, firstName: u.firstName, lastName: u.lastName, phone: u.phone, role, avatar: u.avatar })

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
      return c.json({ error: lock ? `Too many failed sign-in attempts. Try again in ${mins} minutes.` : 'Invalid email or password' }, lock ? 423 : 401)
    }
    if ((Number(foundUser.failedLoginCount) || 0) > 0 || lockedUntilMs) await db.update(user).set({ failedLoginCount: 0, lockedUntil: null }).where(eq(user.id, foundUser.id))

    const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
    if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

    const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
    await storeRefreshToken(foundUser.id, tokens.refreshToken, { lastLogin: new Date() })

    return c.json({ user: userPayload(foundUser, foundUser.role), company: companyPayload(foundCompany), ...tokens })
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
      company: companyPayload(foundCompany),
      permissions: permissions.getPermissions(foundUser.role),
    })
  })

  app.get('/permissions', authenticate, async (c) => {
    const currentUser = c.get('user') as any
    const role = permissions.normalizeRole(currentUser.role)
    return c.json({
      role,
      roleLevel: permissions.ROLE_HIERARCHY.indexOf(role),
      permissions: permissions.getPermissions(role),
      can: {
        manageTeam: permissions.hasPermission(role, 'team:create'),
        manageFinancials: permissions.hasPermission(role, 'invoices:create'),
        approveTime: permissions.hasPermission(role, 'time:approve'),
        deleteCompany: permissions.hasPermission(role, 'company:delete'),
      },
    })
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
