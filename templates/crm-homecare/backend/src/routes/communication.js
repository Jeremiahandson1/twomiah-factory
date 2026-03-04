import { Router } from 'express';
import { prisma } from '../index.js';
import { authenticate, requireAdmin } from '../middleware/auth.js';

const router = Router();
router.use(authenticate);

// Communication Log
router.get('/log', async (req, res, next) => {
  try {
    const { entityType, entityId, page = 1, limit = 30 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const where = {};
    if (entityType) where.entityType = entityType;
    if (entityId) where.entityId = entityId;
    const [logs, total] = await Promise.all([
      prisma.communicationLog.findMany({
        where, skip, take: parseInt(limit), orderBy: [{ isPinned: 'desc' }, { createdAt: 'desc' }],
        include: { loggedBy: { select: { firstName: true, lastName: true } } },
      }),
      prisma.communicationLog.count({ where }),
    ]);
    res.json({ logs, total });
  } catch (err) { next(err); }
});

router.post('/log', async (req, res, next) => {
  try {
    const log = await prisma.communicationLog.create({
      data: {
        ...req.body,
        loggedById: req.user.userId,
        loggedByName: `${req.user.firstName} ${req.user.lastName}`,
      },
    });
    res.status(201).json(log);
  } catch (err) { next(err); }
});

router.patch('/log/:id/pin', async (req, res, next) => {
  try {
    const log = await prisma.communicationLog.findUniqueOrThrow({ where: { id: req.params.id } });
    const updated = await prisma.communicationLog.update({ where: { id: req.params.id }, data: { isPinned: !log.isPinned } });
    res.json(updated);
  } catch (err) { next(err); }
});

router.patch('/log/:id/follow-up', async (req, res, next) => {
  try {
    const updated = await prisma.communicationLog.update({ where: { id: req.params.id }, data: { followUpDone: true } });
    res.json(updated);
  } catch (err) { next(err); }
});

// Message Board - Threads
router.get('/threads', async (req, res, next) => {
  try {
    const threads = await prisma.messageThread.findMany({
      where: {
        participants: { some: { userId: req.user.userId } },
      },
      orderBy: { updatedAt: 'desc' },
      include: {
        participants: { include: { user: { select: { firstName: true, lastName: true } } } },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        _count: { select: { messages: true } },
      },
    });
    res.json(threads);
  } catch (err) { next(err); }
});

router.post('/threads', async (req, res, next) => {
  try {
    const { subject, threadType, isBroadcast, participantIds } = req.body;
    const allIds = [...new Set([req.user.userId, ...(participantIds || [])])];
    const thread = await prisma.messageThread.create({
      data: {
        subject, threadType, isBroadcast,
        createdById: req.user.userId,
        participants: { create: allIds.map(id => ({ userId: id })) },
      },
      include: { participants: true },
    });
    res.status(201).json(thread);
  } catch (err) { next(err); }
});

// Messages in thread
router.get('/threads/:id/messages', async (req, res, next) => {
  try {
    const messages = await prisma.message.findMany({
      where: { threadId: req.params.id, isDeleted: false },
      orderBy: { createdAt: 'asc' },
      include: { sender: { select: { firstName: true, lastName: true, role: true } } },
    });
    // Mark as read
    await prisma.messageThreadParticipant.updateMany({
      where: { threadId: req.params.id, userId: req.user.userId },
      data: { lastReadAt: new Date() },
    });
    res.json(messages);
  } catch (err) { next(err); }
});

router.post('/threads/:id/messages', async (req, res, next) => {
  try {
    const message = await prisma.message.create({
      data: { threadId: req.params.id, senderId: req.user.userId, body: req.body.body },
      include: { sender: { select: { firstName: true, lastName: true } } },
    });
    await prisma.messageThread.update({ where: { id: req.params.id }, data: { updatedAt: new Date() } });
    res.status(201).json(message);
  } catch (err) { next(err); }
});

export default router;
