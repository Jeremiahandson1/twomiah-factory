/**
 * Geocoding Service
 *
 * Converts addresses to coordinates using free services.
 * Caches results to avoid rate limits.
 */

import { db } from '../../db/index.ts'
import { job, project, contact } from '../../db/schema.ts'
import { eq } from 'drizzle-orm'

// Simple in-memory cache (in production, use Redis)
const cache = new Map<string, { data: any; timestamp: number }>()
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

interface GeocodeResult {
  lat: number
  lng: number
  displayName: string
  type: string
}

/**
 * Geocode an address to coordinates
 */
export async function geocode(address: string): Promise<GeocodeResult | null> {
  if (!address || address.trim().length < 5) {
    return null
  }

  const cacheKey = address.toLowerCase().trim()

  // Check cache
  const cached = cache.get(cacheKey)
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return cached.data
  }

  try {
    // Use Nominatim (OpenStreetMap) - free, no API key
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
      {
        headers: {
          'User-Agent': '{{COMPANY_NAME}} CRM ({{COMPANY_EMAIL}})',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Geocoding failed: ${response.status}`)
    }

    const data = await response.json()

    if (data.length === 0) {
      // Cache negative result
      cache.set(cacheKey, { data: null, timestamp: Date.now() })
      return null
    }

    const result: GeocodeResult = {
      lat: parseFloat(data[0].lat),
      lng: parseFloat(data[0].lon),
      displayName: data[0].display_name,
      type: data[0].type,
    }

    // Cache result
    cache.set(cacheKey, { data: result, timestamp: Date.now() })

    return result
  } catch (error) {
    console.error('Geocoding error:', error)
    return null
  }
}

interface ReverseGeocodeResult {
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  displayName: string
}

/**
 * Reverse geocode coordinates to address
 */
export async function reverseGeocode(lat: number, lng: number): Promise<ReverseGeocodeResult | null> {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
      {
        headers: {
          'User-Agent': '{{COMPANY_NAME}} CRM ({{COMPANY_EMAIL}})',
        },
      }
    )

    if (!response.ok) {
      throw new Error(`Reverse geocoding failed: ${response.status}`)
    }

    const data = await response.json()

    return {
      address: data.address?.road,
      city: data.address?.city || data.address?.town || data.address?.village,
      state: data.address?.state,
      zip: data.address?.postcode,
      country: data.address?.country,
      displayName: data.display_name,
    }
  } catch (error) {
    console.error('Reverse geocoding error:', error)
    return null
  }
}

/**
 * Geocode and update a job's coordinates
 */
export async function geocodeJob(jobId: string) {
  const [jobRow] = await db.select()
    .from(job)
    .where(eq(job.id, jobId))

  if (!jobRow) return null

  // Get related project and contact
  let projectRow = null
  let contactRow = null

  if (jobRow.projectId) {
    const [p] = await db.select().from(project).where(eq(project.id, jobRow.projectId))
    projectRow = p || null
  }

  if (jobRow.contactId) {
    const [c] = await db.select().from(contact).where(eq(contact.id, jobRow.contactId))
    contactRow = c || null
  }

  // Build address from job or related entities
  let address = buildAddress(jobRow)
  if (!address && projectRow) {
    address = buildAddress(projectRow)
  }
  if (!address && contactRow) {
    address = buildAddress(contactRow)
  }

  if (!address) return null

  const coords = await geocode(address)
  if (!coords) return null

  // Update job with coordinates
  const [updated] = await db.update(job)
    .set({
      lat: coords.lat,
      lng: coords.lng,
    })
    .where(eq(job.id, jobId))
    .returning()

  return updated
}

/**
 * Geocode and update a project's coordinates
 */
export async function geocodeProject(projectId: string) {
  const [projectRow] = await db.select()
    .from(project)
    .where(eq(project.id, projectId))

  if (!projectRow) return null

  const address = buildAddress(projectRow)
  if (!address) return null

  const coords = await geocode(address)
  if (!coords) return null

  const [updated] = await db.update(project)
    .set({
      lat: coords.lat,
      lng: coords.lng,
    })
    .where(eq(project.id, projectId))
    .returning()

  return updated
}

/**
 * Batch geocode all jobs without coordinates
 */
export async function geocodeAllJobs(companyId: string, limit = 50) {
  const jobs = await db.select()
    .from(job)
    .where(eq(job.companyId, companyId))
    .limit(limit)

  // Filter to jobs without lat that have an address
  const jobsToGeocode = jobs.filter(j => j.lat === null && j.address !== null)

  const results: Array<{ id: string; success: boolean; error?: string }> = []

  for (const j of jobsToGeocode) {
    // Rate limit: 1 request per second for Nominatim
    await sleep(1100)

    try {
      const updated = await geocodeJob(j.id)
      results.push({ id: j.id, success: !!updated })
    } catch (error: any) {
      results.push({ id: j.id, success: false, error: error.message })
    }
  }

  return results
}

/**
 * Build address string from object
 */
function buildAddress(obj: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string | null {
  const parts: string[] = []

  if (obj.address) parts.push(obj.address)
  if (obj.city) parts.push(obj.city)
  if (obj.state) parts.push(obj.state)
  if (obj.zip) parts.push(obj.zip)

  return parts.length >= 2 ? parts.join(', ') : null
}

/**
 * Calculate distance between two points in miles
 */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959 // Earth's radius in miles
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) *
    Math.sin(dLng / 2) * Math.sin(dLng / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toRad(deg: number): number {
  return deg * (Math.PI / 180)
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default {
  geocode,
  reverseGeocode,
  geocodeJob,
  geocodeProject,
  geocodeAllJobs,
  calculateDistance,
}
