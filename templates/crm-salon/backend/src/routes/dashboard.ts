import { Hono } from 'hono'
import { salonDayWindows } from '../utils/salonDate.ts'
import { db } from '../../db/index.ts'
import { contact, appointment, serviceRecord, serviceMenu, membershipEnrollment, user, invoice, teamMember } from '../../db/schema.ts'
import { eq, and, or, gte, lt, count, desc, sql, isNotNull } from 'drizzle-orm'
import { isClient } from '../utils/clientTypes.ts'
import { authenticate } from '../middleware/auth.ts'
import { clientsOf } from '../utils/clientTypes.ts'

/**
 * Salon dashboard — the book today, revenue in the chair, who is due back, and
 * membership count (not the contractor jobs/quotes/invoices the base ships).
 */

const app = new Hono()
app.use('*', authenticate)

// Cancelled and no-show rows are not appointments the desk has to serve; upcoming excludes completed
// too. (SALON-N9)
//
// These live at MODULE scope because two handlers need them. They used to be declared inside /stats,
// and /recent-activity referenced UPCOMING_APPT anyway — a ReferenceError on every single request,
// swallowed by the safe() wrapper below, which is why the Upcoming Appointments panel was ALWAYS empty
// while the tile above it counted the same appointments correctly. (Salon T20 M1)
const LIVE_APPT = sql`${appointment.status} NOT IN ('cancelled', 'no_show')`
const UPCOMING_APPT = sql`${appointment.status} NOT IN ('cancelled', 'no_show', 'completed')`

