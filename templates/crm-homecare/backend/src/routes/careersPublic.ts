// Public careers endpoints — no sign-in (ported from CVHC publicLeadRoutes.js job-postings + the
// public POST in applicationsRoutes.js). Mounted at /api/public/careers; index.ts rate-limits it.
//
//   GET  /job-postings         open, published postings (empty → the careers page shows the
//                              general "always building our caregiver pool" copy)
//   GET  /job-postings/:slug   one open posting, for its own apply page
//   POST /apply                a job application
//
// Only the public columns of a posting are returned — never who created it or the counts.
import { Hono } from 'hono'
import { and, desc, eq, gt, isNull, or, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { jobPostings } from '../../db/schema.ts'
import { createApplication } from '../services/applicationIntake.ts'

const app = new Hono()

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
const open = () => and(eq(jobPostings.isPublished, true), or(isNull(jobPostings.closesAt), gt(jobPostings.closesAt, new Date())))

app.get('/job-postings', async (c) => {
  const rows = await db.select(publicColumns).from(jobPostings).where(open())
    .orderBy(sql`${jobPostings.publishedAt} DESC NULLS LAST`, desc(jobPostings.createdAt))
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(rows)
})

app.get('/job-postings/:slug', async (c) => {
  const [row] = await db.select(publicColumns).from(jobPostings).where(and(eq(jobPostings.slug, c.req.param('slug')), open()))
  if (!row) return c.json({ error: 'Posting not found' }, 404)
  c.header('Cache-Control', 'public, max-age=60')
  return c.json(row)
})

app.post('/apply', async (c) => {
  const body = await c.req.json().catch(() => null) as any
  if (!body || typeof body !== 'object') return c.json({ error: 'Please fill in the application form.' }, 400)
  // Honeypot: real people never fill this hidden field; bots usually do. Answer as if it worked.
  if (body.botField || body['bot-field']) return c.json({ success: true })
  try {
    const r = await createApplication(body)
    if (!r.ok) return c.json({ error: r.error }, r.status)
    return c.json({ success: true, message: 'Application submitted successfully', applicationId: r.id })
  } catch (err: any) {
    console.error('Application submission error:', err?.message)
    return c.json({ error: 'Failed to submit application. Please try again.' }, 500)
  }
})

export default app
