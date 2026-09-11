/**
 * Online Booking Service (Drizzle)
 *
 * Embeddable booking widget for customer websites:
 * - Public booking page (no auth required)
 * - Service selection
 * - Date/time slot picker
 * - Customer info collection
 * - Creates the appointment in The Book
 *
 * NOTE: bookingSettings, bookableService, onlineBooking tables are not in the
 * current schema. This uses raw SQL for those. Add them to db/schema.ts for
 * full query-builder support.
 */

import { db } from '../../db/index.ts';
import { contact, appointment, serviceMenu, bookingSettings } from '../../db/schema.ts';
import { eq, and, gte, lte, count, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// Convert a wall-clock date+time in a named timezone to the correct UTC instant (DST-aware).
// A UTC server would otherwise store the salon's local 1:00 PM as 13:00Z — five hours early
// in America/Chicago, so every online booking landed at 8:00 AM. (CC-33)
function zonedWallTimeToUtc(dateStr: string, timeStr: string, timeZone: string): Date {
  const [h, m] = timeStr.split(':').map(Number);
  const asUtc = new Date(`${dateStr}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`);
  const local = new Date(asUtc.toLocaleString('en-US', { timeZone }));
  const utc = new Date(asUtc.toLocaleString('en-US', { timeZone: 'UTC' }));
  return new Date(asUtc.getTime() - (local.getTime() - utc.getTime()));
}

// ============================================
// BOOKING SETTINGS
// ============================================

/**
 * Get/create booking settings for a company
 */
export async function getBookingSettings(companyId: string) {
  // Drizzle-typed on purpose. The previous implementation was raw SQL against
  // columns the table has never had (lead_time_hours, title, require_phone,
  // logo_url...) — every settings read 500'd on the defaults-INSERT and the
  // public booking page could not even load. Typed access makes that class of
  // drift a compile error instead of a live-tenant discovery.
  let [row] = await db.select().from(bookingSettings)
    .where(eq(bookingSettings.companyId, companyId)).limit(1);

  if (!row) {
    const [created] = await db.insert(bookingSettings).values({
      companyId,
      enabled: true,
      leadTimeDays: 1,
      maxDaysOut: 30,
      slotDurationMinutes: 60,
      workingHours: {
        monday: { start: '09:00', end: '17:00', enabled: true },
        tuesday: { start: '09:00', end: '17:00', enabled: true },
        wednesday: { start: '09:00', end: '17:00', enabled: true },
        thursday: { start: '09:00', end: '17:00', enabled: true },
        friday: { start: '09:00', end: '17:00', enabled: true },
        saturday: { start: '09:00', end: '14:00', enabled: false },
        sunday: { start: '09:00', end: '14:00', enabled: false },
      },
      welcomeMessage: 'Book an appointment',
      confirmationMessage: "You're booked — see you soon!",
      primaryColor: '{{PRIMARY_COLOR}}',
    }).returning();
    row = created;
  }

  // One normalized shape for every consumer. The snake_case aliases are what
  // the slot/date logic below reads; the camelCase fields are what the route
  // and the widget read. lead time is STORED in days, exposed in hours.
  return {
    ...row,
    slot_duration_minutes: row.slotDurationMinutes,
    working_hours: row.workingHours,
    lead_time_hours: (row.leadTimeDays ?? 1) * 24,
    max_days_out: row.maxDaysOut,
    title: row.welcomeMessage || 'Book an appointment',
    description: row.confirmationMessage || '',
    // The table carries no require flags; a salon needs a phone number to
    // confirm, and never needs a street address for a chair.
    requirePhone: true,
    requireAddress: false,
    logoUrl: row.logo || null,
  };
}

export async function updateBookingSettings(companyId: string, data: Record<string, unknown>) {
  await getBookingSettings(companyId); // ensure the row exists

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (typeof data.enabled === 'boolean') updates.enabled = data.enabled;
  if (data.slotDurationMinutes != null) updates.slotDurationMinutes = Number(data.slotDurationMinutes);
  if (data.maxDaysOut != null) updates.maxDaysOut = Number(data.maxDaysOut);
  if (data.concurrentBookings != null) updates.concurrentBookings = Math.min(20, Math.max(1, Math.round(Number(data.concurrentBookings) || 1)));
  // Accept either unit; the column is days.
  if (data.leadTimeDays != null) updates.leadTimeDays = Number(data.leadTimeDays);
  else if (data.leadTimeHours != null) updates.leadTimeDays = Math.ceil(Number(data.leadTimeHours) / 24);
  if (data.workingHours && typeof data.workingHours === 'object') updates.workingHours = data.workingHours;
  if (typeof data.welcomeMessage === 'string') updates.welcomeMessage = data.welcomeMessage;
  if (typeof data.confirmationMessage === 'string') updates.confirmationMessage = data.confirmationMessage;
  if (typeof data.primaryColor === 'string') updates.primaryColor = data.primaryColor;
  if (typeof data.logo === 'string' || data.logo === null) updates.logo = data.logo;
  if (typeof data.notifyEmail === 'boolean') updates.notifyEmail = data.notifyEmail;
  if (typeof data.notifySms === 'boolean') updates.notifySms = data.notifySms;

  await db.update(bookingSettings).set(updates as any)
    .where(eq(bookingSettings.companyId, companyId));

  return getBookingSettings(companyId);
}

// ============================================
// BOOKABLE SERVICES
// ============================================

/**
 * Get services available for online booking
 */
// activeOnly: the public widget wants bookable services; the owner's settings
// screen has to see the ones they switched off too.
export async function getBookableServices(companyId: string, activeOnly = false) {
  const result = await db.execute(sql`
    SELECT * FROM bookable_service
    WHERE company_id = ${companyId}
      ${activeOnly ? sql`AND active = true` : sql``}
    ORDER BY sort_order ASC, name ASC
  `);
  return (result as any).rows || result;
}

/**
 * Create bookable service
 */
export async function createBookableService(companyId: string, data: {
  name: string;
  description?: string;
  durationMinutes?: number;
  price?: number;
  depositRequired?: boolean;
  depositAmount?: number;
  active?: boolean;
  sortOrder?: number;
}) {
  // Columns match the table: it has deposit_required/deposit_amount and no
  // price_type — writing price_type made every create fail.
  const id = createId();
  await db.execute(sql`
    INSERT INTO bookable_service (
      id, company_id, name, description, duration_minutes, price,
      deposit_required, deposit_amount, active, sort_order, created_at, updated_at
    )
    VALUES (
      ${id}, ${companyId}, ${data.name}, ${data.description || null},
      ${data.durationMinutes || 60}, ${String(data.price ?? 0)},
      ${data.depositRequired === true}, ${String(data.depositAmount ?? 0)},
      ${data.active !== false}, ${data.sortOrder || 0}, NOW(), NOW()
    )
  `);
  const result = await db.execute(sql`SELECT * FROM bookable_service WHERE id = ${id}`);
  return (result.rows?.[0] as any) ?? { id };
}

/**
 * Update bookable service
 */
export async function updateBookableService(serviceId: string, companyId: string, data: Record<string, unknown>) {
  const allowedCols = ['name', 'description', 'duration_minutes', 'price', 'deposit_required', 'deposit_amount', 'active', 'sort_order'];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    if (!allowedCols.includes(colName)) continue;
    await db.execute(sql`UPDATE bookable_service SET ${sql.raw(`"${colName}"`)} = ${value}, updated_at = NOW() WHERE id = ${serviceId} AND company_id = ${companyId}`);
  }
}

