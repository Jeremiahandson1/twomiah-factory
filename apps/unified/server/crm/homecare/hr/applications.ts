// Job applications — the office's review queue. Moved from templates/crm-homecare/backend/src/routes/applications.ts,
// mounted at /api/applications. Applicants apply through the public careers form (./careersPublic.ts).
//
// Everything here is the office's: an application carries a date of birth, a felony answer and references, so reads
// are care-hr:read and writes care-hr's write permissions (the template's requireAdmin on every route).
//
// Changes: the company's applications only; a hire makes a login in the agency's company with the unified caregiver
// role (`field`); the list is { data, pagination }.
import { Hono } from 'hono'
import { and, desc, eq, gte, lte } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { applications, applicationStatusHistory, user, caregiverProfiles } from '../../../db/schema/index.ts'
import { appendedNote, applicationCounts, emailIs } from '../../../data/homecareHrRoutes.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { all, body, companyOf, me, insertSeatedUser } from './shared.ts'

// Statuses the office moves an application through. 'hired' is only reachable through /hire, which also creates the login.
export const APPLICATION_STATUSES = ['new', 'reviewing', 'interviewed', 'offered', 'hired', 'rejected']

const dateParam = (v: string | undefined) => (v && !Number.isNaN(new Date(v).getTime()) ? new Date(v) : null)

