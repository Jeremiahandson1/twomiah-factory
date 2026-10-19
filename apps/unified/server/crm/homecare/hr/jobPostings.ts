// Job postings — the office's openings (/api/job-postings, care-hr; the template's requireAdmin on every route) and the
// public careers endpoints (/api/public/careers, no sign-in). Moved from
// templates/crm-homecare/backend/src/routes/{jobPostings,careersPublic}.ts.
//
// Changes: the office's postings are its company's; the public side is the database's one company (one company per
// tenant database, SPEC §2); the public door is rate-limited inside its router (the template's index.ts: 10 writes an
// hour and 60 reads a minute per address); lists are { data, pagination }.
import { Hono } from 'hono'
import { and, asc, desc, eq, gt, isNotNull, isNull, lte, ne, or } from 'drizzle-orm'
import { company, jobPostings } from '../../../db/schema/index.ts'
import { descNullsLast, postingApplicationsLive } from '../../../data/homecareHrRoutes.ts'
import type { AppEnv } from '../../../http/env.ts'
import { createRateLimiter, isWrite } from '../../../http/guards.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { all, body, companyOf, me } from './shared.ts'

const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'prn', 'contract']
const PAY_UNITS = ['hour', 'week', 'year', 'visit']

export const slugify = (title: unknown) =>
  String(title || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 180)

// A pay figure: blank means "not stated"; anything else must be a non-negative number.
function payValue(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n.toFixed(2) }
}

function dateValue(v: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const dt = new Date(String(v))
  return Number.isNaN(dt.getTime()) ? { ok: false } : { ok: true, value: dt }
}