// Remove a bookable service — the delete control 404'd; no route existed. (BOOK-06)
export async function deleteBookableService(serviceId: string, companyId: string) {
  await db.execute(sql`DELETE FROM bookable_service WHERE id = ${serviceId} AND company_id = ${companyId}`);
}

// Cancel a booking — set both the online_booking and its linked appointment (The Book)
// to cancelled. There was no cancel/delete route, so a booking could never be undone. (BOOK-06)
export async function cancelBooking(bookingId: string, companyId: string) {
  const rows = await db.execute(sql`SELECT appointment_id FROM online_booking WHERE id = ${bookingId} AND company_id = ${companyId}`);
  const apptId = (rows.rows?.[0] as any)?.appointment_id;
  if (apptId) await db.execute(sql`UPDATE appointment SET status = 'cancelled', updated_at = NOW() WHERE id = ${apptId} AND company_id = ${companyId}`);
  await db.execute(sql`UPDATE online_booking SET status = 'cancelled' WHERE id = ${bookingId} AND company_id = ${companyId}`);
}

// Change a booking's status (and its appointment) — e.g. confirm or no-show. (BOOK-06)
export async function updateBookingStatus(bookingId: string, companyId: string, status: string) {
  await db.execute(sql`UPDATE online_booking SET status = ${status} WHERE id = ${bookingId} AND company_id = ${companyId}`);
  const rows = await db.execute(sql`SELECT appointment_id FROM online_booking WHERE id = ${bookingId} AND company_id = ${companyId}`);
  const apptId = (rows.rows?.[0] as any)?.appointment_id;
  if (apptId) await db.execute(sql`UPDATE appointment SET status = ${status}, updated_at = NOW() WHERE id = ${apptId} AND company_id = ${companyId}`);
}

