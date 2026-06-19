import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import reviews from '../services/reviews.ts'
import audit from '../services/audit.ts'
import { db } from '../../db/index.ts'
import { reviewRequest } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

const app = new Hono()

// ── Public tracking endpoint (no auth) ────────────────────────────────────────

app.get('/track/:requestId/click', async (c) => {
  const requestId = c.req.param('requestId')
  await reviews.markReviewCompleted(requestId, { clicked: true })

  const [request] = await db.select().from(reviewRequest)
    .where(eq(reviewRequest.id, requestId))
    .limit(1)

  if (request?.reviewLink) {
    return c.redirect(request.reviewLink)
  }

  // Fallback: look up Google review URL from company settings
  if (request?.companyId) {
    const settings = await reviews.getReviewSettings(request.companyId)
    if (settings.reviewLink) {
      return c.redirect(settings.reviewLink)
    }
  }

  return c.text('Review link not found', 404)
})

// ── Authenticated endpoints ───────────────────────────────────────────────────

app.use('*', authenticate)

// Get review settings
app.get('/settings', async (c) => {
  const user = c.get('user') as any
  const settings = await reviews.getReviewSettings(user.companyId)
  return c.json(settings)
})

// Update review settings
app.put('/settings', requireRole('admin', 'owner'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json()
  const settings = await reviews.updateReviewSettings(user.companyId, body)

  audit.log({
    action: 'REVIEW_SETTINGS_UPDATED',
    entity: 'company',
    entityId: user.companyId,
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(settings)
})

// Get review stats
app.get('/stats', async (c) => {
  const user = c.get('user') as any
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const stats = await reviews.getReviewStats(user.companyId, { startDate, endDate })
  return c.json(stats)
})

// List review requests
app.get('/', async (c) => {
  const user = c.get('user') as any
  const status = c.req.query('status')
  const limit = c.req.query('limit')
  const page = c.req.query('page')
  const requests = await reviews.getReviewRequests(user.companyId, {
    status: status || undefined,
    limit: parseInt(limit!) || 50,
    page: parseInt(page!) || 1,
  })
  return c.json(requests)
})

// Send review request for a job
app.post('/request/:jobId', async (c) => {
  const user = c.get('user') as any
  const jobId = c.req.param('jobId')
  const { channel = 'both' } = await c.req.json()

  const result = await reviews.sendReviewRequest(jobId, { channel })

  audit.log({
    action: 'REVIEW_REQUEST_SENT',
    entity: 'job',
    entityId: jobId,
    metadata: { channel },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json(result)
})

// Schedule review request for a job
app.post('/schedule/:jobId', async (c) => {
  const jobId = c.req.param('jobId')
  const request = await reviews.scheduleReviewRequest(jobId)

  if (!request) {
    return c.json({ error: 'Could not schedule review request' }, 400)
  }

  return c.json(request)
})

// Send follow-up
app.post('/follow-up/:requestId', async (c) => {
  const requestId = c.req.param('requestId')
  const result = await reviews.sendFollowUp(requestId)

  if (!result) {
    return c.json({ error: 'Could not send follow-up' }, 400)
  }

  return c.json(result)
})

// Process scheduled requests (manual trigger)
app.post('/process-scheduled', requireRole('admin', 'owner'), async (c) => {
  const results = await reviews.processScheduledRequests()
  return c.json({ processed: results.length, results })
})

// Generate review link preview
app.get('/preview-link', async (c) => {
  const placeId = c.req.query('placeId')

  if (!placeId) {
    return c.json({ error: 'placeId is required' }, 400)
  }

  const link = reviews.generateGoogleReviewLink(placeId)
  return c.json({ link })
})

export default app
