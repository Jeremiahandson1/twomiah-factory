import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import comments from '../services/comments.js';

const router = Router();
router.use(authenticate);

// ============================================
// COMMENTS
// ============================================

// Get comments for an entity
router.get('/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const result = await comments.getComments(req.user.companyId, entityType, entityId);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Add a comment
router.post('/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const { content, mentions, attachments, parentId } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const comment = await comments.addComment({
      companyId: req.user.companyId,
      userId: req.user.userId,
      entityType,
      entityId,
      content: content.trim(),
      mentions: mentions || [],
      attachments: attachments || [],
      parentId,
    });

    res.status(201).json(comment);
  } catch (error) {
    next(error);
  }
});

// Update a comment
router.put('/:commentId', async (req, res, next) => {
  try {
    const { content } = req.body;

    if (!content?.trim()) {
      return res.status(400).json({ error: 'Content is required' });
    }

    const comment = await comments.updateComment(
      req.params.commentId,
      req.user.companyId,
      req.user.userId,
      content.trim()
    );

    res.json(comment);
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

// Delete a comment
router.delete('/:commentId', async (req, res, next) => {
  try {
    const isAdmin = ['admin', 'owner'].includes(req.user.role);
    await comments.deleteComment(
      req.params.commentId,
      req.user.companyId,
      req.user.userId,
      isAdmin
    );
    res.status(204).send();
  } catch (error) {
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    next(error);
  }
});

// React to a comment
router.post('/:commentId/react', async (req, res, next) => {
  try {
    const { reaction = 'like' } = req.body;
    const result = await comments.toggleReaction(
      req.params.commentId,
      req.user.userId,
      reaction
    );
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// ============================================
// ACTIVITY
// ============================================

// Get activity feed for company
router.get('/activity/feed', async (req, res, next) => {
  try {
    const { limit = '50', page = '1', types } = req.query;
    const entityTypes = types ? types.split(',') : null;

    const result = await comments.getActivityFeed(req.user.companyId, {
      limit: parseInt(limit),
      page: parseInt(page),
      entityTypes,
    });

    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get activity for specific entity
router.get('/activity/:entityType/:entityId', async (req, res, next) => {
  try {
    const { entityType, entityId } = req.params;
    const { limit = '50' } = req.query;

    const activities = await comments.getEntityActivity(
      req.user.companyId,
      entityType,
      entityId,
      { limit: parseInt(limit) }
    );

    res.json(activities);
  } catch (error) {
    next(error);
  }
});

// Get user's activity
router.get('/activity/user/:userId', async (req, res, next) => {
  try {
    const { limit = '50' } = req.query;
    const activities = await comments.getUserActivity(
      req.params.userId,
      req.user.companyId,
      { limit: parseInt(limit) }
    );
    res.json(activities);
  } catch (error) {
    next(error);
  }
});

export default router;
