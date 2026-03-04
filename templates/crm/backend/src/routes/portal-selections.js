import { Router } from 'express';
import selections from '../services/selections.js';

const router = Router();

// Client portal routes - authenticated via portal token
// These are called from the customer-facing portal

/**
 * Get selections for client
 */
router.get('/project/:projectId/selections', async (req, res, next) => {
  try {
    // req.portal is set by portal auth middleware
    if (!req.portal?.contactId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data = await selections.getClientSelections(
      req.params.projectId,
      req.portal.contactId
    );
    res.json(data);
  } catch (error) {
    if (error.message === 'Access denied') {
      return res.status(403).json({ error: 'Access denied' });
    }
    next(error);
  }
});

/**
 * Client makes a selection
 */
router.post('/project/:projectId/selections/:selectionId', async (req, res, next) => {
  try {
    if (!req.portal?.contactId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const { optionId, notes } = req.body;

    if (!optionId) {
      return res.status(400).json({ error: 'Option ID is required' });
    }

    const result = await selections.clientMakeSelection(
      req.params.projectId,
      req.params.selectionId,
      req.portal.contactId,
      { optionId, notes }
    );

    res.json(result);
  } catch (error) {
    if (error.message === 'Access denied') {
      return res.status(403).json({ error: 'Access denied' });
    }
    if (error.message === 'Selection cannot be changed') {
      return res.status(400).json({ error: error.message });
    }
    next(error);
  }
});

export default router;
