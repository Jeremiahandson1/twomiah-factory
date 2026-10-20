/**
 * Background location for the trades — the native side (expo-location + expo-task-manager), the way
 * the field-service apps do it: the OS wakes the app with batched fixes (about every 100 m, at most
 * about once a minute), the app posts each to POST /api/geofencing/location, and the server records it
 * (the office's crew map) and — when the person also switched on "Clock me in and out at job sites" —
 * clocks them in or out at a job's geofence. The decisions live in ./policy.ts (tested under bun).
 *
 * The task is defined at module top level, and app/_layout.tsx imports this module, so the task exists
 * whenever the OS launches the app in the background to deliver locations (no screen is mounted then).
 */

import * as Location from 'expo-location'
import * as TaskManager from 'expo-task-manager'
import Constants from 'expo-constants'
import { getApiUrl, loadTokens, post } from '../api/client'
import { afterPost, locationBodies, permissionVerdict } from './policy'

export const LOCATION_TASK = 'twomiah-location'

/** Does this build declare background location (app.config.ts — the trade variants, not Twomiah Care)? */
export const BUILD_SUPPORTS_BACKGROUND = (Constants.expoConfig?.extra as any)?.backgroundLocation === true

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data) return
  try {
    // A background launch starts with an empty client: read the saved server and tokens first.
    if (!getApiUrl()) await loadTokens()
    if (!getApiUrl()) return
    for (const body of locationBodies(data.locations)) {
      const res = await post('/api/geofencing/location', body)
      if (afterPost(res) === 'stop') {
        await stopTracking()
        return
      }
    }
  } catch {
    /* no signal, or the keychain is locked — the next delivery tries again */
  }
})

export async function permissionState() {
  const fg = await Location.getForegroundPermissionsAsync()
  const bg = await Location.getBackgroundPermissionsAsync()
  return permissionVerdict(fg.status as any, bg.status as any)
}

/**
 * Ask for "While using", then "Always" — only ever from the person's own tap on the switch. Returns
 * the verdict; tracking starts only on 'always'.
 */
export async function requestPermission() {
  const fg = await Location.requestForegroundPermissionsAsync()
  if (fg.status !== 'granted') return permissionVerdict(fg.status as any, 'denied')
  const bg = await Location.requestBackgroundPermissionsAsync()
  return permissionVerdict('granted', bg.status as any)
}

export async function isTracking(): Promise<boolean> {
  try {
    if (!(await TaskManager.isTaskRegisteredAsync(LOCATION_TASK))) return false
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)
  } catch {
    return false
  }
}

/** Start the background updates. The caller has the person's consent and 'always' permission. */
export async function startTracking(): Promise<boolean> {
  if ((await permissionState()) !== 'always') return false
  if (await isTracking()) return true
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 100,
    deferredUpdatesDistance: 100,
    deferredUpdatesInterval: 60_000,
    timeInterval: 60_000,
    // Never paused by iOS: after a long stop at a site, a paused stream may not resume until the app is opened, and the
    // auto clock-out on leaving would be missed. The person turns sharing off when they are done for the day.
    pausesUpdatesAutomatically: false,
    activityType: Location.ActivityType.AutomotiveNavigation,
    showsBackgroundLocationIndicator: true,
    foregroundService: {
      notificationTitle: 'Location on for work',
      notificationBody: 'Your business uses your location to clock you in and out at job sites and to show the office where the crew is. Turn it off in the app under Alerts.',
      killServiceOnDestroy: false,
    },
  })
  return true
}

export async function stopTracking(): Promise<void> {
  try {
    if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK)
  } catch {
    /* not running */
  }
}
