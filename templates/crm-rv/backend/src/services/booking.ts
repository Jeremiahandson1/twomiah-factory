/**
 * Online Booking Service (Drizzle)
 *
 * Embeddable booking widget for customer websites:
 * - Public booking page (no auth required)
 * - Service selection
 * - Date/time slot picker
 * - Customer info collection
 * - Creates job in system
 *
 * NOTE: bookingSettings, bookableService, onlineBooking tables are not in the
 * current schema. This uses raw SQL for those. Add them to db/schema.ts for
 * full query-builder support.
 */

import { db } from '../../db/index.ts';
import { contact, job } from '../../db/schema.ts';
import { eq, and, gte, lte, count, ne, sql } from 'drizzle-orm';
import { createId } from '@paralleldrive/cuid2';

// ============================================
// BOOKING SETTINGS
// ============================================

/**
 * Get/create booking settings for a company
 */
export async function getBookingSettings(companyId: string) {
  const result = await db.execute(sql`
    SELECT * FROM booking_settings WHERE company_id = ${companyId} LIMIT 1
  `);
  const rows = (result as any).rows || result;

  if (rows.length > 0) return rows[0];

  // Create defaults
  const defaultSettings = {
    enabled: true,
    title: 'Book an Appointment',
    description: 'Schedule your service appointment online.',
    leadTimeHours: 24,
    maxDaysOut: 30,
    slotDurationMinutes: 60,
    workingHours: {
      monday: { start: '08:00', end: '17:00', enabled: true },
      tuesday: { start: '08:00', end: '17:00', enabled: true },
      wednesday: { start: '08:00', end: '17:00', enabled: true },
      thursday: { start: '08:00', end: '17:00', enabled: true },
      friday: { start: '08:00', end: '17:00', enabled: true },
      saturday: { start: '09:00', end: '14:00', enabled: false },
      sunday: { start: '09:00', end: '14:00', enabled: false },
    },
    requirePhone: true,
    requireAddress: true,
    sendConfirmationEmail: true,
    sendConfirmationSms: false,
    primaryColor: '{{PRIMARY_COLOR}}',
    logoUrl: null,
  };

  await db.execute(sql`
    INSERT INTO booking_settings (id, company_id, enabled, title, description, lead_time_hours, max_days_out, slot_duration_minutes, working_hours, require_phone, require_address, send_confirmation_email, send_confirmation_sms, primary_color, logo_url, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${companyId}, true,
      ${defaultSettings.title}, ${defaultSettings.description},
      ${defaultSettings.leadTimeHours}, ${defaultSettings.maxDaysOut}, ${defaultSettings.slotDurationMinutes},
      ${JSON.stringify(defaultSettings.workingHours)}::jsonb,
      ${defaultSettings.requirePhone}, ${defaultSettings.requireAddress},
      ${defaultSettings.sendConfirmationEmail}, ${defaultSettings.sendConfirmationSms},
      ${defaultSettings.primaryColor}, ${null},
      NOW(), NOW()
    )
  `);

  const created = await db.execute(sql`SELECT * FROM booking_settings WHERE company_id = ${companyId} LIMIT 1`);
  return ((created as any).rows || created)[0];
}

