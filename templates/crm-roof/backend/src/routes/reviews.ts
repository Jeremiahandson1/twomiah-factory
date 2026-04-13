/**
 * Reviews — Pro tier feature.
 *
 * Two resources:
 *   - /requests — ask a customer to leave a review via SMS/email
 *   - /  — reviews actually received (internal + scraped from Google etc)
 *
 * Ported from crm/ (Build) as a minimal standalone implementation. The
 * Build version integrates with services/reviews.ts for Google My Business
 * API tracking; this one is schema + CRUD only, leaving the GMB sync for
 * a follow-up.
 */
import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { reviewRequest, review } from '../../db/schema.ts'
import { eq, and, desc, avg, count } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import gmb, { GmbNotConfiguredError } from '../services/gmb.ts'

const app = new Hono()

// ─────────────────────────────────────────────────────────────
// PUBLIC — track a review click (no auth; visitor arrives from SMS/email)
// ─────────────────────────────────────────────────────────────

app.get('/track/:requestId/click', async (c) => {
  const requestId = c.req.param('requestId')
  const [r] = await db.select().from(reviewRequest).where(eq(reviewRequest.id, requestId)).limit(1)
  if (!r) return c.text('Not found', 404)

  await db
    .update(reviewRequest)
    .set({ status: 'clicked', clickedAt: new Date() } as any)
    .where(eq(reviewRequest.id, requestId))

  if (r.reviewLink) return c.redirect(r.reviewLink)
  return c.text('Thanks! No review link configured yet.')
})

// All other routes require auth
app.use('*', authenticate)

// ─────────────────────────────────────────────────────────────
// REVIEW REQUESTS
// ─────────────────────────────────────────────────────────────

const requestSchema = z.object({
  contactId: z.string(),
  jobId: z.string().optional(),
  channel: z.enum(['sms', 'email', 'both']).default('both'),
  reviewLink: z.string().optional(),
  message: z.string().optional(),
})

app.get('/requests', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const conditions = [eq(reviewRequest.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(reviewRequest.status, status))
  const data = await db.select().from(reviewRequest).where(and(...conditions)).orderBy(desc(reviewRequest.createdAt))
  return c.json({ data })
})

app.post('/requests', async (c) => {
  const currentUser = c.get('user') as any
  const data = requestSchema.parse(await c.req.json())
  const [created] = await db
    .insert(reviewRequest)
    .values({ ...data, companyId: currentUser.companyId } as any)
    .returning()
  return c.json(created, 201)
})

// Mark as sent (e.g., after SMS/email delivered)
app.post('/requests/:id/mark-sent', async (c) => {
  const id = c.req.param('id')
  const [updated] = await db
    .update(reviewRequest)
    .set({ status: 'sent', sentAt: new Date() } as any)
    .where(eq(reviewRequest.id, id))
    .returning()
  return c.json(updated)
})

app.delete('/requests/:id', async (c) => {
  const id = c.req.param('id')
  await db.delete(reviewRequest).where(eq(reviewRequest.id, id))
  return c.body(null, 204)
})

// ─────────────────────────────────────────────────────────────
// REVIEWS (received)
// ─────────────────────────────────────────────────────────────

const reviewBodySchema = z.object({
  rating: z.number().int().min(1).max(5),
  comment: z.string().optional(),
  platform: z.enum(['google', 'facebook', 'yelp', 'internal']).default('google'),
  reviewerName: z.string().optional(),
  contactId: z.string().optional(),
  jobId: z.string().optional(),
  requestId: z.string().optional(),
})

app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const platform = c.req.query('platform')
  const minRating = c.req.query('minRating')
  const conditions = [eq(review.companyId, currentUser.companyId)]
  if (platform) conditions.push(eq(review.platform, platform))
  const data = await db.select().from(review).where(and(...conditions)).orderBy(desc(review.receivedAt))
  const filtered = minRating ? data.filter((r) => r.rating >= Number(minRating)) : data
  return c.json({ data: filtered })
})

app.post('/', async (c) => {
  const currentUser = c.get('user') as any
  const data = reviewBodySchema.parse(await c.req.json())
  const [created] = await db
    .insert(review)
    .values({ ...data, companyId: currentUser.companyId } as any)
    .returning()
  return c.json(created, 201)
})

app.get('/summary', async (c) => {
  const currentUser = c.get('user') as any
  const [stats] = await db
    .select({ avgRating: avg(review.rating), total: count() })
    .from(review)
    .where(eq(review.companyId, currentUser.companyId))
  return c.json({
    averageRating: stats?.avgRating ? Number(stats.avgRating) : 0,
    totalReviews: Number(stats?.total || 0),
  })
})

// Google My Business sync — pulls reviews from GMB into the local review table.
// Stubbed service — returns "not configured" until env vars are set. See
// services/gmb.ts header for setup instructions.
app.get('/sync/gmb/status', (c) => {
  return c.json({ configured: gmb.isConfigured() })
})

app.post('/sync/gmb', async (c) => {
  const currentUser = c.get('user') as any
  try {
    const result = await gmb.syncReviews(currentUser.companyId)
    return c.json({ success: true, ...result })
  } catch (e: any) {
    if (e instanceof GmbNotConfiguredError) {
      return c.json({ error: 'not_configured', message: e.message }, 503)
    }
    return c.json({ error: 'sync_failed', message: e.message }, 500)
  }
})

export default app
