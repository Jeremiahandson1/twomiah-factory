const express = require('express');
const { body, query, validationResult } = require('express-validator');
const Lead = require('../models/Lead');

const router = express.Router();

// Validation middleware
const validate = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ 
      success: false, 
      errors: errors.array() 
    });
  }
  next();
};

// Contact form validation
const contactFormValidation = [
  body('firstName').trim().notEmpty().withMessage('First name is required'),
  body('lastName').trim().notEmpty().withMessage('Last name is required'),
  body('email').optional({ checkFalsy: true }).isEmail().withMessage('Invalid email'),
  body('phone').trim().notEmpty().withMessage('Phone is required'),
  body('services').isArray({ min: 1 }).withMessage('At least one service must be selected'),
];

// ===========================================
// PUBLIC ROUTES (Contact Form)
// ===========================================

// POST /api/leads - Submit contact form (public)
router.post('/', contactFormValidation, validate, async (req, res) => {
  try {
    const lead = await Lead.create({
      ...req.body,
      ipAddress: req.ip,
      userAgent: req.get('User-Agent'),
      referrer: req.get('Referrer')
    });

    res.status(201).json({
      success: true,
      message: 'Thank you! We\'ll be in touch shortly.',
      data: { uuid: lead.uuid }
    });
  } catch (err) {
    console.error('Error creating lead:', err);
    res.status(500).json({
      success: false,
      message: 'Something went wrong. Please try again or call us directly.'
    });
  }
});

// ===========================================
// ADMIN ROUTES (CRM - protected in future)
// ===========================================

// GET /api/leads - List all leads
router.get('/', async (req, res) => {
  try {
    const { status, source, search, page, limit, sortBy, sortOrder } = req.query;
    
    const result = await Lead.findAll({
      status,
      source,
      search,
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      sortBy,
      sortOrder
    });

    res.json({
      success: true,
      data: result
    });
  } catch (err) {
    console.error('Error fetching leads:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch leads'
    });
  }
});

// GET /api/leads/statuses - Get all lead statuses
router.get('/statuses', async (req, res) => {
  try {
    const statuses = await Lead.getStatuses();
    res.json({
      success: true,
      data: statuses
    });
  } catch (err) {
    console.error('Error fetching statuses:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch statuses'
    });
  }
});

// GET /api/leads/pipeline - Get pipeline summary
router.get('/pipeline', async (req, res) => {
  try {
    const pipeline = await Lead.getPipelineSummary();
    res.json({
      success: true,
      data: pipeline
    });
  } catch (err) {
    console.error('Error fetching pipeline:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch pipeline'
    });
  }
});

// GET /api/leads/:id - Get single lead
router.get('/:id', async (req, res) => {
  try {
    const id = req.params.id;
    // Check if it's a UUID or numeric ID
    const lead = id.includes('-') 
      ? await Lead.findByUuid(id)
      : await Lead.findById(parseInt(id));

    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (err) {
    console.error('Error fetching lead:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch lead'
    });
  }
});

// PATCH /api/leads/:id - Update lead
router.patch('/:id', async (req, res) => {
  try {
    const lead = await Lead.update(parseInt(req.params.id), req.body);
    
    if (!lead) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    res.json({
      success: true,
      data: lead
    });
  } catch (err) {
    console.error('Error updating lead:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to update lead'
    });
  }
});

// PATCH /api/leads/:id/status - Update lead status
router.patch('/:id/status', 
  body('status').notEmpty().withMessage('Status is required'),
  validate,
  async (req, res) => {
    try {
      const lead = await Lead.updateStatus(parseInt(req.params.id), req.body.status);
      
      res.json({
        success: true,
        data: lead
      });
    } catch (err) {
      console.error('Error updating lead status:', err);
      res.status(500).json({
        success: false,
        message: err.message || 'Failed to update lead status'
      });
    }
  }
);

// DELETE /api/leads/:id - Delete lead
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await Lead.delete(parseInt(req.params.id));
    
    if (!deleted) {
      return res.status(404).json({
        success: false,
        message: 'Lead not found'
      });
    }

    res.json({
      success: true,
      message: 'Lead deleted'
    });
  } catch (err) {
    console.error('Error deleting lead:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to delete lead'
    });
  }
});

module.exports = router;
