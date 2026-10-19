// The caregiver app's GPS: the browser half of templates/crm-homecare/frontend/src/hooks/useNative.ts useGeolocation.
//
// The template's web build always stubbed Capacitor (its vite.config.js aliased @capacitor/* to capacitor-stub), so
// `isNative` was false in every browser and only this branch ever ran: a one-shot getCurrentPosition and a
// watchPosition, both high accuracy. The native branches, the haptics (no-ops off a phone), the background watcher
// (on the web a second watchPosition whose callback the dashboard left empty), the network hook and the IndexedDB
// queue counter (read by nothing on screen) are not moved — see the visits group's report.
import { useCallback, useEffect, useRef, useState } from 'react'

export interface GeoPosition {
  latitude: number
  longitude: number
  accuracy: number
  timestamp: number
}

const fromBrowser = (pos: GeolocationPosition): GeoPosition => ({
  latitude: pos.coords.latitude,
  longitude: pos.coords.longitude,
  accuracy: pos.coords.accuracy,
  timestamp: pos.timestamp,
})

const hasGeolocation = () => typeof navigator !== 'undefined' && 'geolocation' in navigator

/** One-shot position (getPosition) and, with `watch`, the live position while the screen is open. */
export function useGeolocation({ watch = false, highAccuracy = true }: { watch?: boolean; highAccuracy?: boolean } = {}) {
  const [position, setPosition] = useState<GeoPosition | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const watchIdRef = useRef<number | null>(null)

  const getPosition = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (!hasGeolocation()) throw new Error('Geolocation not supported')
      await new Promise<void>((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(
          (pos) => { setPosition(fromBrowser(pos)); resolve() },
          (err) => reject(new Error(err.message)),
          { enableHighAccuracy: highAccuracy, timeout: 15000 },
        )
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [highAccuracy])

  useEffect(() => {
    if (!watch || !hasGeolocation()) return
    let cancelled = false
    watchIdRef.current = navigator.geolocation.watchPosition(
      (pos) => { if (!cancelled) setPosition(fromBrowser(pos)) },
      (err) => { if (!cancelled) setError(err.message) },
      { enableHighAccuracy: true },
    )
    return () => {
      cancelled = true
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
      watchIdRef.current = null
    }
  }, [watch])

  return { position, error, loading, getPosition }
}
