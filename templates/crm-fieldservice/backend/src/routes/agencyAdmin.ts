import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'

import { db } from '../../db/index.ts'
import { company, user, contact, job, quote, invoice, project } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, asc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import {
  FEATURE_REGISTRY,
  FEATURE_PACKAGES,
  getCoreFeatureIds,
  getPackageFeatures,
  getAllFeatureIds,
} from '../config/featureRegistry.ts'

const app = new Hono()

// Only agency admins can access these routes
const requireAgencyAdmin = async (c: any, next: any) => {
  const u = c.get('user') as any
  if (!u || u.role !== 'agency_admin') {
    return c.json({ error: 'Agency admin access required' }, 403)
  }
  await next()
}

app.use('*', authenticate)
app.use('*', requireAgencyAdmin)

// ============================================
// FEATURE REGISTRY (read-only)
// ============================================

app.get('/features', async (c) => {
  return c.json({
    registry: FEATURE_REGISTRY,
    packages: FEATURE_PACKAGES,
    coreFeatures: getCoreFeatureIds(),
  })
})

// ============================================
// CUSTOMER MANAGEMENT
// ============================================

const createCustomerSchema = z.object({
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50).regex(/^[a-z0-9-]+$/).optional(),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  logo: z.string().url().optional(),
  primaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  secondaryColor: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  packageId: z.string().optional(),
  enabledFeatures: z.array(z.string()).optional(),
  adminEmail: z.string().email(),
  adminFirstName: z.string().min(1),
  adminLastName: z.string().min(1),
  adminPassword: z.string().min(8).optional(),
})

app.post('/customers', async (c) => {
  const u = c.get('user') as any
  const body = await c.req.json()
  if (typeof body.email === 'string') { body.email = body.email.toLowerCase().trim(); if (!body.email) delete body.email }
  if (typeof body.adminEmail === 'string') { body.adminEmail = body.adminEmail.toLowerCase().trim(); if (!body.adminEmail) delete body.adminEmail }
  const data = createCustomerSchema.parse(body)

  // Determine features to enable
  let enabledFeatures: string[] = []

  if (data.packageId) {
    enabledFeatures = getPackageFeatures(data.packageId)
  } else if (data.enabledFeatures?.length) {
    enabledFeatures = [...getCoreFeatureIds(), ...data.enabledFeatures]
  } else {
    enabledFeatures = getCoreFeatureIds()
  }

  enabledFeatures = [...new Set(enabledFeatures)]

  // Generate slug if not provided
  let slug = data.slug
  if (!slug) {
    slug = data.name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')
  }

  // Check slug uniqueness
  const [existing] = await db.select({ id: company.id }).from(company).where(eq(company.slug, slug)).limit(1)
  if (existing) {
    return c.json({ error: `Slug "${slug}" already exists` }, 400)
  }

  // Generate admin password if not provided
  const adminPassword = data.adminPassword || crypto.randomBytes(12).toString('base64').slice(0, 12)
  const hashedPassword = await Bun.password.hash(adminPassword, 'bcrypt')

  // Create company with admin user in transaction
  const result = await db.transaction(async (tx) => {
    const [newCompany] = await tx.insert(company).values({
      name: data.name,
      slug,
      email: data.email,
      phone: data.phone,
      address: data.address,
      city: data.city,
      state: data.state,
      zip: data.zip,
      logo: data.logo,
      primaryColor: data.primaryColor || '{{PRIMARY_COLOR}}',
      secondaryColor: data.secondaryColor || '#1e293b',
      enabledFeatures,
      settings: {
        timezone: 'America/Chicago',
        dateFormat: 'MM/DD/YYYY',
        packageId: data.packageId || null,
      },
    }).returning()

    const [adminUser] = await tx.insert(user).values({
      companyId: newCompany.id,
      email: data.adminEmail,
      passwordHash: hashedPassword,
      firstName: data.adminFirstName,
      lastName: data.adminLastName,
      role: 'admin',
      isActive: true,
    }).returning()

    return { company: newCompany, adminUser, generatedPassword: data.adminPassword ? null : adminPassword }
  })

  return c.json({
    success: true,
    company: {
      id: result.company.id,
      name: result.company.name,
      slug: result.company.slug,
      enabledFeatures: result.company.enabledFeatures,
    },
    adminUser: {
      id: result.adminUser.id,
      email: result.adminUser.email,
      name: `${result.adminUser.firstName} ${result.adminUser.lastName}`,
    },
    generatedPassword: result.generatedPassword,
    loginUrl: `${process.env.FRONTEND_URL || 'https://{{COMPANY_DOMAIN}}'}/${result.company.slug}/login`,
  }, 201)
})