// ============================================
// AVAILABILITY
// ============================================

// Abandoned deposit checkouts must not squat on bookable capacity: a booking
// still owing its deposit after the hold window is cancelled and its appointment
// released the next time availability is computed.
const rawHoldMinutes = Number(process.env.BOOKING_DEPOSIT_HOLD_MINUTES)
const DEPOSIT_HOLD_MINUTES = Number.isFinite(rawHoldMinutes) && rawHoldMinutes > 0 ? rawHoldMinutes : 30

export async function expireStaleDepositHolds(companyId: string) {
  const expired = await db.execute(sql`
    UPDATE online_booking
    SET status = 'cancelled', deposit_status = 'expired', updated_at = NOW()
    WHERE company_id = ${companyId}
      AND status = 'pending'
      AND deposit_status = 'pending'
      AND created_at < NOW() - (${DEPOSIT_HOLD_MINUTES} * interval '1 minute')
    RETURNING appointment_id
  `)
  const ids = ((expired as any).rows || []).map((r: any) => r.appointment_id).filter(Boolean)
  for (const id of ids) {
    await db.execute(sql`UPDATE appointment SET status = 'cancelled', updated_at = NOW() WHERE id = ${id}`)
  }
  return ids.length
}


// ============================================
// AVAILABILITY — salon-local time, capacity-aware, race-safe
// ============================================
//
// Everything here is computed in the salon's timezone (booking_settings.timezone). The previous
// implementation compared slot times (salon-local) against appointment times read with the SERVER's
// getHours() (UTC on Render): a 10:00 booking was stored as 15:00Z, never overlapped the 10:00 slot,
// and the slot stayed open — two customers took the same time (SALON-N3). Two more rules live here:
//   • capacity: a slot is open while fewer than `concurrentBookings` active appointments overlap it
//     (a three-chair salon takes three online bookings at 10:00; the default is 1);
//   • the calendar of record is the appointment book, so desk bookings block online slots too.

export class BookingError extends Error {
  status = 400
  constructor(message: string) { super(message); this.name = 'BookingError' }
}

const DAY_MS = 86400000
const MAX_CONCURRENT = 20

function tzParts(d: Date, timeZone: string): { date: string; minutes: number; weekday: string } {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone, hour12: false, weekday: 'long', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(d)
  const get = (t: string) => parts.find(p => p.type === t)?.value || ''
  const hour = Number(get('hour')) % 24
  return { date: `${get('year')}-${get('month')}-${get('day')}`, minutes: hour * 60 + Number(get('minute')), weekday: get('weekday').toLowerCase() }
}

function safeTz(tz: string | null | undefined): string {
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz || 'x' }); return tz as string } catch { return 'America/Chicago' }
}

