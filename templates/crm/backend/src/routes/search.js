import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import search from '../services/search.js';

const router = Router();
router.use(authenticate);

// Global search
router.get('/', async (req, res, next) => {
  try {
    const { q, limit = '20', types } = req.query;
    
    const result = await search.globalSearch(
      req.user.companyId,
      q,
      {
        limit: Math.min(parseInt(limit), 50),
        types: types ? types.split(',') : null,
      }
    );
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Quick search (lighter)
router.get('/quick', async (req, res, next) => {
  try {
    const { q, limit = '10' } = req.query;
    const results = await search.quickSearch(
      req.user.companyId,
      q,
      Math.min(parseInt(limit), 20)
    );
    res.json(results);
  } catch (error) {
    next(error);
  }
});

// Recent items (for empty search state)
router.get('/recent', async (req, res, next) => {
  try {
    const { limit = '10' } = req.query;
    const results = await search.getRecentItems(
      req.user.companyId,
      Math.min(parseInt(limit), 20)
    );
    res.json(results);
  } catch (error) {
    next(error);
  }
});

export default router;
