/**
 * Where and when the phone says a photo was taken — read from the photo's own EXIF, which the camera screen already asks
 * the picker for (useCamera: `exif: true`). Nothing is requested of the person and no location is read here: when the
 * camera left no place in the photo (location off for the camera, or a photo from the library with it stripped), there is
 * no place, and the server stores none. The inspection report (server/crm/roof/inspection) prints what is sent.
 *
 * Plain functions with no React Native import, so they run under bun (tests/mobile/photo-stamp.test.ts).
 */
export interface PhotoStamp { latitude?: number; longitude?: number; takenAt?: string }

const num = (v: unknown): number | null => { const n = typeof v === 'string' ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) ? n : null }

/** One coordinate: decimal degrees, or [degrees, minutes, seconds]; the hemisphere ('S', 'W') makes it negative. */
function coordinate(value: unknown, ref: unknown): number | null {
  let deg: number | null
  if (Array.isArray(value)) {
    const [d, m, s] = value.map(num)
    deg = d === null || d === undefined ? null : Math.abs(d) + (m ?? 0) / 60 + (s ?? 0) / 3600
  } else deg = num(value)
  if (deg === null) return null
  const r = String(ref ?? '').toUpperCase()
  return r === 'S' || r === 'W' ? -Math.abs(deg) : deg
}

/** "2026:03:04 14:15:00" (the camera's wall clock) with an optional "-06:00" offset → an instant, as an ISO string. */
function takenAt(original: unknown, offset: unknown): string | undefined {
  const m = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/.exec(String(original ?? ''))
  if (!m) return undefined
  const [, y, mo, d, h, mi, s] = m
  const off = /^[+-]\d{2}:\d{2}$/.test(String(offset ?? '')) ? String(offset) : null
  const when = off ? new Date(`${y}-${mo}-${d}T${h}:${mi}:${s}${off}`) : new Date(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s))
  return Number.isNaN(when.getTime()) ? undefined : when.toISOString()
}

/** The stamp the photo carries, or {} — flat EXIF (GPSLatitude…) and the nested form some phones give ({GPS}: { Latitude… }). */
export function stampFromExif(exif: Record<string, any> | null | undefined): PhotoStamp {
  if (!exif || typeof exif !== 'object') return {}
  const gps = (exif['{GPS}'] || exif.GPS || {}) as Record<string, unknown>
  const lat = coordinate(exif.GPSLatitude ?? gps.Latitude, exif.GPSLatitudeRef ?? gps.LatitudeRef)
  const lng = coordinate(exif.GPSLongitude ?? gps.Longitude, exif.GPSLongitudeRef ?? gps.LongitudeRef)
  const exifBlock = (exif['{Exif}'] || {}) as Record<string, unknown>
  const at = takenAt(exif.DateTimeOriginal ?? exifBlock.DateTimeOriginal ?? exif.DateTime, exif.OffsetTimeOriginal ?? exifBlock.OffsetTimeOriginal)
  const out: PhotoStamp = {}
  // Both coordinates or neither, and within the earth's range (the server refuses anything else).
  if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0)) { out.latitude = lat; out.longitude = lng }
  if (at) out.takenAt = at
  return out
}

/** The extra form fields a photo upload carries for its stamp (none when the phone had nothing to say). */
export function stampFields(stamp: PhotoStamp | null | undefined): Record<string, string> {
  const out: Record<string, string> = {}
  if (!stamp) return out
  if (stamp.latitude !== undefined && stamp.longitude !== undefined) { out.latitude = String(stamp.latitude); out.longitude = String(stamp.longitude) }
  if (stamp.takenAt) out.takenAt = stamp.takenAt
  return out
}
