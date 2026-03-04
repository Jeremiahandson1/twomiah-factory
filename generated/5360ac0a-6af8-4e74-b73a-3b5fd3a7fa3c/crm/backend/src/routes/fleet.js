import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission } from '../middleware/permissions.js';
import fleet from '../services/fleet.js';

const router = Router();
router.use(authenticate);

// Vehicles
router.get('/vehicles', async (req, res, next) => {
  try {
    const data = await fleet.getVehicles(req.user.companyId, req.query);
    res.json(data);
  } catch (error) { next(error); }
});

router.get('/vehicles/:id', async (req, res, next) => {
  try {
    const vehicle = await fleet.getVehicle(req.params.id, req.user.companyId);
    if (!vehicle) return res.status(404).json({ error: 'Vehicle not found' });
    res.json(vehicle);
  } catch (error) { next(error); }
});

router.post('/vehicles', requirePermission('fleet:create'), async (req, res, next) => {
  try {
    const vehicle = await fleet.createVehicle(req.user.companyId, req.body);
    res.status(201).json(vehicle);
  } catch (error) { next(error); }
});

router.put('/vehicles/:id', requirePermission('fleet:update'), async (req, res, next) => {
  try {
    await fleet.updateVehicle(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.post('/vehicles/:id/assign', requirePermission('fleet:update'), async (req, res, next) => {
  try {
    await fleet.assignVehicle(req.params.id, req.user.companyId, req.body.userId);
    res.json({ success: true });
  } catch (error) { next(error); }
});

// Locations
router.get('/locations', async (req, res, next) => {
  try {
    const data = await fleet.getFleetLocations(req.user.companyId);
    res.json(data);
  } catch (error) { next(error); }
});

router.post('/vehicles/:id/location', async (req, res, next) => {
  try {
    await fleet.updateLocation(req.params.id, req.user.companyId, req.body);
    res.json({ success: true });
  } catch (error) { next(error); }
});

router.get('/vehicles/:id/location-history', async (req, res, next) => {
  try {
    const data = await fleet.getLocationHistory(req.params.id, req.user.companyId, req.query);
    res.json(data);
  } catch (error) { next(error); }
});

// Trips
router.get('/trips', async (req, res, next) => {
  try {
    const data = await fleet.getTrips(req.user.companyId, req.query);
    res.json(data);
  } catch (error) { next(error); }
});

router.post('/trips/start', async (req, res, next) => {
  try {
    const trip = await fleet.startTrip(req.body.vehicleId, req.user.companyId, {
      ...req.body,
      userId: req.user.userId,
    });
    res.status(201).json(trip);
  } catch (error) { next(error); }
});

router.post('/trips/:id/end', async (req, res, next) => {
  try {
    const trip = await fleet.endTrip(req.params.id, req.user.companyId, req.body);
    res.json(trip);
  } catch (error) { next(error); }
});

// Maintenance
router.get('/maintenance-due', async (req, res, next) => {
  try {
    const data = await fleet.getMaintenanceDue(req.user.companyId);
    res.json(data);
  } catch (error) { next(error); }
});

router.post('/vehicles/:id/maintenance', requirePermission('fleet:update'), async (req, res, next) => {
  try {
    const record = await fleet.addMaintenance(req.params.id, req.user.companyId, req.body);
    res.status(201).json(record);
  } catch (error) { next(error); }
});

// Fuel
router.post('/vehicles/:id/fuel', async (req, res, next) => {
  try {
    const entry = await fleet.addFuelEntry(req.params.id, req.user.companyId, req.body);
    res.status(201).json(entry);
  } catch (error) { next(error); }
});

router.get('/vehicles/:id/fuel-stats', async (req, res, next) => {
  try {
    const stats = await fleet.getFuelStats(req.params.id, req.user.companyId, req.query);
    res.json(stats);
  } catch (error) { next(error); }
});

// Stats
router.get('/stats', async (req, res, next) => {
  try {
    const stats = await fleet.getFleetStats(req.user.companyId);
    res.json(stats);
  } catch (error) { next(error); }
});

export default router;
