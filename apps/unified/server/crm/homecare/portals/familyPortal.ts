// Home care's family portal: relatives see the care of the person they look out for. Moved from
// templates/crm-homecare/backend/src/routes/familyPortal.ts.
//
// A family member is a family_members row: their own email + password, tied to one client, with four switches the
// office sets (schedule, care plan, medications, messaging). Separate from the client portal (./clientPortal.ts), whose
// logins are client_portal_accounts and which shows the client's whole account.
//
//   /admin/*    the office (care-portal permissions; the template's requireAdmin)
//   /client/:clientId/members   any staff member who may see that client (care-portal:read)
//   /login      public
//   /portal/*   a signed-in family member (familyAuth), each read gated on its switch
//
// Changes from the template:
//   · permissions, not rank: the office's reads were requireAdmin and are care-portal:update (a caregiver holds only
//     care-portal:read); adding a relative and replying are care-portal:create;
//   · GET /client/:clientId/members was open to every signed-in person for every client; it is care-portal:read AND
//     a client the person may see (core access: the office any of its company's clients, a caregiver only those they
//     serve) — a caregiver could read every client's relatives' phone numbers and emails (fixed);
//   · a reply names the person who wrote it (the app's sign-in carries no name; the template's fell back to "Care
//     Team" / "Staff" under it);
//   · every read and write is scoped to the company (the office's, or the signed-in relative's);
//   · lists are { data, pagination } (RULEBOOK §3), the schedule's keys are camelCase.
import { Hono, type Context, type Next } from 'hono'
import jwt from 'jsonwebtoken'
import { and, asc, desc, eq } from 'drizzle-orm'
import { createActorName } from '@twomiah/tenant-backend'
import {
  clients, company, familyMembers, familyMessages, carePlans, medications, timeEntries, user, portalMessageThreads, portalMessages,
} from '../../../db/schema/index.ts'
import { fail, one, done, listAll } from '../../../http/reply.ts'
import { createRateLimiter } from '../../../http/guards.ts'
import type { AppEnv } from '../../../http/env.ts'
import { familyEmailTaken, familyMemberForLogin, familyScheduleRows, caregiversServingClient } from '../../../data/homecarePortals.ts'
import { addDays } from '../core/agencyTime.ts'
import { mimeOf, UPCOMING_DAYS } from '../core/familyContent.ts'
import { activePlanWhere } from '../core/carePlanStatus.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import type { ClientPortal } from './clientPortal.ts'

export const FAMILY_RULES = { sessionHours: 24, minPasswordLength: 8 } as const
// The next four weeks of visits from the agency's today.
export const FAMILY_SCHEDULE_DAYS = 28

const normEmail = (e: unknown) => String(e ?? '').trim().toLowerCase()
const familyLoginUrl = () => `${process.env.FRONTEND_URL || ''}/family`

// The columns a family member row may be shown with. Never the password hash or the unused link token.
const memberColumns = {
  id: familyMembers.id,
  clientId: familyMembers.clientId,
  name: familyMembers.name,
  relationship: familyMembers.relationship,
  email: familyMembers.email,
  phone: familyMembers.phone,
  isActive: familyMembers.isActive,
  isPrimaryContact: familyMembers.isPrimaryContact,
  visitTextOptIn: familyMembers.visitTextOptIn,
  visitTextOptInAt: familyMembers.visitTextOptInAt,
  canViewSchedule: familyMembers.canViewSchedule,
  canViewCarePlan: familyMembers.canViewCarePlan,
  canViewMedications: familyMembers.canViewMedications,
  canViewVitals: familyMembers.canViewVitals,
  canViewDocuments: familyMembers.canViewDocuments,
  canMessage: familyMembers.canMessage,
  lastLogin: familyMembers.lastLoginAt,
  createdAt: familyMembers.createdAt,
  updatedAt: familyMembers.updatedAt,
}
type Member = { id: string; clientId: string; name: string; canViewSchedule: boolean | null; canViewCarePlan: boolean | null; canViewMedications: boolean | null; canViewVitals: boolean | null; canViewDocuments: boolean | null; canMessage: boolean | null } & Record<string, unknown>
type FamilyEnv = { Variables: AppEnv['Variables'] & { familyMember: Member; familyClientId: string; familyCompanyId: string } }
type Permission = 'canViewSchedule' | 'canViewCarePlan' | 'canViewMedications' | 'canViewVitals' | 'canViewDocuments' | 'canMessage'

