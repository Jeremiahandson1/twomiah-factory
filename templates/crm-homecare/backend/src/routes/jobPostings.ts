// Job postings — the office's openings for the public careers page (ported from CVHC
// routes/jobPostingsRoutes.js). The public list lives in routes/careersPublic.ts.
// Office only: every route here is requireAdmin.
import { Hono } from 'hono'
import { and, desc, eq, gt, isNull, lte, ne, or, sql, isNotNull } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { jobPostings } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

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

// Unique slug; when taken, append a short random suffix.
async function uniqueSlug(base: string, excludeId?: string) {
  const root = base || 'posting'
  const [hit] = await db.select({ id: jobPostings.id }).from(jobPostings)
    .where(excludeId ? and(eq(jobPostings.slug, root), ne(jobPostings.id, excludeId)) : eq(jobPostings.slug, root))
    .limit(1)
  if (!hit) return root
  return `${root}-${Math.random().toString(36).slice(2, 7)}`
}

// A pay figure: blank means "not stated"; anything else must be a non-negative number.
function payValue(v: unknown): { ok: true; value: string | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const n = Number(v)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n.toFixed(2) }
}

function dateValue(v: unknown): { ok: true; value: Date | null } | { ok: false } {
  if (v === undefined || v === null || v === '') return { ok: true, value: null }
  const d = new Date(String(v))
  return Number.isNaN(d.getTime()) ? { ok: false } : { ok: true, value: d }
}

// Written out in full: in a single-table select drizzle renders ${jobPostings.id} as a bare "id",
// which inside this subquery would resolve to applications.id and count nothing.
const liveCount = sql<number>`(SELECT COUNT(*)::int FROM applications a WHERE a.posting_id = "job_postings"."id")`

// GET /api/job-postings?status=published|draft|closed
app.get('/', async (c) => {
  const status = c.req.query('status')
  const now = new Date()
  const where =
    status === 'published' ? and(eq(jobPostings.isPublished, true), or(isNull(jobPostings.closesAt), gt(jobPostings.closesAt, now)))
    : status === 'draft' ? eq(jobPostings.isPublished, false)
    : status === 'closed' ? and(isNotNull(jobPostings.closesAt), lte(jobPostings.closesAt, now))
    : undefined
  const rows = await db.select({ posting: jobPostings, applicationsCountLive: liveCount })
    .from(jobPostings)
    .where(where)
    .orderBy(desc(jobPostings.isPublished), sql`${jobPostings.publishedAt} DESC NULLS LAST`, desc(jobPostings.createdAt))
  return c.json(rows.map((r) => ({ ...r.posting, applicationsCountLive: r.applicationsCountLive })))
})

// GET /api/job-postings/:id
app.get('/:id', async (c) => {
  const [row] = await db.select().from(jobPostings).where(eq(jobPostings.id, c.req.param('id')))
  if (!row) return c.json({ error: 'Job posting not found' }, 404)
  return c.json(row)
})

// POST /api/job-postings
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({})) as any
  const title = typeof body.title === 'string' ? body.title.trim() : ''
  const description = typeof body.description === 'string' ? body.description.trim() : ''
  if (!title || !description) return c.json({ error: 'Title and description are required' }, 400)
  const employmentType = body.employmentType || 'part_time'
  const payRateUnit = body.payRateUnit || 'hour'
  if (!EMPLOYMENT_TYPES.includes(employmentType)) return c.json({ error: 'Employment type must be full time, part time, PRN or contract' }, 400)
  if (!PAY_UNITS.includes(payRateUnit)) return c.json({ error: 'Pay must be per hour, week, year or visit' }, 400)
  const min = payValue(body.payRangeMin), max = payValue(body.payRangeMax), closes = dateValue(body.closesAt)
  if (!min.ok || !max.ok) return c.json({ error: 'Pay must be a number of zero or more' }, 400)
  if (min.value && max.value && Number(max.value) < Number(min.value)) return c.json({ error: 'Pay max cannot be less than pay min' }, 400)
  if (!closes.ok) return c.json({ error: 'Closing date is not a valid date' }, 400)

  const user = c.get('user') as any
  const [row] = await db.insert(jobPostings).values({
    title,
    slug: await uniqueSlug(slugify(title)),
    employmentType,
    location: body.location || null,
    payRangeMin: min.value,
    payRangeMax: max.value,
    payRateUnit,
    summary: body.summary || null,
    description,
    responsibilities: body.responsibilities || null,
    qualifications: body.qualifications || null,
    isPublished: !!body.isPublished,
    publishedAt: body.isPublished ? new Date() : null,
    closesAt: closes.value,
    createdById: user?.userId || null,
  }).returning()
  return c.json(row, 201)
})

