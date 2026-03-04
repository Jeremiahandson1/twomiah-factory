const express = require('express');
const Service = require('../models/Service');

const router = express.Router();

// GET /api/services - List all services
router.get('/', async (req, res) => {
  try {
    const services = await Service.findAll();
    res.json({
      success: true,
      data: services
    });
  } catch (err) {
    console.error('Error fetching services:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch services'
    });
  }
});

// GET /api/services/:slug - Get service by slug
router.get('/:slug', async (req, res) => {
  try {
    const service = await Service.findBySlug(req.params.slug);
    
    if (!service) {
      return res.status(404).json({
        success: false,
        message: 'Service not found'
      });
    }

    res.json({
      success: true,
      data: service
    });
  } catch (err) {
    console.error('Error fetching service:', err);
    res.status(500).json({
      success: false,
      message: 'Failed to fetch service'
    });
  }
});

module.exports = router;
