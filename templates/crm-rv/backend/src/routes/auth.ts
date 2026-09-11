import { Hono } from 'hono'

import jwt from 'jsonwebtoken'
import { z } from 'zod'
import crypto from 'crypto'
const uuidv4 = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import emailService from '../services/email.ts'
import logger from '../services/logger.ts'

const app = new Hono()

const generateTokens = (userId: string, companyId: string, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh', jti: crypto.randomUUID() }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// Multi-device sessions. user.refresh_token used to hold ONE token, overwritten on every login —
// so signing in on a second device (or an admin/API login as the same account) silently
// invalidated the first device's refresh token, and 15 minutes later that device was thrown
// to the login screen mid-shift. The column now holds a JSON array of the user's live refresh
// tokens (newest last, capped), and logout revokes only the device that logged out.
// (Propagated from crm-dispensary go-live QA M-4.)
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
  if (!token) { await db.update(user).set({ refreshToken: null, updatedAt: new Date() } as any).where(eq(user.id, userId)); return }
  const [row] = await db.select({ refreshToken: user.refreshToken }).from(user).where(eq(user.id, userId)).limit(1)
  const next = parseTokenList(row?.refreshToken).filter((t) => t !== token && stillValid(t))
  await db.update(user).set({ refreshToken: next.length ? JSON.stringify(next) : null, updatedAt: new Date() } as any).where(eq(user.id, userId))
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

  const valid = await Bun.password.verify(data.password, foundUser.passwordHash)

  if (!valid) {
    return c.json({ error: 'Invalid email or password' }, 401)
  }

  // Fetch company separately
  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
  await storeRefreshToken(foundUser.id, tokens.refreshToken, { lastLogin: new Date() })

  return c.json({
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, role: foundUser.role, avatar: foundUser.avatar },
    company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, logo: foundCompany.logo, primaryColor: foundCompany.primaryColor, phone: foundCompany.phone, email: foundCompany.email, address: foundCompany.address, city: foundCompany.city, state: foundCompany.state, zip: foundCompany.zip, website: foundCompany.website, enabledFeatures: foundCompany.enabledFeatures, settings: foundCompany.settings, visionUrl: process.env.VISION_URL || null, vertical: 'contractor' },
    ...tokens,
  })
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

// Logout
// Logout — revokes THIS device's refresh token when the client sends it; with no token in the
// body (older clients) every session for the user is revoked, as before.
app.post('/logout', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  await revokeRefreshToken(currentUser.userId, typeof body?.refreshToken === 'string' ? body.refreshToken : null)
  return c.json({ message: 'Logged out' })
})

// Get current user
app.get('/me', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!foundUser) return c.json({ error: 'User not found' }, 404)

  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Import permissions
  const { getPermissions, normalizeRole } = await import('../middleware/permissions.ts')
  const permissions = getPermissions(foundUser.role)

  return c.json({
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, phone: foundUser.phone, role: normalizeRole(foundUser.role), avatar: foundUser.avatar },
    company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, logo: foundCompany.logo, primaryColor: foundCompany.primaryColor, phone: foundCompany.phone, email: foundCompany.email, address: foundCompany.address, city: foundCompany.city, state: foundCompany.state, zip: foundCompany.zip, website: foundCompany.website, enabledFeatures: foundCompany.enabledFeatures, settings: foundCompany.settings, visionUrl: process.env.VISION_URL || null, vertical: 'contractor' },
    permissions,
  })
})

// Get user permissions
app.get('/permissions', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const { getPermissions, normalizeRole, hasPermission, ROLE_HIERARCHY } = await import('../middleware/permissions.ts')
  const role = normalizeRole(currentUser.role)
  const permissions = getPermissions(role)

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
  const passwordSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) })
  const data = passwordSchema.parse(await c.req.json())

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
  const email = typeof body?.email === 'string' ? fpBody.email.toLowerCase().trim() : ''
  // Validate the format (400) like /login does; the response below stays generic so this never
  // reveals whether an account exists. (Wrench QA W-6)
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
  const resetSchema = z.object({ token: z.string(), password: z.string().min(8, 'Password must be at least 8 characters').regex(/(?=.*[A-Za-z])(?=.*\d)/, 'Password must include at least one letter and one number') })
  const data = resetSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(and(eq(user.resetToken, data.token), gt(user.resetTokenExp, new Date()))).limit(1)
  if (!foundUser) return c.json({ error: 'Invalid or expired reset token' }, 400)

  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  await db.update(user).set({ passwordHash, resetToken: null, resetTokenExp: null, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password reset successfully' })
})

export default app
