import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({ date: z.string().optional(), projectId: z.string(), weather: z.string().optional(), temperature: z.number().optional(), conditions: z.string().optional(), crewSize: z.number().optional(), hoursWorked: z.number().optional(), workPerformed: z.string().optional(), materials: z.string().optional(), equipment: z.string().optional(), visitors: z.string().optional(), delays: z.string().optional(), safetyNotes: z.string().optional(), notes: z.string().optional() });

router.get('/', async (req, res, next) => {
  try {
    const { projectId, startDate, endDate, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (projectId) where.projectId = projectId;
    if (startDate || endDate) where.date = { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) };
    const [data, total] = await Promise.all([prisma.dailyLog.findMany({ where, include: { project: { select: { id: true, name: true } }, user: { select: { id: true, firstName: true, lastName: true } } }, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: +limit }), prisma.dailyLog.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => { try { const log = await prisma.dailyLog.findFirst({ where: { id: req.params.id, companyId: req.user.companyId }, include: { project: true, user: true } }); if (!log) return res.status(404).json({ error: 'Daily log not found' }); res.json(log); } catch (error) { next(error); } });

router.post('/', async (req, res, next) => {
  try { const data = schema.parse(req.body); const log = await prisma.dailyLog.create({ data: { ...data, date: data.date ? new Date(data.date) : new Date(), companyId: req.user.companyId, userId: req.user.userId } }); res.status(201).json(log); } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => { try { const data = schema.partial().parse(req.body); const log = await prisma.dailyLog.update({ where: { id: req.params.id }, data: { ...data, date: data.date ? new Date(data.date) : undefined } }); res.json(log); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => { try { await prisma.dailyLog.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });

export default router;
