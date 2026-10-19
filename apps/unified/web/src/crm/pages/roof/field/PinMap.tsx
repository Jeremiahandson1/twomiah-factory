// A Leaflet map of coloured pins on OpenStreetMap tiles — what roofing's canvassing and storm-lead screens drew
// (templates/crm-roof: CanvassingView, CanvassingDashboard, StormLeadsPage). The template read Leaflet off `window.L`, put
// there by a <script> from unpkg in its index.html; here Leaflet is the app's own dependency, imported on first use so
// the map code and its stylesheet load only when a map is opened. No key: the tiles are OpenStreetMap's.
//
// A popup's words are set as text, never as HTML (the template interpolated the address into its popup markup).
import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'

type L = typeof Leaflet

let leafletLoad: Promise<L> | null = null
const ensureLeaflet = (): Promise<L> => {
  if (!leafletLoad) {
    leafletLoad = Promise.all([import('leaflet'), import('leaflet/dist/leaflet.css')])
      .then(([mod]) => ((mod as unknown as { default?: L }).default || (mod as unknown as L)))
      .catch((e) => { leafletLoad = null; throw e })
  }
  return leafletLoad
}

/** Where the template's maps opened with nothing to centre on. */
const FALLBACK_CENTER: [number, number] = [32.78, -96.8]

export interface Pin {
  id: string
  lat: number
  lng: number
  /** The pin's fill (a fixed colour: the pins sit on the map's own light tiles in both themes). */
  color: string
  /** The popup's first line, in bold. */
  title: string
  /** The popup's further lines. */
  lines?: string[]
  /** Pixel radius; 8 by default. */
  radius?: number
}

interface Props {
  pins: Pin[]
  /** Where the map opens; the fallback when absent. */
  center?: [number, number] | null
  zoom?: number
  /** A circle of this many miles around the centre (a canvassing session's target radius). */
  circleMiles?: number | null
  /** Fit the view to the pins when there are two or more (the dashboard and the storm map did; the live canvass did not). */
  fit?: boolean
  className?: string
}

/** A number from a decimal column (which arrives as a string), or null when there is none. */
export const coord = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function popupOf(pin: Pin): HTMLElement {
  const el = document.createElement('div')
  const title = document.createElement('strong')
  title.textContent = pin.title
  el.appendChild(title)
  for (const line of pin.lines || []) {
    el.appendChild(document.createElement('br'))
    const span = document.createElement('span')
    span.textContent = line
    el.appendChild(span)
  }
  return el
}

export default function PinMap({ pins, center, zoom = 15, circleMiles, fit = true, className = 'h-80' }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const libRef = useRef<L | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const layerRef = useRef<Leaflet.LayerGroup | null>(null)
  const [ready, setReady] = useState(0)
  const [failed, setFailed] = useState(false)
  const lat = center?.[0] ?? null
  const lng = center?.[1] ?? null

  // The map itself, made once per centre.
  useEffect(() => {
    let cancelled = false
    let made: Leaflet.Map | null = null
    ensureLeaflet().then((L) => {
      if (cancelled || !divRef.current) return
      const at: [number, number] = lat !== null && lng !== null ? [lat, lng] : FALLBACK_CENTER
      made = L.map(divRef.current).setView(at, zoom)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(made)
      if (circleMiles && circleMiles > 0) {
        L.circle(at, { radius: circleMiles * 1609.34, color: '#3B82F6', fillOpacity: 0.05, weight: 1 }).addTo(made)
      }
      libRef.current = L
      layerRef.current = L.layerGroup().addTo(made)
      mapRef.current = made
      setReady((n) => n + 1)
    }).catch(() => { if (!cancelled) setFailed(true) })
    return () => {
      cancelled = true
      if (made) { try { made.remove() } catch { /* already gone */ } }
      mapRef.current = null
      layerRef.current = null
    }
  }, [lat, lng, zoom, circleMiles])

  // The pins, redrawn whenever they change.
  useEffect(() => {
    const L = libRef.current
    const map = mapRef.current
    const layer = layerRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    for (const pin of pins) {
      L.circleMarker([pin.lat, pin.lng], {
        radius: pin.radius ?? 8, fillColor: pin.color, color: '#fff', weight: 2, fillOpacity: 0.9,
      }).bindPopup(popupOf(pin)).addTo(layer)
    }
    if (fit && pins.length > 1) map.fitBounds(L.latLngBounds(pins.map((p) => [p.lat, p.lng] as [number, number])), { padding: [30, 30] })
  }, [pins, fit, ready])

  if (failed) {
    return (
      <div className={`${className} flex items-center justify-center text-sm text-gray-500 dark:text-slate-400`}>
        The map could not load.
      </div>
    )
  }
  // `isolate`: Leaflet's panes carry z-indexes up to 1000; inside their own stacking context they stay under the
  // page's dialogs (z-50) instead of drawing over them.
  return <div ref={divRef} className={`${className} isolate`} />
}
