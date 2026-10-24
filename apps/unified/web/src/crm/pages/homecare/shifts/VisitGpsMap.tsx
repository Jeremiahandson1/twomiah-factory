// Moved from templates/crm-homecare/frontend/src/components/admin/VisitGpsMap.tsx (ported there from CVHC
// VisitGpsMap.jsx): a Leaflet map of one visit's GPS trail.
//
// Draws the trail of GPS pings, start (green) / last (red) markers and the client's home (blue ★) when known, with the
// tracked distance and duration and an "Open in Google Maps" link.
//
// The trail is GET /api/time-entries/:id/gps (server/crm/homecare/visits/timeTracking.ts): a list reply of gps_tracking
// rows, { data: [{ latitude, longitude, timestamp, … }] } — the template's reply was the bare array. No token: the
// session is the app's.
import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { addMapTiles } from '@twomiah/tenant-ui/src/maps/tiles'
import { api, rows, errorMessage } from '../lib/http'
import { formatDateTime } from '../lib/datetime'

type L = typeof Leaflet

// Leaflet is imported on first use so the map code and its stylesheet only load when someone opens a map.
let leafletLoadPromise: Promise<L> | null = null
const ensureLeaflet = (): Promise<L> => {
  if (!leafletLoadPromise) {
    leafletLoadPromise = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => ((mod as unknown as { default?: L }).default || (mod as unknown as L)))
      .catch((e) => { leafletLoadPromise = null; throw e })
  }
  return leafletLoadPromise
}

const haversineMi = (a: { lat: number; lng: number }, b: { lat: number; lng: number }) => {
  const R = 3958.8
  const toRad = (d: number) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLng = toRad(b.lng - a.lng)
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s))
}

/** A gps_tracking row (decimal columns arrive as strings). */
interface GpsPoint {
  id: string
  latitude: string | number | null
  longitude: string | number | null
  timestamp: string | null
}

type Coord = string | number | null | undefined

interface Props {
  timeEntryId: string
  clientLat?: Coord
  clientLng?: Coord
  clientName?: string
}

