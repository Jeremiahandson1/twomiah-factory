// Job applications — the office's review queue (ported from CVHC routes/applicationsRoutes.js).
//
// Applicants apply through the public careers form (routes/careersPublic.ts → POST
// /api/public/careers/apply). Everything here is the office's: an application carries a date of
// birth, a felony answer and references, so reads are requireAdmin as well as writes.
import { Hono } from 'hono'
import { and, desc, eq, gte, lte, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { applications, applicationStatusHistory, users, caregiverProfiles } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { createId } from '@paralleldrive/cuid2'
import { createApplication } from '../services/applicationIntake.ts'
import { createPacketForHire } from '../services/onboardingPackets.ts'
import { sendCaregiverWelcome } from '../services/staffEmails.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)

// Statuses the office moves an application through. 'hired' is only reachable through /hire,
// which also creates the login.
export const APPLICATION_STATUSES = ['new', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected']

const dateParam = (v: string | undefined) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null)

// GET /api/applications?status=&startDate=&endDate=
app.get('/', async (c) => {
  const status = c.req.query('status')
  const start = dateParam(c.req.query('startDate'))
  const end = dateParam(c.req.query('endDate'))
  const conds = [
    status ? eq(applications.status, status) : undefined,
    start ? gte(applications.createdAt, start) : undefined,
    end ? lte(applications.createdAt, end) : undefined,
  ].filter(Boolean) as any[]
  const rows = await db.select().from(applications)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(applications.createdAt))
  return c.json(rows)
})

