import { Hono } from 'hono'
import { z } from 'zod'
import crypto from 'crypto'
import { db } from '../../db/index.ts'
import { portalSession, contact, company, job, jobPhoto, invoice, quote } from '../../db/schema.ts'
import { eq, and, desc, gt, sql, count, inArray, notInArray } from 'drizzle-orm'
import { PORTAL_INVOICE_HIDDEN } from '../shared/index.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'

const app = new Hono()

// Portal session middleware (NO standard auth - uses portal tokens)
const portalAuth = async (c: any, next: any) => {
  const authHeader = c.req.header('authorization')
  if (!authHeader?.startsWith('Bearer ')) {
    return c.json({ error: 'No portal token provided' }, 401)
  }

  const token = authHeader.split(' ')[1]
  // A 6-digit sign-in code is also stored in portal_session; only a real 64-hex session token gets in.
  if (!token || token.length < 32) return c.json({ error: 'Invalid or expired portal session' }, 401)
  const [session] = await db.select().from(portalSession)
    .where(and(eq(portalSession.token, token), gt(portalSession.expiresAt, new Date())))
    .limit(1)

  if (!session) return c.json({ error: 'Invalid or expired portal session' }, 401)

  // Fetch contact
  const [sessionContact] = await db.select().from(contact).where(eq(contact.id, session.contactId)).limit(1)
  if (!sessionContact) return c.json({ error: 'Contact not found' }, 401)

  // The client portal is an optional module, and this is where its switch has to be enforced: the
  // portal runs on its own token, not a CRM login, so the `authenticate + requireEnabledFeature`
  // chain the other gated modules use in index.ts cannot reach it. The company comes from the
  // session, so the check happens here instead — after the session resolves, before anything is
  // served. A contractor who switches the portal off should find it closed, not merely unlinked.
  if (!(await isFeatureEnabled(session.companyId, 'client_portal'))) {
    return c.json({ error: 'The customer portal is not enabled for this company.', code: 'FEATURE_NOT_ENABLED', feature: 'client_portal' }, 403)
  }

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

// Portal sign-in: email → 6-digit code by email → /verify → 30-day session.
// The code is a short-lived portal_session row (6 digits, 10 minutes); a real session token is 64 hex
// chars and portalAuth refuses anything shorter, so a code can never be used as a session. Before this,
// POST /login handed out a full session for a bare email address (no secret at all), and the shipped
// sign-in page already asked for a PIN and called /verify — which did not exist.
// The login response never says whether the email has portal access (no account enumeration).
const CODE_TTL_MS = 10 * 60 * 1000
const SESSION_DAYS = 30
const isCode = (t: string) => /^\d{6}$/.test(t)
const findPortalContacts = async (email: string, companySlug?: string) => {
  const conds: any[] = [sql`lower(${contact.email}) = ${email}`]
  if (companySlug) {
    const [comp] = await db.select({ id: company.id }).from(company).where(eq(company.slug, companySlug)).limit(1)
    if (!comp) return [] as any[]
    conds.push(eq(contact.companyId, comp.id))
  }
  return db.select().from(contact).where(and(...conds)).limit(5)
}

app.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  if (!email || !z.string().email().safeParse(email).success) return c.json({ error: 'A valid email address is required' }, 400)
  const companySlug = typeof body?.companySlug === 'string' && body.companySlug.trim() ? body.companySlug.trim() : undefined
  const generic = { message: 'If that email has portal access, a 6-digit sign-in code is on its way.' }

  // …and the company must actually have the portal switched on. Without this a homeowner could
  // request a code, sign in, and then meet a 403 on every page — worse than being told nothing.
  // Filtering here rather than returning a different message keeps the no-enumeration property: the
  // response is the same generic line either way.
  const matched = (await findPortalContacts(email, companySlug)).filter((r: any) => r.portalEnabled)
  const rows: any[] = []
  for (const row of matched) {
    if (await isFeatureEnabled(row.companyId, 'client_portal')) rows.push(row)
  }
  if (!rows.length) return c.json(generic)

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0')
  const expiresAt = new Date(Date.now() + CODE_TTL_MS)
  for (const row of rows) {
    // one live code per contact
    await db.delete(portalSession).where(and(eq(portalSession.contactId, row.id), sql`length(${portalSession.token}) = 6`))
    await db.insert(portalSession).values({ contactId: row.id, companyId: row.companyId, token: code, expiresAt })
  }
  const [comp] = await db.select({ name: company.name }).from(company).where(eq(company.id, rows[0].companyId)).limit(1)
  try {
    const { send } = await import('../services/email.ts')
    await send(email, 'portalLoginCode', {
      companyName: comp?.name || 'Your Contractor',
      contactName: [rows[0].firstName, rows[0].lastName].filter(Boolean).join(' ') || 'there',
      code,
      minutes: CODE_TTL_MS / 60000,
    })
  } catch (err: any) {
    console.error('[portal/login] sign-in code email failed:', err?.message)
    return c.json({ error: 'Could not send the sign-in code — please try again in a moment.' }, 502)
  }
  return c.json(generic)
})

