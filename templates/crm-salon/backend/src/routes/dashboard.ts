import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, appointment, serviceRecord, serviceMenu, membershipEnrollment, user } from '../../db/schema.ts'
import { eq, and, gte, lt, count, desc, sql, isNotNull } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

/**
 * Salon dashboard — the book today, revenue in the chair, who is due back, and
 * membership count (not the contractor jobs/quotes/invoices the base ships).
 */

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 86400000)
  const in7 = new Date(today.getTime() + 7 * 86400000)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [clientRows, todayApptRows, upcomingApptRows, apptsByStatus, visitsMonthRows, revenueRows, byStylistRows, membershipRows, dueRows] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, tomorrow))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), lt(appointment.startTime, in7))), [{ value: 0 }]),
    safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ amt: serviceRecord.priceCharged }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [] as { amt: string | null }[]),
    // Chair productivity this month — the number an owner actually manages by.
    safe(() => db.select({
      stylistId: serviceRecord.stylistId,
      firstName: user.firstName,
      lastName: user.lastName,
      visits: count(),
      revenue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
    })
      .from(serviceRecord)
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth), isNotNull(serviceRecord.stylistId)))
      .groupBy(serviceRecord.stylistId, user.firstName, user.lastName), [] as any[]),
    safe(() => db.select({ value: count() }).from(membershipEnrollment).where(and(eq(membershipEnrollment.companyId, companyId), eq(membershipEnrollment.status, 'active'))), [{ value: 0 }]),
    // Rebooking due: latest visit per (client, service) whose interval has elapsed
    // or elapses within 14 days. Mirrors GET /reminders/due — same rule, one number.
    safe(() => db.select({
      contactId: serviceRecord.contactId,
      serviceId: serviceRecord.serviceId,
      performedAt: sql<string>`max(${serviceRecord.performedAt})`,
      interval: serviceMenu.rebookIntervalDays,
    })
      .from(serviceRecord)
      .innerJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .where(and(eq(serviceRecord.companyId, companyId), isNotNull(serviceMenu.rebookIntervalDays)))
      .groupBy(serviceRecord.contactId, serviceRecord.serviceId, serviceMenu.rebookIntervalDays), [] as any[]),
  ])

  const revenueThisMonth = revenueRows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0)

  const t = today.getTime()
  const soon = t + 14 * 86400000
  const floor = t - 90 * 86400000
  let overdue = 0, dueSoon = 0
  for (const r of dueRows as any[]) {
    const due = new Date(r.performedAt).getTime() + Number(r.interval) * 86400000
    if (due < floor) continue
    if (due < t) overdue++
    else if (due <= soon) dueSoon++
  }

  return c.json({
    contacts: clientRows[0]?.value ?? 0,
    clients: { total: clientRows[0]?.value ?? 0 },
    appointments: {
      today: todayApptRows[0]?.value ?? 0,
      upcoming7: upcomingApptRows[0]?.value ?? 0,
      byStatus: Object.fromEntries(apptsByStatus.map(a => [a.status, Number(a.c)])),
    },
    services: { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueThisMonth },
    byStylist: (byStylistRows as any[]).map(r => ({
      stylistId: r.stylistId,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || 'Unassigned',
      visits: Number(r.visits),
      revenue: Number(r.revenue || 0),
    })).sort((a, b) => b.revenue - a.revenue),
    reminders: { overdue, dueSoon },
    memberships: { activeEnrollments: membershipRows[0]?.value ?? 0 },
  })
})

app.get('/recent-activity', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [recentClients, recentServices, upcomingAppointments] = await Promise.all([
    safe(() => db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, updatedAt: contact.updatedAt })
      .from(contact).where(eq(contact.companyId, companyId)).orderBy(desc(contact.updatedAt)).limit(5), []),
    safe(() => db.select({ id: serviceRecord.id, performedAt: serviceRecord.performedAt, priceCharged: serviceRecord.priceCharged, serviceName: serviceMenu.name, clientName: contact.name, stylistFirstName: user.firstName, stylistLastName: user.lastName })
      .from(serviceRecord)
      .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .where(eq(serviceRecord.companyId, companyId)).orderBy(desc(serviceRecord.performedAt)).limit(5), []),
    safe(() => db.select({ id: appointment.id, startTime: appointment.startTime, status: appointment.status, station: appointment.station, serviceName: serviceMenu.name, clientName: contact.name, stylistFirstName: user.firstName, stylistLastName: user.lastName })
      .from(appointment)
      .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
      .leftJoin(contact, eq(appointment.contactId, contact.id))
      .leftJoin(user, eq(appointment.stylistId, user.id))
      .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now))).orderBy(appointment.startTime).limit(8), []),
  ])

  return c.json({ recentClients, recentServices, upcomingAppointments })
})

export default app
