import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { portalSession, contact, company, job, jobPhoto, invoice } from '../../db/schema.ts'
import { eq, and, desc, gt, sql, count } from 'drizzle-orm'

const app = new Hono()

// Portal session middleware (NO standard auth - uses portal tokens)
const portalAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No portal token provided' }, 401)
  }

  const token = authHeader.split(' ')[1]
  const [session] = await db.select().from(portalSession)
    .where(and(eq(portalSession.token, token), gt(portalSession.expiresAt, new Date())))
    .limit(1)

  if (!session) return c.json({ error: 'Invalid or expired portal session' }, 401)

  // Fetch contact
  const [sessionContact] = await db.select().from(contact).where(eq(contact.id, session.contactId)).limit(1)
  if (!sessionContact) return c.json({ error: 'Contact not found' }, 401)

  c.set('portalContact', sessionContact)
  c.set('portalCompanyId', session.companyId)
  await next()
}

// Plain-English status descriptions for portal
const STATUS_DESCRIPTIONS: Record<string, string> = {
  lead: 'Inquiry Received',
  inspection_scheduled: 'Inspection Scheduled',
  inspected: 'Inspection Complete',
  measurement_ordered: 'Measurements Being Taken',
  proposal_sent: 'Proposal Sent – Awaiting Your Approval',
  signed: 'Contract Signed',
  material_ordered: 'Materials Ordered',
  in_production: 'Roof Installation In Progress',
  final_inspection: 'Final Inspection',
  invoiced: 'Invoice Sent',
  collected: 'Project Complete',
}

// Portal login with PIN
app.post('/login', async (c) => {
  const loginSchema = z.object({
    email: z.string().email(),
    companySlug: z.string().min(1),
  })

  const data = loginSchema.parse(await c.req.json())

  // Find company by slug
  const [comp] = await db.select().from(company).where(eq(company.slug, data.companySlug)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)

  // Find contact by email within this company
  const [contactRow] = await db.select().from(contact)
    .where(and(eq(contact.email, data.email), eq(contact.companyId, comp.id)))
    .limit(1)

  if (!contactRow) return c.json({ error: 'No account found with this email' }, 404)
  if (!contactRow.portalEnabled) return c.json({ error: 'Portal access is not enabled for this account' }, 403)

  // Generate 6-character alphanumeric token
  const token = crypto.randomBytes(3).toString('hex').toUpperCase()

  // Create portal session (30-day expiry)
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + 30)

  await db.insert(portalSession).values({
    contactId: contactRow.id,
    companyId: comp.id,
    token,
    expiresAt,
  })

  return c.json({
    token,
    contact: {
      id: contactRow.id,
      firstName: contactRow.firstName,
      lastName: contactRow.lastName,
      email: contactRow.email,
    },
    company: {
      id: comp.id,
      name: comp.name,
    },
    expiresAt,
  })
})

// Get portal user info
app.get('/me', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string

  const [comp] = await db.select({ id: company.id, name: company.name, primaryColor: company.primaryColor })
    .from(company).where(eq(company.id, companyId)).limit(1)

  return c.json({
    contact: {
      id: portalContact.id,
      firstName: portalContact.firstName,
      lastName: portalContact.lastName,
      email: portalContact.email,
      phone: portalContact.phone,
      address: portalContact.address,
      city: portalContact.city,
      state: portalContact.state,
      zip: portalContact.zip,
    },
    company: comp || null,
  })
})

// List jobs for this contact
app.get('/jobs', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string

  const jobs = await db.select({
    id: job.id,
    jobNumber: job.jobNumber,
    jobType: job.jobType,
    status: job.status,
    propertyAddress: job.propertyAddress,
    city: job.city,
    state: job.state,
    zip: job.zip,
    installDate: job.installDate,
    createdAt: job.createdAt,
  }).from(job)
    .where(and(eq(job.contactId, portalContact.id), eq(job.companyId, companyId)))
    .orderBy(desc(job.createdAt))

  const jobsWithDescriptions = jobs.map(j => ({
    ...j,
    statusDescription: STATUS_DESCRIPTIONS[j.status] || j.status,
  }))

  return c.json(jobsWithDescriptions)
})

