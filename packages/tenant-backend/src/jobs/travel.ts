// Travel time between two jobs, for the clash check (jobs.ts) and a day's re-timing (the unified app's day route).
//
// The same estimate the route optimiser falls back to when no router answers (apps/unified/server/crm/field/
// routingService.ts): straight-line distance at 13.4 m/s (30 mph). It runs on every save, so it never calls out to a
// router — a save must not wait on, or fail with, an outside service.

export interface Place { lat?: number | null; lng?: number | null; address?: string | null }

const hasCoords = (p: Place) => p.lat !== null && p.lat !== undefined && p.lng !== null && p.lng !== undefined
  && Number.isFinite(Number(p.lat)) && Number.isFinite(Number(p.lng))

/** Straight-line distance in metres. */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000
  const lat1 = (a.lat * Math.PI) / 180, lat2 = (b.lat * Math.PI) / 180
  const dLat = ((b.lat - a.lat) * Math.PI) / 180, dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

const sameAddress = (a?: string | null, b?: string | null) => String(a || '').trim().toLowerCase() === String(b || '').trim().toLowerCase()

/**
 * Minutes of driving between two places, or null when nothing says they are apart.
 *   both on the map            → the distance at 30 mph, rounded up (0 for the same spot)
 *   not both on the map        → 1 when both have an address and the addresses differ (back-to-back at two different
 *                                places is never enough, however far apart they are), else null (unknown: no warning)
 */
export function travelMinutes(a: Place, b: Place): number | null {
  if (hasCoords(a) && hasCoords(b)) return Math.ceil(metresBetween({ lat: Number(a.lat), lng: Number(a.lng) }, { lat: Number(b.lat), lng: Number(b.lng) }) / 13.4 / 60)
  if (String(a.address || '').trim() && String(b.address || '').trim() && !sameAddress(a.address, b.address)) return 1
  return null
}