export function createJobPostingsRoutes(_core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const ours = (companyId: string, id: string) => and(eq(jobPostings.id, id), eq(jobPostings.companyId, companyId))

  // A unique slug; when taken, a short random suffix. The slug is unique across the database (the careers page finds a
  // posting by it alone), so the check is too.
  async function uniqueSlug(base: string, excludeId?: string) {
    const root = base || 'posting'
    const [hit] = await d.db.select({ id: jobPostings.id }).from(jobPostings)
      .where(excludeId ? and(eq(jobPostings.slug, root), ne(jobPostings.id, excludeId)) : eq(jobPostings.slug, root))
      .limit(1)
    if (!hit) return root
    return `${root}-${Math.random().toString(36).slice(2, 7)}`
  }

  // GET /api/job-postings?status=published|draft|closed
  app.get('/', requirePermission('care-hr:read'), async (c) => {
    const status = c.req.query('status')
    const now = new Date()
    const where =
      status === 'published' ? and(eq(jobPostings.isPublished, true), or(isNull(jobPostings.closesAt), gt(jobPostings.closesAt, now)))
      : status === 'draft' ? eq(jobPostings.isPublished, false)
      : status === 'closed' ? and(isNotNull(jobPostings.closesAt), lte(jobPostings.closesAt, now))
      : undefined
    const rows = await d.db.select({ posting: jobPostings, applicationsCountLive: postingApplicationsLive })
      .from(jobPostings)
      .where(and(eq(jobPostings.companyId, companyOf(c)), where))
      .orderBy(desc(jobPostings.isPublished), descNullsLast(jobPostings.publishedAt), desc(jobPostings.createdAt))
    return all(c, rows.map((r: any) => ({ ...r.posting, applicationsCountLive: r.applicationsCountLive })))
  })

  // GET /api/job-postings/:id
  app.get('/:id', requirePermission('care-hr:read'), async (c) => {
    const [row] = await d.db.select().from(jobPostings).where(ours(companyOf(c), c.req.param('id')))
    if (!row) return fail(c, 404, 'Job posting not found')
    return one(c, row)
  })

  // POST /api/job-postings
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const b = await body(c)
    const title = typeof b.title === 'string' ? b.title.trim() : ''
    const description = typeof b.description === 'string' ? b.description.trim() : ''
    if (!title || !description) return fail(c, 400, 'Title and description are required')
    const employmentType = b.employmentType || 'part_time'
    const payRateUnit = b.payRateUnit || 'hour'
    if (!EMPLOYMENT_TYPES.includes(employmentType)) return fail(c, 400, 'Employment type must be full time, part time, PRN or contract')
    if (!PAY_UNITS.includes(payRateUnit)) return fail(c, 400, 'Pay must be per hour, week, year or visit')
    const min = payValue(b.payRangeMin), max = payValue(b.payRangeMax), closes = dateValue(b.closesAt)
    if (!min.ok || !max.ok) return fail(c, 400, 'Pay must be a number of zero or more')
    if (min.value && max.value && Number(max.value) < Number(min.value)) return fail(c, 400, 'Pay max cannot be less than pay min')
    if (!closes.ok) return fail(c, 400, 'Closing date is not a valid date')

    const [row] = await d.db.insert(jobPostings).values({
      companyId,
      title,
      slug: await uniqueSlug(slugify(title)),
      employmentType,
      location: b.location || null,
      payRangeMin: min.value,
      payRangeMax: max.value,
      payRateUnit,
      summary: b.summary || null,
      description,
      responsibilities: b.responsibilities || null,
      qualifications: b.qualifications || null,
      isPublished: !!b.isPublished,
      publishedAt: b.isPublished ? new Date() : null,
      closesAt: closes.value,
      createdById: me(c)?.userId || null,
    }).returning()
    return one(c, row, 201)
  })

  // PUT /api/job-postings/:id
  app.put('/:id', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const b = await body(c)
    const [current] = await d.db.select().from(jobPostings).where(ours(companyId, id))
    if (!current) return fail(c, 404, 'Job posting not found')

    if (b.employmentType && !EMPLOYMENT_TYPES.includes(b.employmentType)) return fail(c, 400, 'Employment type must be full time, part time, PRN or contract')
    if (b.payRateUnit && !PAY_UNITS.includes(b.payRateUnit)) return fail(c, 400, 'Pay must be per hour, week, year or visit')
    const min = payValue(b.payRangeMin), max = payValue(b.payRangeMax), closes = dateValue(b.closesAt)
    if (!min.ok || !max.ok) return fail(c, 400, 'Pay must be a number of zero or more')
    if (min.value && max.value && Number(max.value) < Number(min.value)) return fail(c, 400, 'Pay max cannot be less than pay min')
    if (!closes.ok) return fail(c, 400, 'Closing date is not a valid date')

    const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : current.title
    // Re-slug only when the title actually changed.
    const slug = title !== current.title ? await uniqueSlug(slugify(title), id) : current.slug
    // First-time publish stamps published_at; unpublishing keeps the last value.
    const isPublished = b.isPublished === undefined ? current.isPublished : !!b.isPublished
    const publishedAt = isPublished && !current.isPublished ? new Date() : current.publishedAt
    const description = typeof b.description === 'string' && b.description.trim() ? b.description.trim() : current.description

    const [row] = await d.db.update(jobPostings).set({
      title,
      slug,
      employmentType: b.employmentType || current.employmentType,
      location: b.location || null,
      payRangeMin: min.value,
      payRangeMax: max.value,
      payRateUnit: b.payRateUnit || current.payRateUnit,
      summary: b.summary || null,
      description,
      responsibilities: b.responsibilities || null,
      qualifications: b.qualifications || null,
      isPublished,
      publishedAt,
      closesAt: closes.value,
      updatedAt: new Date(),
    }).where(ours(companyId, id)).returning()
    return one(c, row)
  })

  // POST /api/job-postings/:id/publish
  app.post('/:id/publish', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const [current] = await d.db.select().from(jobPostings).where(ours(companyId, id))
    if (!current) return fail(c, 404, 'Not found')
    const [row] = await d.db.update(jobPostings)
      .set({ isPublished: true, publishedAt: current.publishedAt || new Date(), updatedAt: new Date() })
      .where(ours(companyId, id)).returning()
    return one(c, row)
  })

  // POST /api/job-postings/:id/unpublish
  app.post('/:id/unpublish', requirePermission('care-hr:update'), async (c) => {
    const [row] = await d.db.update(jobPostings).set({ isPublished: false, updatedAt: new Date() })
      .where(ours(companyOf(c), c.req.param('id'))).returning()
    if (!row) return fail(c, 404, 'Not found')
    return one(c, row)
  })

  // POST /api/job-postings/:id/close — closes now and takes it off the website
  app.post('/:id/close', requirePermission('care-hr:update'), async (c) => {
    const [row] = await d.db.update(jobPostings).set({ closesAt: new Date(), isPublished: false, updatedAt: new Date() })
      .where(ours(companyOf(c), c.req.param('id'))).returning()
    if (!row) return fail(c, 404, 'Not found')
    return one(c, row)
  })

  // DELETE /api/job-postings/:id — applications keep their data; posting_id is set null by the FK.
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(jobPostings).where(ours(companyOf(c), c.req.param('id'))).returning({ id: jobPostings.id })
    if (!row) return fail(c, 404, 'Not found')
    return done(c)
  })

  return app
}

