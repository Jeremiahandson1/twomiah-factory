// The draw-it-yourself roof report's screen: pick a line type, click dot to dot over the aerial picture, press Done.
// Wherever the lines close a loop the roof gains a section; each section gets its pitch (read from the height map under
// the picture, and the roofer may set it — from the pitch gauge on a phone, or by typing), and the area, squares and
// every line's real length are worked out as the roofer draws (packages/roof-core/src/v2/drawnRoof — the same arithmetic
// the server saves the report with).
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url'
import { Check, CornerDownLeft, Loader2, MousePointer2, Pencil, Redo2, Ruler, Trash2, Undo2 } from 'lucide-react'
import { measureDrawnRoof, toLocal, toLatLng, interiorPoint, insideOutline, type DrawnLineType } from '@twomiah/roof-core/src/v2/drawnRoof'
import { decodePitchGrid, pitchInside, facingInside } from '@twomiah/roof-core/src/v2/facePitch'
import type { DrawBackdrop } from '@twomiah/roof-core/src/v2/drawBackdrop'
import PitchGauge from './PitchGauge'

maplibregl.setWorkerUrl(maplibreWorkerUrl)

const GLYPHS = 'https://fonts.openmaptiles.org/{fontstack}/{range}.pbf'

export interface LatLng { lat: number; lng: number }
interface Line { id: string; type: DrawnLineType; a: LatLng; b: LatLng }

/** What Done hands back: the drawing as POST /api/roof-reports/finalize-drawn takes it. */
export interface DrawnPayload {
  lines: Array<{ type: DrawnLineType; startLat: number; startLng: number; endLat: number; endLng: number }>
  facePitches: Array<{ lat: number; lng: number; pitchOver12: number }>
  /** Which way each section faces (read from the aerial data), for the report's table. */
  faceFacings: Array<{ lat: number; lng: number; azimuthDeg: number }>
  /** What the roofer called each building, when more than one was drawn. */
  buildingNames: Array<{ lat: number; lng: number; name: string }>
  defaultPitchOver12: number
  wastePct: number
}

interface Props {
  aerialImage: string
  backdrop: DrawBackdrop
  /** Saving, after Done. */
  busy?: boolean
  onDone: (drawing: DrawnPayload) => void
}

const TYPES: Array<{ type: DrawnLineType; label: string; color: string }> = [
  // The five the saved report has always drawn keep its colours (packages/roof-core roofReportRenderer EDGE_COLORS).
  { type: 'eave', label: 'Eave', color: '#805AD5' },
  { type: 'rake', label: 'Rake', color: '#DD6B20' },
  { type: 'ridge', label: 'Ridge', color: '#E53E3E' },
  { type: 'hip', label: 'Hip', color: '#38A169' },
  { type: 'valley', label: 'Valley', color: '#3182CE' },
  { type: 'flash', label: 'Wall flashing', color: '#0891b2' },
  { type: 'stepflash', label: 'Step flashing', color: '#ca8a04' },
]
const TYPE_OF = Object.fromEntries(TYPES.map((t) => [t.type, t])) as Record<DrawnLineType, (typeof TYPES)[number]>
const FACE_FILL = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316']

let nextId = 1
const newId = () => `l${nextId++}`
const pitchText = (p: number) => `${Number.isInteger(p) ? p : p.toFixed(1)}/12`
const feet = (n: number) => `${n.toLocaleString(undefined, { maximumFractionDigits: 1 })} ft`

