// The salon's dashboard — the book today, takings in the chair, who is due back, active memberships — in place of the
// jobs dashboard (CrmSettings.dashboard 'salon', mounted at /api/dashboard by modules/crm.ts). Moved from
// templates/crm-salon/backend/src/routes/dashboard.ts.
import { Hono } from 'hono'
import { and, count, desc, eq, gte, lt, notInArray } from 'drizzle-orm'
import { contact, appointment, serviceRecord, serviceMenu, membershipEnrollment, user, invoice, teamMember } from '../../db/schema/index.ts'
import { takingsByChair } from '../../data/salon.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { canSeeWith, type CrmDeps } from '../deps.ts'
import { clientsOf, isClient } from './people.ts'
import type { SalonServices } from './services.ts'
import { inOwnChair } from './bookScope.ts'
import { appointmentsTodayCondition, activeEnrollmentCondition } from './tileConditions.ts'
import { withoutPrices } from './prices.ts'

// Cancelled and no-show rows are not appointments the desk has to serve; upcoming excludes completed too. (SALON-N9)
// Module scope because two handlers use them — one referencing a handler-local copy was a ReferenceError on every
// request, swallowed, which emptied Upcoming Appointments for six builds. (Salon T20 M1)
const LIVE_APPT = notInArray(appointment.status, ['cancelled', 'no_show'])
const UPCOMING_APPT = notInArray(appointment.status, ['cancelled', 'no_show', 'completed'])

