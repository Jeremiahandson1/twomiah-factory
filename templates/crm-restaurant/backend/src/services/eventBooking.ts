// Event booking rules — ONE set of them for everything that writes an event: POST /events, PUT /events/:id
// and the CSV importer. What an event may hold (validateEventInput) and how a booking is written
// (createEvent: the per-business lock, the room-clash check, the row, the room-hire line). The importer
// once inserted straight into the table with none of this, so a CSV could double-book a room and save
// dates, times, guest counts, money and types the form refuses (T15 B1/H4, M1–M4). (#162)
import { and, eq, gte, inArray, notInArray, ne, isNotNull, sql, count, countDistinct } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { db } from '../../db/index.ts'
import { event, eventSpace, eventMenuItem } from '../../db/schema.ts'
import { EXIT_STATUSES } from './eventLedger.ts'

// The lists the frontend offers (pages/events/EventsPage.tsx STATUSES / EVENT_TYPES) — pinned equal by
// scripts/check-events-input.ts, so a status or type is one vocabulary end to end.
export const EVENT_STATUSES = ['enquiry', 'tentative', 'confirmed', 'completed', 'lost', 'cancelled'] as const
export const EVENT_TYPES = ['private_dining', 'wedding', 'corporate', 'birthday', 'anniversary', 'funeral', 'christmas_party', 'other'] as const

// A space can only host one live event per date. HELD lists the statuses that hold the room; enquiries
// deliberately do NOT, because two people asking about the same Saturday is normal and must not block
// either of them.
export const HELD = ['tentative', 'confirmed', 'completed']

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const MAX_EVENT_NAME = 200

