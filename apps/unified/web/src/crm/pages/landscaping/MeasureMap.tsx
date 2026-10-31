// Measure a property on the satellite map: click the corners of the lawn, the beds, the hardscape or the lot, and the area is
// saved on the property by type, ready for Area Pricing. A shape can also cut out of an area (a bed inside a lawn). The server
// measures the corners itself (PUT /api/area-pricing/sites/:id/shapes); the figure shown while drawing is the same formula.
// Google's own drawing library is being retired, so the corners are collected with plain map clicks.
import { useEffect, useRef, useState } from 'react'
import { Loader2, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'
import { loadGooglePlaces } from '../roof/lib/AddressAutocomplete'

const TYPES: Array<{ value: string; label: string; color: string }> = [
  { value: 'lawnSqft', label: 'Lawn', color: '#16a34a' }, { value: 'bedSqft', label: 'Beds', color: '#b45309' },
  { value: 'hardscapeSqft', label: 'Hardscape', color: '#6b7280' }, { value: 'drivewaySqft', label: 'Driveway', color: '#2563eb' },
  { value: 'lotSqft', label: 'Whole lot', color: '#9333ea' },
]
const colorOf = (type: string) => TYPES.find((t) => t.value === type)?.color || '#16a34a'
const labelOf = (type: string) => TYPES.find((t) => t.value === type)?.label || type

interface Shape { key: string; areaType: string; mode: 'add' | 'cut'; label: string; polygon: any }

/** The same sphere formula the server uses (data/siteShapes.ts), for the figure shown while drawing. */
function sqftOf(path: Array<{ lat: number; lng: number }>): number {
  if (path.length < 3) return 0
  const rad = (d: number) => (d * Math.PI) / 180
  let sum = 0
  for (let i = 0; i < path.length; i++) {
    const a = path[i], b = path[(i + 1) % path.length]
    let dLng = rad(b.lng - a.lng)
    if (dLng > Math.PI) dLng -= 2 * Math.PI
    if (dLng < -Math.PI) dLng += 2 * Math.PI
    sum += dLng * (2 + Math.sin(rad(a.lat)) + Math.sin(rad(b.lat)))
  }
  return Math.round((Math.abs(sum) * 6378137 * 6378137 * 10.763910416709722) / 2)
}
const pathOf = (polygon: any): Array<{ lat: number; lng: number }> => polygon.getPath().getArray().map((p: any) => ({ lat: p.lat(), lng: p.lng() }))
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback

export default function MeasureMap({ siteId, onSaved }: { siteId: string; onSaved: () => void }) {
  const toast = useToast()
  const mayMeasure = useMayWrite('contacts:update')
  const box = useRef<HTMLDivElement>(null)
  const mapRef = useRef<any>(null)
  const draft = useRef<{ line: any; points: any[] }>({ line: null, points: [] })
  const [ready, setReady] = useState<'loading' | 'ok' | 'nokey'>('loading')
  const [shapes, setShapes] = useState<Shape[]>([])
  const [, bump] = useState(0)
  const [areaType, setAreaType] = useState('lawnSqft')
  const [mode, setMode] = useState<'add' | 'cut'>('add')
  const [drawing, setDrawing] = useState(false)
  const [corners, setCorners] = useState(0)
  const [saving, setSaving] = useState(false)
  const typeRef = useRef(areaType); typeRef.current = areaType
  const drawingRef = useRef(drawing); drawingRef.current = drawing

  const addPolygon = (type: string, m: 'add' | 'cut', path: Array<{ lat: number; lng: number }>, label = ''): Shape => {
    const g = (window as any).google.maps
    const polygon = new g.Polygon({
      map: mapRef.current, paths: path, editable: mayMeasure, strokeColor: m === 'cut' ? '#dc2626' : colorOf(type),
      fillColor: m === 'cut' ? '#dc2626' : colorOf(type), fillOpacity: m === 'cut' ? 0.15 : 0.3, strokeWeight: 2,
    })
    const path$ = polygon.getPath()
    for (const ev of ['set_at', 'insert_at', 'remove_at']) g.event.addListener(path$, ev, () => bump((n) => n + 1))
    return { key: Math.random().toString(36).slice(2), areaType: type, mode: m, label, polygon }
  }

  useEffect(() => {
    let dead = false
    const mine: Shape[] = []
    ;(async () => {
      try { await loadGooglePlaces() } catch { if (!dead) setReady('nokey'); return }
      if (dead || !box.current) return
      const g = (window as any).google.maps
      const [{ Map }, { Geocoder }] = await Promise.all([g.importLibrary('maps'), g.importLibrary('geocoding')])
      const map = new Map(box.current, { center: { lat: 39.5, lng: -98.35 }, zoom: 4, mapTypeId: 'satellite', tilt: 0, streetViewControl: false, fullscreenControl: true, mapTypeControl: false })
      mapRef.current = map
      // Clicks add a corner while drawing.
      map.addListener('click', (e: any) => {
        if (!drawingRef.current) return
        draft.current.points.push(e.latLng)
        if (!draft.current.line) draft.current.line = new g.Polyline({ map, path: draft.current.points, strokeColor: colorOf(typeRef.current), strokeWeight: 2 })
        else draft.current.line.setPath(draft.current.points)
        setCorners(draft.current.points.length)
      })
      // Existing shapes, then the property's address.
      let center: any = null
      try {
        const [saved, s] = await Promise.all([api.get(`/api/area-pricing/sites/${siteId}/shapes`) as any, api.get(`/api/sites/${siteId}`) as any])
        for (const r of (saved?.data ?? []) as any[]) {
          const sh = addPolygon(r.areaType, r.mode, (r.path as number[][]).map(([lat, lng]) => ({ lat, lng })), r.label || '')
          mine.push(sh)
        }
        if (mine.length) {
          const bounds = new g.LatLngBounds()
          for (const sh of mine) for (const p of sh.polygon.getPath().getArray()) bounds.extend(p)
          map.fitBounds(bounds)
        } else {
          const site = (s?.data ?? s) as any
          const address = [site?.address, site?.city, site?.state, site?.zip].filter(Boolean).join(', ')
          if (address) {
            const res = await new Geocoder().geocode({ address })
            center = res?.results?.[0]?.geometry?.location
          }
          if (center) { map.setCenter(center); map.setZoom(20) }
        }
      } catch { /* the map still works without them */ }
      if (!dead) { setShapes(mine); setReady('ok') }
    })()
    return () => { dead = true; for (const sh of mine) sh.polygon.setMap(null); draft.current.line?.setMap(null) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId])

  const startDrawing = () => { cancelDraft(); setDrawing(true) }
  const cancelDraft = () => { draft.current.line?.setMap(null); draft.current = { line: null, points: [] }; setCorners(0); setDrawing(false) }
  const finish = () => {
    if (draft.current.points.length < 3) { toast.error('Click at least three corners first'); return }
    const path = draft.current.points.map((p: any) => ({ lat: p.lat(), lng: p.lng() }))
    const sh = addPolygon(areaType, mode, path)
    setShapes((all) => [...all, sh])
    cancelDraft()
  }
  const remove = (key: string) => setShapes((all) => { const gone = all.find((s) => s.key === key); gone?.polygon.setMap(null); return all.filter((s) => s.key !== key) })

  const totals = new Map<string, number>()
  for (const s of shapes) totals.set(s.areaType, (totals.get(s.areaType) ?? 0) + (s.mode === 'cut' ? -1 : 1) * sqftOf(pathOf(s.polygon)))

  const save = async () => {
    setSaving(true)
    try {
      await api.put(`/api/area-pricing/sites/${siteId}/shapes`, {
        shapes: shapes.map((s) => ({ areaType: s.areaType, mode: s.mode, label: s.label || undefined, path: pathOf(s.polygon).map((p) => [p.lat, p.lng]) })),
      })
      toast.success('Measurements saved on the property')
      onSaved()
    } catch (e) { toast.error(errorText(e, 'Could not save the measurements')) }
    finally { setSaving(false) }
  }

  if (ready === 'nokey') return <p className="text-sm text-gray-500 dark:text-slate-400">The satellite map is not switched on for this business yet (it needs a Google Maps key). You can still type the measurements in above.</p>
  return (
    <div className="space-y-3">
      {mayMeasure && (
        <div className="flex flex-wrap items-end gap-2">
          <select aria-label="What this shape measures" className="input w-auto" value={areaType} onChange={(e) => setAreaType(e.target.value)} disabled={drawing}>
            {TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <select aria-label="Adds or cuts out" className="input w-auto" value={mode} onChange={(e) => setMode(e.target.value as 'add' | 'cut')} disabled={drawing}>
            <option value="add">Adds to the area</option><option value="cut">Cuts out of the area</option>
          </select>
          {!drawing
            ? <button onClick={startDrawing} className="btn-secondary" disabled={ready !== 'ok'}>Draw a shape</button>
            : <><button onClick={finish} className="btn-primary" disabled={corners < 3}>Finish shape ({corners} corners)</button><button onClick={cancelDraft} className="btn-secondary">Cancel</button></>}
        </div>
      )}
      <div ref={box} className="h-96 w-full rounded-lg border dark:border-slate-700 bg-gray-100 dark:bg-slate-800" aria-label="Satellite map of the property" />
      {ready === 'loading' && <p className="text-sm text-gray-500 flex items-center gap-2 dark:text-slate-400"><Loader2 className="w-4 h-4 animate-spin" /> Loading the map…</p>}
      {drawing && <p className="text-xs text-gray-500 dark:text-slate-400">Click each corner of the {labelOf(areaType).toLowerCase()} in order, then Finish shape. Drag a corner afterwards to adjust it.</p>}
      {shapes.length > 0 && (
        <>
          <ul className="divide-y dark:divide-slate-700 text-sm">
            {shapes.map((s) => (
              <li key={s.key} className="flex items-center justify-between py-1">
                <span><span className="inline-block w-3 h-3 rounded-sm mr-2 align-middle" style={{ background: s.mode === 'cut' ? '#dc2626' : colorOf(s.areaType) }} />{labelOf(s.areaType)}{s.mode === 'cut' ? ' (cut out)' : ''} · {sqftOf(pathOf(s.polygon)).toLocaleString()} sq ft</span>
                {mayMeasure && <button aria-label="Delete shape" onClick={() => remove(s.key)} className="p-1 text-red-600 dark:text-red-400"><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
          <p className="text-sm font-medium">{[...totals].map(([t, n]) => `${labelOf(t)} ${Math.max(0, n).toLocaleString()} sq ft`).join(' · ')}</p>
        </>
      )}
      {mayMeasure && <button onClick={save} disabled={saving || ready !== 'ok'} className="btn-primary disabled:opacity-50">{saving ? 'Saving…' : 'Save measurements'}</button>}
    </div>
  )
}