export function createSalonDashboardRoutes(d: CrmDeps, salon: SalonServices) {
  const { db, logger } = d
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()

  /** A panel that cannot load degrades, not the dashboard — and SAYS so. (Salon T20 M1) */
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch (err: any) { logger.error('[dashboard] panel failed to load', { error: err?.message || String(err) }); return fallback }
  }

  app.get('/stats', async (c) => {
    const u = c.get('user') as any
    const companyId = u.companyId
    // The same question the Invoices and Reports pages ask, for the money on this screen. (Salon T28 M4)
    const canSeeMoney = await canSee(u.role, 'invoices:read', u.userId)
    const now = new Date()
    // The SHOP's days, not the server's. (Salon T27 H1)
    const { today, tomorrow, in7, startOfMonth, startOfNextMonth } = await salon.clock.salonDayWindows(companyId)
    // The appointment tiles count the book this seat reads: its own chair where the owner narrowed it (./bookScope.ts,
    // owner's decision 2026-10-25), else everyone's. The month's visits by chair are the visit record, not the book.
    const own = await salon.book.ownChairOf(u)
    const mine = own ? [inOwnChair(own)] : []

    const [clientRows, todayApptRows, upcomingApptRows, apptsByStatus, visitsMonthRows, revenueRows, byStylistRows, membershipRows, dueRows] = await Promise.all([
      // The tile says "Clients … In your book", so it counts CLIENTS. (T20 M2)
      safe(() => db.select({ value: count() }).from(contact).where(clientsOf(companyId)), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), ...mine, appointmentsTodayCondition(appointment, today, tomorrow))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), ...mine, gte(appointment.startTime, now), lt(appointment.startTime, in7), UPCOMING_APPT)), [{ value: 0 }]),
      safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), ...mine, gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
      safe(() => db.select({ value: count() }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [{ value: 0 }]),
      safe(() => db.select({ amt: serviceRecord.priceCharged }).from(serviceRecord).where(and(eq(serviceRecord.companyId, companyId), gte(serviceRecord.performedAt, startOfMonth), lt(serviceRecord.performedAt, startOfNextMonth))), [] as { amt: string | null }[]),
      // Chair productivity this month, whichever column holds the stylist. (Salon T27 N5)
      safe(() => takingsByChair(db, companyId, startOfMonth, startOfNextMonth), []),
      safe(() => db.select({ value: count() }).from(membershipEnrollment).where(and(eq(membershipEnrollment.companyId, companyId), activeEnrollmentCondition(membershipEnrollment))), [{ value: 0 }]),
      // REBOOKING DUE — the same computation the recall list runs, with its default window. (T58)
      safe(() => salon.rebooking.dueRebookings(companyId, { windowDays: 14, maxOverdue: 90 }), []),
    ]) as [Array<{ value: number }>, Array<{ value: number }>, Array<{ value: number }>, Array<{ status: string; c: number }>, Array<{ value: number }>, Array<{ amt: string | null }>, Awaited<ReturnType<typeof takingsByChair>>, Array<{ value: number }>, Array<{ overdue: boolean }>]

    const revenueThisMonth = revenueRows.reduce((s, r) => s + Number(r.amt || 0), 0)
    const overdue = dueRows.filter((r) => r.overdue).length
    const dueSoon = dueRows.length - overdue

    // What clients still owe, on the same balance model as the invoice list and Reports: fully paid is 0, else
    // total − (paid − refunded) floored at 0, over issued invoices. (SALON-M14, BL1a)
    const owing = await safe(() => db.select({ total: invoice.total, amountPaid: invoice.amountPaid, amountRefunded: invoice.amountRefunded }).from(invoice)
      .where(and(eq(invoice.companyId, companyId), notInArray(invoice.status, ['draft', 'void', 'refunded']))), [] as { total: string; amountPaid: string | null; amountRefunded: string | null }[])
    const outstandingValue = Math.round((owing as Array<{ total: string; amountPaid: string | null; amountRefunded: string | null }>).reduce((sum, r) => {
      const total = Number(r.total), paid = Number(r.amountPaid || 0), refunded = Number(r.amountRefunded || 0)
      return sum + (paid >= total ? 0 : Math.max(0, total - (paid - refunded)))
    }, 0) * 100) / 100

    return one(c, {
      // omitted, not zeroed — "$0 outstanding" would be a different wrong answer
      ...(canSeeMoney ? { invoices: { outstandingValue } } : {}),
      contacts: clientRows[0]?.value ?? 0,
      clients: { total: clientRows[0]?.value ?? 0 },
      appointments: {
        today: todayApptRows[0]?.value ?? 0,
        upcoming7: upcomingApptRows[0]?.value ?? 0,
        byStatus: Object.fromEntries(apptsByStatus.map((a) => [a.status, Number(a.c)])),
      },
      services: { thisMonth: visitsMonthRows[0]?.value ?? 0, ...(canSeeMoney ? { revenueThisMonth } : {}) },
      byStylist: byStylistRows.map((r) => ({
        stylistId: r.stylistId ?? r.stylistMemberId,
        name: [r.firstName, r.lastName].filter(Boolean).join(' ') || r.memberName || 'Unassigned',
        visits: Number(r.visits),
        // a stylist may see who is in which chair and how busy they are, not what they each took
        ...(canSeeMoney ? { revenue: Number(r.revenue || 0) } : {}),
      })).sort((a, b) => canSeeMoney ? Number((b as any).revenue || 0) - Number((a as any).revenue || 0) : b.visits - a.visits),
      reminders: { overdue, dueSoon },
      memberships: { activeEnrollments: membershipRows[0]?.value ?? 0 },
    })
  })

  app.get('/recent-activity', async (c) => {
    const u = c.get('user') as any
    const companyId = u.companyId
    const now = new Date()
    // Upcoming Appointments is the book: this seat's own chair where the owner narrowed it (./bookScope.ts).
    const own = await salon.book.ownChairOf(u)
    const mine = own ? [inOwnChair(own)] : []
    const [recentClients, recentServices, upcomingAppointments] = await Promise.all([
      // Clients, not everyone in the address book. (Salon T27 N10)
      safe(() => db.select({ id: contact.id, name: contact.name, phone: contact.phone, email: contact.email, updatedAt: contact.updatedAt })
        .from(contact).where(and(eq(contact.companyId, companyId), isClient())).orderBy(desc(contact.updatedAt)).limit(5), []),
      // A roster stylist's name too. (Salon T27 N5)
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
        .leftJoin(teamMember, eq(appointment.stylistMemberId, teamMember.id))
        .where(and(eq(appointment.companyId, companyId), ...mine, gte(appointment.startTime, now), UPCOMING_APPT)).orderBy(appointment.startTime).limit(8), []),
    ]) as [any[], any[], any[]]

    // What a visit took is the salon's money: a seat that may not read invoices gets the visit, not the price (./prices.ts).
    const maySeeMoney = await canSee(u.role, 'invoices:read', u.userId)
    return one(c, {
      recentClients,
      recentServices: maySeeMoney ? recentServices : withoutPrices(recentServices),
      upcomingAppointments: upcomingAppointments.map((a) => {
        const parts = String(a.stylistMemberName || '').trim().split(/\s+/)
        return { ...a, stylistFirstName: a.stylistFirstName ?? (parts[0] || null), stylistLastName: a.stylistLastName ?? (parts.slice(1).join(' ') || null) }
      }),
    })
  })

  return app
}
