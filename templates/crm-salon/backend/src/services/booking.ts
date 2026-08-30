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

/**
 * Get available time slots for a date
 */

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

export async function getAvailableSlots(companyId: string, date: string, serviceId?: string) {
  await expireStaleDepositHolds(companyId);
  const settings = await getBookingSettings(companyId);

  let service: any = null;
  if (serviceId) {
    const svcResult = await db.execute(sql`
      SELECT * FROM bookable_service WHERE id = ${serviceId} AND company_id = ${companyId} LIMIT 1
    `);
    const svcRows = (svcResult as any).rows || svcResult;
    service = svcRows[0] || null;
  }

  const slotDuration = service?.duration_minutes || settings.slot_duration_minutes || 60;
  const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
  const workingHours = typeof settings.working_hours === 'string'
    ? JSON.parse(settings.working_hours)
    : settings.working_hours;
  const daySettings = workingHours[dayOfWeek];

  if (!daySettings?.enabled) {
    return [];
  }

  const slots: Array<{ time: string; available: boolean }> = [];
  const [startHour, startMin] = daySettings.start.split(':').map(Number);
  const [endHour, endMin] = daySettings.end.split(':').map(Number);

  let currentTime = startHour * 60 + startMin;
  const endTime = endHour * 60 + endMin;

  while (currentTime + slotDuration <= endTime) {
    const hour = Math.floor(currentTime / 60);
    const min = currentTime % 60;
    slots.push({
      time: `${hour.toString().padStart(2, '0')}:${min.toString().padStart(2, '0')}`,
      available: true,
    });
    currentTime += slotDuration;
  }

  // Get existing bookings for this date
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(date);
  endOfDay.setHours(23, 59, 59, 999);

  // Salon: the calendar of record is the APPOINTMENT book, so online slots are
  // subtracted against it — a walk-in booked at the desk blocks the online slot
  // and vice versa. (The contractor-family templates subtract jobs here.)
  const existingAppointments = await db.select({
    startTime: appointment.startTime,
    endTime: appointment.endTime,
    status: appointment.status,
  })
    .from(appointment)
    .where(and(
      eq(appointment.companyId, companyId),
      gte(appointment.startTime, startOfDay),
      lte(appointment.startTime, endOfDay),
    ));

  // Mark unavailable slots. Cancelled / no-show rows free the slot back up.
  for (const a of existingAppointments) {
    if (!a.startTime || a.status === 'cancelled' || a.status === 'no_show') continue;
    const apptStart = a.startTime.getHours() * 60 + a.startTime.getMinutes();
    const apptEnd = a.endTime
      ? a.endTime.getHours() * 60 + a.endTime.getMinutes()
      : apptStart + 60;

    for (const slot of slots) {
      const [slotHour, slotMin] = slot.time.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMin;

      if (slotTime < apptEnd && slotTime + slotDuration > apptStart) {
        slot.available = false;
      }
    }
  }

  // Filter by lead time
  const now = new Date();
  const leadTimeHours = settings.lead_time_hours || 24;
  const minTime = new Date(now.getTime() + leadTimeHours * 60 * 60 * 1000);

  if (new Date(date).toDateString() === now.toDateString()) {
    for (const slot of slots) {
      const [slotHour, slotMin] = slot.time.split(':').map(Number);
      const slotDate = new Date(date);
      slotDate.setHours(slotHour, slotMin, 0, 0);

      if (slotDate < minTime) {
        slot.available = false;
      }
    }
  }

  return slots.filter(s => s.available);
}

/**
 * Get available dates for the next N days
 */
export async function getAvailableDates(companyId: string, days = 30) {
  const settings = await getBookingSettings(companyId);
  const dates: Array<{ date: string; dayOfWeek: string }> = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const maxDaysOut = settings.max_days_out || 30;
  const workingHours = typeof settings.working_hours === 'string'
    ? JSON.parse(settings.working_hours)
    : settings.working_hours;

  for (let i = 0; i < Math.min(days, maxDaysOut); i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);

    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const daySettings = workingHours[dayOfWeek];

    if (daySettings?.enabled) {
      dates.push({
        date: date.toISOString().split('T')[0],
        dayOfWeek,
      });
    }
  }

  return dates;
}

// ============================================
// BOOKING SUBMISSION
// ============================================

/**
 * Create a booking (public endpoint)
 */