app.get('/customers', async (c) => {
  const u = c.get('user') as any
  const search = c.req.query('search')
  const page = parseInt(c.req.query('page') || '1')
  const limit = parseInt(c.req.query('limit') || '50')
  const agencyId = u.agencyId || u.companyId

  const conditions = [eq(company.id, sql`${company.id}`)] as any[] // placeholder, replaced below

  // Build where clause - filter by agencyId is not in schema, so we use a raw sql approach
  // Since agencyId is not in the Drizzle schema, we use sql template
  const baseCondition = sql`${company.id} IN (SELECT id FROM company WHERE true)`

  let whereClause
  if (search) {
    whereClause = and(
      or(
        ilike(company.name, `%${search}%`),
        ilike(company.email, `%${search}%`),
        ilike(company.slug, `%${search}%`),
      ),
    )
  } else {
    whereClause = undefined
  }

  const [customers, [{ value: total }]] = await Promise.all([
    db.select().from(company)
      .where(whereClause)
      .orderBy(desc(company.createdAt))
      .offset((page - 1) * limit)
      .limit(limit),
    db.select({ value: count() }).from(company).where(whereClause),
  ])

  // Get counts for each customer
  const customerData = await Promise.all(
    customers.map(async (cust) => {
      const [[{ value: userCount }], [{ value: contactCount }], [{ value: jobCount }]] = await Promise.all([
        db.select({ value: count() }).from(user).where(eq(user.companyId, cust.id)),
        db.select({ value: count() }).from(contact).where(eq(contact.companyId, cust.id)),
        db.select({ value: count() }).from(job).where(eq(job.companyId, cust.id)),
      ])
      return {
        id: cust.id,
        name: cust.name,
        slug: cust.slug,
        email: cust.email,
        logo: cust.logo,
        primaryColor: cust.primaryColor,
        enabledFeatures: cust.enabledFeatures,
        featureCount: (cust.enabledFeatures as any[])?.length || 0,
        stats: {
          users: userCount,
          contacts: contactCount,
          jobs: jobCount,
        },
        createdAt: cust.createdAt,
      }
    })
  )

  return c.json({
    data: customerData,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
  })
})

app.get('/customers/:id', async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')

  const [customer] = await db.select().from(company).where(eq(company.id, id)).limit(1)

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  // Get users for this company
  const users = await db.select({
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
  }).from(user).where(eq(user.companyId, id))

  // Get counts
  const [[{ value: contactCount }], [{ value: jobCount }], [{ value: quoteCount }], [{ value: invoiceCount }], [{ value: projectCount }]] = await Promise.all([
    db.select({ value: count() }).from(contact).where(eq(contact.companyId, id)),
    db.select({ value: count() }).from(job).where(eq(job.companyId, id)),
    db.select({ value: count() }).from(quote).where(eq(quote.companyId, id)),
    db.select({ value: count() }).from(invoice).where(eq(invoice.companyId, id)),
    db.select({ value: count() }).from(project).where(eq(project.companyId, id)),
  ])

  return c.json({
    ...customer,
    users,
    stats: {
      contacts: contactCount,
      jobs: jobCount,
      quotes: quoteCount,
      invoices: invoiceCount,
      projects: projectCount,
    },
  })
})

app.put('/customers/:id', async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')

  const [customer] = await db.select().from(company).where(eq(company.id, id)).limit(1)

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  const body = await c.req.json()
  const { name, email, phone, address, city, state, zip, logo, primaryColor, secondaryColor } = body

  const updateData: Record<string, any> = { updatedAt: new Date() }
  if (name) updateData.name = name
  if (email) updateData.email = email
  if (phone !== undefined) updateData.phone = phone
  if (address !== undefined) updateData.address = address
  if (city !== undefined) updateData.city = city
  if (state !== undefined) updateData.state = state
  if (zip !== undefined) updateData.zip = zip
  if (logo !== undefined) updateData.logo = logo
  if (primaryColor) updateData.primaryColor = primaryColor
  if (secondaryColor) updateData.secondaryColor = secondaryColor

  const [updated] = await db.update(company).set(updateData).where(eq(company.id, id)).returning()

  return c.json(updated)
})

app.put('/customers/:id/features', async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')

  const [customer] = await db.select().from(company).where(eq(company.id, id)).limit(1)

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  const { enabledFeatures: reqFeatures, packageId } = await c.req.json()

  let features: string[] = []

  if (packageId) {
    features = getPackageFeatures(packageId)
  } else if (reqFeatures) {
    features = [...getCoreFeatureIds(), ...reqFeatures]
  } else {
    return c.json({ error: 'Must provide enabledFeatures or packageId' }, 400)
  }

  features = [...new Set(features)]

  const allFeatures = getAllFeatureIds()
  const invalid = features.filter((f: string) => !allFeatures.includes(f))
  if (invalid.length > 0) {
    return c.json({ error: `Invalid features: ${invalid.join(', ')}` }, 400)
  }

  const [updated] = await db.update(company).set({
    enabledFeatures: features,
    settings: {
      ...(customer.settings as any),
      packageId: packageId || null,
    },
    updatedAt: new Date(),
  }).where(eq(company.id, id)).returning()

  return c.json({
    success: true,
    enabledFeatures: updated.enabledFeatures,
  })
})

app.delete('/customers/:id', async (c) => {
  const u = c.get('user') as any
  const id = c.req.param('id')

  const [customer] = await db.select().from(company).where(eq(company.id, id)).limit(1)

  if (!customer) {
    return c.json({ error: 'Customer not found' }, 404)
  }

  const body = await c.req.json()
  if (body.confirmDelete !== customer.slug) {
    return c.json({
      error: 'Must confirm deletion by providing company slug',
      required: customer.slug,
    }, 400)
  }

  await db.delete(company).where(eq(company.id, id))

  return c.json({ success: true, deleted: customer.slug })
})

// ============================================
// ANALYTICS
// ============================================

app.get('/stats', async (c) => {
  const u = c.get('user') as any
  const agencyId = u.agencyId || u.companyId

  const [
    [{ value: totalCustomers }],
    [{ value: totalUsers }],
    [{ value: totalJobs }],
    recentCustomers,
  ] = await Promise.all([
    db.select({ value: count() }).from(company),
    db.select({ value: count() }).from(user),
    db.select({ value: count() }).from(job),
    db.select({
      id: company.id,
      name: company.name,
      createdAt: company.createdAt,
    }).from(company).orderBy(desc(company.createdAt)).limit(5),
  ])

  return c.json({
    totalCustomers,
    totalUsers,
    totalJobs,
    recentCustomers,
  })
})

export default app
