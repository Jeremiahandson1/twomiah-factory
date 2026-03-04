import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import booking from '../services/booking.js';

const router = Router();

// ============================================
// PUBLIC ROUTES (no auth - for the widget)
// ============================================

/**
 * Get booking page info for a company (public)
 */
router.get('/public/:companySlug', async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { slug: req.params.companySlug },
      select: { id: true, name: true, logo: true, primaryColor: true },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const [settings, services] = await Promise.all([
      booking.getBookingSettings(company.id),
      booking.getBookableServices(company.id),
    ]);

    if (!settings.enabled) {
      return res.status(403).json({ error: 'Online booking is not enabled' });
    }

    res.json({
      company: {
        name: company.name,
        logo: company.logo || settings.logoUrl,
        primaryColor: company.primaryColor || settings.primaryColor,
      },
      settings: {
        title: settings.title,
        description: settings.description,
        requirePhone: settings.requirePhone,
        requireAddress: settings.requireAddress,
      },
      services,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get available dates (public)
 */
router.get('/public/:companySlug/dates', async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { slug: req.params.companySlug },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const dates = await booking.getAvailableDates(company.id);
    res.json(dates);
  } catch (error) {
    next(error);
  }
});

/**
 * Get available time slots for a date (public)
 */
router.get('/public/:companySlug/slots', async (req, res, next) => {
  try {
    const { date, serviceId } = req.query;

    if (!date) {
      return res.status(400).json({ error: 'Date required' });
    }

    const company = await prisma.company.findUnique({
      where: { slug: req.params.companySlug },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const slots = await booking.getAvailableSlots(company.id, date, serviceId);
    res.json(slots);
  } catch (error) {
    next(error);
  }
});

/**
 * Submit booking (public)
 */
const bookingSchema = z.object({
  serviceId: z.string().optional(),
  date: z.string(),
  time: z.string(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
  email: z.string().email(),
  phone: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  notes: z.string().optional(),
});

router.post('/public/:companySlug', async (req, res, next) => {
  try {
    const data = bookingSchema.parse(req.body);

    const company = await prisma.company.findUnique({
      where: { slug: req.params.companySlug },
    });

    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    const settings = await booking.getBookingSettings(company.id);
    
    // Validate required fields
    if (settings.requirePhone && !data.phone) {
      return res.status(400).json({ error: 'Phone number is required' });
    }
    if (settings.requireAddress && !data.address) {
      return res.status(400).json({ error: 'Address is required' });
    }

    const result = await booking.createBooking(company.id, data);

    res.status(201).json({
      success: true,
      confirmationCode: result.confirmationCode,
      appointment: {
        date: data.date,
        time: data.time,
        service: result.job.title,
      },
    });
  } catch (error) {
    if (error.message === 'Selected time slot is no longer available') {
      return res.status(409).json({ error: error.message });
    }
    next(error);
  }
});

// ============================================
// ADMIN ROUTES (authenticated)
// ============================================

router.use(authenticate);

/**
 * Get booking settings
 */
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await booking.getBookingSettings(req.user.companyId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

/**
 * Update booking settings
 */
router.put('/settings', async (req, res, next) => {
  try {
    const settings = await booking.updateBookingSettings(req.user.companyId, req.body);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

/**
 * Get bookable services
 */
router.get('/services', async (req, res, next) => {
  try {
    const services = await booking.getBookableServices(req.user.companyId);
    res.json(services);
  } catch (error) {
    next(error);
  }
});

/**
 * Create bookable service
 */
router.post('/services', async (req, res, next) => {
  try {
    const service = await booking.createBookableService(req.user.companyId, req.body);
    res.status(201).json(service);
  } catch (error) {
    next(error);
  }
});

/**
 * Update bookable service
 */
router.put('/services/:id', async (req, res, next) => {
  try {
    await booking.updateBookableService(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * Get all bookings
 */
router.get('/', async (req, res, next) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    
    const where = { companyId: req.user.companyId };
    if (status) where.status = status;

    const [bookings, total] = await Promise.all([
      prisma.onlineBooking.findMany({
        where,
        include: {
          job: { select: { id: true, number: true, title: true, status: true } },
          contact: { select: { id: true, name: true, email: true } },
          service: { select: { id: true, name: true } },
        },
        orderBy: { scheduledDate: 'desc' },
        skip: (page - 1) * limit,
        take: +limit,
      }),
      prisma.onlineBooking.count({ where }),
    ]);

    res.json({
      data: bookings,
      pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Get embed code
 */
router.get('/embed-code', async (req, res, next) => {
  try {
    const company = await prisma.company.findUnique({
      where: { id: req.user.companyId },
      select: { slug: true },
    });

    const embedCode = booking.getEmbedCode(req.user.companyId, company.slug);
    res.json({ embedCode });
  } catch (error) {
    next(error);
  }
});

export default router;
