/**
 * GPS Geofencing Service
 * 
 * Auto clock in/out based on location:
 * - Define geofences around job sites
 * - Track user location
 * - Auto clock in when entering geofence
 * - Auto clock out when leaving geofence
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Default geofence radius in meters
const DEFAULT_RADIUS = 100;

// ============================================
// GEOFENCE MANAGEMENT
// ============================================

/**
 * Create a geofence for a job site
 */
export async function createGeofence({
  companyId,
  name,
  lat,
  lng,
  radius = DEFAULT_RADIUS,
  jobId,
  projectId,
  address,
}) {
  return prisma.geofence.create({
    data: {
      companyId,
      name,
      lat,
      lng,
      radius,
      jobId,
      projectId,
      address,
      active: true,
    },
  });
}

/**
 * Get all geofences for a company
 */
export async function getGeofences(companyId, { active = true } = {}) {
  return prisma.geofence.findMany({
    where: { 
      companyId,
      ...(active !== null ? { active } : {}),
    },
    include: {
      job: { select: { id: true, title: true, number: true } },
      project: { select: { id: true, name: true, number: true } },
    },
    orderBy: { createdAt: 'desc' },
  });
}

/**
 * Update a geofence
 */
export async function updateGeofence(geofenceId, companyId, data) {
  return prisma.geofence.updateMany({
    where: { id: geofenceId, companyId },
    data,
  });
}

/**
 * Delete a geofence
 */
export async function deleteGeofence(geofenceId, companyId) {
  return prisma.geofence.deleteMany({
    where: { id: geofenceId, companyId },
  });
}

/**
 * Auto-create geofence when job has location
 */
export async function autoCreateJobGeofence(job) {
  if (!job.lat || !job.lng) return null;

  // Check if geofence already exists
  const existing = await prisma.geofence.findFirst({
    where: { jobId: job.id },
  });

  if (existing) return existing;

  return createGeofence({
    companyId: job.companyId,
    name: job.title || `Job ${job.number}`,
    lat: job.lat,
    lng: job.lng,
    radius: DEFAULT_RADIUS,
    jobId: job.id,
    address: job.address,
  });
}

// ============================================
// LOCATION TRACKING
// ============================================

/**
 * Process location update from user
 * Returns any clock in/out actions taken
 */
export async function processLocationUpdate(userId, companyId, { lat, lng, accuracy }) {
  const actions = [];

  // Get active geofences
  const geofences = await getGeofences(companyId, { active: true });

  // Get user's current active time entry
  const activeEntry = await prisma.timeEntry.findFirst({
    where: {
      userId,
      companyId,
      status: 'active',
    },
  });

  // Check each geofence
  for (const geofence of geofences) {
    const distance = calculateDistance(lat, lng, geofence.lat, geofence.lng);
    const isInside = distance <= geofence.radius;

    // Get last known state for this geofence
    const lastState = await getLastGeofenceState(userId, geofence.id);
    const wasInside = lastState?.inside || false;

    // Record current state
    await recordGeofenceState(userId, geofence.id, isInside, { lat, lng, accuracy, distance });

    // Detect transitions
    if (isInside && !wasInside) {
      // ENTERED geofence - auto clock in
      if (!activeEntry) {
        const entry = await autoClockIn(userId, companyId, geofence);
        actions.push({
          type: 'clock_in',
          geofence: geofence.name,
          entryId: entry.id,
          jobId: geofence.jobId,
          projectId: geofence.projectId,
        });
      }
    } else if (!isInside && wasInside) {
      // LEFT geofence - auto clock out
      if (activeEntry && activeEntry.geofenceId === geofence.id) {
        const entry = await autoClockOut(activeEntry.id);
        actions.push({
          type: 'clock_out',
          geofence: geofence.name,
          entryId: entry.id,
          duration: entry.workedMinutes,
        });
      }
    }
  }

  // Log location for audit trail
  await logLocation(userId, companyId, { lat, lng, accuracy });

  return actions;
}

/**
 * Auto clock in when entering geofence
 */
async function autoClockIn(userId, companyId, geofence) {
  return prisma.timeEntry.create({
    data: {
      userId,
      companyId,
      jobId: geofence.jobId,
      projectId: geofence.projectId,
      geofenceId: geofence.id,
      startTime: new Date(),
      status: 'active',
      isManual: false,
      isAutoClocked: true,
      notes: `Auto clocked in at ${geofence.name}`,
    },
  });
}

