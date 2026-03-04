import { Router } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/', async (req, res, next) => { try { const company = await prisma.company.findUnique({ where: { id: req.user.companyId } }); res.json(company); } catch (error) { next(error); } });

router.put('/', requireAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ name: z.string().min(1).optional(), email: z.string().email().optional(), phone: z.string().optional(), address: z.string().optional(), city: z.string().optional(), state: z.string().optional(), zip: z.string().optional(), logo: z.string().optional(), primaryColor: z.string().optional(), website: z.string().optional(), licenseNumber: z.string().optional(), settings: z.record(z.any()).optional() });
    const data = schema.parse(req.body);
    const company = await prisma.company.update({ where: { id: req.user.companyId }, data });
    res.json(company);
  } catch (error) { next(error); }
});

router.put('/features', requireAdmin, async (req, res, next) => {
  try { const { features } = req.body; const company = await prisma.company.update({ where: { id: req.user.companyId }, data: { enabledFeatures: features } }); res.json(company); } catch (error) { next(error); }
});

// User management
router.get('/users', async (req, res, next) => {
  try { const users = await prisma.user.findMany({ where: { companyId: req.user.companyId }, select: { id: true, email: true, firstName: true, lastName: true, phone: true, role: true, isActive: true, lastLogin: true, createdAt: true } }); res.json(users); } catch (error) { next(error); }
});

router.post('/users', requireAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ email: z.string().email(), password: z.string().min(8), firstName: z.string().min(1), lastName: z.string().min(1), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).default('user') });
    const data = schema.parse(req.body);
    const existing = await prisma.user.findFirst({ where: { email: data.email, companyId: req.user.companyId } });
    if (existing) return res.status(409).json({ error: 'Email already exists' });
    const passwordHash = await bcrypt.hash(data.password, 12);
    const user = await prisma.user.create({ data: { ...data, passwordHash, companyId: req.user.companyId }, select: { id: true, email: true, firstName: true, lastName: true, role: true } });
    res.status(201).json(user);
  } catch (error) { next(error); }
});

router.put('/users/:id', requireAdmin, async (req, res, next) => {
  try {
    const schema = z.object({ firstName: z.string().optional(), lastName: z.string().optional(), phone: z.string().optional(), role: z.enum(['admin', 'manager', 'user', 'field']).optional(), isActive: z.boolean().optional() });
    const data = schema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.params.id }, data, select: { id: true, email: true, firstName: true, lastName: true, role: true, isActive: true } });
    res.json(user);
  } catch (error) { next(error); }
});

router.delete('/users/:id', requireAdmin, async (req, res, next) => {
  try { if (req.params.id === req.user.userId) return res.status(400).json({ error: 'Cannot delete yourself' }); await prisma.user.delete({ where: { id: req.params.id } }); res.status(204).send(); } catch (error) { next(error); }
});

export default router;
