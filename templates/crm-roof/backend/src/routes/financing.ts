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
app.post('/:id/mark-sent', async (c) => {
  const id = c.req.param('id')
  const { applicationUrl, lenderReference } = await c.req.json().catch(() => ({}))
  const [updated] = await db
    .update(financingApplication)
    .set({
      status: 'sent',
      sentAt: new Date(),
      applicationUrl,
      lenderReference,
      updatedAt: new Date(),
    } as any)
    .where(eq(financingApplication.id, id))
    .returning()
  return c.json(updated)
})

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
