// Auth routes — signup, login, tenant registration (from Factory)

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { tenant, user } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import jwt from 'jsonwebtoken'
import { authenticate } from '../middleware/tenantAuth.ts'

const JWT_SECRET = process.env.JWT_SECRET || 'roof-estimator-dev-secret'

const app = new Hono()

// ============================================
// SELF-SIGNUP — create a new tenant + admin user
// ============================================

app.post('/signup', async (c) => {
  const { companyName, email, password, phone } = await c.req.json()

  if (!companyName || !email || !password) {
    return c.json({ error: 'companyName, email, and password required' }, 400)
  }

  // Check if email already exists
  const [existing] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (existing) return c.json({ error: 'Email already registered' }, 409)

  // Create tenant
  const slug = companyName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(password + JWT_SECRET)
  const passwordHash = hasher.digest('hex')

  const [newTenant] = await db.insert(tenant).values({
    slug: `${slug}-${createId().slice(0, 6)}`,
    companyName,
    email,
    phone: phone || null,
    plan: 'free',
    monthlyReportLimit: 5,
    source: 'self_signup',
  }).returning()

  const [newUser] = await db.insert(user).values({
    tenantId: newTenant.id,
    email,
    passwordHash,
    name: companyName,
    role: 'admin',
  }).returning()

  const token = jwt.sign({ userId: newUser.id, tenantId: newTenant.id }, JWT_SECRET, { expiresIn: '7d' })

  return c.json({
    token,
    user: { id: newUser.id, email: newUser.email, name: newUser.name, role: newUser.role },
    tenant: { id: newTenant.id, slug: newTenant.slug, companyName: newTenant.companyName, plan: newTenant.plan, apiKey: newTenant.apiKey },
  }, 201)
})

// ============================================
// LOGIN
// ============================================

app.post('/login', async (c) => {
  const { email, password } = await c.req.json()
  if (!email || !password) return c.json({ error: 'email and password required' }, 400)

  const [u] = await db.select().from(user).where(eq(user.email, email)).limit(1)
  if (!u) return c.json({ error: 'Invalid credentials' }, 401)

  const hasher = new Bun.CryptoHasher('sha256')
  hasher.update(password + JWT_SECRET)
  const hash = hasher.digest('hex')
  if (hash !== u.passwordHash) return c.json({ error: 'Invalid credentials' }, 401)

  const [t] = await db.select().from(tenant).where(eq(tenant.id, u.tenantId)).limit(1)
  if (!t || !t.active) return c.json({ error: 'Account inactive' }, 401)

  const token = jwt.sign({ userId: u.id, tenantId: t.id }, JWT_SECRET, { expiresIn: '7d' })

  return c.json({
    token,
    user: { id: u.id, email: u.email, name: u.name, role: u.role },
    tenant: { id: t.id, slug: t.slug, companyName: t.companyName, plan: t.plan, apiKey: t.apiKey },
  })
})

// ============================================
// GET CURRENT USER
// ============================================

app.get('/me', authenticate, (c) => {
  const t = c.get('tenant') as any
  const u = c.get('user') as any
  return c.json({
    user: u ? { id: u.id, email: u.email, name: u.name, role: u.role } : null,
    tenant: { id: t.id, slug: t.slug, companyName: t.companyName, plan: t.plan, apiKey: t.apiKey, monthlyReportLimit: t.monthlyReportLimit, reportsUsedThisMonth: t.reportsUsedThisMonth },
  })
})

// ============================================
// FACTORY REGISTRATION — called by Factory deploy pipeline
// ============================================

app.post('/register-tenant', async (c) => {
  const factoryKey = c.req.header('X-Factory-Key')
  if (factoryKey !== process.env.FACTORY_SYNC_KEY) {
    return c.json({ error: 'Invalid factory key' }, 403)
  }

  const { slug, companyName, email, phone, website, plan, monthlyReportLimit, factoryTenantId } = await c.req.json()
  if (!slug || !companyName) return c.json({ error: 'slug and companyName required' }, 400)

  // Upsert tenant
  const [existing] = await db.select().from(tenant).where(eq(tenant.slug, slug)).limit(1)

  if (existing) {
    await db.update(tenant).set({
      companyName, email, phone, website, plan: plan || existing.plan,
      monthlyReportLimit: monthlyReportLimit || existing.monthlyReportLimit,
      updatedAt: new Date(),
    }).where(eq(tenant.id, existing.id))

    return c.json({ tenant: existing, created: false })
  }

  const [newTenant] = await db.insert(tenant).values({
    slug,
    companyName,
    email,
    phone,
    website,
    plan: plan || 'starter',
    monthlyReportLimit: monthlyReportLimit || 50,
    source: 'factory_deploy',
    factoryTenantId,
  }).returning()

  return c.json({ tenant: newTenant, created: true }, 201)
})

export default app