// PUT /api/job-postings/:id
app.put('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const [current] = await db.select().from(jobPostings).where(eq(jobPostings.id, id))
  if (!current) return c.json({ error: 'Job posting not found' }, 404)

  if (body.employmentType && !EMPLOYMENT_TYPES.includes(body.employmentType)) return c.json({ error: 'Employment type must be full time, part time, PRN or contract' }, 400)
  if (body.payRateUnit && !PAY_UNITS.includes(body.payRateUnit)) return c.json({ error: 'Pay must be per hour, week, year or visit' }, 400)
  const min = payValue(body.payRangeMin), max = payValue(body.payRangeMax), closes = dateValue(body.closesAt)
  if (!min.ok || !max.ok) return c.json({ error: 'Pay must be a number of zero or more' }, 400)
  if (min.value && max.value && Number(max.value) < Number(min.value)) return c.json({ error: 'Pay max cannot be less than pay min' }, 400)
  if (!closes.ok) return c.json({ error: 'Closing date is not a valid date' }, 400)

  const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : current.title
  // Re-slug only when the title actually changed.
  const slug = title !== current.title ? await uniqueSlug(slugify(title), id) : current.slug
  // First-time publish stamps published_at; unpublishing keeps the last value.
  const isPublished = body.isPublished === undefined ? current.isPublished : !!body.isPublished
  const publishedAt = isPublished && !current.isPublished ? new Date() : current.publishedAt
  const description = typeof body.description === 'string' && body.description.trim() ? body.description.trim() : current.description

  const [row] = await db.update(jobPostings).set({
    title,
    slug,
    employmentType: body.employmentType || current.employmentType,
    location: body.location || null,
    payRangeMin: min.value,
    payRangeMax: max.value,
    payRateUnit: body.payRateUnit || current.payRateUnit,
    summary: body.summary || null,
    description,
    responsibilities: body.responsibilities || null,
    qualifications: body.qualifications || null,
    isPublished,
    publishedAt,
    closesAt: closes.value,
    updatedAt: new Date(),
  }).where(eq(jobPostings.id, id)).returning()
  return c.json(row)
})

// POST /api/job-postings/:id/publish
app.post('/:id/publish', async (c) => {
  const id = c.req.param('id')
  const [current] = await db.select().from(jobPostings).where(eq(jobPostings.id, id))
  if (!current) return c.json({ error: 'Not found' }, 404)
  const [row] = await db.update(jobPostings)
    .set({ isPublished: true, publishedAt: current.publishedAt || new Date(), updatedAt: new Date() })
    .where(eq(jobPostings.id, id)).returning()
  return c.json(row)
})

// POST /api/job-postings/:id/unpublish
app.post('/:id/unpublish', async (c) => {
  const [row] = await db.update(jobPostings)
    .set({ isPublished: false, updatedAt: new Date() })
    .where(eq(jobPostings.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// POST /api/job-postings/:id/close — closes now and takes it off the website
app.post('/:id/close', async (c) => {
  const [row] = await db.update(jobPostings)
    .set({ closesAt: new Date(), isPublished: false, updatedAt: new Date() })
    .where(eq(jobPostings.id, c.req.param('id'))).returning()
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json(row)
})

// DELETE /api/job-postings/:id — applications keep their data; posting_id is set null by the FK.
app.delete('/:id', async (c) => {
  const [row] = await db.delete(jobPostings).where(eq(jobPostings.id, c.req.param('id'))).returning({ id: jobPostings.id })
  if (!row) return c.json({ error: 'Not found' }, 404)
  return c.json({ success: true })
})

export default app
