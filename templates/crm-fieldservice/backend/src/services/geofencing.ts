/**
 * GPS Geofencing Service (Drizzle)
 *
 * Auto clock in/out based on location:
 * - Define geofences around job sites
 * - Track user location
 * - Auto clock in when entering geofence
 * - Auto clock out when leaving geofence
 */

import { db } from '../../db/index.ts';
import {
  geofence,
  geofenceEvent,
  timeEntry,
  locationLog,
  userSettings,
  job,
  project,
} from '../../db/schema.ts';
import { eq, and, desc, gte, lte, isNull, isNotNull } from 'drizzle-orm';

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
}: {
  companyId: string;
  name: string;
  lat: number;
  lng: number;
  radius?: number;
  jobId?: string;
  projectId?: string;
  address?: string;
}) {
  const [result] = await db.insert(geofence).values({
    companyId,
    name,
    lat,
    lng,
    radius,
    jobId: jobId ?? null,
    projectId: projectId ?? null,
    address: address ?? null,
    active: true,
  }).returning();

  return result;
}

/**
 * Get all geofences for a company
 */
export async function getGeofences(companyId: string, { active = true }: { active?: boolean | null } = {}) {
  const conditions: any[] = [eq(geofence.companyId, companyId)];
  if (active !== null) {
    conditions.push(eq(geofence.active, active as boolean));
  }

  const rows = await db.select({
    geofence: geofence,
    job: { id: job.id, title: job.title, number: job.number },
    project: { id: project.id, name: project.name, number: project.number },
  })
    .from(geofence)
    .leftJoin(job, eq(job.id, geofence.jobId))
    .leftJoin(project, eq(project.id, geofence.projectId))
    .where(and(...conditions))
    .orderBy(desc(geofence.createdAt));

  return rows.map(({ geofence: g, job: j, project: p }) => ({
    ...g,
    job: j,
    project: p,
  }));
}

/**
 * Update a geofence
 */
export async function updateGeofence(geofenceId: string, companyId: string, data: Partial<{
  name: string;
  lat: number;
  lng: number;
  radius: number;
  active: boolean;
  address: string;
}>) {
  const [updated] = await db.update(geofence)
    .set({ ...data, updatedAt: new Date() })
    .where(and(eq(geofence.id, geofenceId), eq(geofence.companyId, companyId)))
    .returning();

  return updated ?? null;
}

/**
 * Delete a geofence
 */
export async function deleteGeofence(geofenceId: string, companyId: string) {
  await db.delete(geofence)
    .where(and(eq(geofence.id, geofenceId), eq(geofence.companyId, companyId)));
}

/**
 * Auto-create geofence when job has location
 */
export async function autoCreateJobGeofence(jobData: {
  id: string;
  companyId: string;
  title?: string | null;
  number: string;
  lat?: number | null;
  lng?: number | null;
  address?: string | null;
}) {
  if (!jobData.lat || !jobData.lng) return null;

  // Check if geofence already exists
  const [existing] = await db.select().from(geofence)
    .where(eq(geofence.jobId, jobData.id)).limit(1);

  if (existing) return existing;

  return createGeofence({
    companyId: jobData.companyId,
    name: jobData.title || `Job ${jobData.number}`,
    lat: jobData.lat,
    lng: jobData.lng,
    radius: DEFAULT_RADIUS,
    jobId: jobData.id,
    address: jobData.address ?? undefined,
  });
}

// ============================================
// LOCATION TRACKING
// ============================================

/**
 * Process location update from user
 * Returns any clock in/out actions taken
 */
