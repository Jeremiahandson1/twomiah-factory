import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/caregivers
router.get('/', async (req, res, next) => {
  try {
    const { search, isActive = 'true', page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = { role: 'caregiver' };
    if (isActive !== 'all') where.isActive = isActive === 'true';
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
      ];
    }

    const [caregivers, total] = await Promise.all([
      prisma.user.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
        select: {
          id: true, firstName: true, lastName: true, email: true, phone: true,
          isActive: true, hireDate: true, defaultPayRate: true,
          certifications: true, certificationsExpiry: true,
          profile: { select: { npiNumber: true, evvWorkerId: true, availableMon: true, availableTue: true, availableWed: true, availableThu: true, availableFri: true, availableSat: true, availableSun: true } },
          availability: { select: { status: true, maxHoursPerWeek: true } },
        },
      }),
      prisma.user.count({ where }),
    ]);

    res.json({ caregivers, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/caregivers/:id
router.get('/:id', async (req, res, next) => {
  try {
    const caregiver = await prisma.user.findUniqueOrThrow({
      where: { id: req.params.id },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        isActive: true, hireDate: true, defaultPayRate: true, address: true, city: true, state: true, zip: true,
        latitude: true, longitude: true, certifications: true, certificationsExpiry: true,
        emergencyContactName: true, emergencyContactPhone: true,
        profile: true, availability: true,
        assignments: { where: { status: 'active' }, include: { client: { select: { firstName: true, lastName: true, address: true, city: true } } } },
        backgroundChecks: { orderBy: { createdAt: 'desc' }, take: 5 },
      },
    });
    res.json(caregiver);
  } catch (err) { next(err); }
});

// POST /api/caregivers - create caregiver account
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { password = 'Welcome1!', profile, ...data } = req.body;
    const passwordHash = await bcrypt.hash(password, 12);

    const caregiver = await prisma.user.create({
      data: {
        ...data,
        email: data.email.toLowerCase().trim(),
        passwordHash,
        role: 'caregiver',
        profile: profile ? { create: profile } : { create: {} },
        availability: { create: {} },
        notificationPrefs: { create: {} },
      },
      select: {
        id: true, email: true, firstName: true, lastName: true, phone: true,
        isActive: true, role: true, profile: true, availability: true,
      },
    });
    res.status(201).json(caregiver);
  } catch (err) { next(err); }
});

// PUT /api/caregivers/:id
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { profile, availability, password, ...data } = req.body;

    const updates = [
      prisma.user.update({ where: { id: req.params.id }, data }),
    ];
    if (profile) updates.push(prisma.caregiverProfile.upsert({ where: { caregiverId: req.params.id }, create: { ...profile, caregiverId: req.params.id }, update: profile }));
    if (availability) updates.push(prisma.caregiverAvailability.upsert({ where: { caregiverId: req.params.id }, create: { ...availability, caregiverId: req.params.id }, update: availability }));
    if (password) {
      const passwordHash = await bcrypt.hash(password, 12);
      updates.push(prisma.user.update({ where: { id: req.params.id }, data: { passwordHash } }));
    }

    await Promise.all(updates);
    const updated = await prisma.user.findUnique({ where: { id: req.params.id }, select: { id: true, email: true, firstName: true, lastName: true, isActive: true, profile: true, availability: true } });
    res.json(updated);
  } catch (err) { next(err); }
});

// GET /api/caregivers/:id/background-checks
router.get('/:id/background-checks', requireAdmin, async (req, res, next) => {
  try {
    const checks = await prisma.backgroundCheck.findMany({
      where: { caregiverId: req.params.id },
      orderBy: { createdAt: 'desc' },
    });
    // Strip encrypted fields
    const safe = checks.map(({ ssnEncrypted: _, driversLicenseEncrypted: __, ...c }) => c);
    res.json(safe);
  } catch (err) { next(err); }
});

// POST /api/caregivers/:id/background-checks
router.post('/:id/background-checks', requireAdmin, async (req, res, next) => {
  try {
    const check = await prisma.backgroundCheck.create({
      data: { ...req.body, caregiverId: req.params.id, createdById: req.user.userId },
    });
    const { ssnEncrypted: _, driversLicenseEncrypted: __, ...safe } = check;
    res.status(201).json(safe);
  } catch (err) { next(err); }
});

// PATCH /api/caregivers/:id/toggle-active
router.patch('/:id/toggle-active', requireAdmin, async (req, res, next) => {
  try {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select: { isActive: true } });
    const updated = await prisma.user.update({ where: { id: req.params.id }, data: { isActive: !user.isActive } });
    res.json({ isActive: updated.isActive });
  } catch (err) { next(err); }
});

export default router;