function parseHours(raw: unknown): Record<string, { start: string; end: string; enabled: boolean }> {
  if (!raw) return {}
  if (typeof raw === 'string') { try { return JSON.parse(raw) } catch { return {} } }
  return raw as any
}

interface ResolvedService {
  id: string
  name: string
  durationMinutes: number
  price: number
  depositRequired: boolean
  depositAmount: number
  /** service_menu id when the booked service is a menu item (goes on the appointment) */
  menuServiceId: string | null
  /** bookable_service id when the booked service is a legacy widget service (online_booking.service_id FK) */
  legacyServiceId: string | null
}

// The public catalog: Service Menu items flagged "bookable online" (the salon's real menu, so the
// appointment carries the service, its duration, price, patch-test rule and rebook interval —
// SALON-N4 / M7), plus any legacy widget-only services whose name has no menu match.
export async function getPublicServices(companyId: string) {
  const menu = await db.select().from(serviceMenu)
    .where(and(eq(serviceMenu.companyId, companyId), eq(serviceMenu.active, true), eq(serviceMenu.bookableOnline, true)))
    .orderBy(serviceMenu.name)
  const legacy: any[] = await getBookableServices(companyId, true)
  const names = new Set(menu.map(m => m.name.trim().toLowerCase()))
  const out = menu.map(m => ({
    id: m.id, name: m.name, description: m.description || null,
    duration_minutes: m.durationMin, durationMinutes: m.durationMin,
    price: m.price != null ? String(m.price) : '0', price_is_from: m.priceIsFrom,
    deposit_required: false, depositRequired: false, deposit_amount: '0', depositAmount: '0',
    source: 'menu',
  }))
  for (const s of legacy) {
    if (names.has(String(s.name || '').trim().toLowerCase())) continue
    out.push({ ...s, durationMinutes: s.duration_minutes, depositRequired: !!s.deposit_required, depositAmount: String(s.deposit_amount ?? '0'), source: 'widget' })
  }
  return out
}

async function resolveService(companyId: string, serviceId: string | undefined, exec: any = db): Promise<ResolvedService | null> {
  if (!serviceId) return null
  const [menu] = await exec.select().from(serviceMenu)
    .where(and(eq(serviceMenu.id, serviceId), eq(serviceMenu.companyId, companyId), eq(serviceMenu.active, true)))
    .limit(1)
  if (menu) {
    return { id: menu.id, name: menu.name, durationMinutes: Number(menu.durationMin) || 60, price: Number(menu.price) || 0, depositRequired: false, depositAmount: 0, menuServiceId: menu.id, legacyServiceId: null }
  }
  const res: any = await exec.execute(sql`SELECT * FROM bookable_service WHERE id = ${serviceId} AND company_id = ${companyId} AND active = true LIMIT 1`)
  const row = (res.rows || res)[0]
  if (!row) return null
  // Link a legacy widget service to the menu entry with the same name when one exists.
  const [match] = await exec.select({ id: serviceMenu.id }).from(serviceMenu)
    .where(and(eq(serviceMenu.companyId, companyId), sql`lower(${serviceMenu.name}) = lower(${row.name})`)).limit(1)
  return {
    id: row.id, name: row.name, durationMinutes: Number(row.duration_minutes) || 60, price: Number(row.price) || 0,
    depositRequired: !!row.deposit_required && Number(row.deposit_amount || 0) > 0, depositAmount: Number(row.deposit_amount || 0),
    menuServiceId: match?.id || null, legacyServiceId: row.id,
  }
}

/**
 * Available start times for a date, in the salon's local clock ("HH:MM").
 */
