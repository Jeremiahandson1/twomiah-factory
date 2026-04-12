import { Hono } from 'hono'

import jwt from 'jsonwebtoken'
import { eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { users, caregiverProfiles, agencies } from '../../db/schema.ts'
import { authenticate, logAuthEvent } from '../middleware/auth.ts'

const app = new Hono()

const generateTokens = (userId: string, email: string, role: string, companyId?: string) => {
  const accessToken = jwt.sign({ userId, email, role, companyId }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// POST /api/auth/login
app.post('/login', async (c) => {
  const ip = c.req.header('x-forwarded-for') || 'unknown'
  const ua = c.req.header('user-agent')
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'Email and password are required' }, 400)

  const [user] = await db.select().from(users).where(eq(users.email, email.toLowerCase().trim())).limit(1)

  if (!user) {
    await logAuthEvent({ email, success: false, ipAddress: ip, userAgent: ua, failReason: 'user_not_found' })
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  if (!user.isActive) {
    await logAuthEvent({ email, userId: user.id, success: false, ipAddress: ip, userAgent: ua, failReason: 'account_inactive' })
    return c.json({ error: 'Account is inactive' }, 401)
  }

  const valid = await Bun.password.verify(password, user.passwordHash)
  if (!valid) {
    await logAuthEvent({ email, userId: user.id, success: false, ipAddress: ip, userAgent: ua, failReason: 'invalid_password' })
    return c.json({ error: 'Invalid credentials' }, 401)
  }

  // Fetch agency for company info + include in JWT for companyId-scoped queries
  const [agency] = await db.select().from(agencies).limit(1)

  const { accessToken, refreshToken } = generateTokens(user.id, user.email, user.role, agency?.id)

  await db.update(users).set({ lastLogin: new Date(), refreshToken, updatedAt: new Date() }).where(eq(users.id, user.id))
  await logAuthEvent({ email, userId: user.id, success: true, ipAddress: ip, userAgent: ua })

  return c.json({
    accessToken,
    refreshToken,
    user: { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
    company: agency ? { id: agency.id, name: agency.name, slug: agency.slug, logo: agency.logo, primaryColor: agency.primaryColor, phone: agency.phone, email: agency.email, address: agency.address, city: agency.city, state: agency.state, zip: agency.zip, website: agency.website, vertical: 'homecare' } : { vertical: 'homecare', name: 'Agency' },
  })
})

// POST /api/auth/refresh
app.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json()
  if (!refreshToken) return c.json({ error: 'No refresh token' }, 401)

  try {
    const decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET || process.env.JWT_SECRET!) as any
    const [user] = await db.select().from(users).where(eq(users.id, decoded.userId)).limit(1)

    if (!user || !user.isActive || user.refreshToken !== refreshToken) {
      return c.json({ error: 'Invalid refresh token' }, 401)
    }

    const [agency] = await db.select({ id: agencies.id }).from(agencies).limit(1)
    const tokens = generateTokens(user.id, user.email, user.role, agency?.id)
    await db.update(users).set({ refreshToken: tokens.refreshToken, updatedAt: new Date() }).where(eq(users.id, user.id))

    return c.json(tokens)
  } catch {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }
})

// POST /api/auth/logout
app.post('/logout', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  await db.update(users).set({ refreshToken: null, updatedAt: new Date() }).where(eq(users.id, currentUser.userId))
  return c.json({ message: 'Logged out' })
})

// GET /api/auth/me
app.get('/me', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const [user] = await db.select({
    id: users.id,
    email: users.email,
    firstName: users.firstName,
    lastName: users.lastName,
    phone: users.phone,
    role: users.role,
    isActive: users.isActive,
    hireDate: users.hireDate,
    defaultPayRate: users.defaultPayRate,
    certifications: users.certifications,
    certificationsExpiry: users.certificationsExpiry,
    lastLogin: users.lastLogin,
  }).from(users).where(eq(users.id, currentUser.userId)).limit(1)

  // Fetch profile separately (replaces Prisma include)
  const [profile] = await db.select({
    npiNumber: caregiverProfiles.npiNumber,
    taxonomyCode: caregiverProfiles.taxonomyCode,
    evvWorkerId: caregiverProfiles.evvWorkerId,
    medicaidProviderId: caregiverProfiles.medicaidProviderId,
  }).from(caregiverProfiles).where(eq(caregiverProfiles.caregiverId, currentUser.userId)).limit(1)

  // Fetch agency for company info
  const [agency] = await db.select().from(agencies).limit(1)

  return c.json({ ...user, profile: profile || null, company: agency ? { id: agency.id, name: agency.name, slug: agency.slug, logo: agency.logo, primaryColor: agency.primaryColor, phone: agency.phone, email: agency.email, address: agency.address, city: agency.city, state: agency.state, zip: agency.zip, website: agency.website, vertical: 'homecare' } : { vertical: 'homecare', name: 'Agency' } })
})

// PUT /api/auth/change-password
app.put('/change-password', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const { currentPassword, newPassword } = await c.req.json()
  const [user] = await db.select().from(users).where(eq(users.id, currentUser.userId)).limit(1)
  if (!user) return c.json({ error: 'Invalid credentials' }, 401)
  const valid = await Bun.password.verify(currentPassword, user.passwordHash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 400)
  const passwordHash = await Bun.password.hash(newPassword, 'bcrypt')
  await db.update(users).set({ passwordHash, updatedAt: new Date() }).where(eq(users.id, currentUser.userId))
  return c.json({ message: 'Password changed successfully' })
})

export default app