app.get('/stats', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  // The SHOP's days, not the server's. These were built from now.getFullYear()/getMonth()/getDate(),
  // which is the server's local time — UTC on Render — so from 19:00 Central the "Appointments Today"
  // tile counted TOMORROW's book: 8 where the shop had 5. Same fault as T25 N2, spelled differently,
  // which is why that sweep walked past it. (Salon T27 H1)
  const { today, tomorrow, in7, startOfMonth, startOfNextMonth } = await salonDayWindows(companyId)

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    // A panel that cannot load should degrade, not take the dashboard down — but it must SAY so. Swallowing
    // this silently is how a ReferenceError became a panel that was empty on every request for six
    // builds without anyone seeing a reason. (Salon T20 M1)
    try { return await fn() } catch (err: any) { console.error('[dashboard] panel failed to load:', err?.message || err); return fallback }
  }

  const [clientRows, todayApptRows, upcomingApptRows, apptsByStatus, visitsMonthRows, revenueRows, byStylistRows, membershipRows, dueRows] = await Promise.all([
    // The tile says "Clients … In your book", so it counts CLIENTS — not every contact row including
    // leads and vendors, which is what it used to do. Same rule the Clients page lists by. (T20 M2)
    safe(() => db.select({ value: count() }).from(contact).where(clientsOf(companyId)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, tomorrow), LIVE_APPT)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), lt(appointment.startTime, in7), UPCOMING_APPT)), [{ value: 0 }]),
    safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ amt: serviceRecord.priceCharged }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [] as { amt: string | null }[]),
    // Chair productivity this month — the number an owner actually manages by.
    // A chair is a chair whoever sits in it. This grouped and joined on stylist_id ALONE, so every
    // roster stylist was missing from the one number an owner manages by — the salon could not see
    // the productivity of the people it had just added. (Salon T27 N5)
    safe(() => db.select({
      stylistId: serviceRecord.stylistId,
      stylistMemberId: serviceRecord.stylistMemberId,
      firstName: user.firstName,
      lastName: user.lastName,
      memberName: teamMember.name,
      visits: count(),
      revenue: sql<string>`coalesce(sum(${serviceRecord.priceCharged}), 0)`,
    })
      .from(serviceRecord)
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
      .where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth), or(isNotNull(serviceRecord.stylistId), isNotNull(serviceRecord.stylistMemberId))))
      .groupBy(serviceRecord.stylistId, serviceRecord.stylistMemberId, user.firstName, user.lastName, teamMember.name), [] as any[]),
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

  // What clients still owe — the portal home showed $0 because it read a key this dashboard never set. (SALON-M14)
  // Outstanding MUST use the same balance model as the invoice list / /stats / Reports, or the dashboard
  // disagrees: fully paid → 0 (a goodwill refund never reopens), else total − (paid − refunded) floored at 0
  // (a deposit refund reopens the balance). Summing total − amountPaid ignored refunds, so a part-paid-then-
  // refunded invoice read short and only the dashboard was out of line. Set = issued (not draft/void/refunded),
  // matching reporting.ts's balanceExpr. (BL1a dashboard reconciliation — see scripts/check-money-model.ts)
  const owing = await safe(() => db.select({ total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded }).from(invoice).where(and(eq(invoice.companyId, companyId), sql`${invoice.status} NOT IN ('draft', 'void', 'refunded')`)), [] as { total: string; amountPaid: string; amountRefunded: string }[])
  const outstandingValue = Math.round((owing as any[]).reduce((sum: number, r: any) => {
    const total = Number(r.total), paid = Number(r.amountPaid || 0), refunded = Number(r.amountRefunded || 0)
    return sum + (paid >= total ? 0 : Math.max(0, total - (paid - refunded)))
  }, 0) * 100) / 100
  return c.json({
    invoices: { outstandingValue },
    contacts: clientRows[0]?.value ?? 0,
    clients: { total: clientRows[0]?.value ?? 0 },
    appointments: {
      today: todayApptRows[0]?.value ?? 0,
      upcoming7: upcomingApptRows[0]?.value ?? 0,
      byStatus: Object.fromEntries(apptsByStatus.map(a => [a.status, Number(a.c)])),
    },
    services: { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueThisMonth },
    byStylist: (byStylistRows as any[]).map(r => ({
      // whichever column held them — the page only ever shows one id per chair
      stylistId: r.stylistId ?? r.stylistMemberId,
      name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.memberName || 'Unassigned',
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
    // A panel that cannot load should degrade, not take the dashboard down — but it must SAY so. Swallowing
    // this silently is how a ReferenceError became a panel that was empty on every request for six
    // builds without anyone seeing a reason. (Salon T20 M1)
    try { return await fn() } catch (err: any) { console.error('[dashboard] panel failed to load:', err?.message || err); return fallback }
  }

  const [recentClients, recentServices, upcomingAppointments] = await Promise.all([
    // Clients, not everyone in the address book. This had no type filter at all, so a webhook LEAD
    // appeared under Recent Clients the moment it was touched — while the Clients page beside it
    // correctly left the same row out. isClient() is the one definition of who counts, and it was
    // already sitting in utils/clientTypes.ts. (Salon T27 N10)
    safe(() => db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, updatedAt: contact.updatedAt })
      .from(contact).where(and(eq(contact.companyId, companyId), isClient())).orderBy(desc(contact.updatedAt)).limit(5), []),
    // stylistMemberName for the same reason as the appointments query below it: a roster stylist
    // showed as no stylist at all on Recent Services. (Salon T27 N5)
    safe(() => db.select({ id: serviceRecord.id, performedAt: serviceRecord.performedAt, priceCharged: serviceRecord.priceCharged, serviceName: serviceMenu.name, clientName: contact.name, stylistFirstName: user.firstName, stylistLastName: user.lastName, stylistMemberName: teamMember.name })
      .from(serviceRecord)
      .leftJoin(serviceMenu, eq(serviceRecord.serviceId, serviceMenu.id))
      .leftJoin(contact, eq(serviceRecord.contactId, contact.id))
      .leftJoin(user, eq(serviceRecord.stylistId, user.id))
      .leftJoin(teamMember, eq(serviceRecord.stylistMemberId, teamMember.id))
      .where(eq(serviceRecord.companyId, companyId)).orderBy(desc(serviceRecord.performedAt)).limit(5), []),
    safe(() => db.select({ id: appointment.id, startTime: appointment.startTime, status: appointment.status, station: appointment.station, serviceName: serviceMenu.name, clientName: contact.name, stylistFirstName: user.firstName, stylistLastName: user.lastName, stylistMemberName: teamMember.name })
      .from(appointment)
      .leftJoin(serviceMenu, eq(appointment.serviceId, serviceMenu.id))
      .leftJoin(contact, eq(appointment.contactId, contact.id))
      .leftJoin(user, eq(appointment.stylistId, user.id))
      // a chair-only stylist's name lives in team_member, and they can hold a chair now (T20 H1)
      .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
      .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), UPCOMING_APPT)).orderBy(appointment.startTime).limit(8), []),
  ])

  return c.json({
    recentClients,
    recentServices,
    upcomingAppointments: (upcomingAppointments as any[]).map((a: any) => {
      const parts = String(a.stylistMemberName || '').trim().split(/\s+/)
      return {
        ...a,
        stylistFirstName: a.stylistFirstName ?? (parts[0] || null),
        stylistLastName: a.stylistLastName ?? (parts.slice(1).join(' ') || null),
      }
    }),
  })
})

export default app
