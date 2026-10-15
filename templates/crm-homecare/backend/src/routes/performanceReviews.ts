// Performance reviews — the office's ratings of a caregiver at a client (ported from CVHC
// routes/performanceReviewsRoutes.js, which CVHC added 2026-03-18 because its Performance screen had
// no backend).
//
// Stored on performance_ratings. The review's text fields (notes, strengths, areas for improvement,
// overall assessment) travel as JSON in `comments`, and the assessment sets the satisfaction score
// the dashboard averages: excellent 5, satisfactory 3, needs improvement 1. Office only.
import { Hono } from 'hono'
import { desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { db } from '../../db/index.ts'
import { performanceRatings, users, clients } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

export const SATISFACTION_BY_ASSESSMENT: Record<string, number> = { excellent: 5, satisfactory: 3, needs_improvement: 1 }

const parseComments = (comments: string | null) => {
  if (!comments) return {}
  try {
    const v = JSON.parse(comments)
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

const caregiver = alias(users, 'caregiver_user')

// GET /api/performance-reviews?caregiverId=
app.get('/', async (c) => {
  const caregiverId = c.req.query('caregiverId')
  const rows = await db.select({
    review: performanceRatings,
    caregiverFirstName: caregiver.firstName, caregiverLastName: caregiver.lastName,
    clientFirstName: clients.firstName, clientLastName: clients.lastName,
  })
    .from(performanceRatings)
    .leftJoin(caregiver, eq(performanceRatings.caregiverId, caregiver.id))
    .leftJoin(clients, eq(performanceRatings.clientId, clients.id))
    .where(caregiverId ? eq(performanceRatings.caregiverId, caregiverId) : undefined)
    .orderBy(desc(performanceRatings.ratingDate))
  return c.json(rows.map(({ review, ...names }) => {
    const parsed: any = parseComments(review.comments)
    return {
      ...review,
      ...names,
      reviewDate: review.ratingDate,
      caregiverName: names.caregiverFirstName ? `${names.caregiverFirstName} ${names.caregiverLastName}` : null,
      clientName: names.clientFirstName ? `${names.clientFirstName} ${names.clientLastName}` : null,
      performanceNotes: parsed.performance_notes || (Object.keys(parsed).length ? '' : review.comments || ''),
      strengths: parsed.strengths || '',
      areasForImprovement: parsed.areas_for_improvement || '',
      overallAssessment: parsed.overall_assessment || 'satisfactory',
    }
  }))
})

// POST /api/performance-reviews
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const { caregiverId, clientId, reviewDate, performanceNotes, strengths, areasForImprovement, overallAssessment } = body
  if (!caregiverId || !clientId) return c.json({ error: 'Caregiver and Client are required' }, 400)
  if (reviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(reviewDate))) return c.json({ error: 'Review date is not a valid date' }, 400)
  const [cg] = await db.select({ id: users.id }).from(users).where(eq(users.id, String(caregiverId)))
  const [cl] = await db.select({ id: clients.id }).from(clients).where(eq(clients.id, String(clientId)))
  if (!cg || !cl) return c.json({ error: 'Caregiver or client not found' }, 404)

  const assessment = Object.prototype.hasOwnProperty.call(SATISFACTION_BY_ASSESSMENT, overallAssessment) ? overallAssessment : 'satisfactory'
  const [row] = await db.insert(performanceRatings).values({
    caregiverId: cg.id,
    clientId: cl.id,
    ratingDate: reviewDate || new Date().toISOString().split('T')[0],
    satisfactionScore: SATISFACTION_BY_ASSESSMENT[assessment],
    comments: JSON.stringify({
      performance_notes: performanceNotes,
      strengths,
      areas_for_improvement: areasForImprovement,
      overall_assessment: assessment,
    }),
  }).returning()
  return c.json({
    ...row,
    performanceNotes, strengths, areasForImprovement, overallAssessment: assessment,
    reviewDate: row.ratingDate,
  }, 201)
})

// PUT /api/performance-reviews/:id — the template's score fields
app.put('/:id', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const score = (v: unknown) => (v === undefined ? undefined : v === null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : NaN)
  const set: Record<string, unknown> = {}
  for (const k of ['satisfactionScore', 'punctualityScore', 'professionalismScore', 'careQualityScore']) {
    const s = score(body[k])
    if (Number.isNaN(s)) return c.json({ error: 'Scores are whole numbers from 1 to 5' }, 400)
    if (s !== undefined) set[k] = s
  }
  for (const k of ['noShows', 'lateArrivals']) {
    if (body[k] !== undefined) {
      const n = Number(body[k])
      if (!Number.isInteger(n) || n < 0) return c.json({ error: 'Counts are whole numbers of zero or more' }, 400)
      set[k] = n
    }
  }
  if (typeof body.comments === 'string') set.comments = body.comments
  const [updated] = await db.update(performanceRatings).set({ ...set, updatedAt: new Date() })
    .where(eq(performanceRatings.id, c.req.param('id'))).returning()
  if (!updated) return c.json({ error: 'Review not found' }, 404)
  return c.json(updated)
})

// DELETE /api/performance-reviews/:id
app.delete('/:id', async (c) => {
  const [row] = await db.delete(performanceRatings).where(eq(performanceRatings.id, c.req.param('id'))).returning({ id: performanceRatings.id })
  if (!row) return c.json({ error: 'Review not found' }, 404)
  return c.json({ success: true })
})

export default app
