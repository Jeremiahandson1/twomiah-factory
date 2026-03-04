import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({ description: z.string().min(1), projectId: z.string(), location: z.string().optional(), priority: z.enum(['low', 'normal', 'high', 'urgent']).default('normal'), assignedTo: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() });

router.get('/', async (req, res, next) => {
  try {
    const { status, projectId, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (status) where.status = status; if (projectId) where.projectId = projectId;
    const [data, total] = await Promise.all([prisma.punchListItem.findMany({ where, include: { project: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: +limit }), prisma.punchListItem.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => { try { const item = await prisma.punchListItem.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { project: true } }); if (!item) return res.status(404).json({ error: 'Punch list item not found' }); res.json(item); } catch (error) { next(error); } });

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const count = await prisma.punchListItem.count({ where: { companyId: req.user.companyId, projectId: data.projectId } });
    const item = await prisma.punchListItem.create({ data: { ...data, number: `PL-${String(count + 1).padStart(3, '0')}`, dueDate: data.dueDate ? new Date(data.dueDate) : null, companyId: req.user.companyId } });
    res.status(201).json(item);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => { try { const data = schema.partial().parse(req.body); const item = await prisma.punchListItem.update({ where: { id: req.params.id }, data: { ...data, dueDate: data.dueDate ? new Date(data.dueDate) : undefined } }); res.json(item); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => { try { await prisma.punchListItem.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });
router.post('/:id/complete', async (req, res, next) => { try { const item = await prisma.punchListItem.update({ where: { id: req.params.id }, data: { status: 'completed', completedAt: new Date() } }); res.json(item); } catch (error) { next(error); } });
router.post('/:id/verify', async (req, res, next) => { try { const { verifiedBy } = req.body; const item = await prisma.punchListItem.update({ where: { id: req.params.id }, data: { status: 'verified', verifiedAt: new Date(), verifiedBy } }); res.json(item); } catch (error) { next(error); } });

export default router;
