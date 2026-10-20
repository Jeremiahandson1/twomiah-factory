/**
 * On app start (and when the signed-in business changes): make the native location task match the
 * person's own choice. Sharing on + "Always" permission → make sure it is running; sharing off, the
 * permission taken away in phone settings, or a business / trade not offered it → make sure it is
 * stopped. Never asks for a permission and never turns anything on by itself — only the Location card
 * (src/location/LocationCard.tsx), from the person's tap, does that.
 *
 * Replaces the old foreground reporter (src/hooks/useLocationReporter.ts), which asked every signed-in
 * technician for location permission on launch and posted a fix every minute whether or not they had
 * switched sharing on (the server dropped those) — and posted to /api/geofencing in businesses without
 * gps_tracking, where the route is not mounted.
 */

import { useEffect } from 'react'
import { get } from '../api/client'
import { useAuth } from '../auth/AuthContext'
import { useVertical } from '../vertical/VerticalContext'
import { settingsFromReply, startupAction, trackingOffered } from './policy'
import { BUILD_SUPPORTS_BACKGROUND, isTracking, permissionState, startTracking, stopTracking } from './tracking'

export function useTrackingOffered() {
  const { vertical, hasFeature } = useVertical()
  return trackingOffered({ vertical, hasGpsFeature: hasFeature('gps_tracking'), buildSupportsBackground: BUILD_SUPPORTS_BACKGROUND })
}

export function useTrackingSync() {
  const { isAuthenticated, isLoading, company } = useAuth()
  const offered = useTrackingOffered()

  useEffect(() => {
    if (isLoading) return
    let cancelled = false
    ;(async () => {
      try {
        // Signed out (a session that ended without logout(), e.g. an expired one): nothing may report.
        if (!isAuthenticated) { await stopTracking(); return }
        const running = await isTracking()
        const settings = offered ? settingsFromReply(await get('/api/geofencing/settings')) : null
        const permission = offered ? await permissionState() : 'denied'
        if (cancelled) return
        const action = startupAction({ offered, settings, permission, running })
        if (action === 'start') await startTracking()
        else if (action === 'stop') await stopTracking()
      } catch {
        /* the next launch tries again */
      }
    })()
    return () => { cancelled = true }
  }, [isAuthenticated, isLoading, offered, company?.id])
}
