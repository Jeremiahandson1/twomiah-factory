import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, event, eventSpace, eventMenuItem, eventPayment, user, invoice, payment, job, project, quote, timeEntry } from '../../db/schema.ts'
import { eq, and, gte, lte, lt, count, desc, asc, sql, inArray, notInArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { createReportingService } from '../shared/index.ts'
import { installmentStates, EXIT_STATUSES } from '../services/eventLedger.ts'

/**
 * Events dashboard — the book ahead, the pipeline, and the money owed
 * (not the contractor jobs/quotes/invoices the base ships).
 *
 * Money comes from the invoices (event deposits and balances live there — services/eventLedger.ts),
 * through the same reporting service as the Reports page, so the two can't disagree.
 */

const app = new Hono()
app.use('*', authenticate)
const reporting = createReportingService({ db, tables: { invoice, payment, job, project, quote, timeEntry, user, contact }, authenticate, requirePermission: () => null as any })

const HELD = ['tentative', 'confirmed']
const day = (d: Date) => d.toISOString().slice(0, 10)

app.get('/stats', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  const today = day(now)
  const in30 = day(new Date(now.getTime() + 30 * 86400000))
  const startOfMonth = day(new Date(now.getFullYear(), now.getMonth(), 1))
  const startOfNextMonth = day(new Date(now.getFullYear(), now.getMonth() + 1, 1))

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [clientRows, byStatus, upcoming30Rows, confirmedThisMonth, revenue, bookedValueRows, byTypeRows, spaceRows] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ status: event.status, c: count() }).from(event).where(eq(event.companyId, companyId)).groupBy(event.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(event).where(and(eq(event.companyId, companyId), gte(event.eventDate, today), lte(event.eventDate, in30), inArray(event.status, HELD))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(event).where(and(eq(event.companyId, companyId), gte(event.eventDate, startOfMonth), lt(event.eventDate, startOfNextMonth), inArray(event.status, HELD))), [{ value: 0 }]),
    // Money the venue is owed and hasn't collected — exactly the Reports figures (outstanding now, and the
    // part of it past due). This is the number that pays for the software.
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
  const statusMap = Object.fromEntries(byStatus.map(s => [s.status, Number(s.c)]))

  return c.json({
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
      bookedValue,
    },
    payments: { overdue: Number(revenue.overdue || 0), overdueCount: Number(revenue.overdueCount || 0), outstanding: Number(revenue.outstanding || 0) },
    byType: Object.fromEntries((byTypeRows as any[]).map(r => [r.eventType, Number(r.c)])),
    bySpace: (spaceRows as any[]).map(r => ({ spaceId: r.spaceId, name: r.spaceName || 'Unassigned', events: Number(r.c) }))
      .sort((a, b) => b.events - a.events),
  })
})

app.get('/recent-activity', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const today = day(new Date())
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [newEnquiries, upcomingEvents, scheduleRows] = await Promise.all([
    safe(() => db.select({ id: event.id, name: event.name, eventDate: event.eventDate, eventType: event.eventType, guestCount: event.guestCount, clientName: contact.name, createdAt: event.createdAt })
      .from(event).leftJoin(contact, eq(event.contactId, contact.id))
      .where(and(eq(event.companyId, companyId), eq(event.status, 'enquiry')))
      .orderBy(desc(event.createdAt)).limit(6), []),
    safe(() => db.select({ id: event.id, name: event.name, eventDate: event.eventDate, startTime: event.startTime, status: event.status, guestCount: event.guestCount, guestCountFinal: event.guestCountFinal, spaceName: eventSpace.name, clientName: contact.name, coordinatorFirstName: user.firstName, coordinatorLastName: user.lastName })
      .from(event)
      .leftJoin(eventSpace, eq(event.spaceId, eventSpace.id))
      .leftJoin(contact, eq(event.contactId, contact.id))
      .leftJoin(user, eq(event.coordinatorId, user.id))
      .where(and(eq(event.companyId, companyId), gte(event.eventDate, today), inArray(event.status, HELD)))
      .orderBy(asc(event.eventDate)).limit(8), []),
    // The whole schedule for events still on the book; what is paid comes from each event's invoice below.
    safe(() => db.select({ payment: eventPayment, eventName: event.name, clientName: contact.name })
      .from(eventPayment)
      .innerJoin(event, eq(eventPayment.eventId, event.id))
      .leftJoin(contact, eq(event.contactId, contact.id))
      .where(and(eq(eventPayment.companyId, companyId), notInArray(event.status, EXIT_STATUSES))), [] as any[]),
  ])

  // Installments not yet covered by their event's invoice, soonest first.
  const eventIds = [...new Set((scheduleRows as any[]).map((r) => r.payment.eventId))]
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

  return c.json({ newEnquiries, upcomingEvents, duePayments })
})

export default app
