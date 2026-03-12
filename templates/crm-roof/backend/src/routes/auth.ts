import { Hono } from 'hono'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { z } from 'zod'
import crypto from 'crypto'
const uuidv4 = () => crypto.randomUUID()
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'
import { eq, and, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import logger from '../services/logger.ts'

const app = new Hono()

const generateTokens = (userId: string, companyId: string, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// Feature sets for each plan tier
const PLAN_FEATURES: Record<string, string[]> = {
  starter: [
    'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'measurement_reports',
  ],
  pro: [
    'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'measurement_reports',
    'insurance_workflow', 'customer_portal', 'two_way_texting', 'crews', 'materials',
    'photo_capture', 'reports',
  ],
  business: [
    'contacts', 'jobs', 'quotes', 'invoices', 'scheduling', 'dashboard', 'measurement_reports',
    'insurance_workflow', 'customer_portal', 'two_way_texting', 'crews', 'materials',
    'photo_capture', 'reports',
    'canvassing_tool', 'storm_lead_gen', 'quickbooks_sync', 'pipeline_board',
  ],
  enterprise: ['all'],
}

// Plan limits
const PLAN_LIMITS: Record<string, { users: number | null; contacts: number | null; jobs: number | null; storage: number | null }> = {
  starter: { users: 1, contacts: 250, jobs: 50, storage: 2 },
  pro: { users: 3, contacts: 1000, jobs: 250, storage: 10 },
  business: { users: 10, contacts: 5000, jobs: 1000, storage: 50 },
  enterprise: { users: null, contacts: null, jobs: null, storage: null },
}

// Self-serve signup
app.post('/signup', async (c) => {
  const schema = z.object({
    // Company
    companyName: z.string().min(1),
    industry: z.string().min(1),
    phone: z.string().min(1),
    address: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    website: z.string().optional(),
    employeeCount: z.string().optional(),

    // User
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    email: z.string().email(),
    password: z.string().min(8),

    // Plan
    plan: z.enum(['starter', 'pro', 'business', 'enterprise']),
    billingCycle: z.enum(['monthly', 'annual']),
  })

  const signupBody = await c.req.json()
  if (typeof signupBody.email === 'string') { signupBody.email = signupBody.email.toLowerCase().trim(); if (!signupBody.email) delete signupBody.email }
  const data = schema.parse(signupBody)

  // Check if email already exists
  const [existing] = await db.select().from(user).where(eq(user.email, data.email)).limit(1)
  if (existing) {
    return c.json({ error: 'An account with this email already exists' }, 409)
  }

  // Generate unique company slug
  const baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const slug = `${baseSlug}-${uuidv4().substring(0, 6)}`

  // Hash password
  const passwordHash = await bcrypt.hash(data.password, 12)

  // Get features for the selected plan
  const enabledFeatures = PLAN_FEATURES[data.plan] || PLAN_FEATURES.starter
  const limits = PLAN_LIMITS[data.plan] || PLAN_LIMITS.starter

  // Calculate trial end date (14 days)
  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14)

  // Create company and user in transaction
  const result = await db.transaction(async (tx) => {
    const [newCompany] = await tx.insert(company).values({
      name: data.companyName,
      slug,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      enabledFeatures,
      settings: {
        plan: data.plan,
        billingCycle: data.billingCycle,
        employeeCount: data.employeeCount,
        industry: data.industry,
        limits,
        trialEndsAt: trialEndsAt.toISOString(),
        subscriptionStatus: 'trialing',
      },
    }).returning()

    const [newUser] = await tx.insert(user).values({
      email: data.email,
      passwordHash,
      firstName: data.firstName,
      lastName: data.lastName,
      phone: data.phone,
      role: 'owner',
      companyId: newCompany.id,
    }).returning()

    return { company: newCompany, user: newUser }
  })

  // Generate token pair
  const tokens = generateTokens(result.user.id, result.company.id, result.user.email, result.user.role)
  await db.update(user).set({ refreshToken: tokens.refreshToken, updatedAt: new Date() }).where(eq(user.id, result.user.id))

  logger.info('New signup', {
    companyId: result.company.id,
    plan: data.plan,
    industry: data.industry,
  })

  return c.json({
    user: {
      id: result.user.id,
      email: result.user.email,
      firstName: result.user.firstName,
      lastName: result.user.lastName,
      role: result.user.role,
    },
    company: {
      id: result.company.id,
      name: result.company.name,
      slug: result.company.slug,
      enabledFeatures: result.company.enabledFeatures,
      settings: result.company.settings,
      plan: data.plan,
      trialEndsAt,
    },
    ...tokens,
  }, 201)
})

// Login
app.post('/login', async (c) => {
  const loginSchema = z.object({ email: z.string().email(), password: z.string() })
  const loginBody = await c.req.json()
  if (typeof loginBody.email === 'string') { loginBody.email = loginBody.email.toLowerCase().trim(); if (!loginBody.email) delete loginBody.email }
  const data = loginSchema.parse(loginBody)

  const [foundUser] = await db.select().from(user).where(eq(user.email, data.email)).limit(1)
  if (!foundUser) return c.json({ error: 'Invalid email or password' }, 401)
  if (!foundUser.isActive) return c.json({ error: 'Account is disabled' }, 401)

  const valid = await bcrypt.compare(data.password, foundUser.passwordHash)
  if (!valid) return c.json({ error: 'Invalid email or password' }, 401)

  // Fetch company
  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
  await db.update(user).set({ refreshToken: tokens.refreshToken, lastLogin: new Date(), updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  // Resolve plan limits
  const settings = foundCompany.settings as any
  const planKey = settings?.plan || 'starter'
  const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.starter

  return c.json({
    user: {
      id: foundUser.id,
      email: foundUser.email,
      firstName: foundUser.firstName,
      lastName: foundUser.lastName,
      role: foundUser.role,
    },
    company: {
      id: foundCompany.id,
      name: foundCompany.name,
      slug: foundCompany.slug,
      primaryColor: foundCompany.primaryColor,
      enabledFeatures: foundCompany.enabledFeatures,
      settings: foundCompany.settings,
      limits,
    },
    ...tokens,
  })
})

// Refresh token
app.post('/refresh', async (c) => {
  const { refreshToken } = await c.req.json()
  if (!refreshToken) return c.json({ error: 'Refresh token required' }, 401)

  let decoded: any
  try { decoded = jwt.verify(refreshToken, process.env.JWT_REFRESH_SECRET!) }
  catch { return c.json({ error: 'Invalid refresh token' }, 401) }

  const [foundUser] = await db.select().from(user).where(eq(user.id, decoded.userId)).limit(1)
  if (!foundUser || !foundUser.isActive || foundUser.refreshToken !== refreshToken) {
    return c.json({ error: 'Invalid refresh token' }, 401)
  }

  const tokens = generateTokens(foundUser.id, foundUser.companyId, foundUser.email, foundUser.role)
  await db.update(user).set({ refreshToken: tokens.refreshToken, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json(tokens)
})

// Get current user
app.get('/me', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!foundUser) return c.json({ error: 'User not found' }, 404)

  const [foundCompany] = await db.select().from(company).where(eq(company.id, foundUser.companyId)).limit(1)
  if (!foundCompany) return c.json({ error: 'Company not found' }, 404)

  // Resolve plan limits
  const settings = foundCompany.settings as any
  const planKey = settings?.plan || 'starter'
  const limits = PLAN_LIMITS[planKey] || PLAN_LIMITS.starter

  return c.json({
    user: {
      id: foundUser.id,
      email: foundUser.email,
      firstName: foundUser.firstName,
      lastName: foundUser.lastName,
      phone: foundUser.phone,
      role: foundUser.role,
    },
    company: {
      id: foundCompany.id,
      name: foundCompany.name,
      slug: foundCompany.slug,
      primaryColor: foundCompany.primaryColor,
      enabledFeatures: foundCompany.enabledFeatures,
      settings: foundCompany.settings,
      limits,
    },
  })
})

// Logout
app.post('/logout', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  await db.update(user).set({ refreshToken: null, updatedAt: new Date() }).where(eq(user.id, currentUser.userId))
  return c.json({ message: 'Logged out' })
})

// Change password
app.put('/password', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  const passwordSchema = z.object({ currentPassword: z.string(), newPassword: z.string().min(8) })
  const data = passwordSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(eq(user.id, currentUser.userId)).limit(1)
  if (!foundUser) return c.json({ error: 'User not found' }, 404)
  const valid = await bcrypt.compare(data.currentPassword, foundUser.passwordHash)
  if (!valid) return c.json({ error: 'Current password is incorrect' }, 400)

  const passwordHash = await bcrypt.hash(data.newPassword, 12)
  await db.update(user).set({ passwordHash, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password changed successfully' })
})

// Forgot password
app.post('/forgot-password', async (c) => {
  const fpBody = await c.req.json()
  const email = (fpBody.email || '').toLowerCase().trim()
  const [foundUser] = await db.select().from(user).where(eq(user.email, email)).limit(1)

  if (foundUser) {
    const resetToken = uuidv4()
    await db.update(user).set({ resetToken, resetTokenExp: new Date(Date.now() + 3600000), updatedAt: new Date() }).where(eq(user.id, foundUser.id))

    // TODO: send password reset email via email service
    logger.info('Password reset requested', { email })
  }

  return c.json({ message: 'If that email exists, a reset link has been sent.' })
})

// Reset password
app.post('/reset-password', async (c) => {
  const resetSchema = z.object({ token: z.string(), password: z.string().min(8) })
  const data = resetSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(and(eq(user.resetToken, data.token), gt(user.resetTokenExp, new Date()))).limit(1)
  if (!foundUser) return c.json({ error: 'Invalid or expired reset token' }, 400)

  const passwordHash = await bcrypt.hash(data.password, 12)
  await db.update(user).set({ passwordHash, resetToken: null, resetTokenExp: null, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password reset successfully' })
})

export default app
