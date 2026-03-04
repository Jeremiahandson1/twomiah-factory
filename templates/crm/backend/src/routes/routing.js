import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import routing from '../services/routing.js';
import { PrismaClient } from '@prisma/client';

const router = Router();
const prisma = new PrismaClient();

router.use(authenticate);

/**
 * Calculate route between two points
 */
router.post('/calculate', async (req, res, next) => {
  try {
    const { origin, destination } = req.body;

    if (!origin?.lat || !origin?.lng || !destination?.lat || !destination?.lng) {
      return res.status(400).json({ error: 'Origin and destination with lat/lng are required' });
    }

    const route = await routing.getRoute(origin, destination);
    const fuelCost = routing.calculateFuelCost(route.distanceMiles);

    res.json({
      ...route,
      fuelCost,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * Optimize route for multiple stops
 */
router.post('/optimize', async (req, res, next) => {
  try {
    const { stops, startLocation } = req.body;

    if (!stops || !Array.isArray(stops) || stops.length < 2) {
      return res.status(400).json({ error: 'At least 2 stops are required' });
    }

    // Validate stops have coordinates
    const validStops = stops.filter(s => s.lat && s.lng);
    if (validStops.length < 2) {
      return res.status(400).json({ error: 'Stops must have lat/lng coordinates' });
    }

    const result = await routing.optimizeRoute(validStops, startLocation);
    
    // Add fuel cost
    result.fuelCost = routing.calculateFuelCost(result.totalDistanceMiles);
    result.googleMapsUrl = routing.generateGoogleMapsUrl(result.optimizedOrder);

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Optimize route for a specific day
 */
router.get('/optimize-day', async (req, res, next) => {
  try {
    const { date, userId } = req.query;

    const targetDate = date ? new Date(date) : new Date();
    const targetUserId = userId || req.user.userId;

    const result = await routing.optimizeDayRoute(
      req.user.companyId,
      targetUserId,
      targetDate,
      prisma
    );

    res.json(result);
  } catch (error) {
    next(error);
  }
});

/**
 * Get Google Maps navigation URL
 */
router.post('/navigation-url', async (req, res, next) => {
  try {
    const { stops } = req.body;

    if (!stops || stops.length === 0) {
      return res.status(400).json({ error: 'Stops are required' });
    }

    const url = routing.generateGoogleMapsUrl(stops);
    res.json({ url });
  } catch (error) {
    next(error);
  }
});

/**
 * Calculate fuel cost
 */
router.get('/fuel-cost', async (req, res, next) => {
  try {
    const { miles, mpg, fuelPrice } = req.query;

    if (!miles) {
      return res.status(400).json({ error: 'Miles parameter is required' });
    }

    const cost = routing.calculateFuelCost(
      parseFloat(miles),
      mpg ? parseFloat(mpg) : undefined,
      fuelPrice ? parseFloat(fuelPrice) : undefined
    );

    res.json(cost);
  } catch (error) {
    next(error);
  }
});

/**
 * Get team's routes for a day (dispatcher view)
 */
router.get('/team-routes', async (req, res, next) => {
  try {
    const { date } = req.query;
    const targetDate = date ? new Date(date) : new Date();

    // Get all team members
    const teamMembers = await prisma.user.findMany({
      where: { companyId: req.user.companyId, active: true },
      select: { id: true, firstName: true, lastName: true },
    });

    // Get optimized routes for each team member
    const routes = await Promise.all(
      teamMembers.map(async (user) => {
        try {
          const result = await routing.optimizeDayRoute(
            req.user.companyId,
            user.id,
            targetDate,
            prisma
          );
          return {
            user,
            ...result,
          };
        } catch (error) {
          return {
            user,
            error: error.message,
          };
        }
      })
    );

    // Filter out users with no jobs
    const activeRoutes = routes.filter(r => r.jobs?.length > 0);

    res.json({
      date: targetDate.toISOString().split('T')[0],
      routes: activeRoutes,
      totalJobs: activeRoutes.reduce((sum, r) => sum + (r.jobs?.length || 0), 0),
      totalMiles: activeRoutes.reduce((sum, r) => sum + (r.optimizedRoute?.totalDistanceMiles || 0), 0),
    });
  } catch (error) {
    next(error);
  }
});

export default router;
