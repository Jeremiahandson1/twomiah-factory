import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../index.js';
import { authenticate } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/permissions.js';

const router = Router();
router.use(authenticate);

const schema = z.object({ name: z.string().min(1), email: z.string().email().optional(), phone: z.string().optional(), role: z.string().optional(), department: z.string().optional(), hireDate: z.string().optional(), hourlyRate: z.number().optional(), active: z.boolean().default(true), skills: z.array(z.string()).optional(), notes: z.string().optional() });

router.get('/', requirePermission('team:read'), async (req, res, next) => {
  try {
    const { active, department, page = '1', limit = '50' } = req.query;
    const where = { companyId: req.user.companyId }; if (active !== undefined) where.active = active === 'true'; if (department) where.department = department;
    const [data, total] = await Promise.all([prisma.teamMember.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * limit, take: +limit }), prisma.teamMember.count({ where })]);
    res.json({ data, pagination: { page: +page, limit: +limit, total, pages: Math.ceil(total / limit) } });
  } catch (error) { next(error); }
});

router.get('/:id', requirePermission('team:read'), async (req, res, next) => { try { const member = await prisma.teamMember.findFirst({ where: { id: req.params.id, companyId: req.user.companyId } }); if (!member) return res.status(404).json({ error: 'Team member not found' }); res.json(member); } catch (error) { next(error); } });

router.post('/', requirePermission('team:create'), async (req, res, next) => {
  try { const data = schema.parse(req.body); const member = await prisma.teamMember.create({ data: { ...data, hireDate: data.hireDate ? new Date(data.hireDate) : null, companyId: req.user.companyId } }); res.status(201).json(member); } catch (error) { next(error); }
});

router.put('/:id', requirePermission('team:update'), async (req, res, next) => { try { const data = schema.partial().parse(req.body); const member = await prisma.teamMember.update({ where: { id: req.params.id }, data: { ...data, hireDate: data.hireDate ? new Date(data.hireDate) : undefined } }); res.json(member); } catch (error) { next(error); } });
router.delete('/:id', requirePermission('team:delete'), async (req, res, next) => { try { await prisma.teamMember.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); } });

export default router;