// ── The public careers endpoints ────────────────────────────────────────────────────────────
//   GET  /job-postings         open, published postings (empty → the careers page shows its general copy)
//   GET  /job-postings/:slug   one open posting, for its own apply page
//   POST /apply                a job application
// Only the public columns of a posting are returned — never who created it or the counts.
const publicColumns = {
  id: jobPostings.id,
  title: jobPostings.title,
  slug: jobPostings.slug,
  employmentType: jobPostings.employmentType,
  location: jobPostings.location,
  payRangeMin: jobPostings.payRangeMin,
  payRangeMax: jobPostings.payRangeMax,
  payRateUnit: jobPostings.payRateUnit,
  summary: jobPostings.summary,
  description: jobPostings.description,
  responsibilities: jobPostings.responsibilities,
  qualifications: jobPostings.qualifications,
  publishedAt: jobPostings.publishedAt,
  closesAt: jobPostings.closesAt,
}

export function createCareersPublicRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  // The careers form: 10 applications an hour per address (bots); reads stay cheap.
  app.use('*', createRateLimiter(60 * 60 * 1000, 10, isWrite))
  app.use('*', createRateLimiter(60 * 1000, 60, (m) => !isWrite(m)))

  /** The business this database holds (one company per tenant database, SPEC §2): the oldest row. */
  async function theCompany(): Promise<string | null> {
    const [row] = await d.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    return row?.id ?? null
  }
  const open = (companyId: string) => and(
    eq(jobPostings.companyId, companyId),
    eq(jobPostings.isPublished, true),
    or(isNull(jobPostings.closesAt), gt(jobPostings.closesAt, new Date())),
  )

  app.get('/job-postings', async (c) => {
    const companyId = await theCompany()
    const rows = companyId
      ? await d.db.select(publicColumns).from(jobPostings).where(open(companyId))
        .orderBy(descNullsLast(jobPostings.publishedAt), desc(jobPostings.createdAt))
      : []
    c.header('Cache-Control', 'public, max-age=60')
    return all(c, rows)
  })

  app.get('/job-postings/:slug', async (c) => {
    const companyId = await theCompany()
    const [row] = companyId
      ? await d.db.select(publicColumns).from(jobPostings).where(and(eq(jobPostings.slug, c.req.param('slug')), open(companyId)))
      : []
    if (!row) return fail(c, 404, 'Posting not found')
    c.header('Cache-Control', 'public, max-age=60')
    return one(c, row)
  })

  app.post('/apply', async (c) => {
    const b = await c.req.json().catch(() => null) as any
    if (!b || typeof b !== 'object') return fail(c, 400, 'Please fill in the application form.')
    // Honeypot: real people never fill this hidden field; bots usually do. Answer as if it worked.
    if (b.botField || b['bot-field']) return done(c)
    const companyId = await theCompany()
    if (!companyId) return fail(c, 404, 'Not found')
    try {
      const r = await core.applications.createApplication(companyId, b)
      if (!r.ok) return fail(c, r.status, r.error)
      return one(c, { success: true, message: 'Application submitted successfully', applicationId: r.id })
    } catch (err: any) {
      d.logger.error('Application submission error', { error: err?.message })
      return fail(c, 500, 'Failed to submit application. Please try again.')
    }
  })

  return app
}
