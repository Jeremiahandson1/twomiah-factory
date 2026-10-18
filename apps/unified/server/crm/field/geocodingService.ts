// Geocoding: addresses to coordinates and back through Nominatim (OpenStreetMap, free, no key), cached in memory, and
// the job/project coordinate fill-ins. Moved from the CRM template's services/geocoding.ts
// (templates/crm/backend/src/services). One change: the template's User-Agent had the company's name and email baked
// in at build time ('{{COMPANY_NAME}} CRM ({{COMPANY_EMAIL}})'); one build serves every company here, so it is read
// from the company row when a request is made.
import { eq } from 'drizzle-orm'
import { company, job, project, contact } from '../../db/schema/index.ts'
import type { CrmDeps } from '../deps.ts'

const CACHE_TTL = 7 * 24 * 60 * 60 * 1000 // 7 days

interface GeocodeResult {
  lat: number
  lng: number
  displayName: string
  type: string
}

interface ReverseGeocodeResult {
  address?: string
  city?: string
  state?: string
  zip?: string
  country?: string
  displayName: string
}

/** "address, city, state, zip" when at least two parts are known. */
function buildAddress(obj: { address?: string | null; city?: string | null; state?: string | null; zip?: string | null }): string | null {
  const parts: string[] = []
  if (obj.address) parts.push(obj.address)
  if (obj.city) parts.push(obj.city)
  if (obj.state) parts.push(obj.state)
  if (obj.zip) parts.push(obj.zip)
  return parts.length >= 2 ? parts.join(', ') : null
}

const toRad = (deg: number) => deg * (Math.PI / 180)

/** Distance between two points in miles. */
export function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) * Math.sin(dLng / 2)
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export function createGeocodingService(d: CrmDeps) {
  const { db, logger } = d
  // Per service instance, as the template's was per process.
  const cache = new Map<string, { data: any; timestamp: number }>()

  async function userAgent(companyId: string) {
    const [co] = await db.select({ name: company.name, email: company.email }).from(company).where(eq(company.id, companyId)).limit(1)
    return `${co?.name || 'Twomiah'} CRM (${co?.email || ''})`
  }

  async function geocode(address: string, companyId: string): Promise<GeocodeResult | null> {
    if (!address || address.trim().length < 5) return null
    const cacheKey = address.toLowerCase().trim()
    const cached = cache.get(cacheKey)
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) return cached.data

    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`,
        { headers: { 'User-Agent': await userAgent(companyId) } },
      )
      if (!response.ok) throw new Error(`Geocoding failed: ${response.status}`)
      const data: any = await response.json()
      if (data.length === 0) {
        cache.set(cacheKey, { data: null, timestamp: Date.now() }) // a negative result is cached too
        return null
      }
      const result: GeocodeResult = {
        lat: parseFloat(data[0].lat),
        lng: parseFloat(data[0].lon),
        displayName: data[0].display_name,
        type: data[0].type,
      }
      cache.set(cacheKey, { data: result, timestamp: Date.now() })
      return result
    } catch (error: any) {
      logger.error('Geocoding error', { error: error?.message })
      return null
    }
  }

  async function reverseGeocode(lat: number, lng: number, companyId: string): Promise<ReverseGeocodeResult | null> {
    try {
      const response = await fetch(
        `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`,
        { headers: { 'User-Agent': await userAgent(companyId) } },
      )
      if (!response.ok) throw new Error(`Reverse geocoding failed: ${response.status}`)
      const data: any = await response.json()
      return {
        address: data.address?.road,
        city: data.address?.city || data.address?.town || data.address?.village,
        state: data.address?.state,
        zip: data.address?.postcode,
        country: data.address?.country,
        displayName: data.display_name,
      }
    } catch (error: any) {
      logger.error('Reverse geocoding error', { error: error?.message })
      return null
    }
  }

  /** Geocode a job from its own address, else its project's, else its contact's, and store the coordinates. */
  async function geocodeJob(jobId: string, companyId: string) {
    const [jobRow] = await db.select().from(job).where(eq(job.id, jobId))
    if (!jobRow) return null

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

    let address = buildAddress(jobRow)
    if (!address && projectRow) address = buildAddress(projectRow)
    if (!address && contactRow) address = buildAddress(contactRow)
    if (!address) return null

    const coords = await geocode(address, companyId)
    if (!coords) return null
    const [updated] = await db.update(job).set({ lat: coords.lat, lng: coords.lng }).where(eq(job.id, jobId)).returning()
    return updated
  }

  async function geocodeProject(projectId: string, companyId: string) {
    const [projectRow] = await db.select().from(project).where(eq(project.id, projectId))
    if (!projectRow) return null
    const address = buildAddress(projectRow)
    if (!address) return null
    const coords = await geocode(address, companyId)
    if (!coords) return null
    const [updated] = await db.update(project).set({ lat: coords.lat, lng: coords.lng }).where(eq(project.id, projectId)).returning()
    return updated
  }

  /** Up to `limit` of the company's jobs; those with no lat and an address are geocoded, one a second (Nominatim's limit). */
  async function geocodeAllJobs(companyId: string, limit = 50) {
    const jobs = await db.select().from(job).where(eq(job.companyId, companyId)).limit(limit)
    const jobsToGeocode = jobs.filter((j: any) => j.lat === null && j.address !== null)
    const results: Array<{ id: string; success: boolean; error?: string }> = []
    for (const j of jobsToGeocode) {
      await sleep(1100)
      try {
        const updated = await geocodeJob(j.id, companyId)
        results.push({ id: j.id, success: !!updated })
      } catch (error: any) {
        results.push({ id: j.id, success: false, error: error.message })
      }
    }
    return results
  }

  return { geocode, reverseGeocode, geocodeJob, geocodeProject, geocodeAllJobs, calculateDistance }
}
