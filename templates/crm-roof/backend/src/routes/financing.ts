/**
 * Consumer Financing — Business/Storm tier feature.
 *
 * Tracks financing applications for roofing jobs. Supports multiple
 * lenders (Wisetack, GreenSky, Sunlight) but this route is agnostic —
 * it stores the application + status + lender reference. Actual API
 * integration with each lender is a follow-up (webhook endpoints call
 * the update methods here to sync status changes).
 *
 * Schema: financing_application (migration 0008_add_reviews_and_financing.sql).
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { financingApplication } from '../../db/schema.ts'
import { eq, and, desc } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import lenders, { LenderNotConfiguredError } from '../services/lenders.ts'

const app = new Hono()
app.use('*', authenticate)

const appSchema = z.object({
  contactId: z.string(),
  jobId: z.string().optional(),
  quoteId: z.string().optional(),
  lender: z.enum(['wisetack', 'greensky', 'sunlight', 'other']).default('wisetack'),
  amountRequested: z.number().positive(),
  termMonths: z.number().int().optional(),
  notes: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const contactId = c.req.query('contactId')

  const conditions = [eq(financingApplication.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(financingApplication.status, status))
  if (contactId) conditions.push(eq(financingApplication.contactId, contactId))

  const data = await db.select().from(financingApplication).where(and(...conditions)).orderBy(desc(financingApplication.createdAt))
  return c.json({ data })
})

app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const [found] = await db
    .select()
    .from(financingApplication)
    .where(and(eq(financingApplication.id, id), eq(financingApplication.companyId, currentUser.companyId)))
    .limit(1)
  if (!found) return c.json({ error: 'Application not found' }, 404)
  return c.json(found)
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = appSchema.parse(await c.req.json())
  const [created] = await db
    .insert(financingApplication)
    .values({
      ...data,
      amountRequested: String(data.amountRequested),
      companyId: currentUser.companyId,
    } as any)
    .returning()
  return c.json(created, 201)
})

// Mark sent to lender (after the API call to Wisetack/GreenSky/etc)
// — accepts manual override via body, OR calls the lender service if no
// body is provided and the lender is configured.
app.post('/:id/mark-sent', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({}))

  let applicationUrl = body.applicationUrl
  let lenderReference = body.lenderReference
  let expiresAt = body.expiresAt ? new Date(body.expiresAt) : undefined

  // If caller didn't pre-submit via the UI and the lender is configured,
  // submit the application through the service automatically.
  if (!applicationUrl) {
    const [app] = await db
      .select()
      .from(financingApplication)
      .where(and(eq(financingApplication.id, id), eq(financingApplication.companyId, currentUser.companyId)))
      .limit(1)
    if (!app) return c.json({ error: 'Application not found' }, 404)

    try {
      const result = await lenders.submitApplication({
        lender: app.lender as any,
        amountRequested: Number(app.amountRequested),
        termMonths: app.termMonths || undefined,
        contactName: body.contactName || '',
        contactEmail: body.contactEmail || '',
        contactPhone: body.contactPhone || '',
        contactAddress: body.contactAddress,
        jobDescription: body.jobDescription,
      })
      applicationUrl = result.applicationUrl
      lenderReference = result.lenderReference
      expiresAt = result.expiresAt
    } catch (e: any) {
      if (e instanceof LenderNotConfiguredError) {
        return c.json({ error: 'not_configured', message: e.message }, 503)
      }
      return c.json({ error: 'submit_failed', message: e.message }, 500)
    }
  }

  const [updated] = await db
    .update(financingApplication)
    .set({
      status: 'sent',
      sentAt: new Date(),
      applicationUrl,
      lenderReference,
      expiresAt,
      updatedAt: new Date(),
    } as any)
    .where(eq(financingApplication.id, id))
    .returning()
  return c.json(updated)
})

// Lender status endpoint — what's configured
app.get('/lenders/status', (c) => {
  return c.json({ configured: lenders.configuredLenders() })
})

// Wisetack webhook handler. Wisetack POSTs application status updates
// (approved, declined, funded). Requires WISETACK_WEBHOOK_SECRET to verify.
// No auth middleware on this route (webhook is authenticated via signature).
const webhookApp = new Hono()
webhookApp.post('/webhooks/wisetack', async (c) => {
  const signature = c.req.header('x-wisetack-signature') || ''
  const rawBody = await c.req.text()
  try {
    const payload = lenders.verifyWisetackWebhook(rawBody, signature)
    if (!payload) return c.json({ error: 'invalid_signature' }, 401)

    // Find the application by lender_reference and update status
    const [app] = await db
      .select()
      .from(financingApplication)
      .where(eq(financingApplication.lenderReference, payload.application_id))
      .limit(1)
    if (!app) return c.json({ error: 'application_not_found' }, 404)

    const updateData: any = { updatedAt: new Date() }
    if (payload.event_type === 'approved') {
      updateData.status = 'approved'
      updateData.approvedAt = new Date()
      if (payload.amount_approved !== undefined) updateData.amountApproved = String(payload.amount_approved)
      if (payload.term_months !== undefined) updateData.termMonths = payload.term_months
      if (payload.apr !== undefined) updateData.apr = String(payload.apr)
      if (payload.monthly_payment !== undefined) updateData.monthlyPayment = String(payload.monthly_payment)
    } else if (payload.event_type === 'declined') {
      updateData.status = 'declined'
      if (payload.decline_reason) updateData.notes = payload.decline_reason
    } else if (payload.event_type === 'funded') {
      updateData.status = 'funded'
      updateData.fundedAt = new Date()
    } else if (payload.event_type === 'expired') {
      updateData.status = 'expired'
    }

    await db.update(financingApplication).set(updateData).where(eq(financingApplication.id, app.id))
    return c.json({ success: true })
  } catch (e: any) {
    if (e instanceof LenderNotConfiguredError) {
      return c.json({ error: 'not_configured' }, 503)
    }
    return c.json({ error: 'webhook_failed', message: e.message }, 500)
  }
})
app.route('/', webhookApp)

// Update with lender approval (called by lender webhook handler)
app.post('/:id/approve', async (c) => {
  const id = c.req.param('id')
  const { amountApproved, termMonths, apr, monthlyPayment } = await c.req.json()
  const [updated] = await db
    .update(financingApplication)
    .set({
      status: 'approved',
      approvedAt: new Date(),
      amountApproved: amountApproved !== undefined ? String(amountApproved) : undefined,
      termMonths,
      apr: apr !== undefined ? String(apr) : undefined,
      monthlyPayment: monthlyPayment !== undefined ? String(monthlyPayment) : undefined,
      updatedAt: new Date(),
    } as any)
    .where(eq(financingApplication.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/decline', async (c) => {
  const id = c.req.param('id')
  const { notes } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(financingApplication)
    .set({ status: 'declined', notes, updatedAt: new Date() } as any)
    .where(eq(financingApplication.id, id))
    .returning()
  return c.json(updated)
})

app.post('/:id/mark-funded', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db
    .update(financingApplication)
    .set({ status: 'funded', fundedAt: new Date(), updatedAt: new Date() } as any)
    .where(eq(financingApplication.id, id))
    .returning()
  return c.json(updated)
})

app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(financingApplication).where(eq(financingApplication.id, id))
  return c.body(null, 204)
})

export default app
