import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({
  date: z.string().optional(),
  category: z.enum(['materials', 'equipment', 'labor', 'travel', 'other']),
  vendor: z.string().optional(),
  description: z.string().min(1),
  amount: z.number().positive(),
  billable: z.boolean().default(false),
  reimbursable: z.boolean().default(false),
  receiptUrl: z.string().optional(),
  projectId: z.string().optional(),
  jobId: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const { category, projectId, startDate, endDate, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId };
    if (category) where.category = category;
    if (projectId) where.projectId = projectId;
    if (startDate || endDate) where.date = { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) };
    const [data, total] = await Promise.all([
      prisma.expense.findMany({ where, include: { project: { select: { id: true, name: true } }, job: { select: { id: true, title: true } } }, orderBy: { date: 'desc' }, skip: (page - 1) * limit, take: +limit }),
      prisma.expense.count({ where }),
    ]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/summary', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const where = { companyId: req.user.companyId };
    if (startDate || endDate) where.date = { ...(startDate && { gte: new Date(startDate) }), ...(endDate && { lte: new Date(endDate) }) };
    const expenses = await prisma.expense.groupBy({ by: ['category'], where, _sum: { amount: true }, _count: true });
    const total = expenses.reduce((s, e) => s + Number(e._sum.amount || 0), 0);
    res.json({ total, byCategory: Object.fromEntries(expenses.map(e => [e.category, { amount: Number(e._sum.amount), count: e._count }])) });
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const expense = await prisma.expense.create({ data: { ...data, date: data.date ? new Date(data.date) : new Date(), companyId: req.user.companyId } });
    res.status(201).json(expense);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body);
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { ...data, date: data.date ? new Date(data.date) : undefined } });
    res.json(expense);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.expense.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Expense not found' });
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});

router.post('/:id/reimburse', async (req, res, next) => {
  try { const expense = await prisma.expense.update({ where: { id: req.params.id }, data: { reimbursed: true } }); res.json(expense); } catch (error) { next(error); }
});

export default router;