export default function VisitGpsMap({ timeEntryId, clientLat, clientLng, clientName }: Props) {
  const mapDivRef = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const [points, setPoints] = useState<GpsPoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!timeEntryId) return
    let cancelled = false
    ;(async () => {
      try {
        const reply = await api.get(`/api/time-entries/${encodeURIComponent(timeEntryId)}/gps`)
        if (!cancelled) setPoints(rows<GpsPoint>(reply))
      } catch (e) { if (!cancelled) setError(errorMessage(e, 'Failed to load GPS trail')) }
      finally { if (!cancelled) setLoading(false) }
    })()
    return () => { cancelled = true }
  }, [timeEntryId])

  useEffect(() => {
    if (loading || error) return
    let mapInstance: Leaflet.Map | null = null
    let cancelled = false
    ;(async () => {
      try {
        const L = await ensureLeaflet()
        if (cancelled || !mapDivRef.current) return
        if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

        const trail = points
          .filter((p) => p.latitude != null && p.longitude != null)
          .map((p) => ({ lat: parseFloat(String(p.latitude)), lng: parseFloat(String(p.longitude)), t: p.timestamp }))
        const home = (clientLat != null && clientLng != null && clientLat !== '' && clientLng !== '')
          ? { lat: parseFloat(String(clientLat)), lng: parseFloat(String(clientLng)) }
          : null

        if (trail.length === 0 && !home) {
          mapDivRef.current.innerHTML = '<div style="padding: 20px; color: var(--hc-ink-soft); text-align: center;">No GPS data recorded for this visit.</div>'
          return
        }

        const center = trail[0] || home!
        mapInstance = L.map(mapDivRef.current).setView([center.lat, center.lng], 15)
        mapRef.current = mapInstance
        addMapTiles(L, mapInstance, 'roadmap')

        // The markers sit on the map's own (light) tiles in both themes: white on a fixed dark colour.
        const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch] as string))
        if (home) {
          L.marker([home.lat, home.lng], {
            title: `${clientName || 'Client'} home`,
            icon: L.divIcon({
              className: 'visit-gps-home-marker',
              html: '<div style="background:#2563EB;color:#fff;border-radius:50%;width:28px;height:28px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">★</div>',
              iconSize: [28, 28], iconAnchor: [14, 14],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>${esc(clientName || 'Client')}</strong><br/>Home location`)
        }

        if (trail.length > 0) {
          const latlngs: Leaflet.LatLngTuple[] = trail.map((p) => [p.lat, p.lng])
          L.polyline(latlngs, { color: '#0F766E', weight: 4, opacity: 0.85 }).addTo(mapInstance)
          L.marker(latlngs[0], {
            title: 'Clock in',
            icon: L.divIcon({
              className: 'visit-gps-start-marker',
              html: '<div style="background:#047857;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">▶</div>',
              iconSize: [24, 24], iconAnchor: [12, 12],
            }),
          }).addTo(mapInstance).bindPopup(`<strong>Clock-in</strong><br/>${esc(formatDateTime(trail[0].t))}`)
          if (trail.length > 1) {
            const last = trail[trail.length - 1]
            L.marker([last.lat, last.lng], {
              title: 'Clock out',
              icon: L.divIcon({
                className: 'visit-gps-end-marker',
                html: '<div style="background:#DC2626;color:#fff;border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-weight:700;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);">■</div>',
                iconSize: [24, 24], iconAnchor: [12, 12],
              }),
            }).addTo(mapInstance).bindPopup(`<strong>Last GPS ping</strong><br/>${esc(formatDateTime(last.t))}`)
          }
          const all: Leaflet.LatLngTuple[] = home ? [...latlngs, [home.lat, home.lng]] : latlngs
          mapInstance.fitBounds(all, { padding: [32, 32] })
        } else if (home) {
          mapInstance.setView([home.lat, home.lng], 16)
        }
      } catch (e) {
        if (!cancelled) setError(errorMessage(e, 'Could not draw the map'))
      }
    })()
    return () => {
      cancelled = true
      if (mapInstance) { try { mapInstance.remove() } catch { /* already gone */ } }
      mapRef.current = null
    }
  }, [loading, error, points, clientLat, clientLng, clientName])

  const trail = points.filter((p) => p.latitude != null && p.longitude != null)
  let distMi = 0
  for (let i = 1; i < trail.length; i++) {
    distMi += haversineMi(
      { lat: parseFloat(String(trail[i - 1].latitude)), lng: parseFloat(String(trail[i - 1].longitude)) },
      { lat: parseFloat(String(trail[i].latitude)), lng: parseFloat(String(trail[i].longitude)) },
    )
  }
  // Instants (gps_tracking.timestamp), so a plain parse is right.
  const startT = trail[0]?.timestamp
  const endT = trail[trail.length - 1]?.timestamp
  const durMin = (startT && endT) ? Math.round((new Date(endT).getTime() - new Date(startT).getTime()) / 60000) : null

  return (
    <div>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: 8, fontSize: '0.85rem', color: 'var(--hc-ink-soft)' }}>
        <span><strong>{trail.length}</strong> GPS pings</span>
        {durMin != null && <span><strong>{durMin}</strong> min of tracking</span>}
        {distMi > 0 && <span><strong>{distMi.toFixed(2)}</strong> mi traveled (caregiver position drift)</span>}
        {trail.length > 0 && (
          <a target="_blank" rel="noopener noreferrer"
             href={`https://www.google.com/maps/dir/${trail.map((p) => `${p.latitude},${p.longitude}`).join('/')}`}
             style={{ marginLeft: 'auto', color: 'var(--hc-blue-ink)' }}>
            Open in Google Maps ↗
          </a>
        )}
      </div>
      {loading ? (
        <div style={{ padding: 24, textAlign: 'center', color: 'var(--hc-ink-soft)' }}>Loading GPS trail…</div>
      ) : error ? (
        <div style={{ padding: 16, background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', borderRadius: 6 }}>Error: {error}</div>
      ) : (
        <div ref={mapDivRef} style={{ width: '100%', height: 400, borderRadius: 8, border: '1px solid var(--hc-line)', background: 'var(--hc-subtle)' }} />
      )}
    </div>
  )
}
