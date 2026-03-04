import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

router.get('/templates', async (req, res, next) => {
  try {
    const templates = await prisma.formTemplate.findMany({
      where: { isActive: true },
      orderBy: [{ category: 'asc' }, { name: 'asc' }],
    });
    res.json(templates);
  } catch (err) { next(err); }
});

router.post('/templates', requireAdmin, async (req, res, next) => {
  try {
    const template = await prisma.formTemplate.create({ data: { ...req.body, createdById: req.user.userId } });
    res.status(201).json(template);
  } catch (err) { next(err); }
});

router.put('/templates/:id', requireAdmin, async (req, res, next) => {
  try {
    const template = await prisma.formTemplate.update({ where: { id: req.params.id }, data: req.body });
    res.json(template);
  } catch (err) { next(err); }
});

router.get('/submissions', async (req, res, next) => {
  try {
    const { entityType, entityId, templateId } = req.query;
    const where = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    if (templateId) where.templateId = templateId;
    const submissions = await prisma.formSubmission.findMany({
      where, orderBy: { createdAt: 'desc' },
      include: { template: { select: { name: true, category: true } }, submittedBy: { select: { firstName: true, lastName: true } } },
    });
    res.json(submissions);
  } catch (err) { next(err); }
});

router.post('/submissions', async (req, res, next) => {
  try {
    const submission = await prisma.formSubmission.create({
      data: {
        ...req.body,
        submittedById: req.user.userId,
        submittedByName: `${req.user.firstName} ${req.user.lastName}`,
        status: req.body.signature ? 'signed' : 'submitted',
        signedAt: req.body.signature ? new Date() : null,
      },
    });
    res.status(201).json(submission);
  } catch (err) { next(err); }
});

export default router;
