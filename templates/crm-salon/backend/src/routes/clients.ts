import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, clientProfile, serviceRecord, serviceMenu, appointment, membershipEnrollment, membershipPlan, user, invoice, teamMember } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, ne , sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { isClient } from '../utils/clientTypes.ts'
import { createId } from '@paralleldrive/cuid2'
import { calendarDateIn, salonTimezone, salonToday } from '../utils/salonDate.ts'

/**
 * The client chart. Unlike crm-vet (owner -> pet), a salon client IS the
 * contact, so the salon-specific columns live in a 1:1 `client_profile` keyed
 * by contactId and the list is driven from `contact`. That keeps the shared
 * contact table unforked — the routes here address clients BY CONTACT ID.
 *
 * The profile row is created on demand (upsert on PUT), so a contact captured
 * by the website lead form is already a client the first time they sit down.
 */

const app = new Hono()
app.use('*', authenticate)

// GET /clients — ?search= (name/email/phone), ?stylistId= (preferred stylist)
app.get('/', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const search = c.req.query('search')
  const stylistId = c.req.query('stylistId')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '50')

  // The client book is people who sit in the chair — not vendors/suppliers (CC-20), and not leads
  // either: a lead has not been in the chair yet. They belong on Contacts, where they carry a Lead
  // badge, and become a client the moment they are converted. (T20 M2)
  const conditions = [eq(contact.companyId, currentUser.companyId), isClient()]
  if (search) {
    conditions.push(or(
      ilike(contact.name, `%${search}%`),
      ilike(contact.email, `%${search}%`),
      ilike(contact.phone, `%${search}%`),
    )!)
  }
  if (stylistId) conditions.push(eq(clientProfile.preferredStylistId, stylistId))

  const where = and(...conditions)

  const data = await db.select({
    contact,
    profile: clientProfile,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
  })
    .from(contact)
    .leftJoin(clientProfile, eq(clientProfile.contactId, contact.id))
    .leftJoin(user, eq(clientProfile.preferredStylistId, user.id))
    .where(where)
    .orderBy(desc(contact.createdAt))
    .offset((page - 1) * limit)
    .limit(limit)

  const [{ value: total }] = await db.select({ value: count() })
    .from(contact)
    .leftJoin(clientProfile, eq(clientProfile.contactId, contact.id))
    .where(where)

  // Flatten contact + profile to one row level so the list can read
  // `row.name` / `row.hairType` / `row.stylistFirstName` directly.
  const rows = data.map((r: any) => {
    // portalToken is a bearer credential for the client portal: anyone holding it can open that
    // client's records. It was going out in a LIST response, for every client that had one, to a
    // vertical with no client-portal UI at all — nothing in the salon bundle reads it and
    // /api/portal/contacts/:token 404s here. A secret handed out for a feature that does not exist
    // is pure downside. (T20 L4)
    const { portalToken, portalTokenExp, ...contactSafe } = r.contact
    return {
      ...contactSafe,
      ...(r.profile ? { ...r.profile, id: r.contact.id, profileId: r.profile.id } : {}),
      // The client's PREFERRED stylist, which is a login user by definition (clientProfile
      // .preferredStylistId is a foreign key to `user`) — so there is no roster name to carry here.
      stylistFirstName: r.stylistFirstName,
      stylistLastName: r.stylistLastName,
    }
  })
  return c.json({ data: rows, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// GET /clients/:contactId — full chart: contact, profile, formula history,
// appointments, memberships.
app.get('/:contactId', requirePermission('contacts:read'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [ct] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!ct) return c.json({ error: 'Client not found' }, 404)

  const [profile] = await db.select().from(clientProfile)
    .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, currentUser.companyId)))
    .limit(1)

  const recordRows = await db.select({
    record: serviceRecord,
    serviceName: serviceMenu.name,
    rebookIntervalDays: serviceMenu.rebookIntervalDays,
    stylistFirstName: user.firstName,
    // a chair-only stylist's name lives in team_member; without this a roster stylist reads as nobody
    // and the visit prints with no "with ...". (Salon T28 M6)
    stylistMemberName: teamMember.name,
    stylistLastName: user.lastName,
  })
    .from(serviceRecord)
    .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
    .where(and(eq(serviceRecord.contactId, contactId), eq(serviceRecord.companyId, currentUser.companyId)))
    .orderBy(desc(serviceRecord.performedAt))
    .limit(50)

  const serviceRecords = recordRows.map((r: any) => ({
    ...r.record,
    serviceName: r.serviceName,
    rebookIntervalDays: r.rebookIntervalDays,
    stylistFirstName: r.stylistFirstName,
    stylistLastName: r.stylistLastName,
  }))

  const apptRows = await db.select({
    appointment,
    serviceName: serviceMenu.name,
    stylistFirstName: user.firstName,
    // a chair-only stylist's name lives in team_member; without this a roster stylist reads as nobody
    // and the visit prints with no "with ...". (Salon T28 M6)
    stylistMemberName: teamMember.name,
    stylistLastName: user.lastName,
  })
    .from(appointment)
    .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
    .where(and(eq(appointment.contactId, contactId), eq(appointment.companyId, currentUser.companyId)))
    .orderBy(desc(appointment.startTime))
    .limit(30)

  const appointments = apptRows.map((r: any) => ({ ...r.appointment, serviceName: r.serviceName, stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName, stylistMemberName: r.stylistMemberName }))

  const enrollmentRows = await db.select({
    enrollment: membershipEnrollment,
    planName: membershipPlan.name,
    planPrice: membershipPlan.price,
  })
    .from(membershipEnrollment)
    .leftJoin(membershipPlan, eq(membershipEnrollment.planId, membershipPlan.id))
    .where(and(eq(membershipEnrollment.contactId, contactId), eq(membershipEnrollment.companyId, currentUser.companyId)))
    .orderBy(desc(membershipEnrollment.createdAt))

  const memberships = enrollmentRows.map((r: any) => ({ ...r.enrollment, planName: r.planName, planPrice: r.planPrice }))

  // "Due back on" comes from the most recent record that has a rebook interval,
  // computed rather than stored so re-timing a service re-times every client.
  const withInterval = serviceRecords.find(r => r.rebookIntervalDays)
  // Count the interval from the visit's calendar date in the salon's timezone — an 11:03 PM visit is
  // stored after midnight UTC and used to push due-back a day late. (SALON-H9)
  const tz = await salonTimezone(currentUser.companyId)
  const dueBackAt = withInterval
    ? (() => { const [y, m, d] = calendarDateIn(new Date(withInterval.performedAt), tz).split('-').map(Number); return new Date(Date.UTC(y, m - 1, d) + withInterval.rebookIntervalDays * 86400000).toISOString().slice(0, 10) })()
    : null

  // Money the client actually paid, net of refunds — the same definition serviceRecords.ts uses when
  // it reports what a visit took (amountPaid − amountRefunded). This summed priceCharged, the price
  // TYPED on a visit card: a quote, frequently blank, never adjusted when the invoice was discounted,
  // part-paid or refunded. The profile said $20 for a client who had paid $351.70. (Salon T27 N9)
  const [paidRow] = await db
    .select({
      paid: sql<string>`COALESCE(SUM(GREATEST(0, COALESCE(${invoice.amountPaid}::numeric, 0) - COALESCE(${invoice.amountRefunded}::numeric, 0))), 0)`,
    })
    .from(invoice)
    .where(and(
      eq(invoice.contactId, contactId),
      eq(invoice.companyId, currentUser.companyId),
      sql`${invoice.status} NOT IN ('draft', 'void')`,
    ))
  const lifetimeValue = Math.round(Number(paidRow?.paid || 0) * 100) / 100

  return c.json({
    contact: ct,
    profile: profile || null,
    serviceRecords,
    appointments,
    memberships,
    stats: { visits: serviceRecords.length, lifetimeValue, dueBackAt, lastVisit: serviceRecords[0]?.performedAt ?? null },
  })
})

