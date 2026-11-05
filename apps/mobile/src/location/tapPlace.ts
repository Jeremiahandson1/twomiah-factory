/**
 * Where the phone is at a clock tap, for the GPS stamp on the entry (server time/time.ts `place`). It never asks: only when
 * the person already allowed location (the switch on the Clock screen's location card) does the tap carry a place, and a slow or
 * missing fix is simply left off after a few seconds — a clock tap is never held up, or refused, over a place.
 * The body is made by ../jobflow/clock.ts placeBody (tested).
 */
import * as Location from 'expo-location'
import { placeBody } from '../jobflow/clock'

const WAIT_MS = 4000

export async function tapPlace(): Promise<ReturnType<typeof placeBody>> {
  try {
    const perm = await Location.getForegroundPermissionsAsync()
    if (perm.status !== 'granted') return {}
    const fix = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), WAIT_MS)),
    ])
    return placeBody(fix?.coords)
  } catch {
    return {}
  }
}
