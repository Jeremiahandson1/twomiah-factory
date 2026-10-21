// The booking engine: one for every business. Settings, services, hours, days off and zones; the free days and
// times; taking, moving, cancelling and closing out a booking. Pure decisions live in slots.ts and recurrence.ts;
// this reads and writes the rows around them.
//
// From the CRMs' shared engine (packages/tenant-backend/src/booking/service.ts): the business's own time zone, the
// notice and the booking window derived in one place, the per-day lock and in-transaction re-check, refusals that
// say which thing is wrong, the 'pending' hold for an unpaid deposit and its expiry, and "completed"/"no-show" only
// once a visit has started. From the premium site (server-static.ts, routes/admin.ts): per-person hours, days off,
// buffers, travel time, ZIP zones, the customer's private link to reschedule and cancel, tips and source tracking.
//
// Fixed in the merge: the site's slot list, booking check and reschedule each built their own inputs and disagreed
// (travel time, calendars, zones); here all three call dayInputs(). A deposit that can't be taken (no card payments
// set up, or the provider refused) leaves the booking CONFIRMED — the CRMs' engine left it pending, and its own hold
// expiry then cancelled it half an hour later without a word.
import crypto from 'node:crypto'
import { and, asc, desc, eq, gt, inArray, lt, ne, or, count } from 'drizzle-orm'
import { addDays, isIsoDate, isRealDate, isValidTz, minutesToHm, safeTz, tzParts, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { booking, bookingService, bookingSettings, bookingHours, bookingBlackout, bookingZone, bookingBan, contact, user } from '../db/schema/index.ts'
import { freeSlots, pickWho, type Busy, type ServiceRules, type Slot } from './slots.ts'
import { lockBookingDay } from '../data/bookingLock.ts'
import { recordConsent } from '../site/smsConsent.ts'

export class BookingError extends Error {
  constructor(message: string, public status = 400, public code?: string) { super(message); this.name = 'BookingError' }
}

export type BookingRow = typeof booking.$inferSelect
export type ServiceRow = typeof bookingService.$inferSelect
export type SettingsRow = typeof bookingSettings.$inferSelect
export type BookingEvent = 'booking.created' | 'booking.rescheduled' | 'booking.cancelled' | 'booking.completed' | 'booking.no_show' | 'booking.confirmed'

/** Something that happened to a booking, for the messages, webhooks and calendars that follow it. */
export interface BookingHappening { event: BookingEvent; booking: BookingRow; service: ServiceRow | null; settings: SettingsRow; previousStartAt?: Date; by: 'customer' | 'staff' | 'system' }

export interface DepositProvider {
  /**
   * The payment provider's own page for the deposit (Stripe Checkout, on the business's connected account). Null =
   * can't (no card account, or the provider refused); a new booking then stands without one. `reference` is kept on the
   * booking (payment_intent_id) until the payment's own id replaces it.
   */
  checkout(args: { companyId: string; bookingId: string; token: string; amount: number; customerEmail: string; customerName: string; description: string; expiresAt: Date }): Promise<{ url: string; reference: string } | null>
}

/** What a deposit payment came to: confirmed (or recorded), to be refunded, or no booking of ours. */
export type DepositOutcome = 'done' | 'refund' | 'unknown'

/** One of a vertical's own questions on the public booking form (a vet's pet). */
export interface BookingQuestion {
  /** The form field and the key in BookInput.answers. */
  name: string
  label: string
  placeholder?: string
  maxLength: number
  /** Set: a customer's booking without an answer is refused with this sentence. */
  requiredMessage?: string
}

/**
 * A vertical's own part in a booking (VerticalSettings.booking.calendar): its questions on the form, and what the
 * booking becomes in its own records. The CRMs' engine did this with a calendar per template (packages/tenant-backend
 * booking/calendars.ts); here the booking row is always the engine's, and the add-on writes beside it.
 */
/** What an add-on's record links back onto the booking. */
export type BookingLinks = Partial<Pick<BookingRow, 'appointmentId'>>

export interface BookingAddOn {
  questions: BookingQuestion[]
  /** Inside the booking's transaction, after its row is written: throwing undoes the booking. */
  booked(tx: any, b: { companyId: string; contactId: string; booking: BookingRow; service: ServiceRow; answers: Record<string, string> }): Promise<BookingLinks | void>
  /** After the booking was moved ('moved') or its status changed ('status'), in the same transaction: keep the add-on's record in step. */
  changed?(exec: any, b: BookingRow, change: 'moved' | 'status'): Promise<void>
  /**
   * Time already taken in the vertical's own book that the booking rows don't show (a practice's desk appointments).
   * userId null takes the time from everybody. Never what a booking made itself: that is the booking's own time.
   */
  busy?(exec: any, companyId: string, from: Date, to: Date): Promise<Array<{ userId: string | null; start: Date; end: Date }>>
}

export interface EngineDeps {
  db: any
  /** The vertical's own part in a booking, when it has one. */
  addOn?: BookingAddOn
  /** The vertical's answer to "ask for the address?" when the business hasn't set its own. */
  requireAddressDefault: boolean
  /** Busy times on people's own calendars (Google, Outlook), when any are connected. */
  externalBusy?: (companyId: string, from: Date, to: Date) => Promise<Array<{ userId: string; start: Date; end: Date; eventId: string }>>
  /** Card deposits; absent until the business has card payments. */
  deposits?: DepositProvider
  /** Told after each change has been saved. Never throws into the booking. */
  onHappening?: (h: BookingHappening) => void | Promise<void>
  /** The clock, so tests can stand still. */
  now?: () => number
}

export interface BookInput {
  /** The service's slug (customers) or id (staff). */
  service: string
  date: string
  time: string
  name: string
  email: string
  phone?: string | null
  address?: string | null
  zip?: string | null
  notes?: string | null
  /** One of the service's tip choices, in percent. */
  tipPercent?: number | null
  sourcePath?: string | null
  sourceReferrer?: string | null
  sourceVariant?: string | null
  /** Answers to the vertical's own questions (BookingAddOn.questions), by name. */
  answers?: Record<string, unknown> | null
  /** The customer ticked "Text me about my booking" (site/smsConsent.ts): the booking's texts go to them. */
  smsConsent?: boolean
}

const ACTIVE = ['pending', 'confirmed'] as const
const STATUSES = ['pending', 'confirmed', 'cancelled', 'completed', 'no_show'] as const
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
const HM_RE = /^([01]\d|2[0-3]):[0-5]\d$/
const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
const toMinutes = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m }
const label = (m: number) => { const h = Math.floor(m / 60), mm = m % 60; return `${h % 12 === 0 ? 12 : h % 12}${mm ? ':' + String(mm).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}` }
const dollars = (v: unknown): number => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const money = (n: number) => (Math.round(n * 100) / 100).toFixed(2)
const newToken = () => crypto.randomBytes(24).toString('base64url')
/** The weekday of a calendar date itself (0 = Sunday), whatever zone the server runs in. */
const weekdayOf = (date: string) => { const [y, m, d] = date.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
export const slugify = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 64)