export async function processLocationUpdate(
  userId: string,
  companyId: string,
  { lat, lng, accuracy }: { lat: number; lng: number; accuracy?: number },
) {
  const actions: Array<{
    type: string;
    geofence: string;
    entryId: string;
    jobId?: string | null;
    projectId?: string | null;
    hours?: string | null;
  }> = [];

  // Get active geofences
  const geofences = await getGeofences(companyId, { active: true });

  // Get user's current active time entry (clockIn set, clockOut null)
  const [activeEntry] = await db.select().from(timeEntry)
    .where(and(
      eq(timeEntry.userId, userId),
      eq(timeEntry.companyId, companyId),
      isNotNull(timeEntry.clockIn),
      isNull(timeEntry.clockOut),
    ))
    .limit(1);

  // Check each geofence
  for (const fence of geofences) {
    const distance = calculateDistance(lat, lng, fence.lat, fence.lng);
    const isInside = distance <= fence.radius;

    // Get last known state for this geofence
    const lastState = await getLastGeofenceState(userId, fence.id);
    const wasInside = lastState?.inside || false;

    // Record current state
    await recordGeofenceState(userId, fence.id, isInside, { lat, lng, accuracy: accuracy ?? null, distance });

    // Detect transitions
    if (isInside && !wasInside) {
      // ENTERED geofence - auto clock in
      if (!activeEntry) {
        const entry = await autoClockIn(userId, companyId, fence);
        actions.push({
          type: 'clock_in',
          geofence: fence.name,
          entryId: entry.id,
          jobId: fence.jobId,
          projectId: fence.projectId,
        });
      }
    } else if (!isInside && wasInside) {
      // LEFT geofence - auto clock out
      if (activeEntry && (activeEntry.jobId === fence.jobId || activeEntry.description?.includes(fence.name))) {
        const entry = await autoClockOut(activeEntry.id);
        if (entry) {
          actions.push({
            type: 'clock_out',
            geofence: fence.name,
            entryId: entry.id,
            hours: entry.hours,
          });
        }
      }
    }
  }

  // Log location for audit trail
  await logLocation(userId, companyId, { lat, lng, accuracy: accuracy ?? null });

  return actions;
}

/**
 * Auto clock in when entering geofence
 */
async function autoClockIn(
  userId: string,
  companyId: string,
  fence: { id: string; name: string; jobId: string | null; projectId: string | null },
) {
  const [entry] = await db.insert(timeEntry).values({
    userId,
    companyId,
    jobId: fence.jobId ?? null,
    projectId: fence.projectId ?? null,
    clockIn: new Date(),
    date: new Date(),
    hours: '0',
    isAutoClocked: true,
    description: `Auto clocked in at ${fence.name}`,
  }).returning();

  return entry;
}

/**
 * Auto clock out when leaving geofence
 */
async function autoClockOut(entryId: string) {
  const [entry] = await db.select().from(timeEntry)
    .where(eq(timeEntry.id, entryId)).limit(1);

  if (!entry || !entry.clockIn) return null;

  const endTime = new Date();
  const totalMinutes = Math.round((endTime.getTime() - entry.clockIn.getTime()) / 60000);
  const hours = (Math.round((totalMinutes / 60) * 100) / 100).toFixed(2);

  const [updated] = await db.update(timeEntry).set({
    clockOut: endTime,
    hours,
    description: entry.description ? `${entry.description} | Auto clocked out` : 'Auto clocked out',
    updatedAt: new Date(),
  }).where(eq(timeEntry.id, entryId)).returning();

  return updated;
}

/**
 * Get last geofence state for user
 */
async function getLastGeofenceState(userId: string, geofenceId: string) {
  const [result] = await db.select().from(geofenceEvent)
    .where(and(eq(geofenceEvent.userId, userId), eq(geofenceEvent.geofenceId, geofenceId)))
    .orderBy(desc(geofenceEvent.timestamp))
    .limit(1);

  return result ?? null;
}

/**
 * Record geofence state
 */
async function recordGeofenceState(
  userId: string,
  geofenceId: string,
  inside: boolean,
  location: { lat: number; lng: number; accuracy: number | null; distance: number },
) {
  const [result] = await db.insert(geofenceEvent).values({
    userId,
    geofenceId,
    inside,
    lat: location.lat,
    lng: location.lng,
    accuracy: location.accuracy,
    distance: location.distance,
    timestamp: new Date(),
  }).returning();

  return result;
}

/**
 * Log location for audit trail
 */
