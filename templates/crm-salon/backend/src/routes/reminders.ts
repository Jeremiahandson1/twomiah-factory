import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { serviceRecord, serviceMenu, contact, clientProfile, user, appointment } from '../../db/schema.ts'
import { eq, and, inArray, isNotNull, sql, gt } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import { sendSMS } from '../services/sms.ts'

/**
 * Rebooking / recall engine — the retention wedge.
 *   GET  /reminders/due       clients past (or nearing) their rebook interval
 *   GET  /reminders/lapsed    clients whose last visit is older than N months
 *   GET  /reminders/birthdays clients with a birthday in the next N days
 *   POST /reminders/send      bulk SMS to selected clients
 *
 * "Due" is computed, never stored: last service record + that service's
 * rebookIntervalDays. Re-timing a service in the menu re-times every client on
 * it, which is the whole point of keeping the interval on the menu row.
 */

const app = new Hono()
app.use('*', authenticate)

const todayStr = () => new Date().toISOString().slice(0, 10)
const dayStr = (d: Date) => d.toISOString().slice(0, 10)

// GET /reminders/due?window=14&maxOverdue=90 — clients whose next visit is due
// within `window` days or overdue by up to `maxOverdue` days. The overdue floor
// matters: without it a client who moved away three years ago sits at the top of
// the list forever and the report stops being a call list. Anyone past the floor
// is a win-back, and shows up in /lapsed instead.
app.get('/due', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '14')))
  const maxOverdue = Math.min(3650, Math.max(1, +(c.req.query('maxOverdue') || '90')))
  const cutoff = dayStr(new Date(Date.now() + windowDays * 86400000))
  const floor = dayStr(new Date(Date.now() - maxOverdue * 86400000))

  const rows = await db.select({
    recordId: serviceRecord.id,
    performedAt: serviceRecord.performedAt,
    serviceId: serviceRecord.serviceId,
    serviceName: serviceMenu.name,
    rebookIntervalDays: serviceMenu.rebookIntervalDays,
    stylistFirstName: user.firstName,
    stylistLastName: user.lastName,
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
  })
    .from(serviceRecord)
    .innerJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
    .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
    .leftJoin(user, eq(serviceRecord.stylistId, user.id))
    .where(and(eq(serviceRecord.companyId, u.companyId), isNotNull(serviceMenu.rebookIntervalDays)))

  // Keep only the most recent visit per (client, service) so a client who has
  // already rebooked isn't nagged on the previous appointment's due date.
  const latest = new Map<string, any>()
  for (const r of rows) {
    if (!r.contactId) continue
    const key = r.contactId + '|' + r.serviceId
    const cur = latest.get(key)
    if (!cur || new Date(r.performedAt) > new Date(cur.performedAt)) latest.set(key, r)
  }

  const t = todayStr()
  const data = [...latest.values()]
    .map(r => ({
      ...r,
      dueDate: dayStr(new Date(new Date(r.performedAt).getTime() + r.rebookIntervalDays * 86400000)),
    }))
    .filter(r => r.dueDate <= cutoff && r.dueDate >= floor)
    .map(r => ({ ...r, overdue: r.dueDate < t }))
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  // A client who already has a future appointment has effectively rebooked — don't nag
  // them (and don't text them as overdue). (RECALL-02)
  const booked = new Set(
    (await db.select({ contactId: appointment.contactId }).from(appointment)
      .where(and(eq(appointment.companyId, u.companyId), gt(appointment.startTime, new Date()))))
      .map(a => a.contactId).filter(Boolean)
  )
  const filtered = data.filter(r => !booked.has(r.contactId))

  return c.json({ count: filtered.length, overdue: filtered.filter(d => d.overdue).length, data: filtered })
})

// GET /reminders/lapsed?months=6 — clients whose last visit is older than N
// months. Clients who have never been in the chair are excluded: they are a
// lead-nurture problem, not a win-back one.
app.get('/lapsed', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const months = Math.min(60, Math.max(1, +(c.req.query('months') || '6')))
  const cutoff = new Date(); cutoff.setMonth(cutoff.getMonth() - months)
  const cutoffIso = cutoff.toISOString()

  const rows = await db.select({
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    lastVisit: sql<string | null>`max(${serviceRecord.performedAt})`,
    visits: sql<number>`count(${serviceRecord.id})`,
    lifetimeValue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
  })
    .from(contact)
    .innerJoin(serviceRecord, eq(serviceRecord.contactId, contact.id))
    .where(and(eq(contact.companyId, u.companyId), eq(serviceRecord.companyId, u.companyId)))
    .groupBy(contact.id)
    .having(sql`max(${serviceRecord.performedAt}) < ${cutoffIso}`)

  const data = rows
    .map(r => ({ ...r, visits: Number(r.visits), lifetimeValue: Number(r.lifetimeValue) }))
    .sort((a, b) => b.lifetimeValue - a.lifetimeValue)

  return c.json({ count: data.length, months, data })
})

// GET /reminders/birthdays?window=30 — birthdays in the next N days. Month/day
// only, so the year stored on the profile never matters.
app.get('/birthdays', requirePermission('contacts:read'), async (c) => {
  const u = c.get('user') as any
  const windowDays = Math.min(365, Math.max(1, +(c.req.query('window') || '30')))

  const rows = await db.select({
    contactId: contact.id,
    clientName: contact.name,
    clientEmail: contact.email,
    clientPhone: contact.phone,
    clientMobile: contact.mobile,
    birthday: clientProfile.birthday,
  })
    .from(clientProfile)
    .innerJoin(contact, eq(clientProfile.contactId, contact.id))
    .where(and(eq(clientProfile.companyId, u.companyId), isNotNull(clientProfile.birthday)))

  const now = new Date()
  const data = rows
    .map(r => {
      // Next occurrence of this month/day, rolling into next year if it has passed.
      const [, m, d] = String(r.birthday).split('-').map(Number)
      let next = new Date(now.getFullYear(), m - 1, d)
      const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate())
      if (next < startOfToday) next = new Date(now.getFullYear() + 1, m - 1, d)
      const daysAway = Math.round((next.getTime() - startOfToday.getTime()) / 86400000)
      return { ...r, nextBirthday: dayStr(next), daysAway }
    })
    .filter(r => r.daysAway <= windowDays)
    .sort((a, b) => a.daysAway - b.daysAway)

  return c.json({ count: data.length, data })
})

// POST /reminders/send  { contactIds: string[], message: string } — bulk SMS.
app.post('/send', requirePermission('contacts:update'), async (c) => {
  const u = c.get('user') as any
  const body = (await c.req.json().catch(() => null)) ?? ({} as any)
  const contactIds: string[] = Array.isArray(body.contactIds) ? body.contactIds.filter(Boolean) : []
  const message: string = (body.message || '').trim()
  if (!contactIds.length || !message) return c.json({ error: 'contactIds and message are required' }, 400)

  const clients = await db.select().from(contact).where(and(eq(contact.companyId, u.companyId), inArray(contact.id, contactIds)))
  let sent = 0
  const failures: string[] = []
  for (const ct of clients) {
    const to = (ct as any).mobile || ct.phone
    if (!to) { failures.push(ct.id); continue }
    try {
      await sendSMS(u.companyId, { contactId: ct.id, toPhone: to, message, userId: u.userId })
      sent++
    } catch { failures.push(ct.id) }
  }
  return c.json({ sent, failed: failures.length, failures })
})

export default app
