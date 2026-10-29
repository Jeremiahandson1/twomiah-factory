// The private-events dashboard — the book ahead, the pipeline, and the money owed (not the jobs/quotes/invoices one the
// base CRM ships). Moved from templates/crm-restaurant/backend/src/routes/dashboard.ts (templates/crm-bar has the same
// file). /api/dashboard answers with this router where the vertical says so (CrmSettings.dashboard = 'events',
// server/modules/crm.ts); the registry signs the person in and applies the 'dashboard' gate.
//
// Money comes from the invoices (event deposits and balances live there — eventLedger.ts), through the same reporting
// service as the Reports page, so the two can't disagree. Both replies are one record each, as in the template.
import { Hono } from 'hono'
import { eq, and, gte, lte, lt, count, desc, asc, inArray, notInArray } from 'drizzle-orm'
import { companyTimeZone, createReportingService, invoiceBalance, overdueCutoff, storeDayStart } from '@twomiah/tenant-backend'
import { contact, event, eventSpace, eventMenuItem, eventPayment, user, invoice, payment, job, project, quote, timeEntry } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'
import { installmentStates } from './eventLedger.ts'
import { EXIT_STATUSES, venueToday } from './eventBooking.ts'
import { EVENT_TILES, dayPlus, eventTileCondition, overdueInvoiceCondition } from './tileConditions.ts'
import { barMenuItem, barTap, barPurchaseOrder, barTimeOff } from '../../db/schema/index.ts'
import { outTonightCondition, tapTroubleCondition, onTheWayCondition, pendingTimeOffCondition } from '../bar/tileConditions.ts'

