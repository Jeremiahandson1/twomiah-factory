// A point on the Earth, by one rule for every record that stores one (geofences and the phone's location, a home-care
// client's or caregiver's address point): latitude −90…90, longitude −180…180, numbers only — "12abc" is not 12, and 0
// is a real latitude. Latitude 999 was saved on a geofence (live test 2026-10-22).

/** A number from a JSON number or a numeric string; anything else is NaN. */
export const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v.trim()) : NaN)

/** Both halves required: the sentence to refuse with, or null. */
export function pointProblem(lat: unknown, lng: unknown): string | null {
  if (lat == null || lat === '' || lng == null || lng === '') return 'Latitude and longitude are required.'
  return latProblem(lat) ?? lngProblem(lng)
}
export function latProblem(lat: unknown): string | null {
  const a = num(lat)
  return Number.isFinite(a) && a >= -90 && a <= 90 ? null : 'Latitude must be a number between -90 and 90.'
}
export function lngProblem(lng: unknown): string | null {
  const o = num(lng)
  return Number.isFinite(o) && o >= -180 && o <= 180 ? null : 'Longitude must be a number between -180 and 180.'
}
/** A record's optional `latitude` / `longitude` (blank or null clears them): each one given must be in range. */
export function optionalPointProblem(b: { latitude?: unknown; longitude?: unknown }): string | null {
  const given = (v: unknown) => v !== undefined && v !== null && v !== ''
  return (given(b.latitude) ? latProblem(b.latitude) : null) ?? (given(b.longitude) ? lngProblem(b.longitude) : null)
}
