import { Hono } from 'hono'
import { and, eq, desc, notInArray, sql } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { rentalReservation, unit, contact } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

// ── Rentals ─────────────────────────────────────────────────────────────────
// Reservations on inventory units, stored per company. The server works out the days and total from the dates,
// refuses impossible bookings (return before pick-up, negative or absurd rates, sold units) and never lets one unit
// hold two reservations whose dates overlap — checked under a lock on the unit row, so two bookings made at the
// same moment can't both win. (RV T19 H5: reservations lived in server memory, seeded with made-up rows, a unit
// could be double-booked and a -$100 reservation ending before it started was accepted and counted as revenue)
const app = new Hono()
app.use('*', authenticate)

const DAY_MS = 86_400_000
const MAX_DAYS = 366
const MAX_RATE = 100_000
// allowed status changes (a returned or cancelled reservation no longer holds its dates)
const NEXT: Record<string, string[]> = { reserved: ['out', 'cancelled'], out: ['returned'], returned: [], cancelled: [] }

const isDay = (v: unknown): v is string =>
  typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().slice(0, 10) === v
const addDay = (d: string) => new Date(Date.parse(`${d}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10)
// A booking holds [pick-up, return): the return day is free for the next pick-up; a same-day rental holds its day.
const heldUntil = (start: string, end: string) => (end > start ? end : addDay(start))
const unitLabel = (u: any) => [[u.year, u.make, u.modelName].filter(Boolean).join(' ') || 'Unit', u.stockNumber ? `(${u.stockNumber})` : ''].filter(Boolean).join(' ')

const shape = (r: any) => ({
  id: r.id, unitId: r.unitId, unit: r.unitLabel, contactId: r.contactId, customer: r.customerName,
  start: r.startDate, end: r.endDate, days: r.days, rate: Number(r.dailyRate), total: Number(r.total), status: r.status, notes: r.notes,
})

async function summary(companyId: string) {
  const [s] = await db.select({
    active: sql<number>`count(*) filter (where ${rentalReservation.status} = 'out')`,
    reserved: sql<number>`count(*) filter (where ${rentalReservation.status} = 'reserved')`,
    revenue: sql<string>`coalesce(sum(${rentalReservation.total}) filter (where ${rentalReservation.status} <> 'cancelled'), 0)`,
  }).from(rentalReservation).where(eq(rentalReservation.companyId, companyId))
  return { active: Number(s?.active || 0), reserved: Number(s?.reserved || 0), revenue: Number(s?.revenue || 0) }
}

app.get('/list', requirePermission('contacts:read'), async (c) => {
  const user = c.get('user') as any
  const rows = await db.select().from(rentalReservation)
    .where(eq(rentalReservation.companyId, user.companyId))
    .orderBy(desc(rentalReservation.startDate), desc(rentalReservation.createdAt))
    .limit(500)
  return c.json({ rentals: rows.map(shape), summary: await summary(user.companyId) })
})

app.post('/create', requirePermission('contacts:create'), async (c) => {
  const user = c.get('user') as any
  const b = await c.req.json().catch(() => ({} as any))

  const unitId = typeof b.unitId === 'string' ? b.unitId : ''
  const customer = typeof b.customer === 'string' ? b.customer.trim() : ''
  if (!unitId) return c.json({ error: 'Pick the unit to rent.' }, 400)
  if (!customer) return c.json({ error: 'Customer is required.' }, 400)
  if (customer.length > 200) return c.json({ error: 'Customer name is too long.' }, 400)
  if (!isDay(b.start) || !isDay(b.end)) return c.json({ error: 'Pick-up and return dates are required.' }, 400)
  if (b.end < b.start) return c.json({ error: "The return date can't be before the pick-up date." }, 400)
  const days = Math.max(1, Math.round((Date.parse(`${b.end}T00:00:00Z`) - Date.parse(`${b.start}T00:00:00Z`)) / DAY_MS))
  if (days > MAX_DAYS) return c.json({ error: `A rental can't be longer than ${MAX_DAYS} days.` }, 400)
  const rateText = typeof b.rate === 'string' ? b.rate.trim() : b.rate
  const rate = typeof rateText === 'number' ? rateText : typeof rateText === 'string' && /^\d+(\.\d{1,2})?$/.test(rateText) ? Number(rateText) : NaN
  if (!Number.isFinite(rate) || rate < 0 || rate > MAX_RATE) return c.json({ error: `Daily rate must be a number from 0 to ${MAX_RATE.toLocaleString('en-US')}.` }, 400)
  const dailyRate = Math.round(rate * 100) / 100
  const notes = typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim().slice(0, 2000) : null

  const outcome = await db.transaction(async (tx: any) => {
    const [u] = await tx.select().from(unit).where(and(eq(unit.id, unitId), eq(unit.companyId, user.companyId))).limit(1).for('update')
    if (!u) return { status: 404 as const, error: 'Unit not found.' }
    if (u.status === 'sold') return { status: 409 as const, error: `${unitLabel(u)} is sold and can't be rented.` }

    let contactId: string | null = null
    if (b.contactId) {
      const [ct] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.id, String(b.contactId)), eq(contact.companyId, user.companyId))).limit(1)
      if (!ct) return { status: 404 as const, error: 'Contact not found.' }
      contactId = ct.id
    }

    // another reservation on this unit still holding dates that overlap [start, heldUntil)
    const until = heldUntil(b.start, b.end)
    const [clash] = await tx.select().from(rentalReservation).where(and(
      eq(rentalReservation.companyId, user.companyId),
      eq(rentalReservation.unitId, unitId),
      notInArray(rentalReservation.status, ['returned', 'cancelled']),
      sql`${rentalReservation.startDate} < ${until}`,
      sql`(case when ${rentalReservation.endDate} > ${rentalReservation.startDate} then ${rentalReservation.endDate} else ${rentalReservation.startDate} + 1 end) > ${b.start}`,
    )).limit(1)
    if (clash) return { status: 409 as const, error: `${unitLabel(u)} is already booked ${clash.startDate} → ${clash.endDate} (${clash.customerName}).`, conflictId: clash.id }

    const [row] = await tx.insert(rentalReservation).values({
      unitId, unitLabel: unitLabel(u), contactId, customerName: customer, startDate: b.start, endDate: b.end,
      days, dailyRate: dailyRate.toFixed(2), total: (Math.round(dailyRate * days * 100) / 100).toFixed(2),
      status: 'reserved', notes, companyId: user.companyId,
    }).returning()
    return { row }
  })

  if (!('row' in outcome)) { const { status, ...rest } = outcome; return c.json(rest, status) }
  return c.json({ rental: shape(outcome.row), summary: await summary(user.companyId) }, 201)
})

// POST /:id/status { status } — reserved → out | cancelled, out → returned
app.post('/:id/status', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const id = c.req.param('id')
  const { status } = await c.req.json().catch(() => ({} as any))
  const outcome = await db.transaction(async (tx: any) => {
    const [r] = await tx.select().from(rentalReservation).where(and(eq(rentalReservation.id, id), eq(rentalReservation.companyId, user.companyId))).limit(1).for('update')
    if (!r) return { status: 404 as const, error: 'Reservation not found.' }
    if (!(NEXT[r.status] || []).includes(status)) return { status: 400 as const, error: `A ${r.status} reservation can't be marked ${typeof status === 'string' ? status : 'that'}.` }
    const [row] = await tx.update(rentalReservation).set({ status, updatedAt: new Date() }).where(eq(rentalReservation.id, r.id)).returning()
    return { row }
  })
  if (!('row' in outcome)) { const { status: code, ...rest } = outcome; return c.json(rest, code) }
  return c.json({ rental: shape(outcome.row), summary: await summary(user.companyId) })
})

export default app
