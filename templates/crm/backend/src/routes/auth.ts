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
import { PLAN_FEATURES, PLAN_LIMITS } from '../shared/plans.ts'

const app = new Hono()

const generateTokens = (userId: string, companyId: string, email: string, role: string) => {
  const accessToken = jwt.sign({ userId, companyId, email, role }, process.env.JWT_SECRET!, { expiresIn: '15m' })
  const refreshToken = jwt.sign({ userId, companyId, type: 'refresh' }, process.env.JWT_REFRESH_SECRET!, { expiresIn: '7d' })
  return { accessToken, refreshToken }
}

// Self-serve signup (multi-step flow)
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
    plan: z.enum(['starter', 'pro', 'business', 'construction', 'enterprise']),
    billingCycle: z.enum(['monthly', 'annual']),
  })

  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  const data = schema.parse(body)

  // Check if email already exists
  const [existing] = await db.select().from(user).where(eq(user.email, data.email)).limit(1)
  if (existing) {
    return c.json({ error: 'An account with this email already exists' }, 409)
  }

  // Generate unique company slug
  const baseSlug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-')
  const slug = `${baseSlug}-${uuidv4().substring(0, 6)}`

  // Hash password
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')

  // Get features for the selected plan
  const enabledFeatures = PLAN_FEATURES[data.plan] || PLAN_FEATURES.starter
  const limits = PLAN_LIMITS[data.plan] || PLAN_LIMITS.starter

  // Calculate trial end date (14 days)
  const trialEndsAt = new Date()
  trialEndsAt.setDate(trialEndsAt.getDate() + 14)

  // Create company and user in transaction
  const result = await db.transaction(async (tx) => {
    // Create company
    const [newCompany] = await tx.insert(company).values({
      name: data.companyName,
      slug,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      website: data.website,
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

    // Create owner user
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

  // Generate token pair (same as login/register)
  const tokens = generateTokens(result.user.id, result.company.id, result.user.email, result.user.role)
  await db.update(user).set({ refreshToken: tokens.refreshToken, updatedAt: new Date() }).where(eq(user.id, result.user.id))

  // Send welcome email
  try {
    await emailService.sendWelcome(data.email, {
      firstName: data.firstName,
      companyName: data.companyName,
      plan: data.plan,
      trialEndsAt,
    })
  } catch (emailErr) {
    logger.error('Email error', { action: 'sendWelcomeEmail', email: data.email })
  }

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

// Legacy register endpoint (keep for backwards compatibility)
app.post('/register', async (c) => {
  const registerSchema = z.object({
    email: z.string().email(),
    password: z.string().min(8),
    firstName: z.string().min(1),
    lastName: z.string().min(1),
    companyName: z.string().min(1),
    phone: z.string().optional(),
  })
  const regBody = await c.req.json()
  if (regBody.email && typeof regBody.email === 'string') regBody.email = regBody.email.toLowerCase().trim()
  const data = registerSchema.parse(regBody)

  const [existing] = await db.select().from(user).where(eq(user.email, data.email)).limit(1)
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  const slug = data.companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + uuidv4().substring(0, 6)
  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')

  const result = await db.transaction(async (tx) => {
    const [newCompany] = await tx.insert(company).values({
      name: data.companyName,
      slug,
      email: data.email,
      phone: data.phone,
      enabledFeatures: ['contacts', 'projects', 'jobs', 'quotes', 'invoices', 'scheduling', 'team'],
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

  const tokens = generateTokens(result.user.id, result.company.id, result.user.email, result.user.role)
  await db.update(user).set({ refreshToken: tokens.refreshToken, updatedAt: new Date() }).where(eq(user.id, result.user.id))

  return c.json({
    user: { id: result.user.id, email: result.user.email, firstName: result.user.firstName, lastName: result.user.lastName, role: result.user.role },
    company: { id: result.company.id, name: result.company.name, slug: result.company.slug, phone: result.company.phone, email: result.company.email, address: result.company.address, city: result.company.city, state: result.company.state, zip: result.company.zip, website: result.company.website, enabledFeatures: result.company.enabledFeatures, settings: result.company.settings },
    ...tokens,
  }, 201)
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
  await db.update(user).set({ refreshToken: tokens.refreshToken, lastLogin: new Date(), updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({
    user: { id: foundUser.id, email: foundUser.email, firstName: foundUser.firstName, lastName: foundUser.lastName, role: foundUser.role, avatar: foundUser.avatar },
    company: { id: foundCompany.id, name: foundCompany.name, slug: foundCompany.slug, logo: foundCompany.logo, primaryColor: foundCompany.primaryColor, phone: foundCompany.phone, email: foundCompany.email, address: foundCompany.address, city: foundCompany.city, state: foundCompany.state, zip: foundCompany.zip, website: foundCompany.website, enabledFeatures: foundCompany.enabledFeatures, settings: foundCompany.settings, visionUrl: process.env.VISION_URL || null, vertical: 'contractor' },
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

// Logout
app.post('/logout', authenticate, async (c) => {
  const currentUser = c.get('user') as any
  await db.update(user).set({ refreshToken: null, updatedAt: new Date() }).where(eq(user.id, currentUser.userId))
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
  const body = await c.req.json()
  const email = body.email?.toLowerCase().trim()
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
  const resetSchema = z.object({ token: z.string(), password: z.string().min(8) })
  const data = resetSchema.parse(await c.req.json())

  const [foundUser] = await db.select().from(user).where(and(eq(user.resetToken, data.token), gt(user.resetTokenExp, new Date()))).limit(1)
  if (!foundUser) return c.json({ error: 'Invalid or expired reset token' }, 400)

  const passwordHash = await Bun.password.hash(data.password, 'bcrypt')
  await db.update(user).set({ passwordHash, resetToken: null, resetTokenExp: null, updatedAt: new Date() }).where(eq(user.id, foundUser.id))

  return c.json({ message: 'Password reset successfully' })
})

export default app