/** "Mary" + "Smith" → "Mary Smith"; a single `name` is taken as given. */
const composeName = (b: any): string =>
  [b?.firstName, b?.lastName].map((s) => (typeof s === 'string' ? s.trim() : '')).filter(Boolean).join(' ')
  || (typeof b?.name === 'string' ? b.name.trim() : '')

const all = <T,>(c: Context, rows: T[]) => listAll(c, rows)

export function createFamilyPortalRoutes(core: HomecareCore, d: CrmDeps, clientPortal: ClientPortal) {
  const { db } = d
  const app = new Hono<FamilyEnv>()
  const staff = (permission: string) => [d.authenticate, d.permissions.requirePermission(permission)] as const
  const actorName = createActorName({ db, tables: { user } })
  const agencyName = async (companyId: string) => {
    const [row] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    return row?.name || ''
  }

  // ════ THE OFFICE ════════════════════════════════════════════════════════════════════════

  // GET /admin/family-texts, PUT /admin/family-texts { quietHoursStart, quietHoursEnd } — the hours (agency clock) when no arrival text is sent.
  // Only for an agency with care_family_texts; the office's care-portal:update, like the relatives' own opt-in.
  const textsOn = async (c: Context, companyId: string) => (await d.features.isFeatureEnabled(companyId, 'care_family_texts'))
    ? null : fail(c, 403, 'Family arrival texts are not switched on for this agency.', 'FEATURE_NOT_ENABLED')
  app.get('/admin/family-texts', ...staff('care-portal:update'), async (c) => {
    const companyId = (c.get('user' as never) as any).companyId as string
    return (await textsOn(c, companyId)) ?? one(c, await core.familyTexts.quietHours(companyId))
  })
  app.put('/admin/family-texts', ...staff('care-portal:update'), async (c) => {
    const companyId = (c.get('user' as never) as any).companyId as string
    const off = await textsOn(c, companyId)
    if (off) return off
    const b = await c.req.json().catch(() => ({})) as any
    const out = await core.familyTexts.saveQuietHours(companyId, b.quietHoursStart, b.quietHoursEnd)
    return 'problem' in out ? fail(c, 400, out.problem, 'bad_quiet_hours') : one(c, out)
  })

  // GET /admin/members?status=active|inactive&clientId=
  app.get('/admin/members', ...staff('care-portal:update'), async (c) => {
    const { status, clientId } = c.req.query()
    const conditions: any[] = [eq(familyMembers.companyId, c.get('user').companyId)]
    if (status === 'active') conditions.push(eq(familyMembers.isActive, true))
    else if (status === 'inactive') conditions.push(eq(familyMembers.isActive, false))
    if (clientId) conditions.push(eq(familyMembers.clientId, clientId))
    const rows = await db.select({ ...memberColumns, clientFirstName: clients.firstName, clientLastName: clients.lastName })
      .from(familyMembers)
      .innerJoin(clients, eq(familyMembers.clientId, clients.id))
      .where(and(...conditions))
      .orderBy(asc(clients.lastName), asc(clients.firstName), desc(familyMembers.isPrimaryContact))
    return all(c, rows)
  })

  // POST /admin/members — a relative's login.
  app.post('/admin/members', ...staff('care-portal:create'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    const name = composeName(b)
    const email = normEmail(b?.email)
    const password = typeof b?.password === 'string' ? b.password : ''
    if (!b?.clientId || !name || !email || !password) return fail(c, 400, 'Client, name, email and password are required')
    if (password.length < FAMILY_RULES.minPasswordLength) return fail(c, 400, 'Password must be at least 8 characters')
    const [client] = await db.select({ id: clients.id, firstName: clients.firstName, lastName: clients.lastName })
      .from(clients).where(and(eq(clients.id, String(b.clientId)), eq(clients.companyId, me.companyId))).limit(1)
    if (!client) return fail(c, 404, 'Client not found')
    if (await familyEmailTaken(db, email)) return fail(c, 400, 'Email already exists')
    const [row] = await db.insert(familyMembers).values({
      companyId: me.companyId,
      clientId: client.id,
      name,
      email,
      phone: b.phone || null,
      relationship: b.relationship || null,
      passwordHash: await Bun.password.hash(password, 'bcrypt'),
      canViewSchedule: b.canViewSchedule !== false,
      canViewCarePlan: b.canViewCarePlan !== false,
      canViewMedications: b.canViewMedications === true,
      // Vitals have their own switch (care_family_content); a new relative who may see medicines is shown vitals too unless the office says otherwise.
      canViewVitals: b.canViewVitals === undefined ? b.canViewMedications === true : b.canViewVitals === true,
      canViewDocuments: b.canViewDocuments === true,
      canMessage: b.canMessage !== false,
      isPrimaryContact: b.isPrimaryContact === true,
      // The relative's yes to arrival/departure texts, recorded by the office; never assumed.
      visitTextOptIn: b.visitTextOptIn === true && !!b.phone,
      visitTextOptInAt: b.visitTextOptIn === true && !!b.phone ? new Date() : null,
      isActive: true,
    }).returning(memberColumns)
    // Welcome email with the login. The account stands even if the email cannot go out.
    try {
      await core.email.sendFamilyPortalWelcome(email, {
        familyName: name,
        clientName: `${client.firstName} ${client.lastName}`,
        companyName: await agencyName(me.companyId),
        email,
        tempPassword: password,
        portalUrl: familyLoginUrl(),
      })
    } catch (err) {
      d.logger.warn('[family-portal] welcome email failed', { error: (err as Error).message })
    }
    return one(c, row, 201)
  })

  // PUT /admin/members/:id/status — { isActive }
  app.put('/admin/members/:id/status', ...staff('care-portal:update'), async (c) => {
    const { isActive } = await c.req.json().catch(() => ({} as any))
    if (typeof isActive !== 'boolean') return fail(c, 400, 'isActive must be true or false')
    const [row] = await db.update(familyMembers).set({ isActive, updatedAt: new Date() })
      .where(and(eq(familyMembers.id, c.req.param('id')!), eq(familyMembers.companyId, c.get('user').companyId)))
      .returning(memberColumns)
    if (!row) return fail(c, 404, 'Family member not found')
    return one(c, { success: true, member: row })
  })

  // PUT /admin/members/:id/reset-password — the office sets it; the relative is emailed it.
  app.put('/admin/members/:id/reset-password', ...staff('care-portal:update'), async (c) => {
    const me = c.get('user')
    const { password } = await c.req.json().catch(() => ({} as any))
    if (typeof password !== 'string' || password.length < FAMILY_RULES.minPasswordLength) return fail(c, 400, 'Password must be at least 8 characters')
    const [member] = await db.select({ id: familyMembers.id, name: familyMembers.name, email: familyMembers.email })
      .from(familyMembers).where(and(eq(familyMembers.id, c.req.param('id')!), eq(familyMembers.companyId, me.companyId))).limit(1)
    if (!member) return fail(c, 404, 'Family member not found')
    if (!member.email) return fail(c, 400, 'No login email on this family member')
    await db.update(familyMembers).set({ passwordHash: await Bun.password.hash(password, 'bcrypt'), updatedAt: new Date() })
      .where(and(eq(familyMembers.id, member.id), eq(familyMembers.companyId, me.companyId)))
    try {
      await core.email.sendFamilyPasswordSetByAdmin(member.email, {
        familyName: member.name,
        companyName: await agencyName(me.companyId),
        email: member.email,
        newPassword: password,
        portalUrl: familyLoginUrl(),
      })
    } catch (err) {
      d.logger.warn('[family-portal] password email failed', { error: (err as Error).message })
    }
    return done(c)
  })

  // PUT /admin/members/:id — details and permissions; anything not sent stays as it is.
  app.put('/admin/members/:id', ...staff('care-portal:update'), async (c) => {
    const me = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    const patch: Record<string, unknown> = {}
    const name = composeName(b)
    if (name) patch.name = name
    if (typeof b?.email === 'string' && b.email.trim()) {
      const email = normEmail(b.email)
      if (await familyEmailTaken(db, email, c.req.param('id')!)) return fail(c, 400, 'Email already exists')
      patch.email = email
    }
    if (typeof b?.phone === 'string') patch.phone = b.phone.trim() || null
    if (typeof b?.relationship === 'string') patch.relationship = b.relationship.trim() || null
    for (const k of ['canViewSchedule', 'canViewCarePlan', 'canViewMedications', 'canViewVitals', 'canViewDocuments', 'canMessage', 'isPrimaryContact'] as const) {
      if (typeof b?.[k] === 'boolean') patch[k] = b[k]
    }
    // Arrival/departure texts: turning them on needs a phone number on the relative (the one being saved, or the one on file).
    if (typeof b?.visitTextOptIn === 'boolean') {
      if (b.visitTextOptIn) {
        const phone = 'phone' in patch ? patch.phone : (await db.select({ phone: familyMembers.phone }).from(familyMembers)
          .where(and(eq(familyMembers.id, c.req.param('id')!), eq(familyMembers.companyId, me.companyId))).limit(1))[0]?.phone
        if (!phone) return fail(c, 400, 'Add a phone number before turning on arrival texts.', 'phone_required')
        patch.visitTextOptIn = true
        patch.visitTextOptInAt = new Date()
      } else { patch.visitTextOptIn = false; patch.visitTextOptInAt = null }
    }
    const [row] = await db.update(familyMembers).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(familyMembers.id, c.req.param('id')!), eq(familyMembers.companyId, me.companyId)))
      .returning(memberColumns)
    if (!row) return fail(c, 404, 'Family member not found')
    return one(c, row)
  })

  // GET /admin/messages — what relatives sent, unread first.
  app.get('/admin/messages', ...staff('care-portal:update'), async (c) => {
    const rows = await db.select({
      id: familyMessages.id,
      clientId: familyMessages.clientId,
      familyMemberId: familyMessages.familyMemberId,
      subject: familyMessages.subject,
      message: familyMessages.body,
      isRead: familyMessages.isRead,
      reply: familyMessages.reply,
      repliedAt: familyMessages.repliedAt,
      createdAt: familyMessages.createdAt,
      senderName: familyMembers.name,
      senderRelationship: familyMembers.relationship,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    }).from(familyMessages)
      .innerJoin(familyMembers, eq(familyMessages.familyMemberId, familyMembers.id))
      .innerJoin(clients, eq(familyMessages.clientId, clients.id))
      .where(and(eq(familyMessages.companyId, c.get('user').companyId), eq(familyMessages.senderType, 'family')))
      .orderBy(asc(familyMessages.isRead), desc(familyMessages.createdAt))
    return all(c, rows)
  })

  // POST /admin/messages/:id/reply — { reply }. Kept on the family's message and sent as its own row.
  app.post('/admin/messages/:id/reply', ...staff('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { reply } = await c.req.json().catch(() => ({} as any))
    if (typeof reply !== 'string' || !reply.trim()) return fail(c, 400, 'reply is required')
    const [original] = await db.select().from(familyMessages)
      .where(and(eq(familyMessages.id, c.req.param('id')!), eq(familyMessages.companyId, me.companyId), eq(familyMessages.senderType, 'family'))).limit(1)
    if (!original) return fail(c, 404, 'Message not found')
    await db.update(familyMessages).set({ isRead: true, reply: reply.trim(), repliedAt: new Date(), repliedById: me.userId || null })
      .where(and(eq(familyMessages.id, original.id), eq(familyMessages.companyId, me.companyId)))
    await db.insert(familyMessages).values({
      companyId: me.companyId,
      clientId: original.clientId,
      familyMemberId: original.familyMemberId,
      senderType: 'staff',
      senderName: await actorName(me),
      subject: original.subject ? `Re: ${original.subject}` : null,
      body: reply.trim(),
      isRead: true,
    })
    return done(c)
  })

  // GET /client/:clientId/members — a client's relatives (contact details), for staff who may see that client.
  app.get('/client/:clientId/members', ...staff('care-portal:read'), core.access.requireClientAccess('clientId'), async (c) => {
    const rows = await db.select(memberColumns).from(familyMembers)
      .where(and(eq(familyMembers.clientId, c.req.param('clientId')!), eq(familyMembers.companyId, c.get('user').companyId)))
      .orderBy(desc(familyMembers.isPrimaryContact), asc(familyMembers.name))
    return all(c, rows)
  })

  // ── The client portal's message threads (client → office), answered from here; shown beside the family messages
  // on the Family Portal screen. ──
  app.get('/admin/portal-threads', ...staff('care-portal:update'), async (c) => {
    const threads = await db.select({
      id: portalMessageThreads.id,
      clientId: portalMessageThreads.clientId,
      subject: portalMessageThreads.subject,
      status: portalMessageThreads.status,
      lastMessageAt: portalMessageThreads.lastMessageAt,
      staffLastReadAt: portalMessageThreads.staffLastReadAt,
      createdAt: portalMessageThreads.createdAt,
      clientFirstName: clients.firstName,
      clientLastName: clients.lastName,
    }).from(portalMessageThreads)
      .leftJoin(clients, eq(portalMessageThreads.clientId, clients.id))
      .where(eq(portalMessageThreads.companyId, c.get('user').companyId))
      .orderBy(desc(portalMessageThreads.lastMessageAt))
      .limit(200)
    return all(c, threads.map((t: any) => ({ ...t, hasUnread: !t.staffLastReadAt || new Date(t.lastMessageAt) > new Date(t.staffLastReadAt) })))
  })

  app.get('/admin/portal-threads/:id', ...staff('care-portal:update'), async (c) => {
    const companyId = c.get('user').companyId
    const [thread] = await db.select().from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.id, c.req.param('id')!), eq(portalMessageThreads.companyId, companyId))).limit(1)
    if (!thread) return fail(c, 404, 'Thread not found')
    const msgs = await db.select().from(portalMessages)
      .where(and(eq(portalMessages.threadId, thread.id), eq(portalMessages.companyId, companyId))).orderBy(portalMessages.createdAt)
    await db.update(portalMessageThreads).set({ staffLastReadAt: new Date() })
      .where(and(eq(portalMessageThreads.id, thread.id), eq(portalMessageThreads.companyId, companyId)))
    return one(c, { thread, messages: msgs })
  })

  app.post('/admin/portal-threads/:id/reply', ...staff('care-portal:create'), async (c) => {
    const me = c.get('user')
    const { body } = await c.req.json().catch(() => ({} as any))
    if (typeof body !== 'string' || !body.trim()) return fail(c, 400, 'body is required')
    const [thread] = await db.select({ id: portalMessageThreads.id }).from(portalMessageThreads)
      .where(and(eq(portalMessageThreads.id, c.req.param('id')!), eq(portalMessageThreads.companyId, me.companyId))).limit(1)
    if (!thread) return fail(c, 404, 'Thread not found')
    const [message] = await db.insert(portalMessages).values({
      companyId: me.companyId,
      threadId: thread.id,
      senderType: 'staff',
      senderName: await actorName(me),
      body: body.trim(),
    }).returning()
    await db.update(portalMessageThreads).set({ lastMessageAt: new Date(), staffLastReadAt: new Date(), updatedAt: new Date() })
      .where(and(eq(portalMessageThreads.id, thread.id), eq(portalMessageThreads.companyId, me.companyId)))
    return one(c, message, 201)
  })

  // ════ FAMILY SIGN-IN (public) ═══════════════════════════════════════════════════════════

  // 20 sign-ins per 15 minutes per address (the template's index.ts limit, here beside the route).
  app.post('/login', createRateLimiter(15 * 60 * 1000, 20), async (c) => {
    const { email, password } = await c.req.json().catch(() => ({} as any))
    if (!email || !password) return fail(c, 400, 'Email and password are required')
    const member = await familyMemberForLogin(db, normEmail(email))
    if (!member || !member.passwordHash) return fail(c, 401, 'Invalid credentials')
    const valid = await Bun.password.verify(String(password), member.passwordHash)
    if (!valid) return fail(c, 401, 'Invalid credentials')
    await db.update(familyMembers).set({ lastLoginAt: new Date() })
      .where(and(eq(familyMembers.id, member.id), eq(familyMembers.companyId, member.companyId)))
    const token = jwt.sign(
      { id: member.id, role: 'family', clientId: member.clientId, familyMemberId: member.id, companyId: member.companyId },
      process.env.JWT_SECRET!,
      { expiresIn: `${FAMILY_RULES.sessionHours}h` },
    )
    const [safe] = await db.select(memberColumns).from(familyMembers)
      .where(and(eq(familyMembers.id, member.id), eq(familyMembers.companyId, member.companyId))).limit(1)
    return one(c, { token, user: safe })
  })

  // Every portal request re-reads the member, so switching a relative off — or changing what they may see — applies
  // to their very next click, not at token expiry.
  async function familyAuth(c: Context<FamilyEnv>, next: Next) {
    const token = c.req.header('authorization')?.split(' ')[1]
    if (!token) return fail(c, 401, 'No token')
    let decoded: any
    try {
      decoded = jwt.verify(token, process.env.JWT_SECRET!)
    } catch {
      return fail(c, 401, 'Invalid token')
    }
    if (decoded?.role !== 'family' || !decoded.familyMemberId) return fail(c, 403, 'Access denied')
    const [member] = await db.select({ ...memberColumns, companyId: familyMembers.companyId }).from(familyMembers)
      .where(and(eq(familyMembers.id, String(decoded.familyMemberId)), eq(familyMembers.isActive, true))).limit(1)
    if (!member || (decoded.companyId && member.companyId !== decoded.companyId)) return fail(c, 403, 'Access denied')
    // A cancelled agency's portal is paused, like its staff CRM (core/portalLock.ts).
    const locked = await core.portalLock.refusePortalWhileLocked(c, member.companyId)
    if (locked) return locked
    const { companyId, ...shown } = member
    c.set('familyMember', shown as Member)
    c.set('familyClientId', member.clientId)
    c.set('familyCompanyId', companyId)
    await next()
  }

  const allowed = (c: Context<FamilyEnv>, p: Permission) => !!c.get('familyMember')?.[p]

  // ════ THE FAMILY'S PORTAL ═══════════════════════════════════════════════════════════════

  // careContent: the agency has the daily-care tabs on (care_family_content) — the portal shows them and wording like "Medicine list".
  app.get('/portal/me', familyAuth, async (c) => one(c, { ...c.get('familyMember'), careContent: await core.familyContent.enabled(c.get('familyCompanyId')) }))

  app.get('/portal/client', familyAuth, async (c) => {
    const companyId = c.get('familyCompanyId')
    const [client] = await db.select({
      id: clients.id, firstName: clients.firstName, lastName: clients.lastName, dateOfBirth: clients.dateOfBirth,
      address: clients.address, city: clients.city, state: clients.state, zip: clients.zip, phone: clients.phone,
    }).from(clients).where(and(eq(clients.id, c.get('familyClientId')), eq(clients.companyId, companyId))).limit(1)
    const [agency] = await db.select({ name: company.name, state: company.state }).from(company).where(eq(company.id, companyId)).limit(1)
    // timezone: the portal prints instants (vitals, visit notes, messages) on the agency's clock — the clock its visit
    // times are on.
    return one(c, { ...(client || {}), agencyName: agency?.name || null, agencyState: agency?.state || null, timezone: await core.time.timezone(companyId) })
  })

  // The next four weeks of visits from the agency's today, through the ONE schedule engine.
  app.get('/portal/schedule', familyAuth, async (c) => {
    if (!allowed(c, 'canViewSchedule')) return fail(c, 403, 'Access denied')
    const companyId = c.get('familyCompanyId')
    const today = await core.time.today(companyId)
    return all(c, await familyScheduleRows(db, companyId, c.get('familyClientId'), today, addDays(today, FAMILY_SCHEDULE_DAYS - 1)))
  })

  // Caregivers are part of the schedule tier. No phone numbers for relatives.
  app.get('/portal/caregivers', familyAuth, async (c) => {
    if (!allowed(c, 'canViewSchedule')) return fail(c, 403, 'Access denied')
    const companyId = c.get('familyCompanyId')
    return all(c, await caregiversServingClient(db, companyId, c.get('familyClientId'), await core.time.today(companyId), false))
  })

  app.get('/portal/caregivers/:caregiverId/background-checks', familyAuth, async (c) => {
    if (!allowed(c, 'canViewSchedule')) return fail(c, 403, 'Access denied')
    const rows = await clientPortal.backgroundCheckSummary(c.get('familyCompanyId'), c.req.param('caregiverId')!, c.get('familyClientId'))
    if (!rows) return fail(c, 403, 'This caregiver is not assigned to your loved one')
    return all(c, rows)
  })

  app.get('/portal/care-plan', familyAuth, async (c) => {
    if (!allowed(c, 'canViewCarePlan')) return fail(c, 403, 'Access denied')
    const companyId = c.get('familyCompanyId')
    const [plan] = await db.select({
      id: carePlans.id,
      serviceType: carePlans.serviceType,
      frequency: carePlans.frequency,
      careGoals: carePlans.careGoals,
      specialInstructions: carePlans.specialInstructions,
      precautions: carePlans.precautions,
      startDate: carePlans.startDate,
      endDate: carePlans.endDate,
      status: carePlans.status,
    }).from(carePlans)
      // The office's rule (core/carePlanStatus.ts): status Active and inside its dates — never a draft.
      .where(and(eq(carePlans.companyId, companyId), eq(carePlans.clientId, c.get('familyClientId')), activePlanWhere(await core.time.today(companyId))))
      .orderBy(desc(carePlans.createdAt)).limit(1)
    // No plan is an empty record rather than null (RULEBOOK §3: one record is an object).
    return one(c, plan || {})
  })

  app.get('/portal/medications', familyAuth, async (c) => {
    if (!allowed(c, 'canViewMedications')) return fail(c, 403, 'Access denied')
    const rows = await db.select({
      id: medications.id,
      name: medications.name,
      dosage: medications.dosage,
      frequency: medications.frequency,
      route: medications.route,
      prescribedBy: medications.prescribedBy,
      instructions: medications.instructions,
      isPrn: medications.isPrn,
      notes: medications.notes,
    }).from(medications)
      .where(and(eq(medications.companyId, c.get('familyCompanyId')), eq(medications.clientId, c.get('familyClientId')), eq(medications.status, 'active')))
      .orderBy(asc(medications.name))
    return all(c, rows)
  })

  // Vitals are part of the same clinical tier as medications (the source CRM's rule): the latest 60.
  // With care_family_content on, vitals have their own switch (canViewVitals); off, they ride on the medicines switch as before.
  app.get('/portal/vitals', familyAuth, async (c) => {
    const own = await core.familyContent.enabled(c.get('familyCompanyId'))
    if (!allowed(c, own ? 'canViewVitals' : 'canViewMedications')) return fail(c, 403, 'Access denied')
    const rows = await core.vitals.listClientVitals(c.get('familyCompanyId'), c.get('familyClientId'), 60)
    return all(c, rows.map((v: any) => ({
      id: v.id, recordedAt: v.recordedAt,
      systolicBp: v.systolicBp, diastolicBp: v.diastolicBp, pulse: v.pulse, respirations: v.respirations,
      oxygenSaturation: v.oxygenSaturation, temperatureF: v.temperatureF, bloodGlucose: v.bloodGlucose,
      weightLbs: v.weightLbs, painScale: v.painScale, painLocation: v.painLocation, notes: v.notes,
      caregiverFirst: v.caregiverFirst, caregiverLast: v.caregiverLast,
    })))
  })

  // ── Daily care, meals and documents (care_family_content, not ready) ─────────────────────────────────────────────────────────
  // The feature is off → 404 (the routes do not exist for that agency); on, each is behind the relative's own switch.
  const contentOff = async (c: Context<FamilyEnv>) => (await core.familyContent.enabled(c.get('familyCompanyId'))) ? null : fail(c, 404, 'Not found')

  // The tasks planned for each of the next visits — only those that belong to the visit's weekday and AM/PM.
  app.get('/portal/upcoming-tasks', familyAuth, async (c) => {
    const off = await contentOff(c); if (off) return off
    if (!allowed(c, 'canViewCarePlan') || !allowed(c, 'canViewSchedule')) return fail(c, 403, 'Access denied')
    const companyId = c.get('familyCompanyId')
    const today = await core.time.today(companyId)
    const visits = await familyScheduleRows(db, companyId, c.get('familyClientId'), today, addDays(today, UPCOMING_DAYS - 1))
    return all(c, await core.familyContent.upcoming(companyId, c.get('familyClientId'), visits))
  })

  // The last 30 days: each finished visit, its tasks done or not (never the caregiver's notes), and the meals recorded.
  app.get('/portal/task-log', familyAuth, async (c) => {
    const off = await contentOff(c); if (off) return off
    if (!allowed(c, 'canViewCarePlan')) return fail(c, 403, 'Access denied')
    return all(c, await core.familyContent.past(c.get('familyCompanyId'), c.get('familyClientId')))
  })

  app.get('/portal/documents', familyAuth, async (c) => {
    const off = await contentOff(c); if (off) return off
    if (!allowed(c, 'canViewDocuments')) return fail(c, 403, 'Access denied')
    return all(c, await core.familyContent.sharedDocuments(c.get('familyCompanyId'), c.get('familyClientId')))
  })
  app.get('/portal/documents/:id/download', familyAuth, async (c) => {
    const off = await contentOff(c); if (off) return off
    if (!allowed(c, 'canViewDocuments')) return fail(c, 403, 'Access denied')
    const doc = await core.familyContent.sharedDocumentFile(c.get('familyCompanyId'), c.get('familyClientId'), c.req.param('id')!)
    if (!doc || !doc.fileData) return fail(c, 404, 'Document not found')
    return new Response(new Uint8Array(Buffer.from(String(doc.fileData), 'base64')), { headers: {
      'Content-Type': mimeOf(doc.fileType),
      'Content-Disposition': `attachment; filename="${String(doc.fileName || 'document').replace(/[^\w.\- ]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
    } })
  })

  // Visit notes are part of the care-plan tier.
  app.get('/portal/notes', familyAuth, async (c) => {
    if (!allowed(c, 'canViewCarePlan')) return fail(c, 403, 'Access denied')
    const rows = await db.select({
      id: timeEntries.id,
      startTime: timeEntries.startTime,
      endTime: timeEntries.endTime,
      durationMinutes: timeEntries.durationMinutes,
      notes: timeEntries.notes,
      caregiverFirst: user.firstName,
      caregiverLast: user.lastName,
    }).from(timeEntries)
      .innerJoin(user, eq(timeEntries.caregiverId, user.id))
      .where(and(eq(timeEntries.companyId, c.get('familyCompanyId')), eq(timeEntries.clientId, c.get('familyClientId')), eq(timeEntries.isComplete, true)))
      .orderBy(desc(timeEntries.startTime))
      .limit(30)
    return all(c, rows)
  })

  // A family member's own messages and the office's replies to them — one row per message. An office reply is its own
  // 'staff' row (POST /admin/messages/:id/reply); the copy kept on the family's row (`reply`, the office's "answered"
  // marker) is NOT sent here, or the portal shows every reply twice (Run 4).
  app.get('/portal/messages', familyAuth, async (c) => {
    const member = c.get('familyMember')
    const rows = await db.select({
      id: familyMessages.id,
      senderType: familyMessages.senderType,
      subject: familyMessages.subject,
      message: familyMessages.body,
      createdAt: familyMessages.createdAt,
    }).from(familyMessages)
      .where(and(eq(familyMessages.companyId, c.get('familyCompanyId')), eq(familyMessages.clientId, member.clientId), eq(familyMessages.familyMemberId, member.id)))
      .orderBy(desc(familyMessages.createdAt))
      .limit(50)
    return all(c, rows.map((r: any) => ({ id: r.id, direction: r.senderType === 'family' ? 'inbound' : 'outbound', ...r })))
  })

  app.post('/portal/messages', familyAuth, async (c) => {
    if (!allowed(c, 'canMessage')) return fail(c, 403, 'Access denied')
    const member = c.get('familyMember')
    const { subject, message } = await c.req.json().catch(() => ({} as any))
    if (typeof message !== 'string' || !message.trim()) return fail(c, 400, 'Message is required')
    const [row] = await db.insert(familyMessages).values({
      companyId: c.get('familyCompanyId'),
      clientId: member.clientId,
      familyMemberId: member.id,
      senderType: 'family',
      senderName: member.name,
      subject: typeof subject === 'string' && subject.trim() ? subject.trim() : null,
      body: message.trim(),
    }).returning()
    return one(c, row, 201)
  })

  return app
}