export async function createBooking(companyId: string, data: {
  serviceId?: string;
  date: string;
  time: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  notes?: string;
}) {
  const {
    serviceId, date, time, firstName, lastName, email,
    phone, address, city, state, zip, notes,
  } = data;

  // The /dates helper only offers future working days, but a direct POST can send
  // any date — reject anything before today so bookings can't be injected in the
  // past (BOOK-04). Basic shape check too, so a bad date doesn't crash later.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date)) || !/^\d{2}:\d{2}/.test(String(time || ''))) {
    throw new Error('A valid date and time are required.');
  }
  if (String(date) < new Date().toISOString().slice(0, 10)) {
    throw new Error('That date is in the past.');
  }

  // Validate slot availability
  const slots = await getAvailableSlots(companyId, date, serviceId);
  const slot = slots.find(s => s.time === time);

  if (!slot) {
    throw new Error('Selected time slot is no longer available');
  }

  // Get service details
  let service: any = null;
  if (serviceId) {
    const svcResult = await db.execute(sql`
      SELECT * FROM bookable_service WHERE id = ${serviceId} AND company_id = ${companyId} LIMIT 1
    `);
    service = ((svcResult as any).rows || svcResult)[0] || null;
  }

  // Find or create contact
  const existingContacts = await db.select()
    .from(contact)
    .where(and(eq(contact.companyId, companyId), eq(contact.email, email)))
    .limit(1);

  let theContact = existingContacts[0];

  if (!theContact) {
    const [newContact] = await db.insert(contact).values({
      companyId,
      name: `${firstName} ${lastName}`,
      email,
      phone: phone || null,
      address: address || null,
      city: city || null,
      state: state || null,
      zip: zip || null,
      type: 'lead',
      source: 'online_booking',
    }).returning();
    theContact = newContact;
  }

  // Build scheduled date in the salon's timezone, not the UTC server's. (CC-33)
  const [bset] = await db.select({ timezone: bookingSettings.timezone }).from(bookingSettings)
    .where(eq(bookingSettings.companyId, companyId)).limit(1);
  const scheduledDate = zonedWallTimeToUtc(String(date), time, bset?.timezone || 'America/Chicago');

  // Create the APPOINTMENT — this is what the front desk sees in The Book.
  // The bookable_service catalog is the widget's own; if a service-menu entry
  // with the same name exists, link it so the row carries its service name
  // (and the rebooking engine picks it up once a service record is written).
  const durationMin = service ? Number(service.duration_minutes) || 60 : 60;
  const endTimeDate = new Date(scheduledDate.getTime() + durationMin * 60000);

  let menuServiceId: string | null = null;
  if (service?.name) {
    const [menuMatch] = await db.select({ id: serviceMenu.id }).from(serviceMenu)
      .where(and(eq(serviceMenu.companyId, companyId), sql`lower(${serviceMenu.name}) = lower(${service.name})`))
      .limit(1);
    menuServiceId = menuMatch?.id || null;
  }

  const [newAppointment] = await db.insert(appointment).values({
    companyId,
    contactId: theContact.id,
    serviceId: menuServiceId,
    status: 'scheduled',
    startTime: scheduledDate,
    endTime: endTimeDate,
    quotedPrice: service?.price != null ? String(service.price) : null,
    notes: `Online booking: ${service?.name || 'service'}${notes ? ' — ' + notes : ''}`,
  }).returning();

  // Create booking record.
  // NOTE: this used to write customer_first_name/customer_last_name/
  // confirmation_code — columns online_booking does not have — so every
  // booking blew up here after the appointment and contact had already been created.
  const confirmationCode = generateConfirmationCode();
  const depositRequired = !!(service?.deposit_required) && Number(service?.deposit_amount || 0) > 0;
  const depositAmount = depositRequired ? Number(service.deposit_amount) : 0;
  const bookingId = createId();

  await db.execute(sql`
    INSERT INTO online_booking (
      id, company_id, appointment_id, contact_id, service_id, scheduled_date,
      customer_name, customer_email, customer_phone, notes, status,
      confirmation_code, deposit_amount, deposit_status, created_at, updated_at
    )
    VALUES (
      ${bookingId}, ${companyId}, ${newAppointment.id}, ${theContact.id}, ${serviceId || null},
      ${scheduledDate}, ${firstName + ' ' + lastName}, ${email}, ${phone || null},
      ${notes || null}, ${depositRequired ? 'pending' : 'confirmed'}, ${confirmationCode},
      ${String(depositAmount)}, ${depositRequired ? 'pending' : 'none'},
      NOW(), NOW()
    )
  `);

  // A booking that owes a deposit is not confirmed until it is paid.
  let deposit: { required: boolean; amount: number; clientSecret?: string; publishableKey?: string } = {
    required: depositRequired,
    amount: depositAmount,
  };

  if (depositRequired) {
    // The appointment stays 'scheduled' — deposit state lives on the
    // online_booking row, and the owner's Bookings list shows it as pending.
    try {
      const { createBookingDepositIntent } = await import('./stripe.ts');
      const intent = await createBookingDepositIntent({
        bookingId,
        companyId,
        amount: depositAmount,
        contactRow: theContact,
        description: `Deposit for ${service?.name || 'booking'}`,
      });
      if (intent?.clientSecret) {
        await db.execute(sql`
          UPDATE online_booking SET payment_intent_id = ${intent.paymentIntentId} WHERE id = ${bookingId}
        `);
        deposit = { ...deposit, clientSecret: intent.clientSecret, publishableKey: intent.publishableKey };
      }
    } catch (err: any) {
      // Card processing not configured, or Stripe refused. Keep the booking —
      // the owner can still collect the deposit by hand — but say so.
      console.error('[Booking] Deposit intent failed:', err?.message || err);
    }
  }

  return {
    appointment: newAppointment,
    serviceName: service?.name || 'Online Booking',
    contact: theContact,
    bookingId,
    confirmationCode,
    deposit,
  };
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
