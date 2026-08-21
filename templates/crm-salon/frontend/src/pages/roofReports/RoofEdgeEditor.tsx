import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { MousePointer2, Plus, Trash2, Undo2, Redo2, Save, RotateCcw, Tag } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EdgeType = 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'

interface Edge {
  id: string
  type: EdgeType
  x1: number; y1: number  // pixel coords
  x2: number; y2: number
  lengthFt: number
  startLat: number; startLng: number
  endLat: number; endLng: number
  segmentA?: number; segmentB?: number
}

interface Segment {
  name: string
  pitch: string
  polygon?: Array<{ lat: number; lng: number }>
}

interface Props {
  reportId?: string
  edges: any[]
  segments: Segment[]
  centerLat: number
  centerLng: number
  zoom: number
  aerialImageUrl: string
  mapWidth?: number
  mapHeight?: number
  initialMode?: Mode
  onSave: (edges: any[], measurements: any, reportId?: string) => Promise<void>
  onRevert?: () => Promise<void>
  userEdited?: boolean
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EDGE_COLORS: Record<EdgeType, string> = {
  ridge: '#E53E3E',
  valley: '#3182CE',
  hip: '#38A169',
  rake: '#DD6B20',
  eave: '#805AD5',
}

const EDGE_LABELS: Record<EdgeType, string> = {
  ridge: 'Ridge', valley: 'Valley', hip: 'Hip', rake: 'Rake', eave: 'Eave',
}

const EDGE_TYPES: EdgeType[] = ['ridge', 'valley', 'hip', 'rake', 'eave']

const HANDLE_RADIUS = 6
const SNAP_DISTANCE = 8

type Mode = 'select' | 'add' | 'delete'

// ---------------------------------------------------------------------------
// Coordinate conversion (matches roofReportRenderer.ts exactly)
// ---------------------------------------------------------------------------

function latLngToPixel(
  lat: number, lng: number,
  centerLat: number, centerLng: number, zoom: number,
  imgW = 800, imgH = 600,
): { x: number; y: number } {
  const scale = Math.pow(2, zoom) * 256
  const worldX = (lng + 180) / 360 * scale
  const worldY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale
  const centerWorldX = (centerLng + 180) / 360 * scale
  const centerWorldY = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * scale
  return { x: imgW / 2 + (worldX - centerWorldX), y: imgH / 2 + (worldY - centerWorldY) }
}

function pixelToLatLng(
  px: number, py: number,
  centerLat: number, centerLng: number, zoom: number,
  imgW = 800, imgH = 600,
): { lat: number; lng: number } {
  const scale = Math.pow(2, zoom) * 256
  const centerWorldX = (centerLng + 180) / 360 * scale
  const centerWorldY = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * scale
  const worldX = centerWorldX + (px - imgW / 2)
  const worldY = centerWorldY + (py - imgH / 2)
  const lng = worldX / scale * 360 - 180
  const n = Math.PI - 2 * Math.PI * worldY / scale
  const lat = 180 / Math.PI * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)))
  return { lat, lng }
}

function pixelDistance(x1: number, y1: number, x2: number, y2: number): number {
  return Math.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2)
}

function pixelsToFeet(px: number, lat: number, zoom: number): number {
  const metersPerPixel = 156543.03392 * Math.cos(lat * Math.PI / 180) / Math.pow(2, zoom)
  return px * metersPerPixel * 3.28084
}

