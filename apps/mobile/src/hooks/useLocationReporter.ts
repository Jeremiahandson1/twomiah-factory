import { useEffect, useRef } from 'react'
import * as Location from 'expo-location'
import { AppState } from 'react-native'
import { post } from '../api/client'
import { useAuth } from '../auth/AuthContext'

const REPORT_INTERVAL_MS = 60_000

/**
 * Foreground location reporter.
 *
 * While a technician is signed in and the app is active, post their position to
 * the CRM once a minute. The server (POST /api/geofencing/location) records it in
 * location_log, which drives the fleet live-map, location history, geofence
 * arrival/exit, and auto-clock.
 *
 * Deliberately FOREGROUND-ONLY: reporting stops when the app is backgrounded.
 * Continuous background tracking (battery drain, background-location consent,
 * app-store review) is a separate, opt-in enterprise capability — not this.
 */
export function useLocationReporter() {
  const { isAuthenticated } = useAuth()
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const granted = useRef(false)

  useEffect(() => {
    let cancelled = false

    async function reportOnce() {
      if (!granted.current || AppState.currentState !== 'active') return
      try {
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced })
        await post('/api/geofencing/location', {
          lat: loc.coords.latitude,
          lng: loc.coords.longitude,
          accuracy: loc.coords.accuracy ?? undefined,
        })
      } catch {
        /* transient GPS / network failure — retry on the next tick */
      }
    }

    function stop() {
      if (timer.current) {
        clearInterval(timer.current)
        timer.current = null
      }
    }

    async function start() {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (cancelled) return
      granted.current = status === 'granted'
      if (!granted.current) return
      reportOnce()
      timer.current = setInterval(reportOnce, REPORT_INTERVAL_MS)
    }

    if (isAuthenticated) start()
    else stop()

    return () => {
      cancelled = true
      stop()
    }
  }, [isAuthenticated])
}
