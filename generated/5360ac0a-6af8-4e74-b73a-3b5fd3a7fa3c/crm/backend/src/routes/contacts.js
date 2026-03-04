import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import { emitToCompany, EVENTS } from '../services/socket.js';
import audit from '../services/audit.js';

const router = Router();
router.use(authenticate);

const schema = z.object({
  name: z.string().min(1),
  type: z.enum(['lead', 'client', 'subcontractor', 'vendor']).default('lead'),
  company: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
  phone: z.string().optional(),
  mobile: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  source: z.string().optional(),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional(),
});

router.get('/', requirePermission('contacts:read'), async (req, res, next) => {
  try {
    const { type, search, page = '1', limit = '25' } = req.query;
    const where = { companyId: req.user.companyId };
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { company: { contains: search, mode: 'insensitive' } },
      ];
    }
    const [data, total] = await Promise.all([
      prisma.contact.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (+page - 1) * +limit, take: +limit }),
      prisma.contact.count({ where }),
    ]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / +limit) } });
  } catch (error) { next(error); }
});

router.get('/stats', requirePermission('contacts:read'), async (req, res, next) => {
  try {
    const contacts = await prisma.contact.findMany({ where: { companyId: req.user.companyId }, select: { type: true } });
    const stats = { total: contacts.length, lead: 0, client: 0, subcontractor: 0, vendor: 0 };
    contacts.forEach(c => stats[c.type] = (stats[c.type] || 0) + 1);
    res.json(stats);
  } catch (error) { next(error); }
});

router.get('/:id', requirePermission('contacts:read'), async (req, res, next) => {
  try {
    const contact = await prisma.contact.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: {
        projects: { select: { id: true, name: true, status: true } },
        quotes: { select: { id: true, number: true, total: true, status: true } },
        invoices: { select: { id: true, number: true, total: true, amountPaid: true, status: true } },
      },
    });
    if (!contact) return res.status(404).json({ error: 'Contact not found' });
    res.json(contact);
  } catch (error) { next(error); }
});

router.post('/', requirePermission('contacts:create'), async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const contact = await prisma.contact.create({
      data: { ...data, companyId: req.user.companyId },
    });
    emitToCompany(req.user.companyId, EVENTS.CONTACT_CREATED, contact);
    audit.log({ action: audit.ACTIONS.CREATE, entity: 'contact', entityId: contact.id, entityName: contact.name, req });
    res.status(201).json(contact);
  } catch (error) { next(error); }
});

router.put('/:id', requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body);
    const existing = await prisma.contact.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data });
    emitToCompany(req.user.companyId, EVENTS.CONTACT_UPDATED, contact);
    const changes = audit.diff(existing, contact);
    if (changes) audit.log({ action: audit.ACTIONS.UPDATE, entity: 'contact', entityId: contact.id, entityName: contact.name, changes, req });
    res.json(contact);
  } catch (error) { next(error); }
});

router.delete('/:id', requirePermission('contacts:delete'), async (req, res, next) => {
  try {
    const existing = await prisma.contact.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    await prisma.contact.delete({ where: { id: req.params.id } });
    emitToCompany(req.user.companyId, EVENTS.CONTACT_DELETED, { id: req.params.id });
    audit.log({ action: audit.ACTIONS.DELETE, entity: 'contact', entityId: existing.id, entityName: existing.name, req });
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post('/:id/convert', requirePermission('contacts:update'), async (req, res, next) => {
  try {
    const existing = await prisma.contact.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Contact not found' });
    if (existing.type !== 'lead') return res.status(400).json({ error: 'Only leads can be converted' });
    const contact = await prisma.contact.update({ where: { id: req.params.id }, data: { type: 'client' } });
    emitToCompany(req.user.companyId, EVENTS.CONTACT_UPDATED, contact);
    audit.log({ action: audit.ACTIONS.STATUS_CHANGE, entity: 'contact', entityId: contact.id, entityName: contact.name, changes: { type: { old: 'lead', new: 'client' } }, req });
    res.json(contact);
  } catch (error) { next(error); }
});

export default router;