// PUT /clients/:contactId/profile — upsert the salon-specific profile.
app.put('/:contactId/profile', requirePermission('contacts:update'), async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)

  const [ct] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, currentUser.companyId)))
    .limit(1)
  if (!ct) return c.json({ error: 'Client not found' }, 404)

  // Whitelist editable columns — never let companyId/id/contactId be set from the body.
  const today = await salonToday(currentUser.companyId)
  // Hair type is a short label on a client card ("fine, colour-treated"), and it stored 5,000 characters,
  // which the card then has to render. The longer free-text fields keep their own larger ceilings.
  // (Salon T28 L4)
  const FIELD_MAX: Record<string, number> = { hairType: 120, pronouns: 40, scalpNotes: 2000, allergies: 2000, preferences: 2000, notes: 5000 }
  const tooLong = Object.entries(FIELD_MAX).find(([k, max]) => typeof (body as any)[k] === 'string' && (body as any)[k].trim().length > max)
  if (tooLong) return c.json({ error: `${tooLong[0]} must be ${tooLong[1]} characters or fewer.` }, 400)

  const EDITABLE = ['preferredStylistId', 'hairType', 'scalpNotes', 'allergies', 'patchTestAt', 'preferences', 'pronouns', 'birthday', 'notes'] as const
  for (const k of ['birthday', 'patchTestAt'] as const) {
    if (body[k] == null || body[k] === '') continue
    const v = String(body[k])
    if (!/^\d{4}-\d{2}-\d{2}/.test(v) || isNaN(new Date(v.slice(0, 10) + 'T00:00:00Z').getTime())) return c.json({ error: `${k === 'birthday' ? 'Birthday' : 'Patch test date'} must be a valid date (YYYY-MM-DD).` }, 400)
    if (v.slice(0, 10) > today) return c.json({ error: `${k === 'birthday' ? 'Birthday' : 'Patch test date'} cannot be in the future.` }, 400)
  }

  const [existing] = await db.select().from(clientProfile)
    .where(and(eq(clientProfile.contactId, contactId), eq(clientProfile.companyId, currentUser.companyId)))
    .limit(1)

  let saved: any
  if (existing) {
    const updates: any = { updatedAt: new Date() }
    for (const k of EDITABLE) if (k in body) updates[k] = body[k] || null
    ;[saved] = await db.update(clientProfile).set(updates).where(eq(clientProfile.id, existing.id)).returning()
    await audit.log({ action: 'update', entity: 'client_profile', entityId: existing.id, changes: audit.diff(existing, saved), req: { user: currentUser } })
  } else {
    const values: any = { id: createId(), contactId, companyId: currentUser.companyId }
    for (const k of EDITABLE) if (k in body) values[k] = body[k] || null
    ;[saved] = await db.insert(clientProfile).values(values).returning()
    await audit.log({ action: 'create', entity: 'client_profile', entityId: saved.id, metadata: saved, req: { user: currentUser } })
  }

  emitToCompany(currentUser.companyId, EVENTS.REFRESH, { entity: 'client_profile' })
  return c.json(saved)
})

export default app