export async function getAvailableSlots(companyId: string, date: string, serviceId?: string, exec: any = db) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new BookingError('Date must be YYYY-MM-DD.')
  await expireStaleDepositHolds(companyId)
  const settings = await getBookingSettings(companyId)
  const tz = safeTz((settings as any).timezone)
  const service = await resolveService(companyId, serviceId, exec)
  const slotDuration = service?.durationMinutes || Number(settings.slotDurationMinutes) || 60
  const capacity = Math.min(MAX_CONCURRENT, Math.max(1, Number((settings as any).concurrentBookings) || 1))

  const noon = zonedWallTimeToUtc(date, '12:00', tz)
  if (Number.isNaN(noon.getTime())) throw new BookingError('That date is not valid.')
  const weekday = tzParts(noon, tz).weekday
  const daySettings = parseHours(settings.workingHours)[weekday]
  if (!daySettings?.enabled) return []

  const [startHour, startMin] = String(daySettings.start || '09:00').split(':').map(Number)
  const [endHour, endMin] = String(daySettings.end || '17:00').split(':').map(Number)
  const slots: Array<{ time: string; minutes: number; available: boolean }> = []
  for (let t = startHour * 60 + startMin, end = endHour * 60 + endMin; t + slotDuration <= end; t += slotDuration) {
    slots.push({ time: `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`, minutes: t, available: true })
  }

  // Every active appointment that touches this salon-local day.
  const dayStart = zonedWallTimeToUtc(date, '00:00', tz)
  const dayEnd = new Date(dayStart.getTime() + DAY_MS)
  const existing = await exec.select({ startTime: appointment.startTime, endTime: appointment.endTime, status: appointment.status })
    .from(appointment)
    .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, new Date(dayStart.getTime() - DAY_MS)), lte(appointment.startTime, dayEnd)))

  const busy: Array<{ s: number; e: number }> = []
  for (const a of existing) {
    if (!a.startTime || a.status === 'cancelled' || a.status === 'no_show') continue
    const sp = tzParts(new Date(a.startTime), tz)
    if (sp.date !== date) continue
    const s = sp.minutes
    const e = a.endTime ? (tzParts(new Date(a.endTime), tz).date === date ? tzParts(new Date(a.endTime), tz).minutes : 24 * 60) : s + 60
    busy.push({ s, e })
  }
  for (const slot of slots) {
    const overlapping = busy.filter(b => slot.minutes < b.e && slot.minutes + slotDuration > b.s).length
    if (overlapping >= capacity) slot.available = false
  }

  // Lead time: nothing inside the notice window (stored in days, exposed in hours).
  const leadHours = Number((settings as any).lead_time_hours) || (Number(settings.leadTimeDays ?? 1) * 24)
  const minTime = Date.now() + leadHours * 3600_000
  for (const slot of slots) {
    if (zonedWallTimeToUtc(date, slot.time, tz).getTime() < minTime) slot.available = false
  }

  return slots.filter(s => s.available).map(({ time, available }) => ({ time, available }))
}

/**
 * Dates that have at least one bookable slot (salon-local calendar, lead time respected).
 */
export async function getAvailableDates(companyId: string, days = 30) {
  const settings = await getBookingSettings(companyId)
  const tz = safeTz((settings as any).timezone)
  const hours = parseHours(settings.workingHours)
  const leadHours = Number((settings as any).lead_time_hours) || (Number(settings.leadTimeDays ?? 1) * 24)
  const minTime = Date.now() + leadHours * 3600_000
  const maxDaysOut = Number(settings.maxDaysOut) || 30
  const todayLocal = tzParts(new Date(), tz).date
  const [y, m, d] = todayLocal.split('-').map(Number)
  const dates: Array<{ date: string; dayOfWeek: string }> = []
  for (let i = 0; i < Math.min(days, maxDaysOut); i++) {
    const date = new Date(Date.UTC(y, m - 1, d + i)).toISOString().slice(0, 10)
    const weekday = tzParts(zonedWallTimeToUtc(date, '12:00', tz), tz).weekday
    const ds = hours[weekday]
    if (!ds?.enabled) continue
    // A day whose closing time is inside the notice window has no times to offer — leave it out. (SALON-N11)
    if (zonedWallTimeToUtc(date, String(ds.end || '17:00'), tz).getTime() <= minTime) continue
    dates.push({ date, dayOfWeek: weekday })
  }
  return dates
}