async function logLocation(
  userId: string,
  companyId: string,
  { lat, lng, accuracy }: { lat: number; lng: number; accuracy: number | null },
) {
  const [result] = await db.insert(locationLog).values({
    userId,
    companyId,
    lat,
    lng,
    accuracy,
    timestamp: new Date(),
  }).returning();

  return result;
}

// ============================================
// LOCATION UTILITIES
// ============================================

/**
 * Calculate distance between two points using Haversine formula
 * Returns distance in meters
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
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

function toRad(deg: number): number {
  return deg * (Math.PI / 180);
}

/**
 * Check if point is inside geofence
 */
export function isInsideGeofence(lat: number, lng: number, fence: { lat: number; lng: number; radius: number }): boolean {
  const distance = calculateDistance(lat, lng, fence.lat, fence.lng);
  return distance <= fence.radius;
}

/**
 * Find nearest geofence to a point
 */
export async function findNearestGeofence(companyId: string, lat: number, lng: number) {
  const geofences = await getGeofences(companyId, { active: true });

  let nearest: (typeof geofences[number] & { distance: number }) | null = null;
  let minDistance = Infinity;

  for (const fence of geofences) {
    const distance = calculateDistance(lat, lng, fence.lat, fence.lng);
    if (distance < minDistance) {
      minDistance = distance;
      nearest = { ...fence, distance };
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
export async function getLocationSettings(userId: string) {
  const [settings] = await db.select({
    locationTrackingEnabled: userSettings.locationTrackingEnabled,
    autoClockEnabled: userSettings.autoClockEnabled,
    locationAccuracy: userSettings.locationAccuracy,
    trackingInterval: userSettings.trackingInterval,
  }).from(userSettings).where(eq(userSettings.userId, userId)).limit(1);

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
export async function updateLocationSettings(userId: string, settings: Partial<{
  locationTrackingEnabled: boolean;
  autoClockEnabled: boolean;
  locationAccuracy: string;
  trackingInterval: number;
}>) {
  // Check if settings exist
  const [existing] = await db.select({ id: userSettings.id })
    .from(userSettings).where(eq(userSettings.userId, userId)).limit(1);

  if (existing) {
    const [updated] = await db.update(userSettings)
      .set({ ...settings, updatedAt: new Date() })
      .where(eq(userSettings.userId, userId))
      .returning();
    return updated;
  } else {
    const [created] = await db.insert(userSettings).values({
      userId,
      ...settings,
    } as any).returning();
    return created;
  }
}

// ============================================
// REPORTS
// ============================================

/**
 * Get location history for a user
 */
export async function getLocationHistory(
  userId: string,
  companyId: string,
  { startDate, endDate, limit = 100 }: { startDate?: string; endDate?: string; limit?: number },
) {
  const conditions: any[] = [eq(locationLog.userId, userId), eq(locationLog.companyId, companyId)];
  if (startDate) conditions.push(gte(locationLog.timestamp, new Date(startDate)));
  if (endDate) conditions.push(lte(locationLog.timestamp, new Date(endDate)));

  return db.select().from(locationLog)
    .where(and(...conditions))
    .orderBy(desc(locationLog.timestamp))
    .limit(limit);
}

/**
 * Get geofence events for a user
 */
export async function getGeofenceEvents(
  userId: string,
  { startDate, endDate }: { startDate?: string; endDate?: string },
) {
  const conditions: any[] = [eq(geofenceEvent.userId, userId)];
  if (startDate) conditions.push(gte(geofenceEvent.timestamp, new Date(startDate)));
  if (endDate) conditions.push(lte(geofenceEvent.timestamp, new Date(endDate)));

  const rows = await db.select({
    event: geofenceEvent,
    geofence: { name: geofence.name, address: geofence.address },
  })
    .from(geofenceEvent)
    .leftJoin(geofence, eq(geofence.id, geofenceEvent.geofenceId))
    .where(and(...conditions))
    .orderBy(desc(geofenceEvent.timestamp));

  return rows.map(({ event: e, geofence: g }) => ({
    ...e,
    geofence: g,
  }));
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