/**
 * Auto clock out when leaving geofence
 */
async function autoClockOut(entryId) {
  const entry = await prisma.timeEntry.findUnique({ where: { id: entryId } });
  if (!entry) return null;

  const endTime = new Date();
  const totalMinutes = Math.round((endTime - new Date(entry.startTime)) / 60000);
  const workedMinutes = totalMinutes - (entry.breakMinutes || 0);

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      endTime,
      totalMinutes,
      workedMinutes,
      status: 'completed',
      notes: entry.notes ? `${entry.notes} | Auto clocked out` : 'Auto clocked out',
    },
  });
}

/**
 * Get last geofence state for user
 */
async function getLastGeofenceState(userId, geofenceId) {
  return prisma.geofenceEvent.findFirst({
    where: { userId, geofenceId },
    orderBy: { timestamp: 'desc' },
  });
}

/**
 * Record geofence state
 */
async function recordGeofenceState(userId, geofenceId, inside, location) {
  return prisma.geofenceEvent.create({
    data: {
      userId,
      geofenceId,
      inside,
      lat: location.lat,
      lng: location.lng,
      accuracy: location.accuracy,
      distance: location.distance,
      timestamp: new Date(),
    },
  });
}

/**
 * Log location for audit trail
 */
async function logLocation(userId, companyId, { lat, lng, accuracy }) {
  return prisma.locationLog.create({
    data: {
      userId,
      companyId,
      lat,
      lng,
      accuracy,
      timestamp: new Date(),
    },
  });
}

// ============================================
// LOCATION UTILITIES
// ============================================

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 6371000; // Earth's radius in meters
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function toRad(deg) {
  return deg * (Math.PI / 180);
}

/**
 * Check if point is inside geofence
 */
export function isInsideGeofence(lat, lng, geofence) {
  const distance = calculateDistance(lat, lng, geofence.lat, geofence.lng);
  return distance <= geofence.radius;
}

/**
 * Find nearest geofence to a point
 */
export async function findNearestGeofence(companyId, lat, lng) {
  const geofences = await getGeofences(companyId, { active: true });
  
  let nearest = null;
  let minDistance = Infinity;

  for (const geofence of geofences) {
    const distance = calculateDistance(lat, lng, geofence.lat, geofence.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = { ...geofence, distance };
    }
  }

  return nearest;
}

// ============================================
// USER SETTINGS
// ============================================

/**
 * Get user's location tracking settings
 */
export async function getLocationSettings(userId) {
  const settings = await prisma.userSettings.findUnique({
    where: { userId },
    select: {
      locationTrackingEnabled: true,
      autoClockEnabled: true,
      locationAccuracy: true,
      trackingInterval: true,
    },
  });

  return settings || {
    locationTrackingEnabled: false,
    autoClockEnabled: false,
    locationAccuracy: 'high',
    trackingInterval: 30, // seconds
  };
}

/**
 * Update user's location tracking settings
 */
export async function updateLocationSettings(userId, settings) {
  return prisma.userSettings.upsert({
    where: { userId },
    create: {
      userId,
      ...settings,
    },
    update: settings,
  });
}

// ============================================
// REPORTS
// ============================================

/**
 * Get location history for a user
 */
export async function getLocationHistory(userId, companyId, { startDate, endDate, limit = 100 }) {
  return prisma.locationLog.findMany({
    where: {
      userId,
      companyId,
      timestamp: {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      },
    },
    orderBy: { timestamp: 'desc' },
    take: limit,
  });
}

/**
 * Get geofence events for a user
 */
export async function getGeofenceEvents(userId, { startDate, endDate }) {
  return prisma.geofenceEvent.findMany({
    where: {
      userId,
      timestamp: {
        ...(startDate ? { gte: new Date(startDate) } : {}),
        ...(endDate ? { lte: new Date(endDate) } : {}),
      },
    },
    include: {
      geofence: { select: { name: true, address: true } },
    },
    orderBy: { timestamp: 'desc' },
  });
}

export default {
  createGeofence,
  getGeofences,
  updateGeofence,
  deleteGeofence,
  autoCreateJobGeofence,
  processLocationUpdate,
  calculateDistance,
  isInsideGeofence,
  findNearestGeofence,
  getLocationSettings,
  updateLocationSettings,
  getLocationHistory,
  getGeofenceEvents,
};
