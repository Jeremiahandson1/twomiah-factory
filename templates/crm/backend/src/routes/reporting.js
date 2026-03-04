import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import reporting from '../services/reporting.js';

const router = Router();
router.use(authenticate);

// Dashboard summary
router.get('/dashboard', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const summary = await reporting.getDashboardSummary(req.user.companyId);
    res.json(summary);
  } catch (error) {
    next(error);
  }
});

// Revenue overview
router.get('/revenue', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getRevenueOverview(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Revenue by month
router.get('/revenue/monthly', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { months = '12' } = req.query;
    const data = await reporting.getRevenueByMonth(req.user.companyId, { months: parseInt(months) });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Revenue by customer
router.get('/revenue/customers', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate, limit = '10' } = req.query;
    const data = await reporting.getRevenueByCustomer(req.user.companyId, { 
      startDate, 
      endDate, 
      limit: parseInt(limit) 
    });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Job statistics
router.get('/jobs', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getJobStats(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Jobs by type
router.get('/jobs/types', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getJobsByType(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Jobs by assignee
router.get('/jobs/assignees', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getJobsByAssignee(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Project statistics
router.get('/projects', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const data = await reporting.getProjectStats(req.user.companyId);
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Project profitability
router.get('/projects/profitability', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { limit = '10' } = req.query;
    const data = await reporting.getProjectProfitability(req.user.companyId, { limit: parseInt(limit) });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Team productivity
router.get('/team', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getTeamProductivity(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

// Quote statistics
router.get('/quotes', requirePermission('reports:read'), async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const data = await reporting.getQuoteStats(req.user.companyId, { startDate, endDate });
    res.json(data);
  } catch (error) {
    next(error);
  }
});

export default router;