app.post('/verify', async (c) => {
  const body = await c.req.json().catch(() => ({} as any))
  const email = typeof body?.email === 'string' ? body.email.toLowerCase().trim() : ''
  const pin = String(body?.pin ?? body?.code ?? '').trim()
  if (!email || !isCode(pin)) return c.json({ error: 'Enter the 6-digit code from your email.' }, 400)
  const invalid = { error: 'That code is not valid or has expired. Request a new one.' }

  const rows = (await findPortalContacts(email)).filter((r: any) => r.portalEnabled)
  const ids = rows.map((r: any) => r.id)
  if (!ids.length) return c.json(invalid, 401)
  const [pending] = await db.select().from(portalSession)
    .where(and(inArray(portalSession.contactId, ids), eq(portalSession.token, pin), gt(portalSession.expiresAt, new Date())))
    .limit(1)
  if (!pending) return c.json(invalid, 401)
  await db.delete(portalSession).where(eq(portalSession.id, pending.id))

  const contactRow = rows.find((r: any) => r.id === pending.contactId)!
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date()
  expiresAt.setDate(expiresAt.getDate() + SESSION_DAYS)
  await db.insert(portalSession).values({ contactId: contactRow.id, companyId: contactRow.companyId, token, expiresAt })
  const [comp] = await db.select({ id: company.id, name: company.name }).from(company).where(eq(company.id, contactRow.companyId)).limit(1)

  return c.json({
    token,
    contact: { id: contactRow.id, firstName: contactRow.firstName, lastName: contactRow.lastName, email: contactRow.email },
    company: comp || null,
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

// =============================================
// QUOTES — view and sign a proposal
// A roof proposal is the contract. A signature only binds if we can show WHO
// signed, WHAT they saw, and that they affirmatively agreed to sign
// electronically (ESIGN/UETA), so the approve route demands all three and
// freezes the document it applied to.
// =============================================

const MAX_SIGNATURE_BYTES = 500_000

function validateSignatureInput(body: any): { ok: true; signerName: string } | { ok: false; error: string } {
  const signature = body?.signature
  const signerName = typeof body?.signedBy === 'string' ? body.signedBy.trim() : ''
  if (typeof signature !== 'string' || !signature.startsWith('data:image/')) {
    return { ok: false, error: 'A signature is required.' }
  }
  if (signature.length > MAX_SIGNATURE_BYTES) {
    return { ok: false, error: 'Signature image is too large.' }
  }
  if (!signerName) return { ok: false, error: 'Please type your full name to sign.' }
  if (body?.consent !== true) {
    return { ok: false, error: 'You must agree to sign electronically before approving.' }
  }
  return { ok: true, signerName }
}

/** Caller IP as seen through Render's proxy, best-effort. */
function signerIp(c: any): string | null {
  const fwd = c.req.header('x-forwarded-for')
  if (fwd) return fwd.split(',')[0].trim() || null
  return c.req.header('x-real-ip') || null
}

/** SHA-256 of exactly what the homeowner saw — later edits become provable. */
function documentFingerprint(payload: unknown): string {
  return crypto.createHash('sha256').update(JSON.stringify(payload)).digest('hex')
}

// List quotes for contact
app.get('/quotes', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string

  const quotes = await db.select({
    id: quote.id,
    quoteNumber: quote.quoteNumber,
    status: quote.status,
    total: quote.total,
    expiresAt: quote.expiresAt,
    approvedAt: quote.approvedAt,
    declinedAt: quote.declinedAt,
    signedBy: quote.signedBy,
    signedAt: quote.signedAt,
    createdAt: quote.createdAt,
  }).from(quote)
    // Drafts are the roofer's working copy — the homeowner never sees them.
    .where(and(eq(quote.contactId, portalContact.id), eq(quote.companyId, companyId), sql`${quote.status} <> 'draft'`))
    .orderBy(desc(quote.createdAt))

  return c.json(quotes)
})

// One quote, with everything the homeowner is agreeing to
app.get('/quotes/:id', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string
  const id = c.req.param('id')

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.contactId, portalContact.id), eq(quote.companyId, companyId)))
    .limit(1)
  if (!foundQuote || foundQuote.status === 'draft') return c.json({ error: 'Quote not found' }, 404)

  // Mark it seen the first time they open it
  if (foundQuote.status === 'sent') {
    await db.update(quote).set({ status: 'viewed', updatedAt: new Date() }).where(eq(quote.id, id))
  }

  const [comp] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)

  return c.json({
    ...foundQuote,
    status: foundQuote.status === 'sent' ? 'viewed' : foundQuote.status,
    company: comp ? { name: comp.name, email: comp.email, phone: comp.phone } : null,
  })
})

