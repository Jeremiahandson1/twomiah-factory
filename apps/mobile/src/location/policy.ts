/**
 * Background location for the trades — the decisions, with no React Native in them, so
 * tests/mobile/location-tracking.test.ts runs them under plain bun. src/location/tracking.ts does the
 * native work (expo-location + expo-task-manager) and asks this file what to do.
 *
 * The person's consent is the switch: tracking is never on unless THEY turned "Share my location while
 * working" on (GET/PUT /api/geofencing/settings, apps/unified/server/crm/field/geofencing.ts — their own
 * row; the server's default is off). The phone must also have "Always" location permission; without it
 * nothing is saved as on.
 *
 * Who is offered it: a business with the gps_tracking feature, in a trade the feature is offered to
 * (contractor, basic, field service, landscaping). NOT home care — the caregiver app records location at
 * clock-in and clock-out for EVV instead (src/care/CareContext.tsx) — and not roofing / RV, which are not
 * offered gps_tracking. And only in a build whose native config declares background location
 * (app.config.ts → extra.backgroundLocation).
 */

export const TRACKING_VERTICALS = ['contractor', 'basic', 'fieldservice', 'landscaping'] as const

export interface LocationSettings {
  locationTrackingEnabled: boolean
  autoClockEnabled: boolean
}

export const SETTINGS_OFF: LocationSettings = { locationTrackingEnabled: false, autoClockEnabled: false }

/** The server's settings reply (GET, or PUT's saved row) → the two switches. Auto clock means nothing without tracking. */
export function readSettings(data: any): LocationSettings | null {
  if (!data || typeof data !== 'object') return null
  const tracking = data.locationTrackingEnabled === true
  return { locationTrackingEnabled: tracking, autoClockEnabled: tracking && data.autoClockEnabled === true }
}

/**
 * GET /api/geofencing/settings's answer → the settings, or null for "could not tell" (no signal, a
 * server error): leave the task as it is. A 403 / 404 is the business without the feature (or a seat
 * refused it) — off.
 */
export function settingsFromReply(res: { ok: boolean; status: number; data: any }): LocationSettings | null {
  if (res.ok) return readSettings(res.data)
  return res.status === 403 || res.status === 404 ? SETTINGS_OFF : null
}

export function trackingOffered(o: { vertical: string; hasGpsFeature: boolean; buildSupportsBackground: boolean }): boolean {
  return o.buildSupportsBackground && o.hasGpsFeature && (TRACKING_VERTICALS as readonly string[]).includes(o.vertical)
}

export type PermissionState = 'granted' | 'undetermined' | 'denied'

/** Background tracking needs both: "While using" (foreground) and "Always" (background). */
export function permissionVerdict(foreground: PermissionState, background: PermissionState): 'always' | 'needs_always' | 'denied' {
  if (foreground !== 'granted') return 'denied'
  return background === 'granted' ? 'always' : 'needs_always'
}

/**
 * On app start (and whenever the signed-in business or the settings change): what to do with the
 * native location task. `settings` null = the server could not be read (no signal) — leave things as
 * they are; the task already running keeps the person's last choice.
 */
export function startupAction(o: {
  offered: boolean
  settings: LocationSettings | null
  permission: 'always' | 'needs_always' | 'denied'
  running: boolean
}): 'start' | 'stop' | 'none' {
  if (!o.offered) return o.running ? 'stop' : 'none'
  if (!o.settings) return 'none'
  const want = o.settings.locationTrackingEnabled && o.permission === 'always'
  if (want) return o.running ? 'none' : 'start'
  return o.running ? 'stop' : 'none'
}

/**
 * A switch flipped on the Location card → the PUT /api/geofencing/settings body, or null when the
 * change is not allowed (auto clock on while sharing is off). Turning sharing off turns auto clock off
 * with it — clocking someone in by location needs their location.
 */
export function settingsChange(
  current: LocationSettings,
  change: { locationTrackingEnabled: boolean } | { autoClockEnabled: boolean },
): Partial<LocationSettings> | null {
  if ('locationTrackingEnabled' in change) {
    return change.locationTrackingEnabled
      ? { locationTrackingEnabled: true }
      : { locationTrackingEnabled: false, autoClockEnabled: false }
  }
  if (change.autoClockEnabled && !current.locationTrackingEnabled) return null
  return { autoClockEnabled: change.autoClockEnabled }
}

/** The fixes a background delivery carries → POST /api/geofencing/location bodies, oldest first. */
export function locationBodies(locations: unknown): { lat: number; lng: number; accuracy?: number }[] {
  if (!Array.isArray(locations)) return []
  return locations
    .filter((l: any) => l && l.coords && Number.isFinite(l.coords.latitude) && Number.isFinite(l.coords.longitude))
    .sort((a: any, b: any) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0))
    .map((l: any) => ({
      lat: l.coords.latitude,
      lng: l.coords.longitude,
      ...(Number.isFinite(l.coords.accuracy) ? { accuracy: l.coords.accuracy } : {}),
    }))
}

/**
 * After a location post: keep going, or stop the native task. Stop when the server says tracking is
 * off for this person (switched off on another device or by the server), when the person is no longer
 * signed in (401 after the client's refresh), or when the business no longer has the feature or the
 * seat may not (403 / 404). No signal or a server error (0, 5xx) is not a reason to stop.
 */
export function afterPost(res: { ok: boolean; status: number; data: any }): 'keep' | 'stop' {
  if (res.ok) return res.data && res.data.tracking === false ? 'stop' : 'keep'
  return res.status === 401 || res.status === 403 || res.status === 404 ? 'stop' : 'keep'
}

/** The Location card's error ink, per theme (on the theme's `surface`; ≥ 4.5:1 — tests/mobile/location-tracking.test.ts). */
export const ERROR_INK = { light: '#b91c1c', dark: '#fca5a5' } as const
