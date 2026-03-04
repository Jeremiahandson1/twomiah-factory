import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({ type: z.string(), projectId: z.string(), scheduledDate: z.string().optional(), inspector: z.string().optional(), notes: z.string().optional() });

router.get('/', async (req, res, next) => {
  try {
    const { status, projectId, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (status) where.status = status; if (projectId) where.projectId = projectId;
    const [data, total] = await Promise.all([prisma.inspection.findMany({ where, include: { project: { select: { id: true, name: true } } }, orderBy: { scheduledDate: 'desc' }, skip: (page - 1) * limit, take: +limit }), prisma.inspection.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try { const data = schema.parse(req.body); const count = await prisma.inspection.count({ where: { companyId: req.user.companyId } }); const item = await prisma.inspection.create({ data: { ...data, number: `INS-${String(count + 1).padStart(4, '0')}`, scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : null, companyId: req.user.companyId } }); res.status(201).json(item); } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => { try { const data = schema.partial().parse(req.body); const item = await prisma.inspection.update({ where: { id: req.params.id }, data: { ...data, scheduledDate: data.scheduledDate ? new Date(data.scheduledDate) : undefined } }); res.json(item); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => { try { await prisma.inspection.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });
router.post('/:id/pass', async (req, res, next) => { try { const item = await prisma.inspection.update({ where: { id: req.params.id }, data: { status: 'passed', result: 'pass' } }); res.json(item); } catch (error) { next(error); } });
router.post('/:id/fail', async (req, res, next) => { try { const { deficiencies } = req.body; const item = await prisma.inspection.update({ where: { id: req.params.id }, data: { status: 'failed', result: 'fail', deficiencies } }); res.json(item); } catch (error) { next(error); } });

export default router;
