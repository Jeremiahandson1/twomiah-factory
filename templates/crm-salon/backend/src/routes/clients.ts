import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, clientProfile, serviceRecord, serviceMenu, appointment, membershipEnrollment, membershipPlan, user } from '../../db/schema.ts'
import { eq, and, or, ilike, count, desc, ne } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { emitToCompany, EVENTS } from '../services/socket.ts'
import audit from '../services/audit.ts'
import { createId } from '@paralleldrive/cuid2'

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

  // The client book is people who sit in the chair — not vendors/suppliers. (CC-20)
  const conditions = [eq(contact.companyId, currentUser.companyId), ne(contact.type, 'vendor')]
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
  const rows = data.map((r: any) => ({
    ...r.contact,
    ...(r.profile ? { ...r.profile, id: r.contact.id, profileId: r.profile.id } : {}),
    stylistFirstName: r.stylistFirstName,
    stylistLastName: r.stylistLastName,
  }))
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
    stylistLastName: user.lastName,
  })
    .from(serviceRecord)
    .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
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
    stylistLastName: user.lastName,
  })
    .from(appointment)
    .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
    .leftJoin(user, eq(appointment.stylistId, user.id))
    .where(and(eq(appointment.contactId, contactId), eq(appointment.companyId, currentUser.companyId)))
    .orderBy(desc(appointment.startTime))
    .limit(30)

  const appointments = apptRows.map((r: any) => ({ ...r.appointment, serviceName: r.serviceName, stylistFirstName: r.stylistFirstName, stylistLastName: r.stylistLastName }))

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
  const dueBackAt = withInterval
    ? new Date(new Date(withInterval.performedAt).getTime() + withInterval.rebookIntervalDays * 86400000).toISOString().slice(0, 10)
    : null

  const lifetimeValue = serviceRecords.reduce((s: number, r: any) => s + Number(r.priceCharged || 0), 0)

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
  const EDITABLE = ['preferredStylistId', 'hairType', 'scalpNotes', 'allergies', 'patchTestAt', 'preferences', 'pronouns', 'birthday', 'notes'] as const

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
