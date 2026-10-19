// Performance reviews — the office's ratings of a caregiver at a client (care-hr; the template's requireAdmin on every
// route). Moved from templates/crm-homecare/backend/src/routes/performanceReviews.ts, mounted at /api/performance-reviews.
//
// Stored on performance_ratings. The review's text fields travel as JSON in `comments`, and the assessment sets the
// satisfaction score the dashboard averages: excellent 5, satisfactory 3, needs improvement 1.
//
// Changes: the company's reviews, caregivers and clients only; the list is { data, pagination }.
import { Hono } from 'hono'
import { and, desc, eq } from 'drizzle-orm'
import { alias } from 'drizzle-orm/pg-core'
import { performanceRatings, user, clients } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { all, body, companyOf, personInCompany } from './shared.ts'

export const SATISFACTION_BY_ASSESSMENT: Record<string, number> = { excellent: 5, satisfactory: 3, needs_improvement: 1 }

const parseComments = (comments: string | null) => {
  if (!comments) return {}
  try {
    const v = JSON.parse(comments)
    return v && typeof v === 'object' ? v : {}
  } catch { return {} }
}

const caregiver = alias(user, 'caregiver_user')

export function createPerformanceReviewsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const ours = (companyId: string, id: string) => and(eq(performanceRatings.id, id), eq(performanceRatings.companyId, companyId))

  // GET /api/performance-reviews?caregiverId=
  app.get('/', requirePermission('care-hr:read'), async (c) => {
    const caregiverId = c.req.query('caregiverId')
    const rows = await d.db.select({
      review: performanceRatings,
      caregiverFirstName: caregiver.firstName, caregiverLastName: caregiver.lastName,
      clientFirstName: clients.firstName, clientLastName: clients.lastName,
    })
      .from(performanceRatings)
      .leftJoin(caregiver, eq(performanceRatings.caregiverId, caregiver.id))
      .leftJoin(clients, eq(performanceRatings.clientId, clients.id))
      .where(and(eq(performanceRatings.companyId, companyOf(c)), caregiverId ? eq(performanceRatings.caregiverId, caregiverId) : undefined))
      .orderBy(desc(performanceRatings.ratingDate))
    return all(c, rows.map(({ review, ...names }: any) => {
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
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const { caregiverId, clientId, reviewDate, performanceNotes, strengths, areasForImprovement, overallAssessment } = await body(c)
    if (!caregiverId || !clientId) return fail(c, 400, 'Caregiver and Client are required')
    if (reviewDate && !/^\d{4}-\d{2}-\d{2}$/.test(String(reviewDate))) return fail(c, 400, 'Review date is not a valid date')
    const cg = await personInCompany(d, companyId, String(caregiverId))
    const [cl] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, String(clientId)), eq(clients.companyId, companyId)))
    if (!cg || !cl) return fail(c, 404, 'Caregiver or client not found')

    const assessment = Object.prototype.hasOwnProperty.call(SATISFACTION_BY_ASSESSMENT, overallAssessment) ? overallAssessment : 'satisfactory'
    const [row] = await d.db.insert(performanceRatings).values({
      companyId,
      caregiverId: cg,
      clientId: cl.id,
      // Undated: the agency's today (UTC's was tomorrow every US evening).
      ratingDate: reviewDate || await core.time.today(companyId),
      satisfactionScore: SATISFACTION_BY_ASSESSMENT[assessment],
      comments: JSON.stringify({
        performance_notes: performanceNotes,
        strengths,
        areas_for_improvement: areasForImprovement,
        overall_assessment: assessment,
      }),
    }).returning()
    return one(c, {
      ...row,
      performanceNotes, strengths, areasForImprovement, overallAssessment: assessment,
      reviewDate: row.ratingDate,
    }, 201)
  })

  // PUT /api/performance-reviews/:id — the score fields
  app.put('/:id', requirePermission('care-hr:update'), async (c) => {
    const b = await body(c)
    const score = (v: unknown) => (v === undefined ? undefined : v === null || v === '' ? null : Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 5 ? Number(v) : NaN)
    const set: Record<string, unknown> = {}
    for (const k of ['satisfactionScore', 'punctualityScore', 'professionalismScore', 'careQualityScore']) {
      const s = score(b[k])
      if (Number.isNaN(s)) return fail(c, 400, 'Scores are whole numbers from 1 to 5')
      if (s !== undefined) set[k] = s
    }
    for (const k of ['noShows', 'lateArrivals']) {
      if (b[k] !== undefined) {
        const n = Number(b[k])
        if (!Number.isInteger(n) || n < 0) return fail(c, 400, 'Counts are whole numbers of zero or more')
        set[k] = n
      }
    }
    if (typeof b.comments === 'string') set.comments = b.comments
    const [updated] = await d.db.update(performanceRatings).set({ ...set, updatedAt: new Date() })
      .where(ours(companyOf(c), c.req.param('id'))).returning()
    if (!updated) return fail(c, 404, 'Review not found')
    return one(c, updated)
  })

  // DELETE /api/performance-reviews/:id
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(performanceRatings).where(ours(companyOf(c), c.req.param('id'))).returning({ id: performanceRatings.id })
    if (!row) return fail(c, 404, 'Review not found')
    return done(c)
  })

  return app
}
