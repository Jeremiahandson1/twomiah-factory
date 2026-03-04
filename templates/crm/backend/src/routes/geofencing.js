import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import geofencing from '../services/geofencing.js';

const router = Router();
router.use(authenticate);

// ============================================
// GEOFENCE MANAGEMENT
// ============================================

// Get all geofences
router.get('/', async (req, res, next) => {
  try {
    const { active } = req.query;
    const geofences = await geofencing.getGeofences(
      req.user.companyId,
      { active: active === 'false' ? false : active === 'all' ? null : true }
    );
    res.json(geofences);
  } catch (error) {
    next(error);
  }
});

// Create geofence
router.post('/', requirePermission('settings:update'), async (req, res, next) => {
  try {
    const { name, lat, lng, radius, jobId, projectId, address } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const geofence = await geofencing.createGeofence({
      companyId: req.user.companyId,
      name: name || 'Job Site',
      lat: parseFloat(lat),
      lng: parseFloat(lng),
      radius: radius ? parseInt(radius) : 100,
      jobId,
      projectId,
      address,
    });

    res.status(201).json(geofence);
  } catch (error) {
    next(error);
  }
});

// Update geofence
router.put('/:id', requirePermission('settings:update'), async (req, res, next) => {
  try {
    const { name, lat, lng, radius, active } = req.body;

    const updates = {};
    if (name !== undefined) updates.name = name;
    if (lat !== undefined) updates.lat = parseFloat(lat);
    if (lng !== undefined) updates.lng = parseFloat(lng);
    if (radius !== undefined) updates.radius = parseInt(radius);
    if (active !== undefined) updates.active = active;

    await geofencing.updateGeofence(req.params.id, req.user.companyId, updates);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

// Delete geofence
router.delete('/:id', requirePermission('settings:update'), async (req, res, next) => {
  try {
    await geofencing.deleteGeofence(req.params.id, req.user.companyId);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

// ============================================
// LOCATION TRACKING
// ============================================

// Process location update (main endpoint for mobile app)
router.post('/location', async (req, res, next) => {
  try {
    const { lat, lng, accuracy } = req.body;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    // Check if user has location tracking enabled
    const settings = await geofencing.getLocationSettings(req.user.userId);
    
    if (!settings.locationTrackingEnabled) {
      return res.json({ actions: [], tracking: false });
    }

    const actions = await geofencing.processLocationUpdate(
      req.user.userId,
      req.user.companyId,
      { lat: parseFloat(lat), lng: parseFloat(lng), accuracy: parseFloat(accuracy) || 0 }
    );

    res.json({ actions, tracking: true });
  } catch (error) {
    next(error);
  }
});

// Find nearest geofence
router.get('/nearest', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const nearest = await geofencing.findNearestGeofence(
      req.user.companyId,
      parseFloat(lat),
      parseFloat(lng)
    );

    res.json(nearest);
  } catch (error) {
    next(error);
  }
});

// Check if inside any geofence
router.get('/check', async (req, res, next) => {
  try {
    const { lat, lng } = req.query;

    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng are required' });
    }

    const geofences = await geofencing.getGeofences(req.user.companyId, { active: true });
    const inside = [];

    for (const geofence of geofences) {
      if (geofencing.isInsideGeofence(parseFloat(lat), parseFloat(lng), geofence)) {
        inside.push({
          id: geofence.id,
          name: geofence.name,
          jobId: geofence.jobId,
          projectId: geofence.projectId,
        });
      }
    }

    res.json({ inside, count: inside.length });
  } catch (error) {
    next(error);
  }
});

// ============================================
// USER SETTINGS
// ============================================

// Get location settings
router.get('/settings', async (req, res, next) => {
  try {
    const settings = await geofencing.getLocationSettings(req.user.userId);
    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// Update location settings
router.put('/settings', async (req, res, next) => {
  try {
    const { locationTrackingEnabled, autoClockEnabled, locationAccuracy, trackingInterval } = req.body;

    const settings = await geofencing.updateLocationSettings(req.user.userId, {
      locationTrackingEnabled,
      autoClockEnabled,
      locationAccuracy,
      trackingInterval,
    });

    res.json(settings);
  } catch (error) {
    next(error);
  }
});

// ============================================
// HISTORY & REPORTS
// ============================================

// Get location history
router.get('/history', async (req, res, next) => {
  try {
    const { startDate, endDate, limit } = req.query;
    
    const history = await geofencing.getLocationHistory(
      req.user.userId,
      req.user.companyId,
      { startDate, endDate, limit: parseInt(limit) || 100 }
    );

    res.json(history);
  } catch (error) {
    next(error);
  }
});

// Get geofence events
router.get('/events', async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    
    const events = await geofencing.getGeofenceEvents(req.user.userId, {
      startDate,
      endDate,
    });

    res.json(events);
  } catch (error) {
    next(error);
  }
});

// Admin: Get user's location history
router.get('/history/:userId', requirePermission('team:read'), async (req, res, next) => {
  try {
    const { startDate, endDate, limit } = req.query;
    
    const history = await geofencing.getLocationHistory(
      req.params.userId,
      req.user.companyId,
      { startDate, endDate, limit: parseInt(limit) || 100 }
    );

    res.json(history);
  } catch (error) {
    next(error);
  }
});

export default router;