// ============================================
// BOOKING SUBMISSION
// ============================================

/**
 * Create a booking (public endpoint). The availability check and the appointment insert run inside
 * one transaction under a per-salon-per-day advisory lock, so two customers submitting the same slot
 * at the same instant are serialised — the second one is told the time was just taken. (SALON-N3)
 */
export async function createBooking(companyId: string, data: {
  serviceId?: string
  date: string
  time: string
  firstName: string
  lastName: string
  email: string
  phone?: string
  address?: string
  city?: string
  state?: string
  zip?: string
  notes?: string
}) {
  const { serviceId, date, time, firstName, lastName, email, phone, address, city, state, zip, notes } = data

  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date))) throw new BookingError('Date must be YYYY-MM-DD.')
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(String(time || ''))) throw new BookingError('Time must be HH:MM (24-hour).')
  const settings = await getBookingSettings(companyId)
  const tz = safeTz((settings as any).timezone)
  if (String(date) < tzParts(new Date(), tz).date) throw new BookingError('That date is in the past.')
  if (serviceId && !(await resolveService(companyId, serviceId))) throw new BookingError('That service is not available for online booking.')

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':' + date}))`)

    const slots = await getAvailableSlots(companyId, date, serviceId, tx)
    if (!slots.find(s => s.time === time)) throw new BookingError('That time is no longer available — please pick another slot.')

    const service = await resolveService(companyId, serviceId, tx)

    // Find or create the client. Someone who books is a client, not a sales lead. (SALON-N11)
    let [theContact] = await tx.select().from(contact)
      .where(and(eq(contact.companyId, companyId), eq(contact.email, email))).limit(1)
    if (!theContact) {
      ;[theContact] = await tx.insert(contact).values({
        companyId, name: `${firstName} ${lastName}`.trim(), email, phone: phone || null, mobile: phone || null,
        address: address || null, city: city || null, state: state || null, zip: zip || null,
        type: 'client', source: 'online_booking',
      }).returning()
    }

    const scheduledDate = zonedWallTimeToUtc(String(date), time, tz)
    const durationMin = service?.durationMinutes || Number(settings.slotDurationMinutes) || 60
    const endTimeDate = new Date(scheduledDate.getTime() + durationMin * 60000)

    const [newAppointment] = await tx.insert(appointment).values({
      companyId,
      contactId: theContact.id,
      serviceId: service?.menuServiceId || null,
      status: 'scheduled',
      startTime: scheduledDate,
      endTime: endTimeDate,
      quotedPrice: service && service.price > 0 ? String(service.price) : null,
      notes: `Online booking: ${service?.name || 'service'}${notes ? ' — ' + notes : ''}`,
    }).returning()

    const confirmationCode = generateConfirmationCode()
    const depositRequired = !!service?.depositRequired
    const depositAmount = depositRequired ? service!.depositAmount : 0
    const bookingId = createId()
    await tx.execute(sql`
      INSERT INTO online_booking (
        id, company_id, appointment_id, contact_id, service_id, scheduled_date,
        customer_name, customer_email, customer_phone, notes, status,
        confirmation_code, deposit_amount, deposit_status, created_at, updated_at
      ) VALUES (
        ${bookingId}, ${companyId}, ${newAppointment.id}, ${theContact.id}, ${service?.legacyServiceId || null},
        ${scheduledDate}, ${(firstName + ' ' + lastName).trim()}, ${email}, ${phone || null},
        ${notes || null}, ${depositRequired ? 'pending' : 'confirmed'}, ${confirmationCode},
        ${String(depositAmount)}, ${depositRequired ? 'pending' : 'none'}, NOW(), NOW()
      )`)
    return { newAppointment, theContact, service, confirmationCode, bookingId, depositRequired, depositAmount }
  })

  const { newAppointment, theContact, service, confirmationCode, bookingId, depositRequired, depositAmount } = created

  // A booking that owes a deposit is not confirmed until it is paid.
  let deposit: { required: boolean; amount: number; clientSecret?: string; publishableKey?: string } = { required: depositRequired, amount: depositAmount }
  if (depositRequired) {
    try {
      const { createBookingDepositIntent } = await import('./stripe.ts')
      const intent = await createBookingDepositIntent({ bookingId, companyId, amount: depositAmount, contactRow: theContact, description: `Deposit for ${service?.name || 'booking'}` })
      if (intent?.clientSecret) {
        await db.execute(sql`UPDATE online_booking SET payment_intent_id = ${intent.paymentIntentId} WHERE id = ${bookingId}`)
        deposit = { ...deposit, clientSecret: intent.clientSecret, publishableKey: intent.publishableKey }
      }
    } catch (err: any) {
      // Card processing not configured, or Stripe refused. Keep the booking — the owner can still
      // collect the deposit by hand — but say so.
      console.error('[Booking] Deposit intent failed:', err?.message || err)
    }
  }

  return { appointment: newAppointment, serviceName: service?.name || 'Online Booking', contact: theContact, bookingId, confirmationCode, deposit }
}

/**
 * Bookings for the owner. The admin route has always called this; the service
 * never defined it, so GET /api/booking threw "getBookings is not a function".
 */
export async function getBookings(
  companyId: string,
  { status, page = 1, limit = 50 }: { status?: string; page?: number; limit?: number } = {},
) {
  const offset = (page - 1) * limit;
  const rows = await db.execute(sql`
    SELECT ob.*, bs.name AS service_name, a.status AS appointment_status
    FROM online_booking ob
    LEFT JOIN bookable_service bs ON ob.service_id = bs.id
    LEFT JOIN appointment a ON ob.appointment_id = a.id
    WHERE ob.company_id = ${companyId}
      ${status ? sql`AND ob.status = ${status}` : sql``}
    ORDER BY ob.scheduled_date DESC
    LIMIT ${limit} OFFSET ${offset}
  `);
  const totalResult = await db.execute(sql`
    SELECT COUNT(*)::int AS value FROM online_booking
    WHERE company_id = ${companyId} ${status ? sql`AND status = ${status}` : sql``}
  `);
  const total = Number(((totalResult.rows?.[0] as any) || {}).value ?? 0);

  return {
    data: rows.rows ?? [],
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
  };
}

/** Look a booking up by the code the customer was given. */
export async function getBookingByCode(companyId: string, code: string) {
  const result = await db.execute(sql`
    SELECT ob.*, bs.name AS service_name
    FROM online_booking ob
    LEFT JOIN bookable_service bs ON ob.service_id = bs.id
    WHERE ob.company_id = ${companyId} AND ob.confirmation_code = ${code}
    LIMIT 1
  `);
  return (result.rows?.[0] as any) ?? null;
}

function generateConfirmationCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

// ============================================
// EMBED CODE
// ============================================

/**
 * Generate embed code for website
 */
export function getEmbedCode(_companyId: string, companySlug: string): string {
  // The global is TwomiahBooking, not one built from the company name — a
  // business name with a space in it produced invalid JavaScript. apiUrl is
  // explicit so the widget still reaches the CRM from the customer's own site.
  const host = (process.env.FRONTEND_URL || process.env.BACKEND_URL || '').replace(/\/$/, '');
  return `<!-- {{COMPANY_NAME}} Online Booking Widget -->
<div id="{{COMPANY_SLUG}}-booking"></div>
<script src="${host}/booking-widget.js"></script>
<script>
  TwomiahBooking.init({
    container: '#{{COMPANY_SLUG}}-booking',
    company: '${companySlug}',
    apiUrl: '${host}'
  });
</script>`;
}

export default {
  getBookingSettings,
  getPublicServices,
  updateBookingSettings,
  getBookableServices,
  createBookableService,
  updateBookableService,
  deleteBookableService,
  cancelBooking,
  updateBookingStatus,
  getAvailableSlots,
  getAvailableDates,
  createBooking,
  getBookings,
  getBookingByCode,
  getEmbedCode,
};