// Sign and approve a quote
app.post('/quotes/:id/approve', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string
  const id = c.req.param('id')
  const body = await c.req.json()

  const check = validateSignatureInput(body)
  if (!check.ok) return c.json({ error: check.error }, 400)
  const signerName = check.signerName

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.contactId, portalContact.id), eq(quote.companyId, companyId)))
    .limit(1)
  if (!foundQuote || foundQuote.status === 'draft') return c.json({ error: 'Quote not found' }, 404)
  if (foundQuote.status === 'approved') return c.json({ error: 'Quote already approved' }, 400)
  if (foundQuote.expiresAt && new Date(foundQuote.expiresAt) < new Date()) {
    return c.json({ error: 'This quote has expired — please ask for an updated proposal.' }, 400)
  }

  const signedAt = new Date()
  const ip = signerIp(c)
  const userAgent = c.req.header('user-agent') || null
  const documentHash = documentFingerprint({
    id: foundQuote.id,
    quoteNumber: foundQuote.quoteNumber,
    subtotal: foundQuote.subtotal,
    taxRate: foundQuote.taxRate,
    taxAmount: foundQuote.taxAmount,
    total: foundQuote.total,
    notes: foundQuote.notes || '',
    customerMessage: foundQuote.customerMessage || '',
    lineItems: foundQuote.lineItems,
  })

  const [updated] = await db.update(quote).set({
    status: 'approved',
    approvedAt: signedAt,
    signature: body.signature,
    signedAt,
    signedBy: signerName,
    signedIp: ip,
    signedUserAgent: userAgent,
    signatureHash: documentHash,
    consentAt: signedAt,
    updatedAt: signedAt,
  }).where(eq(quote.id, id)).returning()

  // A signed proposal moves the roofing pipeline forward, same as the admin
  // marking it signed by hand.
  if (foundQuote.jobId) {
    await db.update(job).set({ status: 'signed', updatedAt: signedAt }).where(eq(job.id, foundQuote.jobId))
  }

  return c.json({ success: true, quote: updated })
})

// Decline a quote
app.post('/quotes/:id/decline', portalAuth, async (c) => {
  const portalContact = c.get('portalContact') as any
  const companyId = c.get('portalCompanyId') as string
  const id = c.req.param('id')
  const { reason } = await c.req.json().catch(() => ({ reason: null }))

  const [foundQuote] = await db.select().from(quote)
    .where(and(eq(quote.id, id), eq(quote.contactId, portalContact.id), eq(quote.companyId, companyId)))
    .limit(1)
  if (!foundQuote || foundQuote.status === 'draft') return c.json({ error: 'Quote not found' }, 404)
  if (foundQuote.status === 'approved') return c.json({ error: 'Quote already approved' }, 400)

  const now = new Date()
  const [updated] = await db.update(quote).set({
    status: 'declined',
    declinedAt: now,
    notes: reason ? `${foundQuote.notes ? foundQuote.notes + '\n\n' : ''}Declined by customer: ${String(reason).slice(0, 500)}` : foundQuote.notes,
    updatedAt: now,
  }).where(eq(quote.id, id)).returning()

  return c.json({ success: true, quote: updated })
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
    // Drafts are the office's working copies and void invoices are cancelled — neither is the customer's business.
    .where(and(eq(invoice.contactId, portalContact.id), eq(invoice.companyId, companyId), notInArray(invoice.status, PORTAL_INVOICE_HIDDEN)))
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
