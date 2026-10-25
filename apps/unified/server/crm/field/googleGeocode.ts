// Google's Geocoding API, from the server with its key — the one geocoder (2026-10-24). OpenStreetMap's public Nominatim
// was used here, in home care's route optimiser and from the canvasser's browser; its usage policy (no bulk or
// commercial use from a shared app, one request a second) is the one that got the public tiles blocked, so it is gone
// everywhere (guard: tests/role-tests-1024v.test.ts). No key → no result: nothing falls back to a public service.
// The tests blank GOOGLE_MAPS_API_KEY (tests/noLiveKeys.ts), so they never reach Google.

/** The server's Maps key (Settings → the Render env), also the route optimiser's. Empty: no geocoding. */
export const googleKey = () => process.env.GOOGLE_MAPS_API_KEY || ''

const BASE = 'https://maps.googleapis.com/maps/api/geocode/json'

export interface ForwardResult { lat: number; lng: number; formattedAddress: string; type: string }
export interface ReverseResult { address?: string; city?: string; state?: string; zip?: string; country?: string; formattedAddress: string }

/** An address → its point, or null (no key, not found, or Google refused). Throws never. */
export async function googleGeocode(address: string, log: (m: string) => void = () => {}): Promise<ForwardResult | null> {
  const key = googleKey()
  if (!key || !address.trim()) return null
  try {
    const res = await fetch(`${BASE}?address=${encodeURIComponent(address)}&components=country:US&key=${encodeURIComponent(key)}`)
    const data: any = await res.json()
    if (data?.status !== 'OK' || !data.results?.length) return null
    const r = data.results[0]
    return { lat: Number(r.geometry.location.lat), lng: Number(r.geometry.location.lng), formattedAddress: r.formatted_address || address, type: r.types?.[0] || '' }
  } catch (e: any) { log(`Google Geocoding error: ${e?.message}`); return null }
}

/** A point → its street address, or null. */
export async function googleReverseGeocode(lat: number, lng: number, log: (m: string) => void = () => {}): Promise<ReverseResult | null> {
  const key = googleKey()
  if (!key || !Number.isFinite(lat) || !Number.isFinite(lng)) return null
  try {
    const res = await fetch(`${BASE}?latlng=${lat},${lng}&result_type=street_address|premise&key=${encodeURIComponent(key)}`)
    const data: any = await res.json()
    if (data?.status !== 'OK' || !data.results?.length) return null
    const r = data.results[0]
    const part = (type: string, short = false) => {
      const c = (r.address_components || []).find((x: any) => x.types?.includes(type))
      return c ? String(short ? c.short_name : c.long_name) : undefined
    }
    const number = part('street_number'), road = part('route')
    return {
      address: [number, road].filter(Boolean).join(' ') || undefined,
      city: part('locality') || part('postal_town') || part('sublocality'),
      state: part('administrative_area_level_1', true),
      zip: part('postal_code'),
      country: part('country', true),
      formattedAddress: r.formatted_address || '',
    }
  } catch (e: any) { log(`Google reverse geocoding error: ${e?.message}`); return null }
}
