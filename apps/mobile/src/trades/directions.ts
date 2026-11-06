/**
 * Directions in the maps app the crew chooses (landscaping parity row 11; Jobber: Apple Maps / Google Maps / Waze) — pure, tested
 * by tests/mobile/landscaping-directions.test.ts.
 *
 * Each app is opened by its UNIVERSAL address (https / maps.apple.com): the phone hands it to the app when it is installed and to the
 * browser when it is not, so no app has to be detected first (iOS would need every app's scheme declared ahead in the build to ask).
 * Apple Maps is offered on iPhones only. The choice is remembered on the phone (CHOICE_KEY) and can be changed from the visit.
 * Turn-by-turn spoken directions are the maps apps' own; Twomiah shows the day's stops on a map (row 14) and hands the drive to them.
 */
export type MapsApp = 'apple' | 'google' | 'waze'
export const CHOICE_KEY = 'twomiah_maps_app_v1'
export const MAPS_APPS: Array<{ id: MapsApp; label: string; iosOnly?: boolean }> = [
  { id: 'google', label: 'Google Maps' }, { id: 'apple', label: 'Apple Maps', iosOnly: true }, { id: 'waze', label: 'Waze' },
]

/** The apps this phone is offered. */
export const appsFor = (platform: string) => MAPS_APPS.filter((a) => !a.iosOnly || platform === 'ios')

/** A remembered choice read back from the phone: one this phone is offered, else none. */
export const readChoice = (stored: string | null | undefined, platform: string): MapsApp | null =>
  appsFor(platform).some((a) => a.id === stored) ? (stored as MapsApp) : null

/** Driving directions to an address in the chosen app. */
export function directionsUrl(app: MapsApp, address: string): string {
  const to = encodeURIComponent(address.trim())
  if (app === 'apple') return `https://maps.apple.com/?daddr=${to}&dirflg=d`
  if (app === 'waze') return `https://waze.com/ul?q=${to}&navigate=yes`
  return `https://www.google.com/maps/dir/?api=1&destination=${to}&travelmode=driving`
}

export const appLabel = (app: MapsApp | null) => MAPS_APPS.find((a) => a.id === app)?.label ?? null
