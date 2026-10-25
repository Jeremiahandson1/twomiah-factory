// Event booking rules — ONE set of them for everything that writes an event: POST /events, PUT /events/:id and the
// CSV importer. What an event may hold (validateEventInput) and how a booking is written (createEvent: the
// per-business lock, the room-clash check, the row, the room-hire line). Moved from
// templates/crm-restaurant/backend/src/services/eventBooking.ts (templates/crm-bar has the same file); each function
// takes the database (or the transaction) it runs on. The lock is in server/data/restaurantEvents.ts.
import { and, eq, gte, inArray, notInArray, ne, isNotNull, count, countDistinct } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { event, eventSpace, eventMenuItem, user } from '../../db/schema/index.ts'
import { lockEventBook } from '../../data/restaurantEvents.ts'
import { companyTimeZone, storeDateString } from '@twomiah/tenant-backend'

// The lists the screens offer (crm/pages/restaurant/EventsPage.tsx STATUSES / EVENT_TYPES), so a status or type is
// one vocabulary end to end.
export const EVENT_STATUSES = ['enquiry', 'tentative', 'confirmed', 'completed', 'lost', 'cancelled'] as const
export const EVENT_TYPES = ['private_dining', 'wedding', 'corporate', 'birthday', 'anniversary', 'funeral', 'christmas_party', 'other'] as const

// The event has left the book; its invoice is closed and no longer follows the menu.
export const EXIT_STATUSES = ['cancelled', 'lost']

// A space can only host one live event per date. HELD lists the statuses that hold the room; enquiries deliberately
// do NOT, because two people asking about the same Saturday is normal and must not block either of them.
export const HELD = ['tentative', 'confirmed', 'completed']

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/
export const MAX_EVENT_NAME = 200
// Run-of-show departments — the screen's list (EventDetailPage.tsx DEPARTMENTS).
export const TIMELINE_DEPARTMENTS = ['floor', 'kitchen', 'bar', 'av', 'setup'] as const

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
 * THE MONEY RULE, IN ONE PLACE. (T51 follow-up)
 *
 * ZERO IS ALLOWED where it means something — a complimentary menu line, a booking taken with no deposit, an event
 * not yet priced. What is refused is a SUB-CENT amount: positive, so it passes `< 0`, but stored as 0.00. Nobody
 * means that, it cannot be told apart from a deliberate zero afterwards, and it quietly makes a priced line free.
 *
 * THE REFUSAL MUST NOT OFFER A WAY OUT THAT IS ALSO REFUSED (T58 follow-up): the caller says whether zero is allowed,
 * and the sentence follows it.
 */
export function moneyRefusal(value: unknown, label: string, opts: { zeroAllowed?: boolean } = {}): string | null {
  const zeroAllowed = opts.zeroAllowed !== false
  const v = num(value)
  if (v == null) return null
  if (!Number.isFinite(v)) return `${label} must be a number.`
  if (v < 0) return `${label} cannot be negative.`
  if (v === 0 && !zeroAllowed) return `${label} must be more than $0.00.`
  if (v > 0 && Math.round(v * 100) / 100 === 0) {
    return zeroAllowed
      ? `${label} of ${v} rounds to $0.00. Enter 0 if it is complimentary, or at least one cent.`
      : `${label} of ${v} rounds to $0.00. Enter at least one cent.`
  }
  return null
}

/** A QUANTITY OF NOTHING IS NOT A LINE: the way to say "we are not having this" is to remove the line. (T51) */
export function quantityRefusal(value: unknown, label = 'Quantity'): string | null {
  const v = num(value)
  if (v == null) return null
  if (!Number.isFinite(v)) return `${label} must be a number.`
  if (v < 0) return `${label} cannot be negative.`
  if (v === 0) return `${label} must be at least 1 — remove the line instead of setting it to nought.`
  return null
}

