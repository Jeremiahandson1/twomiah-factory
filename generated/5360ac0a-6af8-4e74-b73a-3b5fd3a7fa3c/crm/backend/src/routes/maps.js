import { Router } from 'express';
import { authenticate } from '../middleware/auth.js';
import { requirePermission, requireRole } from '../middleware/permissions.js';
import geocoding from '../services/geocoding.js';
import { prisma } from '../index.js';

const router = Router();
router.use(authenticate);

// Geocode an address
router.get('/geocode', requirePermission('jobs:read'), async (req, res, next) => {
  try {
    const { address } = req.query;
    
    if (!address) {
      return res.status(400).json({ error: 'Address required' });
    }
    
    const result = await geocoding.geocode(address);
    
    if (!result) {
      return res.status(404).json({ error: 'Address not found' });
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Reverse geocode coordinates
router.get('/reverse', requirePermission('jobs:read'), async (req, res, next) => {
  try {
    const { lat, lng } = req.query;
    
    if (!lat || !lng) {
      return res.status(400).json({ error: 'lat and lng required' });
    }
    
    const result = await geocoding.reverseGeocode(parseFloat(lat), parseFloat(lng));
    
    if (!result) {
      return res.status(404).json({ error: 'Location not found' });
    }
    
    res.json(result);
  } catch (error) {
    next(error);
  }
});

// Get all job locations for map view
router.get('/jobs', requirePermission('jobs:read'), async (req, res, next) => {
  try {
    const { status, assignedTo, date, projectId } = req.query;
    
    const where = { companyId: req.user.companyId };
    
    if (status) where.status = status;
    if (assignedTo) where.assignedToId = assignedTo;
    if (projectId) where.projectId = projectId;
    
    if (date) {
      const targetDate = new Date(date);
      const nextDate = new Date(targetDate);
      nextDate.setDate(nextDate.getDate() + 1);
      where.scheduledDate = {
        gte: targetDate,
        lt: nextDate,
      };
    }
    
    const jobs = await prisma.job.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        priority: true,
        scheduledDate: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        lat: true,
        lng: true,
        project: {
          select: {
            name: true,
            address: true,
            city: true,
            state: true,
            lat: true,
            lng: true,
          },
        },
        contact: {
          select: {
            name: true,
            address: true,
            city: true,
            state: true,
          },
        },
        assignedTo: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
      },
      orderBy: { scheduledDate: 'asc' },
    });
    
    // Map to location format, using project coords if job doesn't have them
    const locations = jobs.map(job => {
      const lat = job.lat || job.project?.lat;
      const lng = job.lng || job.project?.lng;
      const address = formatAddress(job) || formatAddress(job.project) || formatAddress(job.contact);
      
      return {
        id: job.id,
        number: job.number,
        title: job.title,
        status: job.status,
        priority: job.priority,
        scheduledDate: job.scheduledDate,
        address,
        lat,
        lng,
        hasCoordinates: !!(lat && lng),
        projectName: job.project?.name,
        contactName: job.contact?.name,
        assignedTo: job.assignedTo ? `${job.assignedTo.firstName} ${job.assignedTo.lastName}` : null,
      };
    });
    
    res.json({
      total: locations.length,
      withCoordinates: locations.filter(l => l.hasCoordinates).length,
      locations,
    });
  } catch (error) {
    next(error);
  }
});

// Get all project locations
router.get('/projects', requirePermission('projects:read'), async (req, res, next) => {
  try {
    const { status } = req.query;
    
    const where = { companyId: req.user.companyId };
    if (status) where.status = status;
    
    const projects = await prisma.project.findMany({
      where,
      select: {
        id: true,
        number: true,
        name: true,
        status: true,
        address: true,
        city: true,
        state: true,
        zip: true,
        lat: true,
        lng: true,
        contact: {
          select: { name: true },
        },
        _count: {
          select: { jobs: true },
        },
      },
      orderBy: { name: 'asc' },
    });
    
    const locations = projects.map(project => ({
      id: project.id,
      number: project.number,
      title: project.name,
      status: project.status,
      address: formatAddress(project),
      lat: project.lat,
      lng: project.lng,
      hasCoordinates: !!(project.lat && project.lng),
      contactName: project.contact?.name,
      jobCount: project._count.jobs,
    }));
    
    res.json({
      total: locations.length,
      withCoordinates: locations.filter(l => l.hasCoordinates).length,
      locations,
    });
  } catch (error) {
    next(error);
  }
});

// Geocode a specific job
router.post('/jobs/:jobId/geocode', requirePermission('jobs:update'), async (req, res, next) => {
  try {
    const { jobId } = req.params;
    
    const job = await prisma.job.findFirst({
      where: { id: jobId, companyId: req.user.companyId },
    });
    
    if (!job) {
      return res.status(404).json({ error: 'Job not found' });
    }
    
    const updated = await geocoding.geocodeJob(jobId);
    
    if (!updated) {
      return res.status(400).json({ error: 'Could not geocode job address' });
    }
    
    res.json({ lat: updated.lat, lng: updated.lng });
  } catch (error) {
    next(error);
  }
});

// Geocode a specific project
router.post('/projects/:projectId/geocode', requirePermission('projects:update'), async (req, res, next) => {
  try {
    const { projectId } = req.params;
    
    const project = await prisma.project.findFirst({
      where: { id: projectId, companyId: req.user.companyId },
    });
    
    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }
    
    const updated = await geocoding.geocodeProject(projectId);
    
    if (!updated) {
      return res.status(400).json({ error: 'Could not geocode project address' });
    }
    
    res.json({ lat: updated.lat, lng: updated.lng });
  } catch (error) {
    next(error);
  }
});

// Batch geocode all jobs (admin only)
router.post('/batch-geocode', requireRole('admin'), async (req, res, next) => {
  try {
    const { limit = 20 } = req.body;
    
    const results = await geocoding.geocodeAllJobs(req.user.companyId, Math.min(limit, 50));
    
    res.json({
      processed: results.length,
      successful: results.filter(r => r.success).length,
      results,
    });
  } catch (error) {
    next(error);
  }
});

// Calculate distance between two points
router.get('/distance', (req, res) => {
  const { lat1, lng1, lat2, lng2 } = req.query;
  
  if (!lat1 || !lng1 || !lat2 || !lng2) {
    return res.status(400).json({ error: 'lat1, lng1, lat2, lng2 required' });
  }
  
  const distance = geocoding.calculateDistance(
    parseFloat(lat1),
    parseFloat(lng1),
    parseFloat(lat2),
    parseFloat(lng2)
  );
  
  res.json({
    distance,
    unit: 'miles',
  });
});

function formatAddress(obj) {
  if (!obj) return null;
  const parts = [obj.address, obj.city, obj.state, obj.zip].filter(Boolean);
  return parts.length >= 2 ? parts.join(', ') : null;
}

export default router;
