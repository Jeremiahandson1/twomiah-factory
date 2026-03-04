import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// GET /api/clients
router.get('/', async (req, res, next) => {
  try {
    const { search, isActive, serviceType, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where = {};
    if (isActive !== undefined) where.isActive = isActive === 'true';
    if (serviceType) where.serviceType = serviceType;
    if (search) {
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [clients, total] = await Promise.all([
      prisma.client.findMany({
        where,
        skip,
        take: parseInt(limit),
        orderBy: [{ isActive: 'desc' }, { lastName: 'asc' }],
        include: {
          emergencyContacts: { where: { isPrimary: true }, take: 1 },
          onboarding: { select: { allCompleted: true } },
          assignments: { where: { status: 'active' }, include: { caregiver: { select: { firstName: true, lastName: true } } } },
        },
      }),
      prisma.client.count({ where }),
    ]);

    // Strip SSN from list view
    const safeClients = clients.map(({ ssnEncrypted: _, ...c }) => c);
    res.json({ clients: safeClients, total, page: parseInt(page), pages: Math.ceil(total / parseInt(limit)) });
  } catch (err) { next(err); }
});

// GET /api/clients/:id
router.get('/:id', async (req, res, next) => {
  try {
    const client = await prisma.client.findUniqueOrThrow({
      where: { id: req.params.id },
      include: {
        emergencyContacts: true,
        onboarding: true,
        assignments: { include: { caregiver: { select: { id: true, firstName: true, lastName: true, phone: true } } } },
        referredBy: { select: { id: true, name: true, type: true } },
        geofence: true,
        authorizations: { where: { status: 'active' }, orderBy: { endDate: 'asc' } },
      },
    });
    const { ssnEncrypted: _, ...safeClient } = client;
    res.json(safeClient);
  } catch (err) { next(err); }
});

// POST /api/clients
router.post('/', requireAdmin, async (req, res, next) => {
  try {
    const { emergencyContacts, ...data } = req.body;
    const client = await prisma.client.create({
      data: {
        ...data,
        emergencyContacts: emergencyContacts?.length
          ? { create: emergencyContacts }
          : undefined,
        onboarding: { create: {} },
      },
      include: { emergencyContacts: true, onboarding: true },
    });
    res.status(201).json(client);
  } catch (err) { next(err); }
});

// PUT /api/clients/:id
router.put('/:id', requireAdmin, async (req, res, next) => {
  try {
    const { emergencyContacts, onboarding, ...data } = req.body;
    const client = await prisma.client.update({
      where: { id: req.params.id },
      data,
      include: { emergencyContacts: true, onboarding: true },
    });
    res.json(client);
  } catch (err) { next(err); }
});

// PATCH /api/clients/:id/onboarding
router.patch('/:id/onboarding', requireAdmin, async (req, res, next) => {
  try {
    const data = req.body;
    const allFields = ['emergencyContactsCompleted', 'medicalHistoryCompleted', 'insuranceInfoCompleted', 'carePreferencesCompleted', 'familyCommunicationCompleted', 'initialAssessmentCompleted'];
    const allCompleted = allFields.every(f => data[f] === true);
    const updated = await prisma.clientOnboarding.update({
      where: { clientId: req.params.id },
      data: { ...data, allCompleted, completedAt: allCompleted ? new Date() : null },
    });
    res.json(updated);
  } catch (err) { next(err); }
});

// POST /api/clients/:id/emergency-contacts
router.post('/:id/emergency-contacts', requireAdmin, async (req, res, next) => {
  try {
    const contact = await prisma.clientEmergencyContact.create({
      data: { ...req.body, clientId: req.params.id },
    });
    res.status(201).json(contact);
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id/emergency-contacts/:contactId
router.delete('/:id/emergency-contacts/:contactId', requireAdmin, async (req, res, next) => {
  try {
    await prisma.clientEmergencyContact.delete({ where: { id: req.params.contactId } });
    res.json({ message: 'Deleted' });
  } catch (err) { next(err); }
});

// POST /api/clients/:id/assignments
router.post('/:id/assignments', requireAdmin, async (req, res, next) => {
  try {
    const assignment = await prisma.clientAssignment.create({
      data: { ...req.body, clientId: req.params.id },
      include: { caregiver: { select: { id: true, firstName: true, lastName: true } } },
    });
    res.status(201).json(assignment);
  } catch (err) { next(err); }
});

// PATCH /api/clients/assignments/:assignmentId
router.patch('/assignments/:assignmentId', requireAdmin, async (req, res, next) => {
  try {
    const assignment = await prisma.clientAssignment.update({
      where: { id: req.params.assignmentId },
      data: req.body,
    });
    res.json(assignment);
  } catch (err) { next(err); }
});

// DELETE /api/clients/:id
router.delete('/:id', requireAdmin, async (req, res, next) => {
  try {
    await prisma.client.update({ where: { id: req.params.id }, data: { isActive: false } });
    res.json({ message: 'Client deactivated' });
  } catch (err) { next(err); }
});

export default router;