/**
 * The rules, on a create body or an update patch. `existing` supplies the other half of a pair (start/end times,
 * guest counts) when a patch changes only one of them. Returns the first problem as the message the form shows.
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
  if (has(input, 'status') && input.status != null && !(EVENT_STATUSES as readonly string[]).includes(input.status)) return `Status must be one of: ${EVENT_STATUSES.join(', ')}.`
  if (has(input, 'eventType') && input.eventType != null && !(EVENT_TYPES as readonly string[]).includes(input.eventType)) return `Event type must be one of: ${EVENT_TYPES.join(', ')}.`

  for (const k of ['startTime', 'endTime']) {
    const v = input[k]
    if (has(input, k) && v != null && v !== '' && (typeof v !== 'string' || !TIME_RE.test(v))) return 'Times must be HH:MM (24-hour clock).'
  }
  const start = eff('startTime'), end = eff('endTime')
  if (start && end && String(end) <= String(start)) return 'End time must be after the start time.'

  // The API accepted end-before-start, negative and absurd guest counts, and persisted them. (F5)
  const g = num(eff('guestCount')), gf = num(eff('guestCountFinal'))
  if (g != null && (isNaN(g) || g < 0 || g > 1000000)) return 'Guest count must be between 0 and 1,000,000.'
  if (gf != null && (isNaN(gf) || gf < 0 || gf > 1000000)) return 'Final guest count must be between 0 and 1,000,000.'

  for (const [k, label] of [['quotedTotal', 'Quoted total'], ['depositRequired', 'Deposit']] as const) {
    if (!has(input, k)) continue
    const mErr = moneyRefusal(input[k], label)
    if (mErr) return mErr
  }
  return null
}

/** The run-of-show rules: a real HH:MM time, a title, a department from the list. (T16 M3) */
export function validateTimelineInput(input: Record<string, any>, existing?: Record<string, any> | null): string | null {
  const creating = !existing
  if (creating || has(input, 'time')) {
    if (typeof input.time !== 'string' || !input.time.trim()) return 'time is required'
    if (!TIME_RE.test(input.time.trim())) return 'Times must be HH:MM (24-hour clock).'
  }
  if (creating || has(input, 'title')) {
    if (typeof input.title !== 'string' || !input.title.trim()) return 'title is required'
  }
  if (has(input, 'department') && input.department != null && input.department !== '' && !(TIMELINE_DEPARTMENTS as readonly string[]).includes(input.department)) {
    return `Department must be one of: ${TIMELINE_DEPARTMENTS.join(', ')}.`
  }
  if (has(input, 'sortOrder') && input.sortOrder != null && !Number.isInteger(Number(input.sortOrder))) return 'sortOrder must be a whole number.'
  return null
}

/**
 * Thrown inside the booking transaction so a detected clash rolls back the write and is answered as a 409 after it
 * unwinds. The template answered with `{ error, conflictId }`; the reply is the rulebook's error with code
 * 'space_held' (the sentence names the event holding the room).
 */
export class SpaceClash extends Error {
  constructor(message: string, public conflictId: string) { super(message) }
}

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

/**
 * An event's date in words — "Friday, November 20, 2026". The event date is a calendar day (the day the event is on,
 * not a moment), so it is read as the day it names; printed raw it read "held on 2026-11-20" (live test 2026-10-25).
 */