/** A YYYY-MM-DD string that is a real calendar day (2027-02-30 and 2026-13-45 are not). */
export function isCalendarDate(v: unknown): boolean {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

// '' and null mean "not set"; anything else must be a number.
const num = (v: any) => (v === '' || v == null ? null : Number(v))
const has = (input: Record<string, any>, k: string) => k in input

/**
 * The rules, on a create body or an update patch. `existing` supplies the other half of a pair (start/end
 * times, guest counts) when a patch changes only one of them — the same "effective values" check PUT
 * always did. Returns the first problem as the message the form shows.
 */
export function validateEventInput(input: Record<string, any>, existing?: Record<string, any> | null): string | null {
  const eff = (k: string) => (has(input, k) ? input[k] : existing?.[k])
  const creating = !existing

  if (creating || has(input, 'name')) {
    if (typeof input.name !== 'string' || !input.name.trim()) return 'name is required'
    if (input.name.trim().length > MAX_EVENT_NAME) return `Event name must be ${MAX_EVENT_NAME} characters or fewer.`
  }
  if (creating || has(input, 'eventDate')) {
    if (typeof input.eventDate !== 'string' || !DATE_RE.test(input.eventDate)) return 'eventDate is required as YYYY-MM-DD'
    if (!isCalendarDate(input.eventDate)) return `${input.eventDate} is not a real calendar date.`
  }
  if (has(input, 'status') && input.status != null && !EVENT_STATUSES.includes(input.status)) return `Status must be one of: ${EVENT_STATUSES.join(', ')}.`
  if (has(input, 'eventType') && input.eventType != null && !EVENT_TYPES.includes(input.eventType)) return `Event type must be one of: ${EVENT_TYPES.join(', ')}.`

  for (const k of ['startTime', 'endTime']) {
    const v = input[k]
    if (has(input, k) && v != null && v !== '' && (typeof v !== 'string' || !TIME_RE.test(v))) return 'Times must be HH:MM (24-hour clock).'
  }
  const start = eff('startTime'), end = eff('endTime')
  if (start && end && String(end) <= String(start)) return 'End time must be after the start time.'

  // Server-side event validation — the API accepted end-before-start, negative and absurd guest counts,
  // and persisted them (only the widget validated). (F5)
  const g = num(eff('guestCount')), gf = num(eff('guestCountFinal'))
  if (g != null && (isNaN(g) || g < 0 || g > 1000000)) return 'Guest count must be between 0 and 1,000,000.'
  if (gf != null && (isNaN(gf) || gf < 0 || gf > 1000000)) return 'Final guest count must be between 0 and 1,000,000.'

  for (const [k, label] of [['quotedTotal', 'Quoted total'], ['depositRequired', 'Deposit']] as const) {
    if (!has(input, k)) continue
    const v = num(input[k])
    if (v == null) continue
    if (isNaN(v)) return `${label} must be a number.`
    if (v < 0) return `${label} cannot be negative.`
  }
  return null
}

// Thrown inside the booking transaction so a detected clash rolls back the write and is answered as a
// 409 after it unwinds. One advisory lock per business serialises the whole check-then-write, so two
// coordinators holding the same space+date at the same instant can't both pass findClash. (space race)
export class SpaceClash extends Error { constructor(public payload: any) { super('space clash') } }
export const eventLock = (tx: any, companyId: string) => tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':event'}))`)

export async function findClash(exec: any, companyId: string, spaceId: string, eventDate: string, ignoreId?: string) {
  const rows = await exec.select().from(event)
    .where(and(
      eq(event.companyId, companyId),
      eq(event.spaceId, spaceId),
      eq(event.eventDate, eventDate),
      inArray(event.status, HELD),
      ...(ignoreId ? [ne(event.id, ignoreId)] : []),
    ))
    .limit(1)
  return rows[0]
}

// A room's hire fee is charged as its own menu line (spaceId set), priced when the room is booked.
// Moving rooms swaps the line; hand-typed lines are never touched. Runs inside the booking transaction.
export async function syncHireLine(tx: any, companyId: string, ev: { id: string; spaceId: string | null }) {
  const auto = await tx.select().from(eventMenuItem)
    .where(and(eq(eventMenuItem.eventId, ev.id), eq(eventMenuItem.companyId, companyId), isNotNull(eventMenuItem.spaceId)))
  const keep = auto.find((l: any) => l.spaceId === ev.spaceId)
  for (const l of auto) if (l !== keep) await tx.delete(eventMenuItem).where(eq(eventMenuItem.id, l.id))
  if (keep || !ev.spaceId) return
  const [space] = await tx.select().from(eventSpace).where(and(eq(eventSpace.id, ev.spaceId), eq(eventSpace.companyId, companyId))).limit(1)
  if (!space || !(Number(space.hireFee) > 0)) return
  await tx.insert(eventMenuItem).values({
    id: createId(), eventId: ev.id, spaceId: space.id, name: `Room hire — ${space.name}`,
    perPerson: false, quantity: 1, unitPrice: space.hireFee, companyId,
  })
}

/**
 * Write a new event inside the caller's transaction: lock the business's book, refuse a held room
 * (SpaceClash, answered 409 by the route / a row error by the importer), insert, add the room-hire line.
 * The caller has already run validateEventInput. This is the body POST /events always had; the
 * importer now goes through it too.
 */
export async function createEvent(tx: any, companyId: string, body: Record<string, any>) {
  const status = body.status || 'enquiry'
  await eventLock(tx, companyId)
  if (body.spaceId && HELD.includes(status)) {
    const clash = await findClash(tx, companyId, body.spaceId, body.eventDate)
    if (clash) throw new SpaceClash({ error: `That space is already held on ${body.eventDate} by "${clash.name}"`, conflictId: clash.id })
  }
  const [row] = await tx.insert(event).values({
    id: createId(),
    contactId: body.contactId || null,
    spaceId: body.spaceId || null,
    coordinatorId: body.coordinatorId || null,
    name: body.name.trim(),
    eventType: body.eventType || 'private_dining',
    status,
    eventDate: body.eventDate,
    startTime: body.startTime || null,
    endTime: body.endTime || null,
    guestCount: body.guestCount ?? null,
    guestCountFinal: body.guestCountFinal ?? null,
    quotedTotal: body.quotedTotal ?? null,
    depositRequired: body.depositRequired ?? null,
    source: body.source || null,
    dietaryRequirements: body.dietaryRequirements || null,
    setupNotes: body.setupNotes || null,
    notes: body.notes || null,
    companyId,
  }).returning()
  await syncHireLine(tx, companyId, row)
  return row
}

// ── Retiring what upcoming bookings still use ───────────────────────────────────────────────────
// Rooms and packages are retired (active = false), never deleted, so history keeps them. But a room
// that still holds upcoming bookings, or a package still on upcoming menus, vanishes from every picker
// the moment it is retired — those bookings must be moved first. (T15 H1)
// "Upcoming" is the dashboard's rule: dated today (UTC calendar day) or later.
export const todayUtc = () => new Date().toISOString().slice(0, 10)
// A room is held by tentative/confirmed bookings (the same statuses that block a clash today).
const UPCOMING_HOLDS = ['tentative', 'confirmed']

/** Upcoming bookings (today or later, tentative/confirmed) still in this room. */
export async function upcomingEventsUsingSpace(companyId: string, spaceId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(event)
    .where(and(eq(event.companyId, companyId), eq(event.spaceId, spaceId), gte(event.eventDate, todayUtc()), inArray(event.status, UPCOMING_HOLDS)))
  return Number(row?.value || 0)
}

/** Upcoming events (today or later, not lost/cancelled) with this package on their menu. */
export async function upcomingEventsUsingPackage(companyId: string, packageId: string): Promise<number> {
  const [row] = await db.select({ value: countDistinct(eventMenuItem.eventId) }).from(eventMenuItem)
    .innerJoin(event, eq(event.id, eventMenuItem.eventId))
    .where(and(eq(eventMenuItem.companyId, companyId), eq(eventMenuItem.packageId, packageId), gte(event.eventDate, todayUtc()), notInArray(event.status, EXIT_STATUSES)))
  return Number(row?.value || 0)
}

export const retireSpaceRefusal = (name: string, n: number) => `"${name}" still has ${n} upcoming booking${n === 1 ? '' : 's'} — move ${n === 1 ? 'it' : 'them'} to another room first.`
export const retirePackageRefusal = (name: string, n: number) => `"${name}" is on the menu of ${n} upcoming event${n === 1 ? '' : 's'} — change ${n === 1 ? 'its menu' : 'their menus'} first.`
