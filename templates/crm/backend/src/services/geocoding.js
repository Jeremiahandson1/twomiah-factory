/**
 * Geocoding Service
 * 
 * Converts addresses to coordinates using free services.
 * Caches results to avoid rate limits.
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// Simple in-memory cache (in production, use Redis)
const cache = new Map();
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * Geocode an address to coordinates
 */
export async function geocode(address) {
  if (!address || address.trim().length < 5) {
    return null;
  }

  const cacheKey = address.toLowerCase().trim();
  
  // Check cache
  const cached = cache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data;
  }

  try {
    // Use Nominatim (OpenStreetMap) - free, no API key
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      {
        headers: {
          'User-Agent': 'Twomiah Build CRM (contact@twomiah-build.app)',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`);
    }

    const data = await response.json();
    
    if (data.length === 0) {
      // Cache negative result
      cache.set(cacheKey, { data: null, timestamp: Date.now() });
      return null;
    }

    const result = {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
      type: data[0].type,
    };

    // Cache result
    cache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    console.error('Geocoding error:', error);
    return null;
  }
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat, lng) {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      {
        headers: {
          'User-Agent': 'Twomiah Build CRM (contact@twomiah-build.app)',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed: ${response.status}`);
    }

    const data = await response.json();
    
    return {
      address: data.address?.road,
      city: data.address?.city || data.address?.town || data.address?.village,
      state: data.address?.state,
      zip: data.address?.postcode,
      country: data.address?.country,
      displayName: data.display_name,
    };
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    return null;
  }
}

/**
 * Geocode and update a job's coordinates
 */
export async function geocodeJob(jobId) {
  const job = await prisma.job.findUnique({
    where: { id: jobId },
    include: { project: true, contact: true },
  });

  if (!job) return null;

  // Build address from job or related entities
  let address = buildAddress(job);
  if (!address && job.project) {
    address = buildAddress(job.project);
  }
  if (!address && job.contact) {
    address = buildAddress(job.contact);
  }

  if (!address) return null;

  const coords = await geocode(address);
  if (!coords) return null;

  // Update job with coordinates
  const updated = await prisma.job.update({
    where: { id: jobId },
    data: {
      lat: coords.lat,
      lng: coords.lng,
    },
  });

  return updated;
}

/**
 * Geocode and update a project's coordinates
 */
export async function geocodeProject(projectId) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });

  if (!project) return null;

  const address = buildAddress(project);
  if (!address) return null;

  const coords = await geocode(address);
  if (!coords) return null;

  const updated = await prisma.project.update({
    where: { id: projectId },
    data: {
      lat: coords.lat,
      lng: coords.lng,
    },
  });

  return updated;
}

/**
 * Batch geocode all jobs without coordinates
 */
export async function geocodeAllJobs(companyId, limit = 50) {
  const jobs = await prisma.job.findMany({
    where: {
      companyId,
      lat: null,
      OR: [
        { address: { not: null } },
        { project: { address: { not: null } } },
      ],
    },
    include: { project: true },
    take: limit,
  });

  const results = [];
  
  for (const job of jobs) {
    // Rate limit: 1 request per second for Nominatim
    await sleep(1100);
    
    try {
      const updated = await geocodeJob(job.id);
      results.push({ id: job.id, success: !!updated });
    } catch (error) {
      results.push({ id: job.id, success: false, error: error.message });
    }
  }

  return results;
}

/**
 * Build address string from object
 */
function buildAddress(obj) {
  const parts = [];
  
  if (obj.address) parts.push(obj.address);
  if (obj.city) parts.push(obj.city);
  if (obj.state) parts.push(obj.state);
  if (obj.zip) parts.push(obj.zip);
  
  return parts.length >= 2 ? parts.join(', ') : null;
}

/**
 * Calculate distance between two points in miles
 */
export function calculateDistance(lat1, lng1, lat2, lng2) {
  const R = 3959; // Earth's radius in miles
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

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export default {
  geocode,
  reverseGeocode,
  geocodeJob,
  geocodeProject,
  geocodeAllJobs,
  calculateDistance,
};