// GET /api/applications/stats/summary — registered before /:id
app.get('/stats/summary', async (c) => {
  const [row] = await db.select({
    total: sql<number>`COUNT(*)::int`,
    newCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'new'))::int`,
    reviewingCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'reviewing'))::int`,
    interviewedCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'interviewed'))::int`,
    offeredCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'offered'))::int`,
    hiredCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'hired'))::int`,
    rejectedCount: sql<number>`(COUNT(*) FILTER (WHERE ${applications.status} = 'rejected'))::int`,
    last7Days: sql<number>`(COUNT(*) FILTER (WHERE ${applications.createdAt} >= CURRENT_DATE - INTERVAL '7 days'))::int`,
    last30Days: sql<number>`(COUNT(*) FILTER (WHERE ${applications.createdAt} >= CURRENT_DATE - INTERVAL '30 days'))::int`,
  }).from(applications)
  return c.json(row)
})

// GET /api/applications/:id — with its status history
app.get('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.select().from(applications).where(eq(applications.id, id))
  if (!row) return c.json({ error: 'Application not found' }, 404)
  const history = await db.select().from(applicationStatusHistory)
    .where(eq(applicationStatusHistory.applicationId, id))
    .orderBy(desc(applicationStatusHistory.createdAt))
  return c.json({ ...row, statusHistory: history })
})

// POST /api/applications — the office enters an application by hand (paper, phone)
app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const r = await createApplication(body)
  if (!r.ok) return c.json({ error: r.error }, r.status)
  const [row] = await db.select().from(applications).where(eq(applications.id, r.id))
  return c.json(row, 201)
})

// PUT /api/applications/:id/status
app.put('/:id/status', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const status = body.status
  if (status === 'hired') {
    return c.json({ error: 'Use the "Hire as Caregiver" button to hire applicants — this creates their login account.' }, 400)
  }
  if (!APPLICATION_STATUSES.includes(status)) return c.json({ error: 'Unknown application status' }, 400)
  const [row] = await db.update(applications)
    .set({ status, updatedAt: new Date() })
    .where(eq(applications.id, id))
    .returning()
  if (!row) return c.json({ error: 'Application not found' }, 404)
  const user = c.get('user') as any
  await db.insert(applicationStatusHistory).values({
    applicationId: id, status, notes: typeof body.notes === 'string' && body.notes.trim() ? body.notes : null, changedById: user?.userId || null,
  })
  return c.json({ success: true, application: row })
})

// POST /api/applications/:id/notes — appended, dated, never overwritten
app.post('/:id/notes', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''
  if (!notes) return c.json({ error: 'Notes are required' }, 400)
  const [row] = await db.update(applications)
    .set({
      interviewNotes: sql`COALESCE(${applications.interviewNotes}, '') || E'\n\n' || ${notes} || ' - ' || CURRENT_DATE::text`,
      updatedAt: new Date(),
    })
    .where(eq(applications.id, id))
    .returning()
  if (!row) return c.json({ error: 'Application not found' }, 404)
  return c.json({ success: true, application: row })
})

// POST /api/applications/:id/hire — convert the applicant to a caregiver: login, profile, onboarding
// packet (background-check consent), welcome email with the temporary password.
app.post('/:id/hire', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json().catch(() => ({})) as any
  const user = c.get('user') as any

  const [a] = await db.select().from(applications).where(eq(applications.id, id))
  if (!a) return c.json({ error: 'Application not found' }, 404)
  if (a.status === 'hired') return c.json({ error: 'This applicant has already been hired' }, 400)

  const email = String(body.email || a.email || '').toLowerCase().trim()
  if (!email) return c.json({ error: 'Email is required to create caregiver account' }, 400)
  const [existing] = await db.select({ id: users.id }).from(users).where(sql`LOWER(${users.email}) = ${email}`).limit(1)
  if (existing) return c.json({ error: 'A user with this email already exists' }, 409)

  let rate: string | null = null
  const rawRate = body.hourlyRate ?? a.desiredPayRate
  if (rawRate !== undefined && rawRate !== null && rawRate !== '') {
    const n = Number(rawRate)
    if (!Number.isFinite(n) || n < 0) return c.json({ error: 'Hourly rate must be a number of zero or more' }, 400)
    rate = n.toFixed(2)
  }

  const tempPassword = body.password || `Welcome${a.lastName.charAt(0).toUpperCase()}${createId().slice(0, 6)}`
  const passwordHash = await Bun.password.hash(tempPassword, 'bcrypt')

  const certs = Array.isArray(a.certifications) ? (a.certifications as string[]) : []
  const certList = [...new Set([
    ...certs,
    ...(a.hasCna ? ['CNA'] : []),
    ...(a.hasLpn ? ['LPN'] : []),
    ...(a.hasRn ? ['RN'] : []),
    ...(a.hasCpr ? ['CPR'] : []),
    ...(a.hasFirstAid ? ['First Aid'] : []),
  ])]

  const [caregiver] = await db.insert(users).values({
    email, passwordHash,
    firstName: a.firstName, lastName: a.lastName, phone: a.phone,
    role: 'caregiver',
    address: a.address, city: a.city, state: a.state, zip: a.zip,
    certifications: certList,
    defaultPayRate: rate,
    hireDate: new Date().toISOString().split('T')[0],
  }).returning({ id: users.id, email: users.email, firstName: users.firstName, lastName: users.lastName, role: users.role, defaultPayRate: users.defaultPayRate })

  await db.insert(caregiverProfiles).values({ caregiverId: caregiver.id, notes: a.interviewNotes || a.notes })
  await db.update(applications).set({ status: 'hired', hiredUserId: caregiver.id, updatedAt: new Date() }).where(eq(applications.id, id))
  await db.insert(applicationStatusHistory).values({
    applicationId: id, status: 'hired', notes: 'Converted to caregiver. Temporary password was set.', changedById: user?.userId || null,
  })

  // The onboarding packet collects background-check consent and the deeper details. A failure here
  // must not undo the hire — the office can send a packet from the Onboarding queue.
  let packetUrl: string | null = null
  let packetCreated = false
  try {
    const p = await createPacketForHire({ caregiverId: caregiver.id, applicationId: a.id, createdById: user?.userId || null, email, firstName: a.firstName })
    packetUrl = p.url
    packetCreated = true
  } catch (err: any) {
    console.error('[hire] onboarding packet creation failed:', err?.message)
  }

  sendCaregiverWelcome({ to: email, firstName: a.firstName, tempPassword })
    .catch((err) => console.error('[Caregiver welcome email error]', err?.message))

  return c.json({
    success: true,
    caregiverId: caregiver.id,
    tempPassword,
    caregiver,
    packetUrl,
    packetCreated,
    message: packetCreated
      ? `${a.firstName} ${a.lastName} is now a caregiver. An onboarding packet email has been sent for background check consent, and a separate email has their login credentials.`
      : `${a.firstName} ${a.lastName} is now a caregiver. A welcome email has been sent with login instructions.`,
  })
})

// DELETE /api/applications/:id
app.delete('/:id', async (c) => {
  const id = c.req.param('id')
  const [row] = await db.delete(applications).where(eq(applications.id, id)).returning({ id: applications.id })
  if (!row) return c.json({ error: 'Application not found' }, 404)
  return c.json({ success: true })
})

export default app
