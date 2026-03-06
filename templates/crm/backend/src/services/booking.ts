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
import { eq, and, gte, lte, count, sql } from 'drizzle-orm';

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
    primaryColor: '#f97316',
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
    // Update existing
    const sets: string[] = [];
    for (const [key, value] of Object.entries(data)) {
      const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
      if (typeof value === 'object' && value !== null) {
        sets.push(`${colName} = '${JSON.stringify(value)}'::jsonb`);
      } else {
        sets.push(`${colName} = '${value}'`);
      }
    }
    if (sets.length > 0) {
      await db.execute(sql.raw(`UPDATE booking_settings SET ${sets.join(', ')}, updated_at = NOW() WHERE company_id = '${companyId}'`));
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
export async function getBookableServices(companyId: string) {
  const result = await db.execute(sql`
    SELECT * FROM bookable_service
    WHERE company_id = ${companyId} AND active = true
    ORDER BY sort_order ASC
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
  priceType?: string;
  sortOrder?: number;
}) {
  await db.execute(sql`
    INSERT INTO bookable_service (id, company_id, name, description, duration_minutes, price, price_type, active, sort_order, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${companyId}, ${data.name}, ${data.description || null},
      ${data.durationMinutes || 60}, ${data.price || 0}, ${data.priceType || 'starting_at'},
      true, ${data.sortOrder || 0}, NOW(), NOW()
    )
  `);
}

/**
 * Update bookable service
 */
export async function updateBookableService(serviceId: string, companyId: string, data: Record<string, unknown>) {
  const sets: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const colName = key.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase());
    sets.push(`${colName} = '${value}'`);
  }
  if (sets.length > 0) {
    await db.execute(sql.raw(`UPDATE bookable_service SET ${sets.join(', ')}, updated_at = NOW() WHERE id = '${serviceId}' AND company_id = '${companyId}'`));
  }
}

// ============================================
// AVAILABILITY
// ============================================

/**
 * Get available time slots for a date
 */
export async function getAvailableSlots(companyId: string, date: string, serviceId?: string) {
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

  // Create booking record
  const confirmationCode = generateConfirmationCode();
  await db.execute(sql`
    INSERT INTO online_booking (id, company_id, job_id, contact_id, service_id, scheduled_date, customer_first_name, customer_last_name, customer_email, customer_phone, notes, status, confirmation_code, created_at, updated_at)
    VALUES (
      gen_random_uuid(), ${companyId}, ${newJob.id}, ${theContact.id}, ${serviceId || null},
      ${scheduledDate}, ${firstName}, ${lastName}, ${email}, ${phone || null},
      ${notes || null}, 'confirmed', ${confirmationCode},
      NOW(), NOW()
    )
  `);

  return {
    job: newJob,
    contact: theContact,
    confirmationCode,
  };
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
  return `<!-- {{COMPANY_NAME}} Online Booking Widget -->
<div id="{{COMPANY_SLUG}}-booking"></div>
<script src="${process.env.FRONTEND_URL || 'https://{{COMPANY_DOMAIN}}'}/booking-widget.js"></script>
<script>
  {{COMPANY_NAME}}Booking.init({
    container: '#{{COMPANY_SLUG}}-booking',
    company: '${companySlug}',
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
  getEmbedCode,
};
