import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import recurringService from '../services/recurring.js';
import audit from '../services/audit.js';
import { prisma } from '../index.js';

const router = Router();
router.use(authenticate);

// Get all recurring invoices
router.get('/', requirePermission('invoices:read'), async (req, res, next) => {
  try {
    const { status, contactId, page = '1', limit = '25' } = req.query;

    const where = { companyId: req.user.companyId };
    if (status) where.status = status;
    if (contactId) where.contactId = contactId;

    const [data, total] = await Promise.all([
      prisma.recurringInvoice.findMany({
        where,
        include: {
          contact: { select: { id: true, name: true, email: true } },
          project: { select: { id: true, name: true, number: true } },
          _count: { select: { generatedInvoices: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (parseInt(page) - 1) * parseInt(limit),
        take: parseInt(limit),
      }),
      prisma.recurringInvoice.count({ where }),
    ]);

    res.json({
      data,
      pagination: {
        page: parseInt(page),
        limit: parseInt(limit),
        total,
        pages: Math.ceil(total / parseInt(limit)),
      },
    });
  } catch (error) {
    next(error);
  }
});

// Get recurring invoice stats
router.get('/stats', requirePermission('invoices:read'), async (req, res, next) => {
  try {
    const stats = await recurringService.getRecurringStats(req.user.companyId);
    res.json(stats);
  } catch (error) {
    next(error);
  }
});

// Get single recurring invoice
router.get('/:id', requirePermission('invoices:read'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: {
        contact: true,
        project: true,
        lineItems: { orderBy: { sortOrder: 'asc' } },
        generatedInvoices: {
          select: { id: true, number: true, status: true, total: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    res.json(recurring);
  } catch (error) {
    next(error);
  }
});

// Create recurring invoice
router.post('/', requirePermission('invoices:create'), async (req, res, next) => {
  try {
    const {
      contactId,
      projectId,
      frequency,
      startDate,
      endDate,
      dayOfMonth,
      dayOfWeek,
      lineItems,
      notes,
      terms,
      taxRate,
      discount,
      autoSend,
      paymentTermsDays,
    } = req.body;

    if (!contactId) {
      return res.status(400).json({ error: 'Contact is required' });
    }
    if (!frequency) {
      return res.status(400).json({ error: 'Frequency is required' });
    }
    if (!lineItems || lineItems.length === 0) {
      return res.status(400).json({ error: 'At least one line item is required' });
    }

    const recurring = await recurringService.createRecurring({
      companyId: req.user.companyId,
      contactId,
      projectId,
      frequency,
      startDate: startDate || new Date(),
      endDate,
      dayOfMonth,
      dayOfWeek,
      lineItems,
      notes,
      terms,
      taxRate,
      discount,
      autoSend,
      paymentTermsDays,
    });

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      entityName: `${recurring.frequency} - $${recurring.total}`,
      req,
    });

    res.status(201).json(recurring);
  } catch (error) {
    next(error);
  }
});

// Update recurring invoice
router.put('/:id', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const recurring = await recurringService.updateRecurring(
      req.params.id,
      req.user.companyId,
      req.body
    );

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    audit.log({
      action: audit.ACTIONS.UPDATE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      req,
    });

    res.json(recurring);
  } catch (error) {
    next(error);
  }
});

// Pause recurring invoice
router.post('/:id/pause', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    const updated = await prisma.recurringInvoice.update({
      where: { id: req.params.id },
      data: { status: 'paused' },
    });

    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      metadata: { from: recurring.status, to: 'paused' },
      req,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Resume recurring invoice
router.post('/:id/resume', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    // Recalculate next run date from now
    const nextRunDate = new Date();
    
    const updated = await prisma.recurringInvoice.update({
      where: { id: req.params.id },
      data: { 
        status: 'active',
        nextRunDate,
      },
    });

    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      metadata: { from: recurring.status, to: 'active' },
      req,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Cancel recurring invoice
router.post('/:id/cancel', requirePermission('invoices:update'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    const updated = await prisma.recurringInvoice.update({
      where: { id: req.params.id },
      data: { status: 'cancelled' },
    });

    audit.log({
      action: audit.ACTIONS.STATUS_CHANGE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      metadata: { from: recurring.status, to: 'cancelled' },
      req,
    });

    res.json(updated);
  } catch (error) {
    next(error);
  }
});

// Generate invoice now (manual trigger)
router.post('/:id/generate', requirePermission('invoices:create'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    const { invoice } = await recurringService.generateInvoice(req.params.id);

    audit.log({
      action: audit.ACTIONS.CREATE,
      entity: 'invoice',
      entityId: invoice.id,
      entityName: invoice.number,
      metadata: { source: 'recurring', recurringId: recurring.id },
      req,
    });

    res.status(201).json(invoice);
  } catch (error) {
    next(error);
  }
});

// Delete recurring invoice
router.delete('/:id', requirePermission('invoices:delete'), async (req, res, next) => {
  try {
    const recurring = await prisma.recurringInvoice.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
    });

    if (!recurring) {
      return res.status(404).json({ error: 'Recurring invoice not found' });
    }

    // Delete line items first
    await prisma.recurringInvoiceLineItem.deleteMany({
      where: { recurringInvoiceId: req.params.id },
    });

    await prisma.recurringInvoice.delete({
      where: { id: req.params.id },
    });

    audit.log({
      action: audit.ACTIONS.DELETE,
      entity: 'recurring_invoice',
      entityId: recurring.id,
      req,
    });

    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// Process all due recurring (cron endpoint - should be called by scheduler)
router.post('/process', async (req, res, next) => {
  try {
    // In production, secure this with an API key or internal-only access
    const cronSecret = req.headers['x-cron-secret'];
    if (process.env.CRON_SECRET && cronSecret !== process.env.CRON_SECRET) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const results = await recurringService.processDueRecurring();
    res.json(results);
  } catch (error) {
    next(error);
  }
});

export default router;