// Get job detail with photos (before/after only)
app.get('/jobs/:id', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string
  const id = c.req.param('id')

  const [foundJob] = await db.select().from(job)
    .where(and(eq(job.id, id), eq(job.contactId, portalContact.id), eq(job.companyId, companyId)))
    .limit(1)
  if (!foundJob) return c.json({ error: 'Job not found' }, 404)

  // Only return before/after photos
  const photos = await db.select().from(jobPhoto)
    .where(and(eq(jobPhoto.jobId, id), eq(jobPhoto.companyId, companyId)))
    .orderBy(desc(jobPhoto.createdAt))

  const filteredPhotos = photos.filter(p => ['before', 'after'].includes(p.photoType))

  return c.json({
    ...foundJob,
    statusDescription: STATUS_DESCRIPTIONS[foundJob.status] || foundJob.status,
    photos: filteredPhotos,
  })
})

// List invoices for contact
app.get('/invoices', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string

  const invoices = await db.select({
    id: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    status: invoice.status,
    total: invoice.total,
    amountPaid: invoice.amountPaid,
    balance: invoice.balance,
    dueDate: invoice.dueDate,
    createdAt: invoice.createdAt,
  }).from(invoice)
    .where(and(eq(invoice.contactId, portalContact.id), eq(invoice.companyId, companyId)))
    .orderBy(desc(invoice.createdAt))

  return c.json(invoices)
})

// Pay invoice via Stripe
app.post('/invoices/:id/pay', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string
  const id = c.req.param('id')

  const [foundInvoice] = await db.select().from(invoice)
    .where(and(eq(invoice.id, id), eq(invoice.contactId, portalContact.id), eq(invoice.companyId, companyId)))
    .limit(1)
  if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)
  if (Number(foundInvoice.balance) <= 0) return c.json({ error: 'Invoice already paid' }, 400)

  // Get company for Stripe config
  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  if (!comp?.stripeCustomerId) return c.json({ error: 'Online payments not configured' }, 400)

  // Create Stripe payment intent
  const Stripe = (await import('stripe')).default
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!)

  const paymentIntent = await stripe.paymentIntents.create({
    amount: Math.round(Number(foundInvoice.balance) * 100), // cents
    currency: 'usd',
    metadata: {
      invoiceId: foundInvoice.id,
      invoiceNumber: foundInvoice.invoiceNumber,
      companyId,
      contactId: portalContact.id,
    },
    description: `Invoice ${foundInvoice.invoiceNumber}`,
  })

  return c.json({
    clientSecret: paymentIntent.client_secret,
    amount: Number(foundInvoice.balance),
    invoiceNumber: foundInvoice.invoiceNumber,
  })
})

// Submit service request (creates a new job)
app.post('/service-request', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string

  const requestSchema = z.object({
    description: z.string().min(1),
    propertyAddress: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    jobType: z.string().optional(),
  })
  const data = requestSchema.parse(await c.req.json())

  // Generate job number
  const [maxResult] = await db
    .select({ maxNum: sql<string>`MAX(${job.jobNumber})` })
    .from(job)
    .where(eq(job.companyId, companyId))

  let nextNum = 1
  if (maxResult?.maxNum) {
    const match = maxResult.maxNum.match(/ROOF-(\d+)/)
    if (match) nextNum = parseInt(match[1], 10) + 1
  }
  const jobNumber = `ROOF-${String(nextNum).padStart(4, '0')}`

  const [newJob] = await db.insert(job).values({
    companyId,
    contactId: portalContact.id,
    jobNumber,
    jobType: data.jobType || 'service',
    status: 'lead',
    propertyAddress: data.propertyAddress || portalContact.address || '',
    city: data.city || portalContact.city || '',
    state: data.state || portalContact.state || '',
    zip: data.zip || portalContact.zip || '',
    source: 'customer_portal',
    notes: data.description,
  }).returning()

  return c.json(newJob, 201)
})

export default app