/** A whole number a setting is set to: garbage is refused, not turned into a default (CRMs' engine, Salon T27 N7). */
function whole(v: unknown, field: string, lo: number, hi: number): number {
  if (typeof v === 'boolean' || v === null || v === '' || (typeof v === 'string' && !v.trim())) throw new BookingError(`${field} must be a number.`)
  const n = Number(v)
  if (!Number.isFinite(n)) throw new BookingError(`${field} must be a number.`)
  if (n < lo || n > hi) throw new BookingError(`${field} must be between ${lo} and ${hi}.`)
  return Math.round(n)
}
const text = (v: unknown, max: number) => (typeof v === 'string' ? (v.trim() ? v.trim().slice(0, max) : null) : v === null ? null : undefined)

export function createBookingEngine(deps: EngineDeps) {
  const { db } = deps
  const now = deps.now ?? (() => Date.now())
  /** The vertical's own questions on the booking form (none for most). */
  const questions: BookingQuestion[] = deps.addOn?.questions ?? []

  /** The add-on's record follows the booking (a practice's appointment): moved with it, its status with it. */
  async function mirror(exec: any, b: BookingRow, change: 'moved' | 'status') {
    if (deps.addOn?.changed) await deps.addOn.changed(exec, b, change)
  }

  async function emit(h: BookingHappening) {
    try { await deps.onHappening?.(h) } catch { /* the change is saved; a message that failed is logged where it is sent */ }
  }

  // ── Settings ──────────────────────────────────────────────────────────────
  async function settingsOf(companyId: string, exec: any = db): Promise<SettingsRow> {
    const [row] = await exec.select().from(bookingSettings).where(eq(bookingSettings.companyId, companyId)).limit(1)
    if (row) return row
    const [made] = await exec.insert(bookingSettings).values({ companyId }).onConflictDoNothing().returning()
    if (made) return made
    const [again] = await exec.select().from(bookingSettings).where(eq(bookingSettings.companyId, companyId)).limit(1)
    return again
  }
  const tzOf = (s: SettingsRow) => safeTz(s.timezone)
  const requireAddress = (s: SettingsRow) => (typeof s.requireAddress === 'boolean' ? s.requireAddress : deps.requireAddressDefault)

  async function updateSettings(companyId: string, body: Record<string, unknown>): Promise<SettingsRow> {
    await settingsOf(companyId)
    const u: Record<string, unknown> = {}
    if (typeof body.enabled === 'boolean') u.enabled = body.enabled
    if (body.timezone !== undefined) {
      if (!isValidTz(body.timezone)) throw new BookingError('That time zone is not recognised (use a name like America/Chicago).')
      u.timezone = body.timezone
    }
    if (body.leadTimeMinutes !== undefined) u.leadTimeMinutes = whole(body.leadTimeMinutes, 'Notice needed (minutes)', 0, 60 * 24 * 60)
    if (body.maxDaysOut !== undefined) u.maxDaysOut = whole(body.maxDaysOut, 'How far ahead (days)', 1, 365)
    if (body.driveTimeMinutes !== undefined) u.driveTimeMinutes = whole(body.driveTimeMinutes, 'Travel time (minutes)', 0, 240)
    if (body.selfServiceCutoffMinutes !== undefined) u.selfServiceCutoffMinutes = whole(body.selfServiceCutoffMinutes, 'Change cut-off (minutes)', 0, 60 * 24 * 14)
    if (body.depositHoldMinutes !== undefined) u.depositHoldMinutes = whole(body.depositHoldMinutes, 'Deposit hold (minutes)', 5, 24 * 60)
    for (const k of ['requirePhone', 'notifyEmail', 'notifySms'] as const) if (typeof body[k] === 'boolean') u[k] = body[k]
    // true / false is the owner's own answer; null hands it back to the vertical's.
    if (typeof body.requireAddress === 'boolean' || body.requireAddress === null) u.requireAddress = body.requireAddress
    for (const [k, max] of [['heroTitle', 120], ['heroSubtitle', 300], ['confirmCta', 60], ['thanksMessage', 300], ['confirmationEmailSubject', 200], ['confirmationEmailIntro', 2000]] as const) {
      const v = text(body[k], max)
      if (v !== undefined) u[k] = v
    }
    if (body.reviewLink !== undefined) {
      const v = text(body.reviewLink, 2000)
      if (v && !/^https:\/\/\S+$/i.test(v)) throw new BookingError('The review link must be an https:// address.')
      u.reviewLink = v
    }
    if (!Object.keys(u).length) throw new BookingError('Nothing to change.')
    const [row] = await db.update(bookingSettings).set({ ...u, updatedAt: new Date() }).where(eq(bookingSettings.companyId, companyId)).returning()
    return row
  }

  /** A new private address for the bookings calendar feed; the old one stops working. */
  async function rotateFeedToken(companyId: string): Promise<SettingsRow> {
    await settingsOf(companyId)
    const [row] = await db.update(bookingSettings).set({ icalFeedToken: newToken(), updatedAt: new Date() }).where(eq(bookingSettings.companyId, companyId)).returning()
    return row
  }

  // ── Services ──────────────────────────────────────────────────────────────
  async function listServices(companyId: string, opts: { activeOnly?: boolean } = {}): Promise<ServiceRow[]> {
    const where = opts.activeOnly ? and(eq(bookingService.companyId, companyId), eq(bookingService.active, true)) : eq(bookingService.companyId, companyId)
    return db.select().from(bookingService).where(where).orderBy(asc(bookingService.sortOrder), asc(bookingService.name))
  }
  async function serviceBySlug(companyId: string, slug: string, exec: any = db): Promise<ServiceRow | null> {
    const [s] = await exec.select().from(bookingService).where(and(eq(bookingService.companyId, companyId), eq(bookingService.slug, slug))).limit(1)
    return s ?? null
  }
  async function serviceById(companyId: string, id: string, exec: any = db): Promise<ServiceRow | null> {
    const [s] = await exec.select().from(bookingService).where(and(eq(bookingService.companyId, companyId), eq(bookingService.id, id))).limit(1)
    return s ?? null
  }

  function serviceValues(body: Record<string, unknown>, existing: ServiceRow | null) {
    const v: Record<string, unknown> = {}
    if (!existing || body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : ''
      if (!name) throw new BookingError('The service needs a name.')
      v.name = name.slice(0, 200)
    }
    if (body.slug !== undefined || !existing) {
      const slug = typeof body.slug === 'string' && body.slug.trim() ? body.slug.trim().toLowerCase() : slugify(String(v.name ?? existing?.name ?? ''))
      if (!SLUG_RE.test(slug)) throw new BookingError('The address must be lowercase letters, numbers and hyphens (e.g. "lawn-mowing").')
      v.slug = slug
    }
    if (body.description !== undefined) v.description = text(body.description, 2000)
    if (body.durationMinutes !== undefined || !existing) v.durationMinutes = whole(body.durationMinutes ?? 60, 'Length (minutes)', 5, 24 * 60)
    if (body.price !== undefined) v.price = body.price === null || body.price === '' ? null : money(whole(Math.round(Number(body.price) * 100), 'Price', 0, 100_000_000) / 100)
    if (body.depositAmount !== undefined) v.depositAmount = body.depositAmount === null || body.depositAmount === '' ? null : money(whole(Math.round(Number(body.depositAmount) * 100), 'Deposit', 0, 100_000_000) / 100)
    if (body.depositPercent !== undefined) v.depositPercent = body.depositPercent === null || body.depositPercent === '' ? null : whole(body.depositPercent, 'Deposit percent', 1, 100)
    if (body.bufferBeforeMinutes !== undefined) v.bufferBeforeMinutes = whole(body.bufferBeforeMinutes, 'Time before', 0, 480)
    if (body.bufferAfterMinutes !== undefined) v.bufferAfterMinutes = whole(body.bufferAfterMinutes, 'Time after', 0, 480)
    if (body.slotStepMinutes !== undefined) v.slotStepMinutes = whole(body.slotStepMinutes, 'Start times every (minutes)', 5, 240)
    if (body.capacity !== undefined) v.capacity = whole(body.capacity, 'People per time', 1, 500)
    if (body.rebookIntervalDays !== undefined) v.rebookIntervalDays = body.rebookIntervalDays === null || body.rebookIntervalDays === '' ? null : whole(body.rebookIntervalDays, 'Ask to rebook after (days)', 1, 730)
    if (body.tipPresets !== undefined) {
      if (body.tipPresets === null) v.tipPresets = null
      else if (!Array.isArray(body.tipPresets) || body.tipPresets.length > 5) throw new BookingError('Tip choices are up to five percentages.')
      else v.tipPresets = body.tipPresets.map((p) => whole(p, 'Tip percent', 1, 100))
    }
    if (typeof body.active === 'boolean') v.active = body.active
    if (body.sortOrder !== undefined) v.sortOrder = whole(body.sortOrder, 'Order', -10_000, 10_000)
    const merged = { ...existing, ...v } as ServiceRow
    if (merged.depositAmount != null && merged.depositPercent != null) throw new BookingError('Set the deposit as an amount or a percent, not both.')
    if (merged.depositPercent != null && merged.price == null) throw new BookingError('A deposit percent needs the service\'s price.')
    return v
  }

  async function createService(companyId: string, body: Record<string, unknown>): Promise<ServiceRow> {
    const v = serviceValues(body, null)
    if (await serviceBySlug(companyId, String(v.slug))) throw new BookingError('Another service already uses that address.', 409)
    const [row] = await db.insert(bookingService).values({ companyId, ...v }).returning()
    return row
  }
  async function updateService(companyId: string, id: string, body: Record<string, unknown>): Promise<ServiceRow | null> {
    const existing = await serviceById(companyId, id)
    if (!existing) return null
    const v = serviceValues(body, existing)
    if (!Object.keys(v).length) throw new BookingError('Nothing to change.')
    if (v.slug && v.slug !== existing.slug && await serviceBySlug(companyId, String(v.slug))) throw new BookingError('Another service already uses that address.', 409)
    const [row] = await db.update(bookingService).set({ ...v, updatedAt: new Date() }).where(and(eq(bookingService.id, id), eq(bookingService.companyId, companyId))).returning()
    return row
  }
  /** Past bookings keep their own rows (the link is cleared). A service with a repeating booking is switched off, not deleted. */
  async function deleteService(companyId: string, id: string): Promise<boolean> {
    try {
      const gone = await db.delete(bookingService).where(and(eq(bookingService.id, id), eq(bookingService.companyId, companyId))).returning({ id: bookingService.id })
      return gone.length > 0
    } catch {
      throw new BookingError('This service has repeating bookings. Switch it off instead, so nobody new can book it.', 409)
    }
  }

  // ── Hours, days off, zones ────────────────────────────────────────────────
  async function companyUserIds(companyId: string): Promise<Set<string>> {
    const rows = await db.select({ id: user.id }).from(user).where(eq(user.companyId, companyId))
    return new Set(rows.map((r: any) => r.id))
  }
  const getHours = (companyId: string) => db.select().from(bookingHours).where(eq(bookingHours.companyId, companyId)).orderBy(asc(bookingHours.dayOfWeek), asc(bookingHours.startMinute))

  /** Replace the whole week (the site's PUT). Each window: { userId|null, dayOfWeek 0–6, start "HH:MM", end "HH:MM" }. */
  async function setHours(companyId: string, windows: unknown) {
    if (!Array.isArray(windows) || windows.length > 500) throw new BookingError('Hours must be a list of opening times.')
    const people = await companyUserIds(companyId)
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    const rows = windows.map((w: any) => {
      const day = Number(w?.dayOfWeek)
      if (!Number.isInteger(day) || day < 0 || day > 6) throw new BookingError('Each opening time needs a day of the week.')
      if (!HM_RE.test(String(w?.start)) || (!HM_RE.test(String(w?.end)) && w?.end !== '24:00')) throw new BookingError(`${days[day]}: times must be HH:MM.`)
      const startMinute = toMinutes(w.start), endMinute = w.end === '24:00' ? 1440 : toMinutes(w.end)
      if (startMinute >= endMinute) throw new BookingError(`${days[day]}: the opening time must be before the closing time.`)
      const userId = w?.userId ? String(w.userId) : null
      if (userId && !people.has(userId)) throw new BookingError('That person is not on this account.')
      return { companyId, userId, dayOfWeek: day, startMinute, endMinute }
    })
    await db.transaction(async (tx: any) => {
      await tx.delete(bookingHours).where(eq(bookingHours.companyId, companyId))
      if (rows.length) await tx.insert(bookingHours).values(rows)
    })
    return getHours(companyId)
  }

  const listDaysOff = (companyId: string, fromDate?: string) => db.select().from(bookingBlackout)
    .where(fromDate ? and(eq(bookingBlackout.companyId, companyId), gt(bookingBlackout.date, addDays(fromDate, -1))) : eq(bookingBlackout.companyId, companyId))
    .orderBy(asc(bookingBlackout.date))

  async function addDayOff(companyId: string, body: Record<string, any>) {
    if (!isRealDate(body.date)) throw new BookingError('Choose a date.')
    const userId = body.userId ? String(body.userId) : null
    if (userId && !(await companyUserIds(companyId)).has(userId)) throw new BookingError('That person is not on this account.')
    let startMinute: number | null = null, endMinute: number | null = null
    if (body.start || body.end) {
      if (!HM_RE.test(String(body.start)) || !HM_RE.test(String(body.end))) throw new BookingError('Times must be HH:MM, or leave both empty for the whole day.')
      startMinute = toMinutes(body.start); endMinute = toMinutes(body.end)
      if (startMinute >= endMinute) throw new BookingError('The start must be before the end.')
    }
    const [row] = await db.insert(bookingBlackout).values({ companyId, userId, date: body.date, startMinute, endMinute, reason: text(body.reason, 200) ?? null }).returning()
    return row
  }
  async function removeDayOff(companyId: string, id: string) {
    const gone = await db.delete(bookingBlackout).where(and(eq(bookingBlackout.id, id), eq(bookingBlackout.companyId, companyId))).returning({ id: bookingBlackout.id })
    return gone.length > 0
  }

  const listZones = (companyId: string) => db.select().from(bookingZone).where(eq(bookingZone.companyId, companyId))
  /** One person's ZIP codes (replacing what they had). An empty list removes their zone: they serve everywhere. */
  async function setZone(companyId: string, userId: string, zips: unknown) {
    if (!(await companyUserIds(companyId)).has(userId)) throw new BookingError('That person is not on this account.')
    const list = (Array.isArray(zips) ? zips : String(zips ?? '').split(/[\s,]+/)).map((z) => String(z).trim()).filter(Boolean)
    if (list.some((z) => !/^\d{5}$/.test(z))) throw new BookingError('ZIP codes are five digits.')
    await db.delete(bookingZone).where(and(eq(bookingZone.companyId, companyId), eq(bookingZone.userId, userId)))
    if (!list.length) return null
    const [row] = await db.insert(bookingZone).values({ companyId, userId, zips: [...new Set(list)] }).returning()
    return row
  }

  // ── Free times ────────────────────────────────────────────────────────────

  /** The first and last bookable days: today in the business's zone, and maxDaysOut after it (inclusive). */
  function window(s: SettingsRow) {
    const first = tzParts(new Date(now()), tzOf(s)).date
    return { first, last: addDays(first, s.maxDaysOut) }
  }

  /** An unpaid deposit past its hold releases its time. Run before any question about free times. */
  async function expireHolds(companyId: string, s: SettingsRow) {
    const cutoff = new Date(now() - s.depositHoldMinutes * 60_000)
    const expired: BookingRow[] = await db.update(booking)
      .set({ status: 'cancelled', depositStatus: 'expired', cancelledAt: new Date(now()), cancelledReason: 'deposit_not_paid', updatedAt: new Date(now()) })
      .where(and(eq(booking.companyId, companyId), eq(booking.status, 'pending'), eq(booking.depositStatus, 'pending'), lt(booking.createdAt, cutoff)))
      .returning()
    for (const b of expired) await mirror(db, b, 'status')
    for (const b of expired) await emit({ event: 'booking.cancelled', booking: b, service: b.serviceId ? await serviceById(companyId, b.serviceId) : null, settings: s, by: 'system' })
  }

  /**
   * Everything that decides one range of days: hours, days off, zones, and what is already on people's time (bookings
   * that hold time, and their own calendars). ONE loader for the slot list, the booking check and the reschedule.
   */
  /** People's own calendars' busy time over these days — read before any transaction: it is an outside call. */
  async function externalFor(companyId: string, s: SettingsRow, firstDate: string, lastDate: string) {
    if (!deps.externalBusy) return []
    const tz = tzOf(s)
    return deps.externalBusy(companyId, zonedWallTimeToUtc(firstDate, '00:00', tz), zonedWallTimeToUtc(addDays(lastDate, 1), '00:00', tz)).catch(() => [])
  }

  async function loadRange(companyId: string, s: SettingsRow, firstDate: string, lastDate: string, exec: any, exceptBookingId?: string, externalBusy?: Awaited<ReturnType<typeof externalFor>>) {
    const tz = tzOf(s)
    const from = zonedWallTimeToUtc(firstDate, '00:00', tz), to = zonedWallTimeToUtc(addDays(lastDate, 1), '00:00', tz)
    const [hours, daysOff, zones, rows] = await Promise.all([
      exec.select().from(bookingHours).where(eq(bookingHours.companyId, companyId)),
      exec.select().from(bookingBlackout).where(and(eq(bookingBlackout.companyId, companyId), gt(bookingBlackout.date, addDays(firstDate, -1)), lt(bookingBlackout.date, addDays(lastDate, 1)))),
      exec.select().from(bookingZone).where(eq(bookingZone.companyId, companyId)),
      exec.select({ b: booking, before: bookingService.bufferBeforeMinutes, after: bookingService.bufferAfterMinutes }).from(booking)
        .leftJoin(bookingService, eq(booking.serviceId, bookingService.id))
        .where(and(eq(booking.companyId, companyId), inArray(booking.status, [...ACTIVE]), lt(booking.startAt, to), gt(booking.endAt, from), ...(exceptBookingId ? [ne(booking.id, exceptBookingId)] : []))),
    ])
    const ours = new Set(rows.map((r: any) => r.b.externalEventId).filter(Boolean))
    // Inside a transaction the caller hands it in (claim); otherwise it is read here.
    const external = (externalBusy ?? await externalFor(companyId, s, firstDate, lastDate)).filter((e) => !ours.has(e.eventId))
    const own = deps.addOn?.busy ? await deps.addOn.busy(exec, companyId, from, to) : []
    return { tz, hours, daysOff, zones, bookings: rows, external, own }
  }
  type Range = Awaited<ReturnType<typeof loadRange>>

  /** Project an instant span onto one local day as minutes from midnight (clamped to the day). */
  function onDay(start: Date, end: Date, date: string, tz: string): { s: number; e: number } | null {
    const sp = tzParts(start, tz), ep = tzParts(end, tz)
    if (ep.date < date || sp.date > date) return null
    const s = sp.date < date ? 0 : sp.minutes
    const e = ep.date > date ? 24 * 60 : ep.minutes
    return e > s ? { s, e } : null
  }

  const rulesOf = (svc: ServiceRow, s: SettingsRow): ServiceRules => ({
    id: svc.id, durationMinutes: svc.durationMinutes, bufferBeforeMinutes: svc.bufferBeforeMinutes, bufferAfterMinutes: svc.bufferAfterMinutes,
    slotStepMinutes: svc.slotStepMinutes, capacity: svc.capacity, driveTimeMinutes: s.driveTimeMinutes,
  })

  /** One day's times, three ways: every time the hours offer, the free ones, and the free ones a customer may still book. */
  function dayTimes(range: Range, svc: ServiceRow, s: SettingsRow, date: string, zip?: string | null) {
    const busy: Busy[] = []
    for (const r of range.bookings) {
      const d = onDay(r.b.startAt, r.b.endAt, date, range.tz)
      if (d) busy.push({ userId: r.b.assignedUserId, startMinute: d.s, endMinute: d.e, padBefore: r.before ?? 0, padAfter: r.after ?? 0, serviceId: r.b.serviceId })
    }
    for (const x of [...range.external, ...range.own]) {
      const d = onDay(x.start, x.end, date, range.tz)
      if (d) busy.push({ userId: x.userId, startMinute: d.s, endMinute: d.e })
    }
    const base = {
      dayOfWeek: weekdayOf(date), service: rulesOf(svc, s),
      hours: range.hours, daysOff: range.daysOff.filter((d: any) => d.date === date),
      zones: range.zones.map((z: any) => ({ userId: z.userId, zips: Array.isArray(z.zips) ? z.zips.map(String) : [] })), customerZip: zip,
    }
    const offered = freeSlots({ ...base, busy: [] })
    const free = freeSlots({ ...base, busy })
    const earliest = now() + s.leadTimeMinutes * 60_000
    const bookable = free.filter((x) => zonedWallTimeToUtc(date, hm(x.startMinute), range.tz).getTime() >= earliest)
    return { offered, free, bookable }
  }

  const slotOut = (date: string, tz: string) => (x: Slot) => ({ time: hm(x.startMinute), label: label(x.startMinute), startAt: zonedWallTimeToUtc(date, hm(x.startMinute), tz).toISOString() })

  async function activeService(companyId: string, slug: string, exec: any = db) {
    const svc = await serviceBySlug(companyId, slug, exec)
    if (!svc || !svc.active) throw new BookingError('That service is not available to book.', 404)
    return svc
  }

  /** The days in the window with at least one bookable time (a full day isn't offered). */
  async function availableDates(companyId: string, slug: string, zip?: string | null) {
    const s = await settingsOf(companyId)
    if (!s.enabled) return []
    await expireHolds(companyId, s)
    const svc = await activeService(companyId, slug)
    const w = window(s)
    const range = await loadRange(companyId, s, w.first, w.last, db)
    const out: string[] = []
    for (let d = w.first; d <= w.last; d = addDays(d, 1)) if (dayTimes(range, svc, s, d, zip).bookable.length) out.push(d)
    return out
  }

  /** The bookable times on one day. `except`: the booking being moved (it doesn't block itself). */
  async function availableTimes(companyId: string, slug: string, date: string, zip?: string | null, except?: string) {
    if (!isIsoDate(date)) throw new BookingError('Date must be YYYY-MM-DD.')
    if (!isRealDate(date)) throw new BookingError(`${date} is not a real date — check the month and day.`)
    const s = await settingsOf(companyId)
    if (!s.enabled) return []
    await expireHolds(companyId, s)
    const svc = await activeService(companyId, slug)
    const w = window(s)
    if (date < w.first || date > w.last) return []
    const range = await loadRange(companyId, s, date, date, db, except)
    return dayTimes(range, svc, s, date, zip).bookable.map(slotOut(date, range.tz))
  }

  /**
   * Is this time bookable, inside the day's lock — and if not, say which thing is wrong (the CRMs' T58d: a time never
   * offered isn't "just taken", and a time inside the notice isn't either). Returns who can take it.
   */
  async function claim(tx: any, companyId: string, s: SettingsRow, svc: ServiceRow, date: string, time: string, zip: string | null, opts: { except?: string; customer: boolean; override?: boolean; external: Awaited<ReturnType<typeof externalFor>> }) {
    await lockBookingDay(tx, companyId, date)
    if (opts.override) return [] as Array<string | null>
    const range = await loadRange(companyId, s, date, date, tx, opts.except, opts.external)
    const t = dayTimes(range, svc, s, date, zip)
    const minute = toMinutes(time)
    if (!t.offered.length) throw new BookingError('That day is not open for booking — please pick another date.', 409, 'closed')
    const free = t.free.find((x) => x.startMinute === minute)
    if (!t.offered.some((x) => x.startMinute === minute)) {
      const open = t.bookable.map((x) => label(x.startMinute))
      throw new BookingError(open.length
        ? `${label(minute)} isn't one of the times offered that day. Open: ${open.slice(0, 8).join(', ')}${open.length > 8 ? `, and ${open.length - 8} more` : ''}.`
        : `${label(minute)} isn't one of the times offered that day, and the rest of the day is full — please pick another date.`, 409, 'not_offered')
    }
    if (!free) throw new BookingError('That time has just been taken — please pick another.', 409, 'taken')
    if (opts.customer && !t.bookable.some((x) => x.startMinute === minute)) {
      throw new BookingError(s.leadTimeMinutes <= 0 ? `${label(minute)} has already passed — please pick a later time.` : `${label(minute)} is too soon — please book at least ${noticeWords(s.leadTimeMinutes)} ahead.`, 409, 'notice')
    }
    return free.who
  }
  const noticeWords = (m: number) => m % 1440 === 0 ? `${m / 1440} day${m === 1440 ? '' : 's'}` : m % 60 === 0 ? `${m / 60} hour${m === 60 ? '' : 's'}` : `${m} minutes`

  async function isBanned(companyId: string, email: string, phone: string | null) {
    const digits = (phone || '').replace(/\D/g, '')
    const conds = [eq(bookingBan.email, email.toLowerCase()), ...(digits ? [eq(bookingBan.phone, digits)] : [])]
    const [hit] = await db.select({ id: bookingBan.id }).from(bookingBan).where(and(eq(bookingBan.companyId, companyId), or(...conds))).limit(1)
    return !!hit
  }

  /** The person, matched by email or made (the booking is linked to them: SPEC §4.7). Never overwrites their record. */
  async function contactFor(tx: any, companyId: string, c: { name: string; email: string; phone: string | null; address: string | null; zip: string | null }) {
    const [found] = await tx.select({ id: contact.id }).from(contact).where(and(eq(contact.companyId, companyId), eq(contact.email, c.email))).limit(1)
    if (found) return found.id as string
    const [made] = await tx.insert(contact).values({ companyId, type: 'client', name: c.name, email: c.email, phone: c.phone, mobile: c.phone, address: c.address, zip: c.zip, source: 'online_booking' }).returning({ id: contact.id })
    return made.id as string
  }

  // ── Taking a booking ──────────────────────────────────────────────────────

  /**
   * Book a time. A customer (`by: 'customer'`) is held to everything; staff may name who takes it and, with
   * `override`, book over the hours (a favour, an emergency) — the check is still made unless they say so.
   */
  async function book(companyId: string, input: BookInput, opts: { by: 'customer' | 'staff'; assignedUserId?: string | null; override?: boolean; seriesId?: string; seriesIndex?: number; source?: 'public' | 'staff' | 'series' }) {
    const s = await settingsOf(companyId)
    const customer = opts.by === 'customer'
    if (customer && !s.enabled) throw new BookingError('Online booking is switched off.', 403, 'disabled')
    await expireHolds(companyId, s)
    const svc = customer ? await activeService(companyId, input.service) : await serviceById(companyId, input.service) ?? await serviceBySlug(companyId, input.service)
    if (!svc) throw new BookingError('Choose a service.', 404)
    if (!isIsoDate(input.date) || !isRealDate(input.date)) throw new BookingError('Choose a real date (YYYY-MM-DD).')
    if (!HM_RE.test(String(input.time))) throw new BookingError('Time must be HH:MM.')
    const name = String(input.name || '').trim().slice(0, 200)
    const email = String(input.email || '').trim().toLowerCase().slice(0, 320)
    const phone = String(input.phone || '').trim().slice(0, 40) || null
    const address = String(input.address || '').trim().slice(0, 300) || null
    const zip = String(input.zip || '').trim().slice(0, 10) || null
    if (!name) throw new BookingError('Please enter your name.')
    if (!EMAIL_RE.test(email)) throw new BookingError('Please enter a valid email address.')
    const answers: Record<string, string> = {}
    for (const q of questions) {
      const v = input.answers?.[q.name]
      const a = typeof v === 'string' ? v.trim().slice(0, q.maxLength) : ''
      if (a) answers[q.name] = a
    }
    if (customer) {
      if (s.requirePhone && !phone) throw new BookingError('Please enter a phone number.')
      if (requireAddress(s) && !address) throw new BookingError('Please enter the address.')
      for (const q of questions) if (q.requiredMessage && !answers[q.name]) throw new BookingError(q.requiredMessage)
      const w = window(s)
      if (input.date < w.first) throw new BookingError('That date is in the past.')
      if (input.date > w.last) throw new BookingError(`Please choose a date within ${s.maxDaysOut} days.`)
      // Refused plainly. The site answered a banned address with a fake success, so a person turned away believed
      // they had an appointment.
      if (await isBanned(companyId, email, phone)) throw new BookingError("We can't take this booking online — please call us.", 403, 'refused')
    } else if (!opts.override && zonedWallTimeToUtc(input.date, input.time, tzOf(s)).getTime() < now()) {
      throw new BookingError('That time has already passed.')
    }
    if (opts.assignedUserId && !(await companyUserIds(companyId)).has(opts.assignedUserId)) throw new BookingError('That person is not on this account.')

    const tz = tzOf(s)
    const startAt = zonedWallTimeToUtc(input.date, input.time, tz)
    const endAt = new Date(startAt.getTime() + svc.durationMinutes * 60_000)
    const depositOwed = svc.depositAmount != null ? dollars(svc.depositAmount) : svc.depositPercent != null ? dollars(svc.price) * svc.depositPercent / 100 : 0
    const takeDeposit = customer && depositOwed > 0 && !!deps.deposits
    const tipPercent = input.tipPercent != null && Array.isArray(svc.tipPresets) && (svc.tipPresets as number[]).includes(Number(input.tipPercent)) ? Number(input.tipPercent) : null
    const tip = tipPercent && svc.price != null ? dollars(svc.price) * tipPercent / 100 : null

    // People's calendars are read before the day is locked: an outside call never holds the lock.
    const external = opts.override ? [] : await externalFor(companyId, s, input.date, input.date)
    const row: BookingRow = await db.transaction(async (tx: any) => {
      const who = await claim(tx, companyId, s, svc, input.date, input.time, zip, { customer, override: opts.override, external })
      if (opts.assignedUserId && !opts.override && !who.includes(opts.assignedUserId) && !who.includes(null)) throw new BookingError("That person isn't free then.", 409, 'taken')
      const contactId = await contactFor(tx, companyId, { name, email, phone, address, zip })
      const [made] = await tx.insert(booking).values({
        companyId, serviceId: svc.id, contactId, seriesId: opts.seriesId ?? null, seriesIndex: opts.seriesIndex ?? null,
        startAt, endAt, customerName: name, customerEmail: email, customerPhone: phone, customerAddress: address, customerZip: zip,
        customerNotes: String(input.notes || '').trim().slice(0, 2000) || null,
        status: takeDeposit ? 'pending' : 'confirmed',
        assignedUserId: opts.assignedUserId ?? pickWho(who),
        source: opts.source ?? (customer ? 'public' : 'staff'),
        sourcePath: text(input.sourcePath, 500) ?? null, sourceReferrer: text(input.sourceReferrer, 1000) ?? null, sourceVariant: text(input.sourceVariant, 60) ?? null,
        token: newToken(),
        depositAmount: takeDeposit ? money(depositOwed) : null, depositStatus: takeDeposit ? 'pending' : 'none',
        tipAmount: tip ? money(tip) : null,
        // The engine's clock, not the database's: the deposit hold is measured from it.
        createdAt: new Date(now()), updatedAt: new Date(now()),
      }).returning()
      const links = deps.addOn ? await deps.addOn.booked(tx, { companyId, contactId, booking: made, service: svc, answers }) : undefined
      if (links && Object.keys(links).length) {
        const [linked] = await tx.update(booking).set(links).where(eq(booking.id, made.id)).returning()
        return linked
      }
      return made
    })

    // The customer's "Text me" (site/smsConsent.ts), kept by number — after the booking's transaction, never inside it.
    if (customer && input.smsConsent && phone) await recordConsent(db, companyId, { phone, source: 'booking', topic: 'booking', page: text(input.sourcePath, 500) ?? null })
    let final = row
    let deposit: { amount: number; url: string } | null = null
    if (takeDeposit) {
      const page = await openDeposit(row, svc, s)
      if (page) {
        ;[final] = await db.update(booking).set({ paymentIntentId: page.reference, updatedAt: new Date(now()) }).where(eq(booking.id, row.id)).returning()
        deposit = { amount: depositOwed + (tip ?? 0), url: page.url }
      } else {
        // The deposit can't be taken now: the booking stands, and the owner collects it by hand.
        ;[final] = await db.update(booking).set({ status: 'confirmed', depositStatus: 'none', depositAmount: null, updatedAt: new Date(now()) }).where(eq(booking.id, row.id)).returning()
      }
    }
    if (final.status === 'confirmed') await emit({ event: 'booking.created', booking: final, service: svc, settings: s, by: opts.by })
    return { booking: final, service: svc, deposit }
  }

  /** The provider's page for a booking's deposit (its amount and tip as booked), open until the hold runs out. */
  async function openDeposit(b: BookingRow, svc: ServiceRow, s: SettingsRow) {
    if (!deps.deposits || !b.depositAmount) return null
    const amount = dollars(b.depositAmount) + (b.tipAmount ? dollars(b.tipAmount) : 0)
    return deps.deposits.checkout({
      companyId: b.companyId, bookingId: b.id, token: b.token, amount, customerEmail: b.customerEmail, customerName: b.customerName,
      description: `Deposit for ${svc.name}`, expiresAt: new Date(b.createdAt.getTime() + s.depositHoldMinutes * 60_000),
    }).catch(() => null)
  }

  /**
   * The deposit page again, for a booking still waiting on it (the customer's own page, "Pay the deposit"): a new page
   * each time, since the provider's page closes; the hold itself is not extended. Null when nothing is owed now.
   */
  async function depositPage(companyId: string, b: BookingRow): Promise<string | null> {
    const s = await settingsOf(companyId)
    await expireHolds(companyId, s)
    const [cur]: BookingRow[] = await db.select().from(booking).where(and(eq(booking.id, b.id), eq(booking.companyId, companyId))).limit(1)
    if (!cur || cur.status !== 'pending' || cur.depositStatus !== 'pending' || !cur.serviceId) return null
    const svc = await serviceById(companyId, cur.serviceId)
    const page = svc ? await openDeposit(cur, svc, s) : null
    if (!page) return null
    await db.update(booking).set({ paymentIntentId: page.reference, updatedAt: new Date(now()) }).where(eq(booking.id, cur.id))
    return page.url
  }

  /**
   * A deposit paid (the payment provider's webhook), by booking. Waiting on it: the booking is confirmed. Its hold ran
   * out first: confirmed again only if its time is still free and still ahead (the CRMs' late-deposit rule), otherwise
   * refunded. Cancelled any other way: refunded. Never ours: unknown. Paid already (a retried webhook): nothing more.
   */
  async function depositPaid(companyId: string | null, bookingId: string, paymentId: string): Promise<DepositOutcome> {
    const [b]: BookingRow[] = await db.select().from(booking).where(and(eq(booking.id, bookingId), ...(companyId ? [eq(booking.companyId, companyId)] : []))).limit(1)
    if (!b) return 'unknown'
    if (b.depositStatus === 'paid' || b.depositStatus === 'refunded') return 'done'
    const s = await settingsOf(b.companyId)
    const svc = b.serviceId ? await serviceById(b.companyId, b.serviceId) : null
    const paid = { depositStatus: 'paid', depositPaidAt: new Date(now()), paymentIntentId: paymentId, updatedAt: new Date(now()) }
    if (b.status === 'cancelled') {
      // Only a hold that ran out comes back, and only to a time still free and ahead; a booking someone cancelled stays so.
      if (b.depositStatus !== 'expired' || b.cancelledReason !== 'deposit_not_paid' || !svc || b.startAt.getTime() <= now()) return 'refund'
      const at = tzParts(b.startAt, tzOf(s))
      const external = await externalFor(b.companyId, s, at.date, at.date)
      try {
        const back: BookingRow = await db.transaction(async (tx: any) => {
          await claim(tx, b.companyId, s, svc, at.date, minutesToHm(at.minutes), b.customerZip, { except: b.id, customer: false, external })
          const [u] = await tx.update(booking).set({ ...paid, status: 'confirmed', cancelledAt: null, cancelledReason: null }).where(eq(booking.id, b.id)).returning()
          await mirror(tx, u, 'status')
          return u
        })
        await emit({ event: 'booking.created', booking: back, service: svc, settings: s, by: 'customer' })
        return 'done'
      } catch (e) {
        if (e instanceof BookingError) return 'refund'
        throw e
      }
    }
    if (b.status === 'pending') {
      const [u]: BookingRow[] = await db.update(booking).set({ ...paid, status: 'confirmed' }).where(and(eq(booking.id, b.id), eq(booking.status, 'pending'))).returning()
      // changed under us (its hold ran out a moment ago): decide again on what it is now
      if (!u) return depositPaid(companyId, bookingId, paymentId)
      await mirror(db, u, 'status')
      await emit({ event: 'booking.created', booking: u, service: svc, settings: s, by: 'customer' })
      return 'done'
    }
    // Confirmed by hand, or already happened, while the customer paid: the money is recorded on it.
    await db.update(booking).set(paid).where(eq(booking.id, b.id))
    return 'done'
  }

  /** The refund depositPaid asked for, made: recorded on the booking. */
  async function depositRefunded(companyId: string | null, bookingId: string, paymentId: string) {
    await db.update(booking).set({ depositStatus: 'refunded', paymentIntentId: paymentId, updatedAt: new Date(now()) })
      .where(and(eq(booking.id, bookingId), ...(companyId ? [eq(booking.companyId, companyId)] : [])))
  }

  // ── Changing a booking ────────────────────────────────────────────────────
  const getBooking = async (companyId: string, id: string): Promise<BookingRow | null> => {
    const [b] = await db.select().from(booking).where(and(eq(booking.id, id), eq(booking.companyId, companyId))).limit(1)
    return b ?? null
  }
  const byToken = async (companyId: string, token: string): Promise<BookingRow | null> => {
    const [b] = await db.select().from(booking).where(and(eq(booking.token, token), eq(booking.companyId, companyId))).limit(1)
    return b ?? null
  }

  /** May the customer still change it themselves? Staff always may (while it is going ahead). */
  function changeable(b: BookingRow, s: SettingsRow, by: 'customer' | 'staff') {
    if (!(ACTIVE as readonly string[]).includes(b.status)) throw new BookingError(b.status === 'cancelled' ? 'This booking was cancelled.' : 'This booking has already happened.', 409, 'closed')
    if (by === 'customer' && b.startAt.getTime() - now() < s.selfServiceCutoffMinutes * 60_000) {
      throw new BookingError(`It's too close to the start to change this online — please call us.`, 409, 'cutoff')
    }
  }
  const selfServiceOpen = (b: BookingRow, s: SettingsRow) => (ACTIVE as readonly string[]).includes(b.status) && b.startAt.getTime() - now() >= s.selfServiceCutoffMinutes * 60_000

  async function reschedule(companyId: string, b: BookingRow, date: string, time: string, opts: { by: 'customer' | 'staff'; override?: boolean }) {
    const s = await settingsOf(companyId)
    changeable(b, s, opts.by)
    if (!isRealDate(date) || !HM_RE.test(String(time))) throw new BookingError('Choose a real date and time.')
    const svc = b.serviceId ? await serviceById(companyId, b.serviceId) : null
    if (!svc) throw new BookingError("This booking's service no longer exists; book a new one instead.", 409)
    if (opts.by === 'customer') {
      const w = window(s)
      if (date < w.first || date > w.last) throw new BookingError(`Please choose a date within ${s.maxDaysOut} days.`)
    }
    const tz = tzOf(s)
    const startAt = zonedWallTimeToUtc(date, time, tz)
    const endAt = new Date(startAt.getTime() + svc.durationMinutes * 60_000)
    const external = opts.override ? [] : await externalFor(companyId, s, date, date)
    const updated: BookingRow = await db.transaction(async (tx: any) => {
      const who = await claim(tx, companyId, s, svc, date, time, b.customerZip, { except: b.id, customer: opts.by === 'customer', override: opts.override, external })
      // Keep the person when they can still take it; otherwise whoever can.
      const assignedUserId = opts.override || who.includes(b.assignedUserId) || (who.includes(null) && !b.assignedUserId) ? b.assignedUserId : pickWho(who)
      const [u] = await tx.update(booking).set({ startAt, endAt, assignedUserId, reminderEmailSentAt: null, reminderSmsSentAt: null, updatedAt: new Date(now()) }).where(eq(booking.id, b.id)).returning()
      await mirror(tx, u, 'moved')
      return u
    })
    await emit({ event: 'booking.rescheduled', booking: updated, service: svc, settings: s, previousStartAt: b.startAt, by: opts.by })
    return updated
  }

  async function cancel(companyId: string, b: BookingRow, opts: { by: 'customer' | 'staff'; reason?: string | null }) {
    const s = await settingsOf(companyId)
    changeable(b, s, opts.by)
    const u: BookingRow = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(booking).set({
        status: 'cancelled', cancelledAt: new Date(now()), cancelledReason: text(opts.reason, 300) ?? (opts.by === 'customer' ? 'customer' : 'staff'),
        // An unpaid hold is released; a paid deposit stays recorded as paid — refunding it is a decision.
        depositStatus: b.depositStatus === 'pending' ? 'expired' : b.depositStatus, updatedAt: new Date(now()),
      }).where(eq(booking.id, b.id)).returning()
      await mirror(tx, row, 'status')
      return row
    })
    await emit({ event: 'booking.cancelled', booking: u, service: u.serviceId ? await serviceById(companyId, u.serviceId) : null, settings: s, by: opts.by })
    return u
  }

  /**
   * Staff marking what happened. "Completed" and "no-show" are about the past: refused for a visit that hasn't
   * started (CRMs' T58). Cancelling goes through cancel(); a pending booking can be confirmed by hand (deposit taken
   * in person).
   */
  async function setStatus(companyId: string, b: BookingRow, status: string) {
    if (!(STATUSES as readonly string[]).includes(status)) throw new BookingError(`Status must be one of ${STATUSES.join(', ')}.`)
    if (status === 'cancelled') return cancel(companyId, b, { by: 'staff' })
    if (status === 'pending') throw new BookingError('A booking only waits on a deposit when a customer books it.')
    if ((status === 'completed' || status === 'no_show') && b.startAt.getTime() > now() + 60_000) {
      throw new BookingError(status === 'completed' ? "This visit hasn't started yet, so it can't be marked completed." : "This visit hasn't started yet, so nobody can have missed it. Cancel it instead if it isn't going ahead.")
    }
    if (status === 'confirmed' && b.status === 'cancelled') throw new BookingError('A cancelled booking can’t be brought back — book the time again.', 409)
    const s = await settingsOf(companyId)
    const u: BookingRow = await db.transaction(async (tx: any) => {
      const [row] = await tx.update(booking).set({ status, ...(status === 'confirmed' && b.depositStatus === 'pending' ? { depositStatus: 'none' } : {}), updatedAt: new Date(now()) }).where(eq(booking.id, b.id)).returning()
      await mirror(tx, row, 'status')
      return row
    })
    const event = status === 'completed' ? 'booking.completed' : status === 'no_show' ? 'booking.no_show' : 'booking.confirmed'
    await emit({ event, booking: u, service: u.serviceId ? await serviceById(companyId, u.serviceId) : null, settings: s, by: 'staff' })
    return u
  }

  /** Who takes it, and the details on it. */
  async function updateDetails(companyId: string, b: BookingRow, body: Record<string, unknown>) {
    const u: Record<string, unknown> = {}
    if (body.assignedUserId !== undefined) {
      const id = body.assignedUserId ? String(body.assignedUserId) : null
      if (id && !(await companyUserIds(companyId)).has(id)) throw new BookingError('That person is not on this account.')
      u.assignedUserId = id
    }
    for (const [k, max] of [['customerName', 200], ['customerPhone', 40], ['customerAddress', 300], ['customerZip', 10], ['customerNotes', 2000]] as const) {
      const v = text(body[k], max)
      if (v !== undefined) {
        if (k === 'customerName' && !v) throw new BookingError('The booking needs a name.')
        u[k] = v
      }
    }
    if (!Object.keys(u).length) throw new BookingError('Nothing to change.')
    const [row] = await db.update(booking).set({ ...u, updatedAt: new Date(now()) }).where(eq(booking.id, b.id)).returning()
    return row
  }

  /** A booking as the owner's screens show it: with its service's name and the assigned person's. */
  async function withNames(b: BookingRow) {
    const [svc] = b.serviceId ? await db.select({ name: bookingService.name }).from(bookingService).where(eq(bookingService.id, b.serviceId)).limit(1) : []
    const [who] = b.assignedUserId ? await db.select({ first: user.firstName, last: user.lastName }).from(user).where(eq(user.id, b.assignedUserId)).limit(1) : []
    return { ...b, serviceName: svc?.name ?? null, assignedName: who ? [who.first, who.last].filter(Boolean).join(' ') || null : null }
  }

  // ── The owner's list ──────────────────────────────────────────────────────
  async function listBookings(companyId: string, q: { from?: Date; to?: Date; status?: string; assignedUserId?: string; contactId?: string; seriesId?: string; page: number; limit: number }) {
    const conds: any[] = [eq(booking.companyId, companyId)]
    if (q.from && !Number.isNaN(q.from.getTime())) conds.push(gt(booking.endAt, q.from))
    if (q.to && !Number.isNaN(q.to.getTime())) conds.push(lt(booking.startAt, q.to))
    if (q.status) conds.push(eq(booking.status, q.status))
    if (q.assignedUserId) conds.push(eq(booking.assignedUserId, q.assignedUserId))
    if (q.contactId) conds.push(eq(booking.contactId, q.contactId))
    if (q.seriesId) conds.push(eq(booking.seriesId, q.seriesId))
    const where = and(...conds)
    const [rows, [{ total }]] = await Promise.all([
      db.select({ b: booking, serviceName: bookingService.name, first: user.firstName, last: user.lastName }).from(booking).leftJoin(bookingService, eq(booking.serviceId, bookingService.id))
        .leftJoin(user, eq(booking.assignedUserId, user.id))
        .where(where).orderBy(q.from ? asc(booking.startAt) : desc(booking.startAt), asc(booking.id)).limit(q.limit).offset((q.page - 1) * q.limit),
      db.select({ total: count() }).from(booking).where(where),
    ])
    // The person's name comes with the booking, so a seat that can't read the team list still sees who is doing it.
    return { rows: rows.map((r: any) => ({ ...r.b, serviceName: r.serviceName ?? null, assignedName: r.b.assignedUserId ? [r.first, r.last].filter(Boolean).join(' ') || null : null })), total: Number(total) }
  }

  return {
    settingsOf, updateSettings, rotateFeedToken, tzOf, requireAddress, window, selfServiceOpen, questions,
    listServices, serviceBySlug, serviceById, createService, updateService, deleteService,
    getHours, setHours, listDaysOff, addDayOff, removeDayOff, listZones, setZone,
    availableDates, availableTimes, expireHolds,
    book, depositPaid, depositRefunded, depositPage, getBooking, byToken, reschedule, cancel, setStatus, updateDetails, listBookings, withNames,
    isBanned, emit,
  }
}

export type BookingEngine = ReturnType<typeof createBookingEngine>