const HELD = ['tentative', 'confirmed']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

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

  /**
   * THE HOME SCREEN'S TILES (`stats.tiles`): each figure is the count of the SAME condition the tile's list route filters
   * by (tileConditions.ts here and bar/tileConditions.ts), and each is present only when this seat may open that list —
   * the list's own permission and feature. A tile the seat may not open is ABSENT, never 0.
   *   tiles.events.{today,next30,inquiries,confirmed}   GET /api/events?tile=…            contacts:read · event_bookings
   *   tiles.invoices.overdue                            GET /api/invoices?status=overdue   invoices:read · invoices (+ amount)
   *   tiles.menu.out                                    GET /api/bar/menu?tile=out         bar:read · bar_menu
   *   tiles.taps.trouble                                GET /api/bar/taps?tile=trouble     bar:read · bar_menu (+ taps switch)
   *   tiles.orders.on_the_way                           GET /api/stock/orders?tile=on_the_way   bar:update · bar_stock
   *   tiles.timeOff.pending                             GET /api/schedule/time-off?tile=pending bar:update · bar_schedule
   */
  /** The overdue invoices — the list's own rows (overdueInvoiceCondition): how many, and the balance they hold. */
  async function overdueFigures(companyId: string) {
    const cutoff = overdueCutoff(new Date(), await companyTimeZone(db, companyId))
    const rows = await safe(() => db.select().from(invoice).where(and(eq(invoice.companyId, companyId), overdueInvoiceCondition(invoice, cutoff))), [] as any[])
    return { overdue: rows.length, overdueAmount: Math.round(rows.reduce((sum: number, r: any) => sum + invoiceBalance(r), 0) * 100) / 100 }
  }

  async function homeTiles(u: any, today: string) {
    const companyId = u.companyId
    const extra = await getExtraPermissions(u.userId)
    const may = (perm: string) => hasPermission(u.role, perm, extra)
    const on = (f: string | string[]) => d.features.isFeatureEnabled(companyId, f)
    const tapsSwitch = d.settings?.foodService?.tapsFeature
    const n = async (q: Promise<any[]>) => Number((await safe(() => q, [{ value: 0 }] as any[]))[0]?.value ?? 0)
    const tiles: Record<string, any> = {}
    if (may('contacts:read') && await on('event_bookings')) {
      const counts = await Promise.all(EVENT_TILES.map((tile) =>
        n(db.select({ value: count() }).from(event).where(and(eq(event.companyId, companyId), eventTileCondition(tile, event, today))) as any)))
      tiles.events = Object.fromEntries(EVENT_TILES.map((tile, i) => [tile, counts[i]]))
    }
    if (may('invoices:read') && await on('invoices')) tiles.invoices = await overdueFigures(companyId)
    if (may('bar:read') && await on('bar_menu')) {
      tiles.menu = { out: await n(db.select({ value: count() }).from(barMenuItem).where(and(eq(barMenuItem.companyId, companyId), outTonightCondition(barMenuItem))) as any) }
      if (!tapsSwitch || await on(tapsSwitch)) tiles.taps = { trouble: await n(db.select({ value: count() }).from(barTap).where(and(eq(barTap.companyId, companyId), tapTroubleCondition(barTap))) as any) }
    }
    if (may('bar:update') && await on('bar_stock')) tiles.orders = { on_the_way: await n(db.select({ value: count() }).from(barPurchaseOrder).where(and(eq(barPurchaseOrder.companyId, companyId), onTheWayCondition(barPurchaseOrder))) as any) }
    if (may('bar:update') && await on('bar_schedule')) tiles.timeOff = { pending: await n(db.select({ value: count() }).from(barTimeOff).where(and(eq(barTimeOff.companyId, companyId), pendingTimeOffCondition(barTimeOff))) as any) }
    return tiles
  }

  const app = new Hono<AppEnv>()

  app.get('/stats', async (c) => {
    const user_ = c.get('user') as any
    const companyId = user_.companyId
    // Today, this month and the next 30 days on the venue's clock: these read the server's UTC day, so an evening in
    // the States counted tomorrow's events as today's.
    const today = await venueToday(db, companyId)
    const in30 = dayPlus(today, 30)
    const startOfMonth = `${today.slice(0, 8)}01`
    const nm = new Date(Date.UTC(Number(today.slice(0, 4)), Number(today.slice(5, 7)), 1))
    const startOfNextMonth = nm.toISOString().slice(0, 10)
    /**
     * THE REPORTS PAGE'S PERIOD (?startDate=&endDate=, its picker's days on the company clock): the enquiries that came
     * in during it. The Enquiries tile read "in the next 30 days" whatever period was chosen (live test 2026-10-25).
     */
    const qs = c.req.query('startDate'), qe = c.req.query('endDate')
    const period = qs && qe && DAY_RE.test(qs) && DAY_RE.test(qe) && qs <= qe ? { from: qs, to: qe } : null
    const tz = period ? await companyTimeZone(db, companyId) : null
    const periodRange = period && tz ? { start: storeDayStart(period.from, tz), end: storeDayStart(dayPlus(period.to, 1), tz) } : null

    const [clientRows, byStatus, upcoming30Rows, confirmedThisMonth, revenue, bookedValueRows, byTypeRows, spaceRows, aheadRows, periodRows] = await Promise.all([
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
      // The book ahead, by stage: what "booked ahead" counts (a tentative event holds its room, so it is in the figure),
      // so the Reports tile beside it can say how many of each it is rather than "Confirmed events 0" beside $1,575.
      safe(() => db.select({ status: event.status, c: count() }).from(event)
        .where(and(eq(event.companyId, companyId), gte(event.eventDate, today), inArray(event.status, HELD))).groupBy(event.status), [] as { status: string; c: number }[]),
      periodRange
        ? safe(() => db.select({ value: count() }).from(event)
          .where(and(eq(event.companyId, companyId), gte(event.createdAt, periodRange.start), lt(event.createdAt, periodRange.end))), [{ value: 0 }] as any[])
        : Promise.resolve(null),
    ])
    const ahead: Record<string, number> = Object.fromEntries((aheadRows as any[]).map((s) => [s.status, Number(s.c)]))

    const bookedValue = (bookedValueRows as any[]).reduce((s, l) => s + Number(l.unitPrice || 0) * Number(l.quantity || 0), 0)
    const statusMap: Record<string, number> = Object.fromEntries((byStatus as any[]).map((s) => [s.status, Number(s.c)]))
    const money = await maySeeMoney(user_)
    const tiles = await homeTiles(user_, today)
    // The banner is the same rows as the list it opens (and as tiles.invoices), whether or not the invoices switch is on.
    const overdueNow = money ? (tiles.invoices ?? await overdueFigures(companyId)) : { overdue: 0, overdueAmount: 0 }

    return one(c, {
      // the venue's calendar day, so the phone need not guess it
      today,
      tiles,
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
        // Held and still to come — the events bookedValue is the menu of.
        ahead: { confirmed: ahead.confirmed ?? 0, tentative: ahead.tentative ?? 0 },
        // Enquiries received in the asked period (absent when no period was asked).
        ...(periodRows ? { enquiriesInPeriod: Number((periodRows as any[])[0]?.value ?? 0) } : {}),
        ...(money ? { bookedValue } : {}),
      },
      ...(money
        ? { payments: { overdue: overdueNow.overdueAmount, overdueCount: overdueNow.overdue, outstanding: Number(revenue.outstanding || 0) } }
        : { moneyWithheld: true }),
      byType: Object.fromEntries((byTypeRows as any[]).map((r) => [r.eventType, Number(r.c)])),
      bySpace: (spaceRows as any[]).map((r) => ({ spaceId: r.spaceId, name: r.spaceName || 'Unassigned', events: Number(r.c) }))
        .sort((a, b) => b.events - a.events),
    })
  })

  app.get('/recent-activity', async (c) => {
    const user_ = c.get('user') as any
    const companyId = user_.companyId
    const today = await venueToday(db, user_.companyId)

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
