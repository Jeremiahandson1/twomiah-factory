// Rentals: reservations on inventory units. The server works out the days and total from the dates, refuses impossible
// bookings and never lets one unit hold two reservations whose dates overlap — checked under a lock on the unit row
// (RV T19 H5). The fleet's takings are invoices:read's (T41). Moved from templates/crm-rv/backend/src/routes/rentals.ts.
import { Hono } from 'hono'
import { and, eq, desc } from 'drizzle-orm'
import { roundsToNothing } from '@twomiah/tenant-backend'
import { rentalReservation, unit, contact } from '../../db/schema/index.ts'
import { rentalSummary, rentalClash } from '../../data/rvDealership.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

const DAY_MS = 86_400_000
const MAX_DAYS = 366
const MAX_RATE = 100_000
// allowed status changes (a returned or cancelled reservation no longer holds its dates)
const NEXT: Record<string, string[]> = { reserved: ['out', 'cancelled'], out: ['returned'], returned: [], cancelled: [] }

const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const addDay = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
// A booking holds [pick-up, return): the return day is free for the next pick-up; a same-day rental holds its day.
const heldUntil = (start: string, end: string) => (end > start ? end : addDay(start))
const unitLabel = (u: any) => [[u.year, u.make, u.modelName].filter(Boolean).join(' ') || 'Unit', u.stockNumber ? `(${u.stockNumber})` : ''].filter(Boolean).join(' ')

const shape = (r: any) => ({
  id: r.id, unitId: r.unitId, unit: r.unitLabel, contactId: r.contactId, customer: r.customerName,
  start: r.startDate, end: r.endDate, days: r.days, rate: Number(r.dailyRate), total: Number(r.total), status: r.status, notes: r.notes,
})

type Refusal = { status: 400 | 404 | 409; error: string; code?: string }

export function createRentalRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  /**
   * The fleet's figures as this person may see them: summary.revenue only with invoices:read — deleted, not zeroed.
   * The template applied this to /list alone, so booking or moving a reservation handed the floor seat the takings
   * T41 took off /list; every reply that carries the summary asks it now.
   */
  const summaryFor = async (u: any) => {
    const s = await rentalSummary(db, u.companyId)
    if (hasPermission(u?.role, 'invoices:read', await getExtraPermissions(u?.userId))) return s
    const { revenue: _revenue, ...rest } = s
    return rest
  }

  // GET /list — every reservation and the fleet's figures. The daily rate and total on each stay (the quote the
  // counter gives).
  app.get('/list', requirePermission('contacts:read'), async (c) => {
    const u = c.get('user')
    const rows = await db.select().from(rentalReservation)
      .where(eq(rentalReservation.companyId, u.companyId))
      .orderBy(desc(rentalReservation.startDate), desc(rentalReservation.createdAt))
      .limit(500)
    return one(c, { rentals: rows.map(shape), summary: await summaryFor(u) })
  })

  app.post('/create', requirePermission('contacts:create'), async (c) => {
    const u = c.get('user')
    const b = await c.req.json().catch(() => ({} as any))
    const unitId = typeof b.unitId === 'string' ? b.unitId : ''
    const customer = typeof b.customer === 'string' ? b.customer.trim() : ''
    if (!unitId) return fail(c, 400, 'Pick the unit to rent.')
    if (!customer) return fail(c, 400, 'Customer is required.')
    if (customer.length > 200) return fail(c, 400, 'Customer name is too long.')
    if (!isDay(b.start) || !isDay(b.end)) return fail(c, 400, 'Pick-up and return dates are required.')
    if (b.end < b.start) return fail(c, 400, "The return date can't be before the pick-up date.")
    const days = Math.max(1, Math.round((Date.parse(`${b.end}T00:00:00Z`) - Date.parse(`${b.start}T00:00:00Z`)) / DAY_MS))
    if (days > MAX_DAYS) return fail(c, 400, `A rental can't be longer than ${MAX_DAYS} days.`)
    const rateText = typeof b.rate === 'string' ? b.rate.trim() : b.rate
    const rate = typeof rateText === 'number' ? rateText : typeof rateText === 'string' && /^\d+(\.\d{1,2})?$/.test(rateText) ? Number(rateText) : NaN
    if (!Number.isFinite(rate) || rate < 0 || roundsToNothing(rate) || rate > MAX_RATE) return fail(c, 400, `Daily rate must be a number from 0 to ${MAX_RATE.toLocaleString('en-US')}.`)
    const dailyRate = Math.round(rate * 100) / 100
    const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 2000) : null

    const outcome: { row: any } | Refusal = await db.transaction(async (tx: any) => {
      const [un] = await tx.select().from(unit).where(and(eq(unit.id, unitId), eq(unit.companyId, u.companyId))).limit(1).for('update')
      if (!un) return { status: 404, error: 'Unit not found.' }
      if (un.status === 'sold') return { status: 409, error: `${unitLabel(un)} is sold and can't be rented.` }
      let contactId: string | null = null
      if (b.contactId) {
        const [ct] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(b.contactId)), eq(contact.companyId, u.companyId))).limit(1)
        if (!ct) return { status: 404, error: 'Contact not found.' }
        contactId = ct.id
      }
      // another reservation on this unit still holding dates that overlap [start, heldUntil)
      const clash = await rentalClash(tx, { companyId: u.companyId, unitId, start: b.start, until: heldUntil(b.start, b.end) })
      if (clash) return { status: 409, error: `${unitLabel(un)} is already booked ${clash.startDate} → ${clash.endDate} (${clash.customerName}).`, code: 'rental_overlap' }
      const [row] = await tx.insert(rentalReservation).values({
        unitId, unitLabel: unitLabel(un), contactId, customerName: customer, startDate: b.start, endDate: b.end,
        days, dailyRate: dailyRate.toFixed(2), total: (Math.round(dailyRate * days * 100) / 100).toFixed(2),
        status: 'reserved', notes, companyId: u.companyId,
      }).returning()
      return { row }
    })
    if (!('row' in outcome)) return fail(c, outcome.status, outcome.error, outcome.code)
    return one(c, { rental: shape(outcome.row), summary: await summaryFor(u) }, 201)
  })

  // POST /:id/status { status } — reserved → out | cancelled, out → returned
  app.post('/:id/status', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const id = c.req.param('id')
    const { status } = await c.req.json().catch(() => ({} as any))
    const outcome: { row: any } | Refusal = await db.transaction(async (tx: any) => {
      const [r] = await tx.select().from(rentalReservation).where(and(eq(rentalReservation.id, id), eq(rentalReservation.companyId, u.companyId))).limit(1).for('update')
      if (!r) return { status: 404, error: 'Reservation not found.' }
      if (!(NEXT[r.status] || []).includes(status)) return { status: 400, error: `A ${r.status} reservation can't be marked ${typeof status === 'string' ? status : 'that'}.` }
      const [row] = await tx.update(rentalReservation).set({ status, updatedAt: new Date() }).where(eq(rentalReservation.id, r.id)).returning()
      return { row }
    })
    if (!('row' in outcome)) return fail(c, outcome.status, outcome.error)
    return one(c, { rental: shape(outcome.row), summary: await summaryFor(u) })
  })

  return app
}