export function createApplicationsRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const ours = (companyId: string, id: string) => and(eq(applications.id, id), eq(applications.companyId, companyId))

  // GET /api/applications?status=&startDate=&endDate=
  app.get('/', requirePermission('care-hr:read'), async (c) => {
    const status = c.req.query('status')
    const start = dateParam(c.req.query('startDate'))
    const end = dateParam(c.req.query('endDate'))
    const rows = await d.db.select().from(applications)
      .where(and(
        eq(applications.companyId, companyOf(c)),
        status ? eq(applications.status, status) : undefined,
        start ? gte(applications.createdAt, start) : undefined,
        end ? lte(applications.createdAt, end) : undefined,
      ))
      .orderBy(desc(applications.createdAt))
    return all(c, rows)
  })

  // GET /api/applications/stats/summary — before /:id
  app.get('/stats/summary', requirePermission('care-hr:read'), async (c) => {
    const [row] = await d.db.select(applicationCounts(applications.status, applications.createdAt))
      .from(applications).where(eq(applications.companyId, companyOf(c)))
    return one(c, row)
  })

  // GET /api/applications/:id — with its status history
  app.get('/:id', requirePermission('care-hr:read'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const [row] = await d.db.select().from(applications).where(ours(companyId, id))
    if (!row) return fail(c, 404, 'Application not found')
    const history = await d.db.select().from(applicationStatusHistory)
      .where(and(eq(applicationStatusHistory.companyId, companyId), eq(applicationStatusHistory.applicationId, id)))
      .orderBy(desc(applicationStatusHistory.createdAt))
    return one(c, { ...row, statusHistory: history })
  })

  // POST /api/applications — the office enters an application by hand (paper, phone)
  app.post('/', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const r = await core.applications.createApplication(companyId, await body(c))
    if (!r.ok) return fail(c, r.status, r.error)
    const [row] = await d.db.select().from(applications).where(ours(companyId, r.id))
    return one(c, row, 201)
  })

  // PUT /api/applications/:id/status
  app.put('/:id/status', requirePermission('care-hr:update'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const b = await body(c)
    const status = b.status
    if (status === 'hired') {
      return fail(c, 400, 'Use the "Hire as Caregiver" button to hire applicants — this creates their login account.')
    }
    if (!APPLICATION_STATUSES.includes(status)) return fail(c, 400, 'Unknown application status')
    const [row] = await d.db.update(applications).set({ status, updatedAt: new Date() }).where(ours(companyId, id)).returning()
    if (!row) return fail(c, 404, 'Application not found')
    await d.db.insert(applicationStatusHistory).values({
      companyId,
      applicationId: id, status,
      notes: typeof b.notes === 'string' && b.notes.trim() ? b.notes : null,
      changedById: me(c)?.userId || null,
    })
    return one(c, { success: true, application: row })
  })

  // POST /api/applications/:id/notes — appended, dated, never overwritten
  app.post('/:id/notes', requirePermission('care-hr:update'), async (c) => {
    const b = await body(c)
    const notes = typeof b.notes === 'string' ? b.notes.trim() : ''
    if (!notes) return fail(c, 400, 'Notes are required')
    const [row] = await d.db.update(applications)
      .set({ interviewNotes: appendedNote(applications.interviewNotes, notes), updatedAt: new Date() })
      .where(ours(companyOf(c), c.req.param('id')))
      .returning()
    if (!row) return fail(c, 404, 'Application not found')
    return one(c, { success: true, application: row })
  })

  // POST /api/applications/:id/hire — the applicant becomes a caregiver: login, profile, onboarding packet
  // (background-check consent), welcome email with the temporary password.
  app.post('/:id/hire', requirePermission('care-hr:create'), async (c) => {
    const companyId = companyOf(c)
    const id = c.req.param('id')
    const b = await body(c)
    const actor = me(c)

    const [a] = await d.db.select().from(applications).where(ours(companyId, id))
    if (!a) return fail(c, 404, 'Application not found')
    if (a.status === 'hired') return fail(c, 400, 'This applicant has already been hired')

    const email = String(b.email || a.email || '').toLowerCase().trim()
    if (!email) return fail(c, 400, 'Email is required to create caregiver account')
    const [existing] = await d.db.select({ id: user.id }).from(user)
      .where(and(eq(user.companyId, companyId), emailIs(user.email, email))).limit(1)
    if (existing) return fail(c, 409, 'A user with this email already exists')

    let rate: string | null = null
    const rawRate = b.hourlyRate ?? a.desiredPayRate
    if (rawRate !== undefined && rawRate !== null && rawRate !== '') {
      const n = Number(rawRate)
      if (!Number.isFinite(n) || n < 0) return fail(c, 400, 'Hourly rate must be a number of zero or more')
      rate = n.toFixed(2)
    }

    const tempPassword = b.password || `Welcome${a.lastName.charAt(0).toUpperCase()}${createId().slice(0, 6)}`
    const passwordHash = await Bun.password.hash(String(tempPassword), 'bcrypt')

    const certs = Array.isArray(a.certifications) ? (a.certifications as string[]) : []
    const certList = [...new Set([
      ...certs,
      ...(a.hasCna ? ['CNA'] : []),
      ...(a.hasLpn ? ['LPN'] : []),
      ...(a.hasRn ? ['RN'] : []),
      ...(a.hasCpr ? ['CPR'] : []),
      ...(a.hasFirstAid ? ['First Aid'] : []),
    ])]

    const seated = await insertSeatedUser(d, companyId, {
      email, passwordHash,
      firstName: a.firstName, lastName: a.lastName, phone: a.phone,
      role: 'field',
      address: a.address, city: a.city, state: a.state, zip: a.zip,
      certifications: certList,
      defaultPayRate: rate,
      // The agency's day, not UTC's: a hire made in the evening in Wisconsin is that day's hire (found in the move).
      hireDate: await core.time.today(companyId),
    }, { id: user.id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role, defaultPayRate: user.defaultPayRate })
    if ('refusal' in seated) return fail(c, 403, seated.refusal, 'seat_limit')
    const caregiver = seated.row

    await d.db.insert(caregiverProfiles).values({ companyId, caregiverId: caregiver.id, notes: a.interviewNotes || a.notes })
    await d.db.update(applications).set({ status: 'hired', hiredUserId: caregiver.id, updatedAt: new Date() }).where(ours(companyId, id))
    await d.db.insert(applicationStatusHistory).values({
      companyId,
      applicationId: id, status: 'hired', notes: 'Converted to caregiver. Temporary password was set.', changedById: actor?.userId || null,
    })

    // The onboarding packet collects background-check consent and the deeper details. A failure here must not undo the
    // hire — the office can send a packet from the Onboarding queue.
    let packetUrl: string | null = null
    let packetCreated = false
    try {
      const p = await core.onboarding.createPacketForHire(companyId, { caregiverId: caregiver.id, applicationId: a.id, createdById: actor?.userId || null, email, firstName: a.firstName })
      packetUrl = p.url
      packetCreated = true
    } catch (err: any) {
      d.logger.error('[hire] onboarding packet creation failed', { error: err?.message })
    }

    // The login goes to the new caregiver by email. The password comes back to the office's screen ONLY when that email
    // did not go — a send that threw, or no email provider (sendRaw's dev mode sends nothing). (Run 3)
    let credentialsEmailed = false
    try {
      const sent: any = await core.staffEmails.sendCaregiverWelcome(companyId, { to: email, firstName: a.firstName, tempPassword: String(tempPassword) })
      credentialsEmailed = !!sent?.success && !sent?.dev
    } catch (err: any) {
      d.logger.error('[Caregiver welcome email error]', { error: err?.message })
    }

    const who = `${a.firstName} ${a.lastName}`
    return one(c, {
      success: true,
      caregiverId: caregiver.id,
      caregiver,
      packetUrl,
      packetCreated,
      credentialsEmailed,
      emailedTo: email,
      ...(credentialsEmailed ? {} : { tempPassword }),
      message: credentialsEmailed
        ? (packetCreated
          ? `${who} is now a caregiver. Their login details were emailed to ${email}, and an onboarding packet email asks for background check consent.`
          : `${who} is now a caregiver. Their login details were emailed to ${email}.`)
        : `${who} is now a caregiver, but the email with their login could not be sent to ${email}. Give them the temporary password below yourself.`,
    })
  })

  // DELETE /api/applications/:id
  app.delete('/:id', requirePermission('care-hr:delete'), async (c) => {
    const [row] = await d.db.delete(applications).where(ours(companyOf(c), c.req.param('id'))).returning({ id: applications.id })
    if (!row) return fail(c, 404, 'Application not found')
    return done(c)
  })

  return app
}
