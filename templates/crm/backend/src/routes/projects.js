import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  status: z.enum(['planning', 'active', 'on_hold', 'completed', 'cancelled']).default('planning'),
  type: z.string().optional(),
  address: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  zip: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  estimatedValue: z.number().optional(),
  budget: z.number().optional(),
  contactId: z.string().optional(),
  notes: z.string().optional(),
});

router.get('/', async (req, res, next) => {
  try {
    const { status, search, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId };
    if (status) where.status = status;
    if (search) where.OR = [{ name: { contains: search, mode: 'insensitive' } }, { number: { contains: search, mode: 'insensitive' } }];
    const [data, total] = await Promise.all([
      prisma.project.findMany({ where, include: { contact: { select: { id: true, name: true } } }, orderBy: { createdAt: 'desc' }, skip: (page - 1) * limit, take: +limit }),
      prisma.project.count({ where }),
    ]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const projects = await prisma.project.findMany({ where: { companyId: req.user.companyId }, select: { status: true, estimatedValue: true, budget: true } });
    const stats = { total: projects.length, planning: 0, active: 0, completed: 0, totalValue: 0 };
    projects.forEach(p => { stats[p.status] = (stats[p.status] || 0) + 1; stats.totalValue += Number(p.estimatedValue || 0); });
    res.json(stats);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => {
  try {
    const project = await prisma.project.findFirst({
      where: { id: req.params.id, companyId: req.user.companyId },
      include: { contact: true, jobs: { take: 10, orderBy: { createdAt: 'desc' } }, rfis: { take: 10 }, changeOrders: { take: 10 }, punchListItems: { take: 20 } },
    });
    if (!project) return res.status(404).json({ error: 'Project not found' });
    res.json(project);
  } catch (error) { next(error); }
});

router.post('/', async (req, res, next) => {
  try {
    const data = schema.parse(req.body);
    const count = await prisma.project.count({ where: { companyId: req.user.companyId } });
    const project = await prisma.project.create({
      data: { ...data, number: `PRJ-${String(count + 1).padStart(4, '0')}`, startDate: data.startDate ? new Date(data.startDate) : null, endDate: data.endDate ? new Date(data.endDate) : null, companyId: req.user.companyId },
    });
    res.status(201).json(project);
  } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => {
  try {
    const data = schema.partial().parse(req.body);
    const existing = await prisma.project.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });
    const project = await prisma.project.update({ where: { id: req.params.id }, data: { ...data, startDate: data.startDate ? new Date(data.startDate) : undefined, endDate: data.endDate ? new Date(data.endDate) : undefined } });
    res.json(project);
  } catch (error) { next(error); }
});

router.delete('/:id', async (req, res, next) => {
  try {
    const existing = await prisma.project.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } });
    if (!existing) return res.status(404).json({ error: 'Project not found' });
    await prisma.project.delete({ where: { id: req.params.id } });
    res.status(204).send();
  } catch (error) { next(error); }
});

export default router;
