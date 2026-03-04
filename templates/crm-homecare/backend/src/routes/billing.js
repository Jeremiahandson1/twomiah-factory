import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, requireAdmin);

// ── INVOICES ──────────────────────────────────────────────────────

router.get('/invoices', async (req, res, next) => {
  try {
    const { paymentStatus, clientId, startDate, endDate, page = 1, limit = 50 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (paymentStatus) where.paymentStatus = paymentStatus;
    if (clientId) where.clientId = clientId;
    if (startDate || endDate) {
      where.billingPeriodStart = {};
      if (startDate) where.billingPeriodStart.gte = new Date(startDate);
      if (endDate) where.billingPeriodStart.lte = new Date(endDate);
    }
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { createdAt: 'desc' },
        include: { client: { select: { firstName: true, lastName: true } }, lineItems: true },
      }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ invoices, total });
  } catch (err) { next(err); }
});

router.get('/invoices/:id', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.findUniqueOrThrow({
      where: { id: req.params.id },
      include: { client: true, lineItems: { include: { caregiver: { select: { firstName: true, lastName: true } } } } },
    });
    res.json(invoice);
  } catch (err) { next(err); }
});

router.post('/invoices', async (req, res, next) => {
  try {
    const { lineItems, ...data } = req.body;
    // Generate invoice number
    const count = await prisma.invoice.count();
    const invoiceNumber = `INV-${String(count + 1).padStart(5, '0')}`;
    const invoice = await prisma.invoice.create({
      data: {
        ...data,
        invoiceNumber,
        lineItems: lineItems ? { create: lineItems } : undefined,
      },
      include: { lineItems: true },
    });
    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

router.patch('/invoices/:id/status', async (req, res, next) => {
  try {
    const invoice = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { paymentStatus: req.body.status, paymentDate: req.body.paymentDate ? new Date(req.body.paymentDate) : undefined },
    });
    res.json(invoice);
  } catch (err) { next(err); }
});

// ── GENERATE INVOICE FROM TIME ENTRIES ───────────────────────────

router.post('/invoices/generate', async (req, res, next) => {
  try {
    const { clientId, startDate, endDate } = req.body;
    const entries = await prisma.timeEntry.findMany({
      where: { clientId, startTime: { gte: new Date(startDate), lte: new Date(endDate) }, isComplete: true },
      include: { caregiver: true },
    });
    if (!entries.length) return res.status(400).json({ error: 'No completed time entries in this period' });

    const assignment = await prisma.clientAssignment.findFirst({ where: { clientId, status: 'active' } });
    const rate = assignment?.payRate || 25.00;

    const lineItems = entries.map(e => ({
      caregiverId: e.caregiverId,
      timeEntryId: e.id,
      description: `${e.caregiver.firstName} ${e.caregiver.lastName} - Care Visit`,
      hours: Number((e.billableMinutes || e.durationMinutes || 0) / 60).toFixed(2),
      rate: Number(rate),
      amount: Number(((e.billableMinutes || e.durationMinutes || 0) / 60) * Number(rate)).toFixed(2),
    }));

    const subtotal = lineItems.reduce((s, l) => s + Number(l.amount), 0);
    const count = await prisma.invoice.count();
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${String(count + 1).padStart(5, '0')}`,
        clientId,
        billingPeriodStart: new Date(startDate),
        billingPeriodEnd: new Date(endDate),
        subtotal,
        total: subtotal,
        lineItems: { create: lineItems },
      },
      include: { lineItems: true, client: { select: { firstName: true, lastName: true } } },
    });
    res.status(201).json(invoice);
  } catch (err) { next(err); }
});

export default router;
