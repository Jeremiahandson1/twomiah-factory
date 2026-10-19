// The private-events dashboard — the book ahead, the pipeline, and the money owed (not the jobs/quotes/invoices one the
// base CRM ships). Moved from templates/crm-restaurant/backend/src/routes/dashboard.ts (templates/crm-bar has the same
// file). /api/dashboard answers with this router where the vertical says so (CrmSettings.dashboard = 'events',
// server/modules/crm.ts); the registry signs the person in and applies the 'dashboard' gate.
//
// Money comes from the invoices (event deposits and balances live there — eventLedger.ts), through the same reporting
// service as the Reports page, so the two can't disagree. Both replies are one record each, as in the template.
import { Hono } from 'hono'
import { eq, and, gte, lte, lt, count, desc, asc, inArray, notInArray } from 'drizzle-orm'
import { createReportingService } from '@twomiah/tenant-backend'
import { contact, event, eventSpace, eventMenuItem, eventPayment, user, invoice, payment, job, project, quote, timeEntry } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { installmentStates } from './eventLedger.ts'
import { EXIT_STATUSES } from './eventBooking.ts'

const HELD = ['tentative', 'confirmed']
const day = (d: Date) => d.toISOString().slice(0, 10)

export function createEventsDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const { hasPermission, getExtraPermissions } = d.permissions
  const reporting: any = createReportingService({ db, tables: { invoice, payment, job, project, quote, timeEntry, user, contact }, authenticate: d.authenticate, requirePermission: () => null } as any)
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }
  /**
   * WHO OWES THE VENUE WHAT IS THE BOOKS. (T42, T62) invoices:read is the fleet's revenue-read permission: owner,
   * admin, manager and the read-only office seat hold it; `field` does not. The money keys are ABSENT rather than zero
   * — "$0.00" would tell a coordinator the venue is owed nothing — and `moneyWithheld` says so.
   */
  const maySeeMoney = async (u: any) => hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))

  const app = new Hono<AppEnv>()

  app.get('/stats', async (c) => {
    const user_ = c.get('user') as any
    const companyId = user_.companyId
    const now = new Date()
    const today = day(now)
    const in30 = day(new Date(now.getTime() + 30 * 86400000))
    const startOfMonth = day(new Date(now.getFullYear(), now.getMonth(), 1))
    const startOfNextMonth = day(new Date(now.getFullYear(), now.getMonth() + 1, 1))

    const [clientRows, byStatus, upcoming30Rows, confirmedThisMonth, revenue, bookedValueRows, byTypeRows, spaceRows] = await Promise.all([
      safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }] as any[]),
      safe(() => db.select({ status: event.status, c: count() }).from(event).where(eq(event.companyId, companyId)).groupBy(event.status), [] as { status: string; c: number }[]),
      safe(() => db.select({ value: count() }).from(event).where(and(eq(event.companyId, companyId), gte(event.eventDate, today), lte(event.eventDate, in30), inArray(event.status, HELD))), [{ value: 0 }] as any[]),
      safe(() => db.select({ value: count() }).from(event).where(and(eq(event.companyId, companyId), gte(event.eventDate, startOfMonth), lt(event.eventDate, startOfNextMonth), inArray(event.status, HELD))), [{ value: 0 }] as any[]),
      // Money the venue is owed and hasn't collected — exactly the Reports figures.
      safe(() => reporting.revenueOverview(companyId, {}), { outstanding: 0, overdue: 0, overdueCount: 0 } as any),
      // Booked value ahead: menu lines on events that are held and still to come.
      safe(() => db.select({ perPerson: eventMenuItem.perPerson, quantity: eventMenuItem.quantity, unitPrice: eventMenuItem.unitPrice })
        .from(eventMenuItem)
        .innerJoin(event, eq(eventMenuItem.eventId, event.id))
        .where(and(eq(eventMenuItem.companyId, companyId), gte(event.eventDate, today), inArray(event.status, HELD))), [] as any[]),
      safe(() => db.select({ eventType: event.eventType, c: count() }).from(event)
        .where(and(eq(event.companyId, companyId), gte(event.eventDate, today))).groupBy(event.eventType), [] as { eventType: string; c: number }[]),
      safe(() => db.select({ spaceId: event.spaceId, spaceName: eventSpace.name, c: count() })
        .from(event).leftJoin(eventSpace, eq(event.spaceId, eventSpace.id))
        .where(and(eq(event.companyId, companyId), gte(event.eventDate, today), inArray(event.status, HELD)))
        .groupBy(event.spaceId, eventSpace.name), [] as any[]),
    ])

    const bookedValue = (bookedValueRows as any[]).reduce((s, l) => s + Number(l.unitPrice || 0) * Number(l.quantity || 0), 0)
    const statusMap: Record<string, number> = Object.fromEntries((byStatus as any[]).map((s) => [s.status, Number(s.c)]))
    const money = await maySeeMoney(user_)

    return one(c, {
      contacts: clientRows[0]?.value ?? 0,
      pipeline: {
        enquiry: statusMap.enquiry ?? 0,
        tentative: statusMap.tentative ?? 0,
        confirmed: statusMap.confirmed ?? 0,
        completed: statusMap.completed ?? 0,
        lost: statusMap.lost ?? 0,
        cancelled: statusMap.cancelled ?? 0,
      },
      events: {
        upcoming30: upcoming30Rows[0]?.value ?? 0,
        thisMonth: confirmedThisMonth[0]?.value ?? 0,
        ...(money ? { bookedValue } : {}),
      },
      ...(money
        ? { payments: { overdue: Number(revenue.overdue || 0), overdueCount: Number(revenue.overdueCount || 0), outstanding: Number(revenue.outstanding || 0) } }
        : { moneyWithheld: true }),
      byType: Object.fromEntries((byTypeRows as any[]).map((r) => [r.eventType, Number(r.c)])),
      bySpace: (spaceRows as any[]).map((r) => ({ spaceId: r.spaceId, name: r.spaceName || 'Unassigned', events: Number(r.c) }))
        .sort((a, b) => b.events - a.events),
    })
  })

  app.get('/recent-activity', async (c) => {
    const user_ = c.get('user') as any
    const companyId = user_.companyId
    const today = day(new Date())

    const [newEnquiries, upcomingEvents, scheduleRows] = await Promise.all([
      safe(() => db.select({ id: event.id, name: event.name, eventDate: event.eventDate, eventType: event.eventType, guestCount: event.guestCount, clientName: contact.name, createdAt: event.createdAt })
        .from(event).leftJoin(contact, eq(event.contactId, contact.id))
        .where(and(eq(event.companyId, companyId), eq(event.status, 'enquiry')))
        .orderBy(desc(event.createdAt)).limit(6), [] as any[]),
      safe(() => db.select({ id: event.id, name: event.name, eventDate: event.eventDate, startTime: event.startTime, status: event.status, guestCount: event.guestCount, guestCountFinal: event.guestCountFinal, spaceName: eventSpace.name, clientName: contact.name, coordinatorFirstName: user.firstName, coordinatorLastName: user.lastName })
        .from(event)
        .leftJoin(eventSpace, eq(event.spaceId, eventSpace.id))
        .leftJoin(contact, eq(event.contactId, contact.id))
        .leftJoin(user, eq(event.coordinatorId, user.id))
        .where(and(eq(event.companyId, companyId), gte(event.eventDate, today), inArray(event.status, HELD)))
        .orderBy(asc(event.eventDate)).limit(8), [] as any[]),
      // The whole schedule for events still on the book; what is paid comes from each event's invoice below.
      safe(() => db.select({ payment: eventPayment, eventName: event.name, clientName: contact.name })
        .from(eventPayment)
        .innerJoin(event, eq(eventPayment.eventId, event.id))
        .leftJoin(contact, eq(event.contactId, contact.id))
        .where(and(eq(eventPayment.companyId, companyId), notInArray(event.status, EXIT_STATUSES))), [] as any[]),
    ])

    // Installments not yet covered by their event's invoice, soonest first.
    const eventIds = [...new Set((scheduleRows as any[]).map((r) => r.payment.eventId as string))]
    const invoices = eventIds.length
      ? await safe(() => db.select().from(invoice).where(and(eq(invoice.companyId, companyId), inArray(invoice.eventId, eventIds))), [] as any[])
      : []
    const invoiceByEvent = new Map((invoices as any[]).map((inv) => [inv.eventId, inv]))
    const byEvent = new Map<string, any[]>()
    for (const r of scheduleRows as any[]) (byEvent.get(r.payment.eventId) || byEvent.set(r.payment.eventId, []).get(r.payment.eventId)!).push(r)
    const duePayments = [...byEvent.entries()].flatMap(([eventId, rows]) => {
      const meta = rows[0]
      return installmentStates(invoiceByEvent.get(eventId) || null, rows.map((r) => r.payment))
        .filter((p) => p.state === 'unpaid' || p.state === 'part_paid')
        .map((p) => ({ id: p.id, label: p.label, amount: p.amount, paidAmount: p.paidAmount, state: p.state, dueDate: p.dueDate, eventId, eventName: meta.eventName, clientName: meta.clientName }))
    }).sort((a, b) => (a.dueDate || '9999-12-31').localeCompare(b.dueDate || '9999-12-31')).slice(0, 8)

    // The Payments Due panel is the books too: absent, not an empty list, for a seat without invoices:read. (T62)
    return one(c, (await maySeeMoney(user_)) ? { newEnquiries, upcomingEvents, duePayments } : { newEnquiries, upcomingEvents, moneyWithheld: true })
  })

  return app
}
