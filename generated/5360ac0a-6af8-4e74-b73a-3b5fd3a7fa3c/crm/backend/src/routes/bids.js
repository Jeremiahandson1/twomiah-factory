import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

const schema = z.object({ projectName: z.string().min(1), client: z.string().optional(), bidType: z.enum(['lump_sum', 'unit_price', 'cost_plus', 'gmp', 'design_build']).default('lump_sum'), dueDate: z.string().optional(), dueTime: z.string().optional(), estimatedValue: z.number().optional(), bidAmount: z.number().optional(), bondRequired: z.boolean().default(false), prebidDate: z.string().optional(), prebidLocation: z.string().optional(), scope: z.string().optional(), notes: z.string().optional() });

router.get('/', async (req, res, next) => {
  try {
    const { status, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (status) where.status = status;
    const [data, total] = await Promise.all([prisma.bid.findMany({ where, orderBy: { dueDate: 'asc' }, skip: (page - 1) * limit, take: +limit }), prisma.bid.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/stats', async (req, res, next) => {
  try {
    const bids = await prisma.bid.findMany({ where: { companyId: req.user.companyId }, select: { status: true, bidAmount: true, estimatedValue: true } });
    const stats = { total: bids.length, draft: 0, submitted: 0, won: 0, lost: 0, pipelineValue: 0, wonValue: 0, winRate: 0 };
    let decided = 0;
    bids.forEach(b => { stats[b.status] = (stats[b.status] || 0) + 1; if (['draft', 'submitted', 'under_review'].includes(b.status)) stats.pipelineValue += Number(b.estimatedValue || b.bidAmount || 0); if (b.status === 'won') { stats.wonValue += Number(b.bidAmount || 0); decided++; } if (b.status === 'lost') decided++; });
    stats.winRate = decided > 0 ? Math.round((stats.won / decided) * 100) : 0;
    res.json(stats);
  } catch (error) { next(error); }
});

router.get('/:id', async (req, res, next) => { try { const bid = await prisma.bid.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } }); if (!bid) return res.status(404).json({ error: 'Bid not found' }); res.json(bid); } catch (error) { next(error); } });

router.post('/', async (req, res, next) => {
  try { const data = schema.parse(req.body); const count = await prisma.bid.count({ where: { companyId: req.user.companyId } }); const bid = await prisma.bid.create({ data: { ...data, number: `BID-${String(count + 1).padStart(4, '0')}`, dueDate: data.dueDate ? new Date(data.dueDate) : null, prebidDate: data.prebidDate ? new Date(data.prebidDate) : null, companyId: req.user.companyId } }); res.status(201).json(bid); } catch (error) { next(error); }
});

router.put('/:id', async (req, res, next) => { try { const data = schema.partial().parse(req.body); const bid = await prisma.bid.update({ where: { id: req.params.id }, data: { ...data, dueDate: data.dueDate ? new Date(data.dueDate) : undefined, prebidDate: data.prebidDate ? new Date(data.prebidDate) : undefined } }); res.json(bid); } catch (error) { next(error); } });
router.delete('/:id', async (req, res, next) => { try { await prisma.bid.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });
router.post('/:id/submit', async (req, res, next) => { try { const bid = await prisma.bid.update({ where: { id: req.params.id }, data: { status: 'submitted', submittedAt: new Date() } }); res.json(bid); } catch (error) { next(error); } });
router.post('/:id/won', async (req, res, next) => { try { const bid = await prisma.bid.update({ where: { id: req.params.id }, data: { status: 'won', resultDate: new Date() } }); res.json(bid); } catch (error) { next(error); } });
router.post('/:id/lost', async (req, res, next) => { try { const bid = await prisma.bid.update({ where: { id: req.params.id }, data: { status: 'lost', resultDate: new Date() } }); res.json(bid); } catch (error) { next(error); } });

export default router;