export default function DrawRoofEditor({ aerialImage, backdrop, busy, onDone }: Props) {
  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)

  const [lines, setLines] = useState<Line[]>([])
  const [undone, setUndone] = useState<Line[][]>([])
  const [history, setHistory] = useState<Line[][]>([])
  const [type, setType] = useState<DrawnLineType>('eave')
  const [mode, setMode] = useState<'draw' | 'select'>('draw')
  /** The dot the next line starts from, while drawing dot to dot; and where the chain began (to close a loop on it). */
  const [from, setFrom] = useState<LatLng | null>(null)
  const [chainStart, setChainStart] = useState<LatLng | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [defaultPitch, setDefaultPitch] = useState('6')
  const [waste, setWaste] = useState('10')
  /** Pitches the roofer set, each pinned to a point inside its section. */
  const [setPitches, setSetPitches] = useState<Array<LatLng & { pitchOver12: number }>>([])
  const [gaugeFor, setGaugeFor] = useState<number | 'roof' | null>(null)
  /** Names the roofer gave buildings ("House", "Garage"), each pinned to a point inside the building. */
  const [names, setNames] = useState<Array<LatLng & { name: string }>>([])

  const origin = useMemo(() => ({ lat: backdrop.center.lat, lng: backdrop.center.lng }), [backdrop])
  const grid = useMemo(() => decodePitchGrid(backdrop.pitchGrid), [backdrop])
  const defaultPitchNumber = Math.max(0, Math.min(24, Number(defaultPitch) || 0))
  const wasteNumber = Math.max(0, Math.min(50, Number(waste) || 0))

  // ── The measuring, live ──
  const result = useMemo(() => {
    const local = lines.map((l) => ({ type: l.type, a: toLocal(l.a, origin), b: toLocal(l.b, origin) }))
    const source: Array<'set' | 'read' | 'roof'> = []
    const roof = measureDrawnRoof(local, {
      defaultPitchOver12: defaultPitchNumber,
      pitchOfFace: (outline, i) => {
        const mine = setPitches.find((s) => insideOutline(toLocal(s, origin), outline))
        if (mine) { source[i] = 'set'; return mine.pitchOver12 }
        const read = pitchInside(outline.map((p) => toLatLng(p, origin)), grid, backdrop.corners)
        source[i] = read != null ? 'read' : 'roof'
        return read
      },
    })
    const faces = roof.faces.map((f, i) => {
      const ring = f.outline.map((p) => toLatLng(p, origin))
      return { ...f, source: source[i] || 'roof', at: toLatLng(interiorPoint(f.outline), origin), ring, facing: facingInside(ring, grid, backdrop.corners) }
    })
    return { roof, faces }
  }, [lines, setPitches, defaultPitchNumber, origin, grid, backdrop])

  // The buildings drawn (a house and a detached garage are two), each with the name the roofer gave it.
  const buildings = result.roof.buildings.map((b, i) => {
    const mine = names.find((n) => b.faces.some((fi) => insideOutline(toLocal(n, origin), result.roof.faces[fi].outline)))
    return { ...b, at: result.faces[b.faces[0]].at, name: mine?.name ?? '', fallback: `Building ${i + 1}` }
  })
  const nameBuilding = (index: number, name: string) => {
    const b = buildings[index]
    if (!b) return
    const kept = names.filter((n) => !b.faces.some((fi) => insideOutline(toLocal(n, origin), result.roof.faces[fi].outline)))
    setNames([...kept, { ...b.at, name: name.slice(0, 40) }])
  }

  const squares = result.roof.areaSqft / 100
  const squaresWithWaste = Math.round(squares * (1 + wasteNumber / 100) * 100) / 100

  // ── Editing ──
  const commit = useCallback((next: Line[]) => {
    setHistory((h) => [...h.slice(-49), lines])
    setUndone([])
    setLines(next)
  }, [lines])
  const undo = useCallback(() => {
    if (!history.length) return
    setUndone((u) => [...u, lines]); setLines(history[history.length - 1]); setHistory((h) => h.slice(0, -1)); setFrom(null); setChainStart(null)
  }, [history, lines])
  const redo = useCallback(() => {
    if (!undone.length) return
    setHistory((h) => [...h, lines]); setLines(undone[undone.length - 1]); setUndone((u) => u.slice(0, -1))
  }, [undone, lines])
  const finishLine = useCallback(() => { setFrom(null); setChainStart(null) }, [])
  const removeSelected = useCallback(() => {
    if (!selected) return
    commit(lines.filter((l) => l.id !== selected)); setSelected(null)
  }, [selected, lines, commit])

  const setFacePitch = (faceIndex: number, pitchOver12: number | null) => {
    const face = result.faces[faceIndex]
    if (!face) return
    const kept = setPitches.filter((s) => !insideOutline(toLocal(s, origin), face.outline))
    setSetPitches(pitchOver12 == null ? kept : [...kept, { ...face.at, pitchOver12: Math.max(0, Math.min(24, pitchOver12)) }])
  }

  // ── The map ──
  useEffect(() => {
    if (!mapEl.current) return
    const c = backdrop.corners
    const map = new maplibregl.Map({
      container: mapEl.current,
      style: {
        version: 8, glyphs: GLYPHS,
        sources: { aerial: { type: 'image', url: aerialImage, coordinates: [[c[0].lng, c[0].lat], [c[1].lng, c[1].lat], [c[2].lng, c[2].lat], [c[3].lng, c[3].lat]] } },
        layers: [{ id: 'bg', type: 'background', paint: { 'background-color': '#1f2937' } }, { id: 'aerial', type: 'raster', source: 'aerial', paint: { 'raster-fade-duration': 0 } }],
      },
      center: [backdrop.center.lng, backdrop.center.lat], zoom: 19.8, maxZoom: 23, minZoom: 17,
      attributionControl: false, doubleClickZoom: false, dragRotate: false, pitchWithRotate: false,
    })
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')
    map.on('load', () => {
      const empty = { type: 'FeatureCollection' as const, features: [] }
      for (const id of ['faces', 'face-labels', 'lines', 'dots', 'rubber']) map.addSource(id, { type: 'geojson', data: empty })
      map.addLayer({ id: 'faces', type: 'fill', source: 'faces', paint: { 'fill-color': ['get', 'color'], 'fill-opacity': 0.28 } })
      map.addLayer({ id: 'lines-halo', type: 'line', source: 'lines', paint: { 'line-color': '#ffffff', 'line-width': ['case', ['get', 'selected'], 8, 5], 'line-opacity': 0.85 }, layout: { 'line-cap': 'round' } })
      map.addLayer({ id: 'lines', type: 'line', source: 'lines', paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['get', 'selected'], 5, 3] }, layout: { 'line-cap': 'round' } })
      map.addLayer({ id: 'line-labels', type: 'symbol', source: 'lines', layout: { 'symbol-placement': 'line-center', 'text-field': ['get', 'label'], 'text-size': 11, 'text-font': ['Open Sans Bold'], 'text-offset': [0, -0.9], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': ['get', 'color'], 'text-halo-width': 2 } })
      map.addLayer({ id: 'rubber', type: 'line', source: 'rubber', paint: { 'line-color': ['get', 'color'], 'line-width': 2, 'line-dasharray': [2, 2] } })
      map.addLayer({ id: 'dots', type: 'circle', source: 'dots', paint: { 'circle-radius': ['case', ['get', 'active'], 6, 3.5], 'circle-color': ['case', ['get', 'active'], '#f97316', '#ffffff'], 'circle-stroke-color': '#111827', 'circle-stroke-width': 1.5 } })
      map.addLayer({ id: 'face-labels', type: 'symbol', source: 'face-labels', layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-font': ['Open Sans Bold'], 'text-allow-overlap': true }, paint: { 'text-color': '#ffffff', 'text-halo-color': '#111827', 'text-halo-width': 1.6 } })
      mapRef.current = map
      setReady(true)
    })
    return () => { mapRef.current = null; map.remove() }
  }, [aerialImage, backdrop])

  // Draw what there is.
  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const src = (id: string) => map.getSource(id) as maplibregl.GeoJSONSource
    src('lines').setData({
      type: 'FeatureCollection',
      features: lines.map((l, i) => ({
        type: 'Feature',
        properties: { id: l.id, color: TYPE_OF[l.type].color, selected: l.id === selected, label: result.roof.lines[i] ? `${result.roof.lines[i].lengthFt.toFixed(1)}'` : '' },
        geometry: { type: 'LineString', coordinates: [[l.a.lng, l.a.lat], [l.b.lng, l.b.lat]] },
      })),
    })
    src('faces').setData({
      type: 'FeatureCollection',
      features: result.faces.map((f, i) => ({ type: 'Feature', properties: { color: FACE_FILL[i % FACE_FILL.length] }, geometry: { type: 'Polygon', coordinates: [[...f.ring, f.ring[0]].map((p) => [p.lng, p.lat])] } })),
    })
    src('face-labels').setData({
      type: 'FeatureCollection',
      features: result.faces.map((f, i) => ({ type: 'Feature', properties: { label: `${i + 1} · ${pitchText(f.pitchOver12)}` }, geometry: { type: 'Point', coordinates: [f.at.lng, f.at.lat] } })),
    })
    const ends = new Map<string, LatLng>()
    for (const l of lines) for (const p of [l.a, l.b]) ends.set(`${p.lat.toFixed(8)},${p.lng.toFixed(8)}`, p)
    src('dots').setData({
      type: 'FeatureCollection',
      features: [
        ...[...ends.values()].map((p) => ({ type: 'Feature' as const, properties: { active: false }, geometry: { type: 'Point' as const, coordinates: [p.lng, p.lat] } })),
        ...(from ? [{ type: 'Feature' as const, properties: { active: true }, geometry: { type: 'Point' as const, coordinates: [from.lng, from.lat] } }] : []),
      ],
    })
    if (!from) src('rubber').setData({ type: 'FeatureCollection', features: [] })
  }, [lines, result, selected, from, ready])

  // Where a click lands: on a dot that is already there, or on a line, when it is within a finger's width of one.
  const snap = useCallback((map: maplibregl.Map, at: LatLng): LatLng => {
    const pt = map.project([at.lng, at.lat])
    let best: LatLng | null = null, bestD = 14
    const candidates: LatLng[] = lines.flatMap((l) => [l.a, l.b])
    if (chainStart) candidates.push(chainStart)
    for (const c of candidates) {
      const q = map.project([c.lng, c.lat])
      const d = Math.hypot(q.x - pt.x, q.y - pt.y)
      if (d < bestD) { bestD = d; best = c }
    }
    if (best) return best
    bestD = 9
    for (const l of lines) {
      const a = map.project([l.a.lng, l.a.lat]), b = map.project([l.b.lng, l.b.lat])
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy
      if (len2 < 1) continue
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2))
      const d = Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y)
      if (d < bestD) { bestD = d; const ll = map.unproject([a.x + t * dx, a.y + t * dy]); best = { lat: ll.lat, lng: ll.lng } }
    }
    return best || at
  }, [lines, chainStart])

  const nearestLine = useCallback((map: maplibregl.Map, at: LatLng): Line | null => {
    const pt = map.project([at.lng, at.lat])
    let best: Line | null = null, bestD = 12
    for (const l of lines) {
      const a = map.project([l.a.lng, l.a.lat]), b = map.project([l.b.lng, l.b.lat])
      const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1
      const t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2))
      const d = Math.hypot(a.x + t * dx - pt.x, a.y + t * dy - pt.y)
      if (d < bestD) { bestD = d; best = l }
    }
    return best
  }, [lines])

  useEffect(() => {
    const map = mapRef.current
    if (!map || !ready) return
    const same = (p: LatLng, q: LatLng) => Math.abs(p.lat - q.lat) < 1e-9 && Math.abs(p.lng - q.lng) < 1e-9
    const onClick = (e: maplibregl.MapMouseEvent) => {
      const raw = { lat: e.lngLat.lat, lng: e.lngLat.lng }
      if (mode === 'select') { setSelected(nearestLine(map, raw)?.id || null); return }
      const p = snap(map, raw)
      if (!from) { setFrom(p); setChainStart(p); return }
      if (same(p, from)) return
      commit([...lines, { id: newId(), type, a: from, b: p }])
      // Dot to dot: the next line starts where this one ended — unless it closed the loop it began.
      if (chainStart && same(p, chainStart)) { setFrom(null); setChainStart(null) } else setFrom(p)
    }
    const onMove = (e: maplibregl.MapMouseEvent) => {
      if (mode !== 'draw' || !from) return
      const p = snap(map, { lat: e.lngLat.lat, lng: e.lngLat.lng })
      ;(map.getSource('rubber') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [{ type: 'Feature', properties: { color: TYPE_OF[type].color }, geometry: { type: 'LineString', coordinates: [[from.lng, from.lat], [p.lng, p.lat]] } }] })
    }
    const onDouble = () => finishLine()
    // Right-click lets go of the line being drawn.
    const onRight = (e: maplibregl.MapMouseEvent) => { e.preventDefault(); finishLine() }
    map.on('click', onClick); map.on('mousemove', onMove); map.on('dblclick', onDouble); map.on('contextmenu', onRight)
    map.getCanvas().style.cursor = mode === 'draw' ? 'crosshair' : 'default'
    return () => { map.off('click', onClick); map.off('mousemove', onMove); map.off('dblclick', onDouble); map.off('contextmenu', onRight) }
  }, [ready, mode, from, chainStart, type, lines, commit, snap, nearestLine, finishLine])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'SELECT' || el.tagName === 'TEXTAREA')) return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return }
      if (e.key === 'Escape' || e.key === 'Enter') finishLine()
      if (e.key === 'Delete' || e.key === 'Backspace') removeSelected()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo, finishLine, removeSelected])

  const done = () => {
    finishLine()
    onDone({
      lines: lines.map((l) => ({ type: l.type, startLat: l.a.lat, startLng: l.a.lng, endLat: l.b.lat, endLng: l.b.lng })),
      // Every section's pitch as the screen shows it (read or set), so the saved report matches what was seen.
      facePitches: result.faces.filter((f) => f.source !== 'roof').map((f) => ({ lat: f.at.lat, lng: f.at.lng, pitchOver12: f.pitchOver12 })),
      faceFacings: result.faces.filter((f) => f.facing != null).map((f) => ({ lat: f.at.lat, lng: f.at.lng, azimuthDeg: f.facing as number })),
      buildingNames: buildings.filter((b) => b.name.trim()).map((b) => ({ lat: b.at.lat, lng: b.at.lng, name: b.name.trim() })),
      defaultPitchOver12: defaultPitchNumber, wastePct: wasteNumber,
    })
  }

  const selectedLine = lines.find((l) => l.id === selected) || null
  const L = result.roof.lengths
  const tool = (active: boolean) => `flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${active ? 'bg-orange-50 text-orange-700 dark:text-orange-200 dark:bg-orange-950/40' : 'text-gray-600 hover:bg-gray-50 dark:hover:bg-slate-800 dark:text-slate-300'}`
  const input = 'w-20 px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700'

  return (
    <div className="flex flex-col lg:flex-row gap-4">
      <div className="flex-1 min-w-0">
        {/* Line types: pick one, then click dot to dot. */}
        <div className="flex flex-wrap items-center gap-2 mb-3">
          {TYPES.map((t) => (
            <button key={t.type} type="button" onClick={() => { if (t.type !== type) finishLine(); setType(t.type); setMode('draw') }}
              aria-pressed={mode === 'draw' && type === t.type}
              className={`flex items-center gap-2 px-3 py-2 text-xs font-semibold rounded-lg border transition-colors ${mode === 'draw' && type === t.type ? 'border-gray-900 bg-gray-900 text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900' : 'border-gray-200 bg-white text-gray-700 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800'}`}>
              <span className="w-4 h-1 rounded" style={{ backgroundColor: t.color }} />{t.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="flex items-center bg-white rounded-lg border shadow-sm overflow-hidden dark:bg-slate-900 dark:border-slate-700">
            <button type="button" onClick={() => setMode('draw')} className={tool(mode === 'draw')}><Pencil className="w-3.5 h-3.5" /> Draw</button>
            <button type="button" onClick={() => { setMode('select'); finishLine() }} className={`${tool(mode === 'select')} border-l dark:border-slate-700`}><MousePointer2 className="w-3.5 h-3.5" /> Select</button>
          </div>
          {from && (
            <button type="button" onClick={finishLine} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-gray-700 border rounded-lg bg-white hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-200 dark:border-slate-700 dark:hover:bg-slate-800">
              <CornerDownLeft className="w-3.5 h-3.5" /> End this run
            </button>
          )}
          <div className="flex items-center gap-1 ml-auto">
            <button type="button" onClick={undo} disabled={!history.length} title="Undo (Ctrl+Z)" aria-label="Undo" className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-30 dark:text-slate-400"><Undo2 className="w-4 h-4" /></button>
            <button type="button" onClick={redo} disabled={!undone.length} title="Redo (Ctrl+Shift+Z)" aria-label="Redo" className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-30 dark:text-slate-400"><Redo2 className="w-4 h-4" /></button>
          </div>
          <button type="button" onClick={done} disabled={busy || lines.length === 0}
            className="flex items-center gap-2 px-5 py-2 bg-green-700 text-white text-sm font-semibold rounded-lg hover:bg-green-800 disabled:opacity-50 transition-colors">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}{busy ? 'Saving…' : 'Done'}
          </button>
        </div>

        <p className="mb-2 px-3 py-1.5 bg-blue-50 text-blue-800 text-xs rounded-lg dark:text-blue-200 dark:bg-blue-950/40" role="status">
          {mode === 'select' ? 'Click a line to change its type or delete it.'
            : from ? `Click the next dot for this ${TYPE_OF[type].label.toLowerCase()}. Double-click, right-click or press Esc to stop; picking another line type also stops this run.`
              : `Click where the ${TYPE_OF[type].label.toLowerCase()} starts, then click dot to dot. Dots snap to the ones already drawn.`}
        </p>

        <div ref={mapEl} className="w-full rounded-xl overflow-hidden border shadow-sm dark:border-slate-700" style={{ height: 'min(70vh, 640px)', minHeight: 360 }} />

        {result.roof.warnings.length > 0 && lines.length > 0 && (
          <ul className="mt-3 space-y-1" role="alert">
            {result.roof.warnings.map((w) => (
              <li key={w} className="px-3 py-1.5 bg-amber-50 text-amber-900 text-xs rounded-lg dark:text-amber-200 dark:bg-amber-950/40">{w}</li>
            ))}
          </ul>
        )}
      </div>

      <div className="w-full lg:w-72 shrink-0 space-y-4">
        {selectedLine && mode === 'select' && (
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3 dark:bg-slate-900 dark:border-slate-700">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider dark:text-slate-100">Selected line</h3>
            <select value={selectedLine.type} aria-label="Line type"
              onChange={(e) => commit(lines.map((l) => (l.id === selectedLine.id ? { ...l, type: e.target.value as DrawnLineType } : l)))}
              className="w-full px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700">
              {TYPES.map((t) => <option key={t.type} value={t.type}>{t.label}</option>)}
            </select>
            <button type="button" onClick={removeSelected} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-700 border border-red-200 rounded-lg hover:bg-red-50 dark:text-red-400 dark:border-red-900 dark:hover:bg-red-500/10">
              <Trash2 className="w-3.5 h-3.5" /> Delete line
            </button>
          </div>
        )}

        <div className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900 dark:border-slate-700">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3 dark:text-slate-100">Roof</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Area</span><span className="font-medium text-gray-900 dark:text-slate-100">{result.roof.areaSqft.toLocaleString()} sq ft</span></div>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Squares</span><span className="font-bold text-gray-900 dark:text-slate-100">{squares.toFixed(2)}</span></div>
            <label className="flex items-center justify-between gap-2"><span className="text-gray-600 dark:text-slate-400">Waste %</span>
              <input type="number" min={0} max={50} value={waste} onChange={(e) => setWaste(e.target.value)} className={input} /></label>
            <div className="flex justify-between"><span className="text-gray-600 dark:text-slate-400">Squares with waste</span><span className="font-bold text-blue-700 dark:text-blue-300">{squaresWithWaste.toFixed(2)}</span></div>
          </div>
          {buildings.length > 1 ? (
            <div className="mt-3 pt-3 border-t dark:border-slate-700">
              <h4 className="text-xs font-semibold text-gray-700 mb-2 dark:text-slate-200">{buildings.length} buildings on this report</h4>
              <ul className="space-y-2">
                {buildings.map((b, i) => (
                  <li key={`${b.at.lat},${b.at.lng}`} className="flex items-center justify-between gap-2 text-sm">
                    <input type="text" value={b.name} placeholder={b.fallback} maxLength={40} aria-label={`Name of building ${i + 1}`}
                      onChange={(e) => nameBuilding(i, e.target.value)} className="min-w-0 flex-1 px-2 py-1.5 text-sm border rounded-lg bg-white dark:bg-slate-900 dark:border-slate-700" />
                    <span className="font-medium text-gray-900 whitespace-nowrap dark:text-slate-100">{b.squares.toFixed(2)} sq</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-gray-500 dark:text-slate-400">Name each one (House, Garage). The totals above are all of them together.</p>
            </div>
          ) : (
            <p className="mt-3 text-xs text-gray-500 dark:text-slate-400">A detached garage or shed in the picture? Draw it too and it is totalled as its own building.</p>
          )}
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900 dark:border-slate-700">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3 dark:text-slate-100">Pitch</h3>
          <div className="flex items-center justify-between gap-2 text-sm mb-3">
            <span className="text-gray-600 dark:text-slate-400">Whole roof</span>
            <span className="flex items-center gap-1">
              <input type="number" min={0} max={24} step={0.5} value={defaultPitch} onChange={(e) => setDefaultPitch(e.target.value)} aria-label="Whole-roof pitch, rise over 12" className={input} />
              <span className="text-gray-500 dark:text-slate-400">/12</span>
              <button type="button" onClick={() => setGaugeFor('roof')} title="Measure with this phone" aria-label="Measure the whole-roof pitch with this phone" className="p-1.5 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100"><Ruler className="w-4 h-4" /></button>
            </span>
          </div>
          {result.faces.length === 0 ? (
            <p className="text-xs text-gray-500 dark:text-slate-400">Each closed section of the roof gets its own pitch here once it is drawn.</p>
          ) : (
            <ul className="space-y-2">
              {result.faces.map((f, i) => (
                <li key={`${f.at.lat},${f.at.lng}`} className="text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-gray-700 dark:text-slate-200">
                      <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: FACE_FILL[i % FACE_FILL.length] }} />Section {i + 1}
                    </span>
                    <span className="flex items-center gap-1">
                      <input type="number" min={0} max={24} step={0.5} value={f.pitchOver12} aria-label={`Section ${i + 1} pitch, rise over 12`}
                        onChange={(e) => setFacePitch(i, e.target.value === '' ? null : Number(e.target.value))} className={input} />
                      <span className="text-gray-500 dark:text-slate-400">/12</span>
                      <button type="button" onClick={() => setGaugeFor(i)} title="Measure with this phone" aria-label={`Measure section ${i + 1} with this phone`} className="p-1.5 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100"><Ruler className="w-4 h-4" /></button>
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-xs text-gray-500 dark:text-slate-400 pl-5">
                    <span>{Math.round(f.areaSqft).toLocaleString()} sq ft</span>
                    <span>
                      {f.source === 'set' ? <>set by you · <button type="button" className="underline" onClick={() => setFacePitch(i, null)}>reset</button></>
                        : f.source === 'read' ? 'read from the aerial data' : 'whole-roof pitch'}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900 dark:border-slate-700">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3 dark:text-slate-100">Lines</h3>
          <div className="space-y-2 text-sm">
            {TYPES.map((t) => (
              <div key={t.type} className="flex items-center justify-between">
                <span className="flex items-center gap-2 text-gray-600 dark:text-slate-400"><span className="w-3 h-0.5 rounded" style={{ backgroundColor: t.color }} />{t.label}</span>
                <span className="font-medium text-gray-900 dark:text-slate-100">{feet(L[t.type])}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {gaugeFor !== null && (
        <PitchGauge
          title={gaugeFor === 'roof' ? 'Whole-roof pitch' : `Section ${gaugeFor + 1} pitch`}
          onClose={() => setGaugeFor(null)}
          onUse={(p) => { if (gaugeFor === 'roof') setDefaultPitch(String(p)); else setFacePitch(gaugeFor, p); setGaugeFor(null) }}
        />
      )}
    </div>
  )
}