export async function updateBookingSettings(companyId: string, data: Record<string, unknown>) {
  const existing = await db.execute(sql`SELECT id FROM booking_settings WHERE company_id = ${companyId} LIMIT 1`);
  const rows = (existing as any).rows || existing;

  if (rows.length > 0) {
    // Build parameterized update
    const allowedCols = ['business_hours', 'slot_duration_minutes', 'buffer_minutes', 'advance_booking_days', 'require_approval', 'notifications_email'];
    for (const [key, value] of Object.entries(data)) {
      const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      if (!allowedCols.includes(colName)) continue;
      if (typeof value === 'object' && value !== null) {
        await db.execute(sql`UPDATE booking_settings SET ${sql.raw(`"${colName}"`)} = ${JSON.stringify(value)}::jsonb, updated_at = NOW() WHERE company_id = ${companyId}`);
      } else {
        await db.execute(sql`UPDATE booking_settings SET ${sql.raw(`"${colName}"`)} = ${value}, updated_at = NOW() WHERE company_id = ${companyId}`);
      }
    }
  } else {
    await getBookingSettings(companyId); // creates defaults
  }

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

// ============================================
// AVAILABILITY
// ============================================

/**
 * Get available time slots for a date
 */

// Abandoned deposit checkouts must not squat on bookable capacity: a booking
// still owing its deposit after the hold window is cancelled and its job
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
    RETURNING job_id
  `)
  const ids = ((expired as any).rows || []).map((r: any) => r.job_id).filter(Boolean)
  for (const id of ids) {
    await db.execute(sql`UPDATE job SET status = 'cancelled', updated_at = NOW() WHERE id = ${id}`)
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

  const existingJobs = await db.select({
    scheduledDate: job.scheduledDate,
    estimatedHours: job.estimatedHours,
  })
    .from(job)
    .where(and(
      eq(job.companyId, companyId),
      gte(job.scheduledDate, startOfDay),
      lte(job.scheduledDate, endOfDay),
      // cancelled work must not block the online calendar
      ne(job.status, 'cancelled'),
    ));

  // Mark unavailable slots
  for (const j of existingJobs) {
    if (!j.scheduledDate) continue;
    const jobTime = j.scheduledDate.getHours() * 60 + j.scheduledDate.getMinutes();
    const jobDuration = (Number(j.estimatedHours) || 1) * 60;

    for (const slot of slots) {
      const [slotHour, slotMin] = slot.time.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMin;

      if (slotTime < jobTime + jobDuration && slotTime + slotDuration > jobTime) {
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

  // Build scheduled date
  const [hour, min] = time.split(':').map(Number);
  const scheduledDate = new Date(date);
  scheduledDate.setHours(hour, min, 0, 0);

  // Create job
  const [{ value: jobCount }] = await db.select({ value: count() }).from(job).where(eq(job.companyId, companyId));
  const [newJob] = await db.insert(job).values({
    companyId,
    contactId: theContact.id,
    number: `JOB-${String(jobCount + 1).padStart(5, '0')}`,
    title: service?.name || 'Online Booking',
    description: notes || `Booked online for ${service?.name || 'service'}`,
    status: 'scheduled',
    priority: 'normal',
    scheduledDate,
    estimatedHours: service ? String(service.duration_minutes / 60) : '1',
    source: 'online_booking',
  }).returning();

  // Create booking record.
  // NOTE: this used to write customer_first_name/customer_last_name/
  // confirmation_code — columns online_booking does not have — so every
  // booking blew up here after the job and contact had already been created.
  const confirmationCode = generateConfirmationCode();
  const depositRequired = !!(service?.deposit_required) && Number(service?.deposit_amount || 0) > 0;
  const depositAmount = depositRequired ? Number(service.deposit_amount) : 0;
  const bookingId = createId();

  await db.execute(sql`
    INSERT INTO online_booking (
      id, company_id, job_id, contact_id, service_id, scheduled_date,
      customer_name, customer_email, customer_phone, notes, status,
      confirmation_code, deposit_amount, deposit_status, created_at, updated_at
    )
    VALUES (
      ${bookingId}, ${companyId}, ${newJob.id}, ${theContact.id}, ${serviceId || null},
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
    await db.update(job).set({ status: 'pending', updatedAt: new Date() }).where(eq(job.id, newJob.id));
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
    job: newJob,
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
    SELECT ob.*, bs.name AS service_name, j.number AS job_number
    FROM online_booking ob
    LEFT JOIN bookable_service bs ON ob.service_id = bs.id
    LEFT JOIN job j ON ob.job_id = j.id
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
  getAvailableSlots,
  getAvailableDates,
  createBooking,
  getBookings,
  getBookingByCode,
  getEmbedCode,
};
