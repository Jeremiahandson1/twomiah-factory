/**
 * Online Booking Service
 * 
 * Embeddable booking widget for customer websites:
 * - Public booking page (no auth required)
 * - Service selection
 * - Date/time slot picker
 * - Customer info collection
 * - Creates job in system
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ============================================
// BOOKING SETTINGS
// ============================================

/**
 * Get/update booking settings for a company
 */
export async function getBookingSettings(companyId) {
  let settings = await prisma.bookingSettings.findUnique({
    where: { companyId },
  });

  if (!settings) {
    settings = await prisma.bookingSettings.create({
      data: {
        companyId,
        enabled: true,
        title: 'Book an Appointment',
        description: 'Schedule your service appointment online.',
        
        // Availability
        leadTimeHours: 24, // Minimum hours before appointment
        maxDaysOut: 30, // How far out can book
        slotDurationMinutes: 60,
        
        // Working hours (default 8am-5pm M-F)
        workingHours: {
          monday: { start: '08:00', end: '17:00', enabled: true },
          tuesday: { start: '08:00', end: '17:00', enabled: true },
          wednesday: { start: '08:00', end: '17:00', enabled: true },
          thursday: { start: '08:00', end: '17:00', enabled: true },
          friday: { start: '08:00', end: '17:00', enabled: true },
          saturday: { start: '09:00', end: '14:00', enabled: false },
          sunday: { start: '09:00', end: '14:00', enabled: false },
        },
        
        // Required fields
        requirePhone: true,
        requireAddress: true,
        
        // Confirmation
        sendConfirmationEmail: true,
        sendConfirmationSms: false,
        
        // Styling
        primaryColor: '#f97316',
        logoUrl: null,
      },
    });
  }

  return settings;
}

export async function updateBookingSettings(companyId, data) {
  return prisma.bookingSettings.upsert({
    where: { companyId },
    create: { companyId, ...data },
    update: data,
  });
}

// ============================================
// BOOKABLE SERVICES
// ============================================

/**
 * Get services available for online booking
 */
export async function getBookableServices(companyId) {
  return prisma.bookableService.findMany({
    where: { companyId, active: true },
    orderBy: { sortOrder: 'asc' },
  });
}

/**
 * Create bookable service
 */
export async function createBookableService(companyId, data) {
  return prisma.bookableService.create({
    data: {
      companyId,
      name: data.name,
      description: data.description,
      durationMinutes: data.durationMinutes || 60,
      price: data.price || 0,
      priceType: data.priceType || 'starting_at', // fixed, starting_at, call_for_quote
      active: true,
      sortOrder: data.sortOrder || 0,
    },
  });
}

/**
 * Update bookable service
 */
export async function updateBookableService(serviceId, companyId, data) {
  return prisma.bookableService.updateMany({
    where: { id: serviceId, companyId },
    data,
  });
}

// ============================================
// AVAILABILITY
// ============================================

/**
 * Get available time slots for a date
 */
export async function getAvailableSlots(companyId, date, serviceId) {
  const settings = await getBookingSettings(companyId);
  const service = serviceId ? await prisma.bookableService.findFirst({
    where: { id: serviceId, companyId },
  }) : null;

  const slotDuration = service?.durationMinutes || settings.slotDurationMinutes;
  const dayOfWeek = new Date(date).toLocaleDateString('en-US', { weekday: 'lowercase' });
  const daySettings = settings.workingHours[dayOfWeek];

  if (!daySettings?.enabled) {
    return []; // Not a working day
  }

  // Generate all possible slots
  const slots = [];
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

  const existingJobs = await prisma.job.findMany({
    where: {
      companyId,
      scheduledDate: { gte: startOfDay, lte: endOfDay },
      status: { notIn: ['cancelled'] },
    },
    select: { scheduledDate: true, estimatedHours: true },
  });

  // Mark unavailable slots
  for (const job of existingJobs) {
    if (!job.scheduledDate) continue;
    const jobTime = job.scheduledDate.getHours() * 60 + job.scheduledDate.getMinutes();
    const jobDuration = (job.estimatedHours || 1) * 60;

    for (const slot of slots) {
      const [slotHour, slotMin] = slot.time.split(':').map(Number);
      const slotTime = slotHour * 60 + slotMin;

      // Check for overlap
      if (slotTime < jobTime + jobDuration && slotTime + slotDuration > jobTime) {
        slot.available = false;
      }
    }
  }

  // Filter to lead time
  const now = new Date();
  const minTime = new Date(now.getTime() + settings.leadTimeHours * 60 * 60 * 1000);
  
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
export async function getAvailableDates(companyId, days = 30) {
  const settings = await getBookingSettings(companyId);
  const dates = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 0; i < Math.min(days, settings.maxDaysOut); i++) {
    const date = new Date(today);
    date.setDate(date.getDate() + i);
    
    const dayOfWeek = date.toLocaleDateString('en-US', { weekday: 'long' }).toLowerCase();
    const daySettings = settings.workingHours[dayOfWeek];

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
export async function createBooking(companyId, data) {
  const {
    serviceId,
    date,
    time,
    firstName,
    lastName,
    email,
    phone,
    address,
    city,
    state,
    zip,
    notes,
  } = data;

  // Validate slot is still available
  const slots = await getAvailableSlots(companyId, date, serviceId);
  const slot = slots.find(s => s.time === time);
  
  if (!slot) {
    throw new Error('Selected time slot is no longer available');
  }

  // Get service details
  const service = serviceId ? await prisma.bookableService.findFirst({
    where: { id: serviceId, companyId },
  }) : null;

  // Find or create contact
  let contact = await prisma.contact.findFirst({
    where: { companyId, email },
  });

  if (!contact) {
    contact = await prisma.contact.create({
      data: {
        companyId,
        name: `${firstName} ${lastName}`,
        email,
        phone,
        address,
        city,
        state,
        zip,
        type: 'lead',
        source: 'online_booking',
      },
    });
  }

  // Create scheduled date
  const [hour, min] = time.split(':').map(Number);
  const scheduledDate = new Date(date);
  scheduledDate.setHours(hour, min, 0, 0);

  // Create job
  const jobCount = await prisma.job.count({ where: { companyId } });
  const job = await prisma.job.create({
    data: {
      companyId,
      contactId: contact.id,
      number: `JOB-${String(jobCount + 1).padStart(5, '0')}`,
      title: service?.name || 'Online Booking',
      description: notes || `Booked online for ${service?.name || 'service'}`,
      status: 'scheduled',
      priority: 'normal',
      scheduledDate,
      estimatedHours: service ? service.durationMinutes / 60 : 1,
      source: 'online_booking',
    },
  });

  // Create booking record
  const booking = await prisma.onlineBooking.create({
    data: {
      companyId,
      jobId: job.id,
      contactId: contact.id,
      serviceId,
      
      scheduledDate,
      
      customerFirstName: firstName,
      customerLastName: lastName,
      customerEmail: email,
      customerPhone: phone,
      
      notes,
      status: 'confirmed',
      
      confirmationCode: generateConfirmationCode(),
    },
  });

  // TODO: Send confirmation email/SMS

  return {
    booking,
    job,
    contact,
    confirmationCode: booking.confirmationCode,
  };
}

function generateConfirmationCode() {
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
export function getEmbedCode(companyId, companySlug) {
  return `<!-- Twomiah Build Online Booking Widget -->
<div id="twomiah-build-booking"></div>
<script src="${process.env.FRONTEND_URL || 'https://app.twomiah-build.com'}/booking-widget.js"></script>
<script>
  Twomiah BuildBooking.init({
    container: '#twomiah-build-booking',
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
