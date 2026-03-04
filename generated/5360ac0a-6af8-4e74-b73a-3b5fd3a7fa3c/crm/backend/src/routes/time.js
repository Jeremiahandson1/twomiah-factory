import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({
  date: z.string().optional(),
  hours: z.number().positive(),
  hourlyRate: z.number().optional(),
  description: z.string().optional(),
  billable: z.boolean().default(true),
  projectId: z.string().optional(),
  jobId: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const { userId, projectId, jobId, startDate, endDate, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId };
    if (userId) where.userId = userId;
    if (projectId) where.projectId = projectId;
    if (jobId) where.jobId = jobId;
    if (startDate || endDate) where.date = { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) };
    const [data, total] = await Promise.all([
      prisma.timeEntry.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true } }, project: { select: { id: true, name: true } }, job: { select: { id: true, title: true } } }, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: +limit }),
      prisma.timeEntry.count({ where }),
    ]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const { startDate, endDate, userId } = req.query;
    const where = { companyId: req.user.companyId };
    if (userId) where.userId = userId;
    if (startDate || endDate) where.date = { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) };
    const entries = await prisma.timeEntry.findMany({ where, select: { hours: true, billable: true, hourlyRate: true } });
    const totalHours = entries.reduce((s, e) => s + Number(e.hours), 0);
    const billableHours = entries.filter(e => e.billable).reduce((s, e) => s + Number(e.hours), 0);
    const billableAmount = entries.filter(e => e.billable && e.hourlyRate).reduce((s, e) => s + Number(e.hours) * Number(e.hourlyRate), 0);
    res.json({ totalHours, billableHours, nonBillableHours: totalHours - billableHours, billableAmount, entries: entries.length });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const entry = await prisma.timeEntry.create({ data: { ...data, date: data.date ? new Date(data.date) : new Date(), companyId: req.user.companyId, userId: req.user.userId } });
    res.status(201).json(entry);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body);
    const existing = await prisma.timeEntry.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Time entry not found' });
    const entry = await prisma.timeEntry.update({ where: { id: req.params.id }, data: { ...data, date: data.date ? new Date(data.date) : undefined } });
    res.json(entry);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.timeEntry.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Time entry not found' });
    await prisma.timeEntry.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post('/:id/approve', async (req, res, next) => {
  try { const entry = await prisma.timeEntry.update({ where: { id: req.params.id }, data: { approved: true } }); res.json(entry); } catch (error) { next(error); }
});

export default router;