let nextEdgeId = 1
function makeEdgeId(): string { return `e-${nextEdgeId++}-${Date.now()}` }

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RoofEdgeEditor({
  reportId, edges: initialEdges, segments, centerLat, centerLng, zoom,
  aerialImageUrl, mapWidth = 800, mapHeight = 600, initialMode = 'select',
  onSave, onRevert, userEdited,
}: Props) {
  const IMG_W = mapWidth
  const IMG_H = mapHeight
  // Convert API edges to pixel-space edges
  const apiToPixelEdges = useCallback((apiEdges: any[]): Edge[] => {
    return apiEdges.map((e) => {
      const p1 = latLngToPixel(e.startLat || e.start?.lat, e.startLng || e.start?.lng, centerLat, centerLng, zoom, IMG_W, IMG_H)
      const p2 = latLngToPixel(e.endLat || e.end?.lat, e.endLng || e.end?.lng, centerLat, centerLng, zoom, IMG_W, IMG_H)
      return {
        id: makeEdgeId(),
        type: e.type as EdgeType,
        x1: p1.x, y1: p1.y, x2: p2.x, y2: p2.y,
        lengthFt: e.lengthFt,
        startLat: e.startLat || e.start?.lat, startLng: e.startLng || e.start?.lng,
        endLat: e.endLat || e.end?.lat, endLng: e.endLng || e.end?.lng,
        segmentA: e.segmentA, segmentB: e.segmentB,
      }
    })
  }, [centerLat, centerLng, zoom])

  const [edges, setEdges] = useState<Edge[]>(() => apiToPixelEdges(initialEdges))
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(initialMode)
  const [addType, setAddType] = useState<EdgeType>('valley')
  const [addStart, setAddStart] = useState<{ x: number; y: number } | null>(null)
  const [dragState, setDragState] = useState<{ edgeId: string; endpoint: 'start' | 'end'; offsetX: number; offsetY: number } | null>(null)
  const [history, setHistory] = useState<Edge[][]>([])
  const [future, setFuture] = useState<Edge[][]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)

  const svgRef = useRef<SVGSVGElement>(null)

  // Segment polygons in pixel coords
  const segPolygons = useMemo(() => {
    return segments.map(seg => {
      if (!seg.polygon || seg.polygon.length < 3) return []
      return seg.polygon.map(p => latLngToPixel(p.lat, p.lng, centerLat, centerLng, zoom, IMG_W, IMG_H))
    })
  }, [segments, centerLat, centerLng, zoom])

  // Push to undo history (clears future on new action)
  const pushHistory = useCallback((currentEdges: Edge[]) => {
    setHistory(h => [...h, currentEdges].slice(-50))
    setFuture([]) // new action clears redo stack
    setDirty(true)
  }, [])

  const updateEdges = useCallback((newEdges: Edge[]) => {
    pushHistory(edges) // save current state before changing
    setEdges(newEdges)
  }, [edges, pushHistory])

  const undo = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setHistory(h => h.slice(0, -1))
    setFuture(f => [...f, edges]) // push current to redo stack
    setEdges(prev)
  }, [history, edges])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[future.length - 1]
    setFuture(f => f.slice(0, -1))
    setHistory(h => [...h, edges]) // push current to undo stack
    setEdges(next)
  }, [future, edges])

  // Compute measurements from current edges
  const measurements = useMemo(() => {
    const sumLF = (type: EdgeType) =>
      Math.round(edges.filter(e => e.type === type).reduce((s, e) => s + e.lengthFt, 0) * 10) / 10
    const ridgeLF = sumLF('ridge')
    const valleyLF = sumLF('valley')
    const hipLF = sumLF('hip')
    const rakeLF = sumLF('rake')
    const eaveLF = sumLF('eave')
    const totalPerimeterLF = Math.round((rakeLF + eaveLF) * 10) / 10
    const numValleys = edges.filter(e => e.type === 'valley').length
    const numHips = edges.filter(e => e.type === 'hip').length
    const wasteFactor = Math.max(10, Math.min(25, 10 + numValleys * 3 + numHips * 2))
    const totalAreaSqft = segments.reduce((s, seg) => s + (seg as any).area || 0, 0)
    const totalSquares = Math.round((totalAreaSqft / 100) * 100) / 100
    const squaresWithWaste = Math.round(totalSquares * (1 + wasteFactor / 100) * 100) / 100
    const iceWaterShieldSqft = Math.round(valleyLF * 6)
    return { totalAreaSqft, totalSquares, ridgeLF, valleyLF, hipLF, rakeLF, eaveLF, totalPerimeterLF, wasteFactor, squaresWithWaste, iceWaterShieldSqft }
  }, [edges, segments])

  // --- Mouse interaction ---

  const getSvgPoint = useCallback((e: React.MouseEvent): { x: number; y: number } => {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const rect = svg.getBoundingClientRect()
    const scaleX = IMG_W / rect.width
    const scaleY = IMG_H / rect.height
    return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY }
  }, [])

  const findNearestEndpoint = useCallback((x: number, y: number): { edgeId: string; endpoint: 'start' | 'end'; dist: number } | null => {
    let best: { edgeId: string; endpoint: 'start' | 'end'; dist: number } | null = null
    for (const edge of edges) {
      const d1 = pixelDistance(x, y, edge.x1, edge.y1)
      const d2 = pixelDistance(x, y, edge.x2, edge.y2)
      if (d1 < (best?.dist ?? HANDLE_RADIUS * 2) ) best = { edgeId: edge.id, endpoint: 'start', dist: d1 }
      if (d2 < (best?.dist ?? HANDLE_RADIUS * 2)) best = { edgeId: edge.id, endpoint: 'end', dist: d2 }
    }
    return best
  }, [edges])

  const findNearestEdgeLine = useCallback((x: number, y: number): string | null => {
    let bestId: string | null = null
    let bestDist = 10 // max click distance from line
    for (const edge of edges) {
      // Point-to-segment distance
      const dx = edge.x2 - edge.x1, dy = edge.y2 - edge.y1
      const len2 = dx * dx + dy * dy
      if (len2 === 0) continue
      const t = Math.max(0, Math.min(1, ((x - edge.x1) * dx + (y - edge.y1) * dy) / len2))
      const projX = edge.x1 + t * dx, projY = edge.y1 + t * dy
      const d = pixelDistance(x, y, projX, projY)
      if (d < bestDist) { bestDist = d; bestId = edge.id }
    }
    return bestId
  }, [edges])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const pt = getSvgPoint(e)

    if (mode === 'select') {
      // Check for endpoint drag
      const ep = findNearestEndpoint(pt.x, pt.y)
      if (ep && ep.dist < HANDLE_RADIUS * 2) {
        setDragState({ edgeId: ep.edgeId, endpoint: ep.endpoint, offsetX: 0, offsetY: 0 })
        setSelectedId(ep.edgeId)
        return
      }
      // Check for edge click (select)
      const edgeId = findNearestEdgeLine(pt.x, pt.y)
      setSelectedId(edgeId)
    } else if (mode === 'add') {
      if (!addStart) {
        setAddStart(pt)
      } else {
        // Create new edge
        const ll1 = pixelToLatLng(addStart.x, addStart.y, centerLat, centerLng, zoom, IMG_W, IMG_H)
        const ll2 = pixelToLatLng(pt.x, pt.y, centerLat, centerLng, zoom, IMG_W, IMG_H)
        const pxLen = pixelDistance(addStart.x, addStart.y, pt.x, pt.y)
        const lengthFt = Math.round(pixelsToFeet(pxLen, centerLat, zoom) * 10) / 10
        const newEdge: Edge = {
          id: makeEdgeId(), type: addType,
          x1: addStart.x, y1: addStart.y, x2: pt.x, y2: pt.y,
          lengthFt, startLat: ll1.lat, startLng: ll1.lng, endLat: ll2.lat, endLng: ll2.lng,
        }
        updateEdges([...edges, newEdge])
        setAddStart(null)
      }
    } else if (mode === 'delete') {
      const edgeId = findNearestEdgeLine(pt.x, pt.y)
      if (edgeId) {
        updateEdges(edges.filter(ed => ed.id !== edgeId))
      }
    }
  }, [mode, edges, addStart, addType, getSvgPoint, findNearestEndpoint, findNearestEdgeLine, centerLat, centerLng, zoom, updateEdges])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragState) return
    const pt = getSvgPoint(e)

    // Snap to nearby endpoints
    let snapX = pt.x, snapY = pt.y
    for (const edge of edges) {
      if (edge.id === dragState.edgeId) continue
      for (const [ex, ey] of [[edge.x1, edge.y1], [edge.x2, edge.y2]]) {
        if (pixelDistance(pt.x, pt.y, ex, ey) < SNAP_DISTANCE) {
          snapX = ex; snapY = ey; break
        }
      }
    }

    const ll = pixelToLatLng(snapX, snapY, centerLat, centerLng, zoom, IMG_W, IMG_H)
    setEdges(prev => prev.map(edge => {
      if (edge.id !== dragState.edgeId) return edge
      const updated = { ...edge }
      if (dragState.endpoint === 'start') {
        updated.x1 = snapX; updated.y1 = snapY
        updated.startLat = ll.lat; updated.startLng = ll.lng
      } else {
        updated.x2 = snapX; updated.y2 = snapY
        updated.endLat = ll.lat; updated.endLng = ll.lng
      }
      updated.lengthFt = Math.round(pixelsToFeet(pixelDistance(updated.x1, updated.y1, updated.x2, updated.y2), centerLat, zoom) * 10) / 10
      return updated
    }))
    setDirty(true)
  }, [dragState, edges, getSvgPoint, centerLat, centerLng, zoom])

  const handleMouseUp = useCallback(() => {
    if (dragState) {
      pushHistory(edges) // save after drag
      setDragState(null)
    }
  }, [dragState, edges, pushHistory])

  // --- Relabel selected edge ---
  const relabelEdge = useCallback((newType: EdgeType) => {
    if (!selectedId) return
    updateEdges(edges.map(e => e.id === selectedId ? { ...e, type: newType } : e))
  }, [selectedId, edges, updateEdges])

  // --- Save ---
  const handleSave = useCallback(async () => {
    setSaving(true)
    try {
      const apiEdges = edges.map(e => ({
        type: e.type, lengthFt: e.lengthFt,
        startLat: e.startLat, startLng: e.startLng,
        endLat: e.endLat, endLng: e.endLng,
        segmentA: e.segmentA, segmentB: e.segmentB,
      }))
      await onSave(apiEdges, measurements, reportId)
      setDirty(false)
    } finally {
      setSaving(false)
    }
  }, [edges, measurements, onSave])

  const selectedEdge = edges.find(e => e.id === selectedId)

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key === 'z') { e.preventDefault(); redo() }
      else if ((e.metaKey || e.ctrlKey) && e.key === 'z') { e.preventDefault(); undo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) { updateEdges(edges.filter(ed => ed.id !== selectedId)); setSelectedId(null) }
      }
      if (e.key === 'Escape') { setMode('select'); setAddStart(null); setSelectedId(null) }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [selectedId, edges, undo, updateEdges])

  return (
    <div className="flex gap-4">
      {/* SVG Canvas */}
      <div className="flex-1">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 bg-white rounded-lg border p-2 shadow-sm">
          <button
            onClick={() => { setMode('select'); setAddStart(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'select' ? 'bg-blue-100 text-blue-700' : 'hover:bg-gray-100'}`}
          >
            <MousePointer2 className="w-4 h-4" /> Select
          </button>
          <button
            onClick={() => { setMode('add'); setSelectedId(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'add' ? 'bg-green-100 text-green-700' : 'hover:bg-gray-100'}`}
          >
            <Plus className="w-4 h-4" /> Add Line
          </button>
          <button
            onClick={() => { setMode('delete'); setSelectedId(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded text-sm font-medium transition-colors ${mode === 'delete' ? 'bg-red-100 text-red-700' : 'hover:bg-gray-100'}`}
          >
            <Trash2 className="w-4 h-4" /> Delete
          </button>

          <div className="w-px h-6 bg-gray-200 mx-1" />

          {mode === 'add' && (
            <select
              value={addType}
              onChange={e => setAddType(e.target.value as EdgeType)}
              className="px-2 py-1.5 border rounded text-sm"
            >
              {EDGE_TYPES.map(t => <option key={t} value={t}>{EDGE_LABELS[t]}</option>)}
            </select>
          )}

          <div className="flex-1" />

          <button onClick={undo} disabled={history.length === 0} className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-30" title="Undo (Ctrl+Z)">
            <Undo2 className="w-4 h-4" />
          </button>
          <button onClick={redo} disabled={future.length === 0} className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-30" title="Redo (Ctrl+Shift+Z)">
            <Redo2 className="w-4 h-4" />
          </button>

          {onRevert && userEdited && (
            <button onClick={onRevert} className="flex items-center gap-1 px-2 py-1.5 text-sm hover:bg-orange-50 text-orange-600 rounded" title="Revert to auto-detected">
              <RotateCcw className="w-3.5 h-3.5" /> Revert
            </button>
          )}

          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-600 text-white text-sm font-medium rounded hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-4 h-4" /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* SVG Canvas */}
        <div className="relative bg-gray-900 rounded-lg overflow-hidden shadow-lg border" style={{ aspectRatio: `${IMG_W}/${IMG_H}` }}>
          <svg
            ref={svgRef}
            viewBox={`0 0 ${IMG_W} ${IMG_H}`}
            className="w-full h-full"
            style={{ cursor: mode === 'add' ? 'crosshair' : mode === 'delete' ? 'not-allowed' : dragState ? 'grabbing' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            {/* Aerial image */}
            <image href={aerialImageUrl} x="0" y="0" width={IMG_W} height={IMG_H} />

            {/* Segment polygons */}
            {segPolygons.map((poly, i) => {
              if (poly.length < 3) return null
              const pts = poly.map(p => `${p.x},${p.y}`).join(' ')
              const fills = ['rgba(239,68,68,0.15)', 'rgba(59,130,246,0.15)', 'rgba(16,185,129,0.15)', 'rgba(245,158,11,0.15)', 'rgba(139,92,246,0.15)']
              return <polygon key={i} points={pts} fill={fills[i % fills.length]} stroke="rgba(255,255,255,0.3)" strokeWidth="1" />
            })}

            {/* Edge lines */}
            {edges.map(edge => {
              const isSelected = edge.id === selectedId
              const color = EDGE_COLORS[edge.type]
              return (
                <g key={edge.id}>
                  {/* Hit area (wider invisible line for easier clicking) */}
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                    stroke="transparent" strokeWidth="12" style={{ cursor: 'pointer' }} />
                  {/* Shadow */}
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                    stroke="rgba(0,0,0,0.5)" strokeWidth={isSelected ? 5 : 4} strokeLinecap="round" />
                  {/* Colored line */}
                  <line x1={edge.x1} y1={edge.y1} x2={edge.x2} y2={edge.y2}
                    stroke={color} strokeWidth={isSelected ? 3 : 2} strokeLinecap="round"
                    strokeDasharray={isSelected ? '6 3' : undefined} />
                  {/* Length label */}
                  <text
                    x={(edge.x1 + edge.x2) / 2} y={(edge.y1 + edge.y2) / 2}
                    textAnchor="middle" dominantBaseline="central"
                    fontSize="11" fontWeight="bold" fill="white"
                    style={{ textShadow: '0 0 3px #000, 0 0 6px #000' }}
                  >{edge.lengthFt}'</text>
                </g>
              )
            })}

            {/* Drag handles for selected edge */}
            {selectedEdge && mode === 'select' && (
              <>
                {[{ x: selectedEdge.x1, y: selectedEdge.y1, ep: 'start' as const }, { x: selectedEdge.x2, y: selectedEdge.y2, ep: 'end' as const }].map(h => (
                  <circle key={h.ep} cx={h.x} cy={h.y} r={HANDLE_RADIUS}
                    fill="white" stroke={EDGE_COLORS[selectedEdge.type]} strokeWidth="2"
                    style={{ cursor: 'grab' }} />
                ))}
              </>
            )}

            {/* Add mode: show first click point */}
            {mode === 'add' && addStart && (
              <circle cx={addStart.x} cy={addStart.y} r={4} fill={EDGE_COLORS[addType]} stroke="white" strokeWidth="2" />
            )}

            {/* Pitch labels */}
            {segPolygons.map((poly, i) => {
              if (poly.length < 3) return null
              const cx = poly.reduce((s, p) => s + p.x, 0) / poly.length
              const cy = poly.reduce((s, p) => s + p.y, 0) / poly.length
              return (
                <text key={`pitch-${i}`} x={cx} y={cy} textAnchor="middle" dominantBaseline="central"
                  fontSize="13" fontWeight="bold" fill="#FFD700"
                  style={{ textShadow: '0 0 4px #000, 0 0 8px #000' }}
                >{segments[i]?.pitch}</text>
              )
            })}
          </svg>

          {/* Mode hint */}
          {mode === 'add' && (
            <div className="absolute bottom-3 left-3 bg-black/70 text-white text-xs px-3 py-1.5 rounded">
              {addStart ? 'Click second point to create edge' : 'Click first point'}
            </div>
          )}
        </div>

        {/* Legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          {EDGE_TYPES.map(t => (
            <span key={t} className="flex items-center gap-1.5">
              <span className="w-4 h-0.5 inline-block rounded" style={{ backgroundColor: EDGE_COLORS[t] }} />
              {EDGE_LABELS[t]}
            </span>
          ))}
        </div>
      </div>

      {/* Right sidebar — selected edge info + measurements */}
      <div className="w-64 space-y-4">
        {/* Selected edge controls */}
        {selectedEdge && mode === 'select' && (
          <div className="bg-white rounded-lg border shadow-sm p-4 space-y-3">
            <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
              <Tag className="w-4 h-4" /> Edge Properties
            </h3>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Type</label>
              <select
                value={selectedEdge.type}
                onChange={e => relabelEdge(e.target.value as EdgeType)}
                className="w-full px-2 py-1.5 border rounded text-sm"
              >
                {EDGE_TYPES.map(t => <option key={t} value={t}>{EDGE_LABELS[t]}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Length</label>
              <p className="text-lg font-bold" style={{ color: EDGE_COLORS[selectedEdge.type] }}>
                {selectedEdge.lengthFt} ft
              </p>
            </div>
            <button
              onClick={() => { updateEdges(edges.filter(e => e.id !== selectedId)); setSelectedId(null) }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 rounded border border-red-200"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Edge
            </button>
          </div>
        )}

        {/* Live measurements */}
        <div className="bg-white rounded-lg border shadow-sm overflow-hidden">
          <div className="px-4 py-2 bg-gray-50 border-b">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Measurements</h3>
          </div>
          <div className="divide-y divide-gray-100">
            {([
              ['Ridge', measurements.ridgeLF, 'LF'],
              ['Valley', measurements.valleyLF, 'LF'],
              ['Hip', measurements.hipLF, 'LF'],
              ['Rake', measurements.rakeLF, 'LF'],
              ['Eave', measurements.eaveLF, 'LF'],
              ['Perimeter', measurements.totalPerimeterLF, 'LF'],
              ['Waste', measurements.wasteFactor, '%'],
              ['Ice & Water', measurements.iceWaterShieldSqft, 'sqft'],
            ] as [string, number, string][]).map(([label, val, unit]) => (
              <div key={label} className="flex justify-between px-4 py-2 text-sm">
                <span className="text-gray-600">{label}</span>
                <span className="font-medium text-gray-900">{val} {unit}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
