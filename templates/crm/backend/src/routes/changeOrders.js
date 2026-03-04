import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const lineItemSchema = z.object({ description: z.string().min(1), quantity: z.number().default(1), unitPrice: z.number().default(0) });
const schema = z.object({ title: z.string().min(1), description: z.string().optional(), projectId: z.string(), reason: z.string().optional(), daysAdded: z.number().default(0), lineItems: z.array(lineItemSchema).default([]) });

router.get('/', async (req, res, next) => {
  try {
    const { status, projectId, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (status) where.status = status; if (projectId) where.projectId = projectId;
    const [data, total] = await Promise.all([prisma.changeOrder.findMany({ where, include: { project: { select: { id: true, name: true } }, lineItems: true }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: +limit }), prisma.changeOrder.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try { const co = await prisma.changeOrder.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { project: true, lineItems: { orderBy: { sortOrder: 'asc' } } } }); if (!co) return res.status(404).json({ error: 'Change order not found' }); res.json(co); } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body); const { lineItems, ...coData } = data;
    const amount = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0);
    const count = await prisma.changeOrder.count({ where: { companyId: req.user.companyId, projectId: data.projectId } });
    const co = await prisma.changeOrder.create({ data: { ...coData, number: `CO-${String(count + 1).padStart(3, '0')}`, amount, companyId: req.user.companyId, lineItems: { create: lineItems.map((item, i) => ({ ...item, total: item.quantity * item.unitPrice, sortOrder: i })) } }, include: { lineItems: true } });
    res.status(201).json(co);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body); const { lineItems, ...coData } = data;
    const existing = await prisma.changeOrder.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } }); if (!existing) return res.status(404).json({ error: 'Change order not found' });
    let amount = Number(existing.amount);
    if (lineItems) { await prisma.changeOrderLineItem.deleteMany({ where: { changeOrderId: req.params.id } }); amount = lineItems.reduce((s, i) => s + i.quantity * i.unitPrice, 0); }
    const co = await prisma.changeOrder.update({ where: { id: req.params.id }, data: { ...coData, amount, lineItems: lineItems ? { create: lineItems.map((item, i) => ({ ...item, total: item.quantity * item.unitPrice, sortOrder: i })) } : undefined }, include: { lineItems: true } });
    res.json(co);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => { try { await prisma.changeOrder.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });
router.post('/:id/submit', async (req, res, next) => { try { const co = await prisma.changeOrder.update({ where: { id: req.params.id }, data: { status: 'submitted', submittedDate: new Date() } }); res.json(co); } catch (error) { next(error); } });
router.post('/:id/approve', async (req, res, next) => { try { const { approvedBy } = req.body; const co = await prisma.changeOrder.update({ where: { id: req.params.id }, data: { status: 'approved', approvedDate: new Date(), approvedBy } }); res.json(co); } catch (error) { next(error); } });
router.post('/:id/reject', async (req, res, next) => { try { const co = await prisma.changeOrder.update({ where: { id: req.params.id }, data: { status: 'rejected' } }); res.json(co); } catch (error) { next(error); } });

export default router;