export const eventDayWords = (day: unknown): string => {
  const s = String(day ?? '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return String(day ?? '')
  return new Date(`${s}T12:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
/** A stored code in words, for a printed page: 'private_dining' → "Private dining", 'tentative' → "Tentative". */
export const eventCodeWords = (code: unknown): string => {
  const s = String(code ?? '').replace(/_/g, ' ').trim()
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : ''
}

export const clashMessage = (eventDate: string, clash: { name: string }) => `That space is already held on ${eventDayWords(eventDate)} by "${clash.name}"`

// A room's hire fee is charged as its own menu line (spaceId set), priced when the room is booked. Moving rooms swaps
// the line; hand-typed lines are never touched. Runs inside the booking transaction.
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
 * Write a new event inside the caller's transaction: lock the business's book, refuse a held room (SpaceClash),
 * insert, add the room-hire line. The caller has already run validateEventInput.
 */
export async function createEvent(tx: any, companyId: string, body: Record<string, any>) {
  const status = body.status || 'enquiry'
  await lockEventBook(tx, companyId)
  if (body.spaceId && HELD.includes(status)) {
    const clash = await findClash(tx, companyId, body.spaceId, body.eventDate)
    if (clash) throw new SpaceClash(clashMessage(body.eventDate, clash), clash.id)
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

/**
 * Money books the date. A deposit recorded on an enquiry confirms it and holds the room — unless the room is already
 * held that day, in which case the money is refused: there is nothing to sell. Runs inside the payment transaction;
 * returns the refusal, or null once the event is confirmed or needed no change. (T16 M8)
 */
export async function bookOnDeposit(tx: any, companyId: string, eventId: string | null | undefined): Promise<string | null> {
  if (!eventId) return null
  const [ev] = await tx.select().from(event).where(and(eq(event.id, eventId), eq(event.companyId, companyId))).limit(1)
  if (!ev || ev.status !== 'enquiry') return null
  await lockEventBook(tx, companyId)
  if (ev.spaceId) {
    const clash = await findClash(tx, companyId, ev.spaceId, ev.eventDate, ev.id)
    if (clash) return `"${ev.name}" is still an inquiry and its room is already held on ${eventDayWords(ev.eventDate)} by "${clash.name}" — move the date or the room before taking money.`
  }
  await tx.update(event).set({ status: 'confirmed', updatedAt: new Date() }).where(eq(event.id, ev.id))
  return null
}
/** The invoice-payment hook form: the locked invoice row (raw SQL, snake_case) or a drizzle row. */
export const bookOnDepositForInvoice = (tx: any, inv: any) => bookOnDeposit(tx, inv.company_id ?? inv.companyId, inv.event_id ?? inv.eventId)

/**
 * Soft warnings on a saved event — never a refusal (venues back-date walk-ins; a 30-seat room hosts 60 standing).
 * `check` limits them to what the write changed. "Past" means before today in the furthest-behind time zone (UTC−12).
 */
export async function eventWarnings(exec: any, companyId: string, ev: any, check: { date: boolean; capacity: boolean }): Promise<string[]> {
  const out: string[] = []
  const earliestToday = new Date(Date.now() - 12 * 3600_000).toISOString().slice(0, 10)
  if (check.date && ev.eventDate && ev.eventDate < earliestToday) out.push(`${ev.eventDate} is in the past.`)
  const heads = Number(ev.guestCountFinal ?? ev.guestCount ?? 0)
  if (check.capacity && ev.spaceId && heads > 0) {
    const [sp] = await exec.select({ name: eventSpace.name, seated: eventSpace.seatedCapacity, standing: eventSpace.standingCapacity }).from(eventSpace)
      .where(and(eq(eventSpace.id, ev.spaceId), eq(eventSpace.companyId, companyId))).limit(1)
    const cap = sp ? Math.max(Number(sp.seated || 0), Number(sp.standing || 0)) : 0
    if (cap > 0 && heads > cap) out.push(`${heads} guests is more than ${sp.name} holds (${cap} at most).`)
  }
  return out
}

/** A coordinator is a login user of this business; a roster-only team member can't be assigned. (T16 H3) */
export async function coordinatorRefusal(exec: any, companyId: string, coordinatorId: unknown): Promise<string | null> {
  if (coordinatorId == null || coordinatorId === '') return null
  if (typeof coordinatorId !== 'string') return 'coordinatorId must be a user id'
  const [u] = await exec.select({ id: user.id }).from(user).where(and(eq(user.id, coordinatorId), eq(user.companyId, companyId))).limit(1)
  return u ? null : "The coordinator must be one of your login users (Settings › Users) — a roster-only team member can't be assigned."
}

// ── Retiring what upcoming bookings still use (T15 H1) ─────────────────────────────────────────────────────────────
// Rooms and packages are retired (active = false), never deleted, so history keeps them. A room still holding upcoming
// bookings, or a package still on upcoming menus, must have those moved first. "Upcoming": today or later on the venue's
// calendar (it was UTC's, a day ahead every evening).
export const venueToday = async (db: any, companyId: string) => storeDateString(new Date(), await companyTimeZone(db, companyId))
const UPCOMING_HOLDS = ['tentative', 'confirmed']

/** Upcoming bookings (today or later, tentative/confirmed) still in this room. */
export async function upcomingEventsUsingSpace(db: any, companyId: string, spaceId: string): Promise<number> {
  const [row] = await db.select({ value: count() }).from(event)
    .where(and(eq(event.companyId, companyId), eq(event.spaceId, spaceId), gte(event.eventDate, await venueToday(db, companyId)), inArray(event.status, UPCOMING_HOLDS)))
  return Number(row?.value || 0)
}

/** Upcoming events (today or later, not lost/cancelled) with this package on their menu. */
export async function upcomingEventsUsingPackage(db: any, companyId: string, packageId: string): Promise<number> {
  const [row] = await db.select({ value: countDistinct(eventMenuItem.eventId) }).from(eventMenuItem)
    .innerJoin(event, eq(event.id, eventMenuItem.eventId))
    .where(and(eq(eventMenuItem.companyId, companyId), eq(eventMenuItem.packageId, packageId), gte(event.eventDate, await venueToday(db, companyId)), notInArray(event.status, EXIT_STATUSES)))
  return Number(row?.value || 0)
}

export const retireSpaceRefusal = (name: string, n: number) => `"${name}" still has ${n} upcoming booking${n === 1 ? '' : 's'} — move ${n === 1 ? 'it' : 'them'} to another room first.`
export const retirePackageRefusal = (name: string, n: number) => `"${name}" is on the menu of ${n} upcoming event${n === 1 ? '' : 's'} — change ${n === 1 ? 'its menu' : 'their menus'} first.`

/**
 * WHAT THE AUDIT LOG'S RECORD COLUMN SHOWS. (T58k) Tried in order of how a person would refer to the thing; a payment
 * has no name of its own, so its amount (with separated thousands) identifies it.
 */
export const auditName = (row: any): string | null => {
  if (!row || typeof row !== 'object') return null
  for (const k of ['name', 'title', 'eventName', 'packageName', 'itemName', 'description']) {
    const v = row[k]
    if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 120)
  }
  if (row.amount !== undefined && row.amount !== null && Number.isFinite(Number(row.amount))) {
    return '$' + Number(row.amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  }
  return null
}
