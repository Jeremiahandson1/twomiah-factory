// A Leaflet map for drawing and showing areas — the storm map's path and the canvass territories (server/crm/roof/field/geo.ts
// says what a shape is: a polygon of [lat, lng] corners, or a circle with a radius in miles). No drawing library: while
// `drawing` is set a click on the map adds a corner (polygon) or sets the centre (circle); the shape-in-progress is shown and
// the page owns the corners (undo, clear, finish are the page's buttons).
//
// Same tiles, centre and Leaflet loader as PinMap.tsx; nothing here calls a paid service.
import { useEffect, useRef, useState } from 'react'
import type * as Leaflet from 'leaflet'
import { addMapTiles } from '@twomiah/tenant-ui/src/maps/tiles'
import { useMapCenter, US_VIEW, HOME_ZOOM } from '@twomiah/tenant-ui/src/maps/center'
import { api } from '../../../../api'
import { ensureLeaflet, type Pin } from './PinMap'

export type LatLng = [number, number]
export type Shape =
  | { kind: 'polygon'; points: LatLng[] }
  | { kind: 'circle'; lat: number; lng: number; radiusMiles: number }

export interface DrawnArea { id: string; shape: Shape; color: string; label?: string }

interface Props {
  areas: DrawnArea[]
  pins?: Pin[]
  /** The shape being drawn: shown dashed, and clicks on the map call onPick. */
  draft?: Shape | null
  drawing?: boolean
  onPick?: (lat: number, lng: number) => void
  onAreaClick?: (id: string) => void
  /** Fit the view to the areas (and pins) when they change. */
  fit?: boolean
  className?: string
}

const MILE = 1609.34

export default function ShapeMap({ areas, pins = [], draft = null, drawing = false, onPick, onAreaClick, fit = true, className = 'h-96' }: Props) {
  const divRef = useRef<HTMLDivElement | null>(null)
  const libRef = useRef<typeof Leaflet | null>(null)
  const mapRef = useRef<Leaflet.Map | null>(null)
  const layerRef = useRef<Leaflet.LayerGroup | null>(null)
  const pickRef = useRef(onPick)
  const drawingRef = useRef(drawing)
  pickRef.current = onPick
  drawingRef.current = drawing
  const [ready, setReady] = useState(0)
  const [failed, setFailed] = useState(false)
  const home = useMapCenter((p) => api.get(p))
  const lat = home?.lat ?? null, lng = home?.lng ?? null

  useEffect(() => {
    let cancelled = false
    let made: Leaflet.Map | null = null
    ensureLeaflet().then((L) => {
      if (cancelled || !divRef.current) return
      const placed = lat !== null && lng !== null
      made = L.map(divRef.current).setView(placed ? [lat, lng] : US_VIEW.center, placed ? HOME_ZOOM : US_VIEW.zoom)
      addMapTiles(L, made, 'hybrid')
      made.on('click', (e: Leaflet.LeafletMouseEvent) => { if (drawingRef.current) pickRef.current?.(e.latlng.lat, e.latlng.lng) })
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
  }, [lat, lng])

  // The cursor says the map is being drawn on.
  useEffect(() => { if (divRef.current) divRef.current.style.cursor = drawing ? 'crosshair' : '' }, [drawing, ready])

  useEffect(() => {
    const L = libRef.current, map = mapRef.current, layer = layerRef.current
    if (!L || !map || !layer) return
    layer.clearLayers()
    const bounds: Leaflet.LatLngExpression[] = []
    const add = (s: Shape, o: Leaflet.PathOptions, dashed = false) => {
      const opts = { ...o, ...(dashed ? { dashArray: '6 6' } : {}) }
      if (s.kind === 'circle') {
        const c = L.circle([s.lat, s.lng], { ...opts, radius: s.radiusMiles * MILE })
        c.addTo(layer)
        return c
      }
      if (s.points.length >= 3) { const p = L.polygon(s.points, opts); p.addTo(layer); s.points.forEach((q) => bounds.push(q)); return p }
      if (s.points.length >= 1) { L.polyline(s.points, opts).addTo(layer); s.points.forEach((q) => L.circleMarker(q, { radius: 4, color: opts.color }).addTo(layer)); s.points.forEach((q) => bounds.push(q)) }
      return null
    }
    for (const a of areas) {
      const item = add(a.shape, { color: a.color, weight: 2, fillOpacity: 0.15 })
      if (item && a.label) item.bindTooltip(a.label, { sticky: true })
      if (item && onAreaClick) item.on('click', () => { if (!drawingRef.current) onAreaClick(a.id) })
      if (a.shape.kind === 'circle') bounds.push(...circleCorners(a.shape))
    }
    if (draft) {
      add(draft, { color: '#f59e0b', weight: 3, fillOpacity: 0.1 }, true)
      if (draft.kind === 'circle') bounds.push(...circleCorners(draft))
    }
    for (const pin of pins) {
      const m = L.circleMarker([pin.lat, pin.lng], { radius: pin.radius ?? 6, fillColor: pin.color, color: '#fff', weight: 2, fillOpacity: 0.9 })
      const el = document.createElement('div')
      const strong = document.createElement('strong')
      strong.textContent = pin.title
      el.appendChild(strong)
      for (const line of pin.lines || []) { el.appendChild(document.createElement('br')); const span = document.createElement('span'); span.textContent = line; el.appendChild(span) }
      m.bindPopup(el).addTo(layer)
      bounds.push([pin.lat, pin.lng])
    }
    if (fit && bounds.length > 0 && !drawingRef.current) map.fitBounds(L.latLngBounds(bounds), { padding: [30, 30], maxZoom: 15 })
  }, [areas, pins, draft, fit, ready, onAreaClick])

  if (failed) return <div className={`${className} flex items-center justify-center text-sm text-gray-500 dark:text-slate-400`}>The map could not load.</div>
  return <div ref={divRef} className={`${className} isolate rounded-lg`} />
}

/** The four points of a circle's box, for fitting the view. */
function circleCorners(s: { lat: number; lng: number; radiusMiles: number }): LatLng[] {
  const dLat = s.radiusMiles / 69
  const dLng = dLat / Math.max(0.01, Math.cos((s.lat * Math.PI) / 180))
  return [[s.lat - dLat, s.lng - dLng], [s.lat + dLat, s.lng + dLng]]
}
