// Where a new map opens: the business's own address or the places it serves (GET /api/map-center), asked once per page
// load and shared by every map. The maps opened on Dallas — the template's fallback — whatever the business's town
// (landscaping live retest, 2026-10-24). Until the answer arrives, or when nothing on record places the business, a map
// shows the whole country (US_VIEW) rather than a guess.
import { useEffect, useState } from 'react'

export type MapCenter = { lat: number; lng: number }

/** The whole country, for a business nothing on record places yet. */
export const US_VIEW = { center: [39.5, -98.35] as [number, number], zoom: 4 }
/** How close a map opens on the business: a town and its edges. */
export const HOME_ZOOM = 11

let asked: Promise<MapCenter | null> | null = null

/** The business's map centre, or null (unknown or not yet known). `get` is the app's signed-in GET. */
export function useMapCenter(get: (path: string) => Promise<any>): MapCenter | null {
  const [center, setCenter] = useState<MapCenter | null>(null)
  useEffect(() => {
    let live = true
    if (!asked) {
      asked = get('/api/map-center')
        .then((r: any) => {
          const lat = Number(r?.lat), lng = Number(r?.lng)
          return r?.lat != null && r?.lng != null && Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null
        })
        .catch(() => { asked = null; return null })
    }
    asked.then((c) => { if (live) setCenter(c) })
    return () => { live = false }
  }, [])
  return center
}
