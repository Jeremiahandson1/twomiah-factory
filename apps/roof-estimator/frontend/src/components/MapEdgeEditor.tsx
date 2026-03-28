import { useState, useRef, useCallback, useEffect, useMemo } from 'react'
import { MousePointer2, Plus, Trash2, Undo2, Redo2, Save, RotateCcw, Sparkles, Loader2 } from 'lucide-react'
import maplibregl from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'
import { buildMapStyle, buildImageStyle } from './MapProvider'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type EdgeType = 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'

interface Edge {
  id: string
  type: EdgeType
  startLat: number; startLng: number
  endLat: number; endLng: number
  lengthFt: number
  segmentA?: number; segmentB?: number
}

interface Segment {
  name: string
  pitch: string
  polygon?: Array<{ lat: number; lng: number }>
}

interface RoofFace {
  id: string
  vertices: Array<{ lat: number; lng: number }>
  pitch: number        // rise per 12 (e.g. 6 = 6/12)
  areaSqft: number     // footprint area
  slopeAreaSqft: number // area adjusted for pitch
}

type Mode = 'select' | 'add' | 'delete' | 'pitch' | 'ai_segment'

interface Props {
  reportId?: string
  edges: any[]
  segments: Segment[]
  centerLat: number
  centerLng: number
  zoom: number
  aerialImageUrl: string
  nearmapTileUrl?: string | null
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

const SNAP_DISTANCE_METERS = 0.5

let nextEdgeId = 1
function makeEdgeId(): string { return `e-${nextEdgeId++}-${Date.now()}` }

// ---------------------------------------------------------------------------
// Geodesic distance (Haversine)
// ---------------------------------------------------------------------------

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLng = (lng2 - lng1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function haversineFeet(lat1: number, lng1: number, lat2: number, lng2: number): number {
  return haversineMeters(lat1, lng1, lat2, lng2) * 3.28084
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MapEdgeEditor({
  reportId, edges: initialEdges, segments, centerLat, centerLng, zoom,
  aerialImageUrl, nearmapTileUrl, mapWidth = 800, mapHeight = 600,
  initialMode = 'select', onSave, onRevert, userEdited,
}: Props) {
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<maplibregl.Map | null>(null)
  const [mapReady, setMapReady] = useState(false)

  // Edge state
  const [edges, setEdges] = useState<Edge[]>(() =>
    initialEdges.map((e: any) => ({
      id: makeEdgeId(),
      type: e.type as EdgeType,
      startLat: e.startLat || e.start?.lat,
      startLng: e.startLng || e.start?.lng,
      endLat: e.endLat || e.end?.lat,
      endLng: e.endLng || e.end?.lng,
      lengthFt: e.lengthFt,
      segmentA: e.segmentA,
      segmentB: e.segmentB,
    }))
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mode, setMode] = useState<Mode>(initialMode as Mode)
  const [addType, setAddType] = useState<EdgeType>('valley')
  const [addStart, setAddStart] = useState<{ lat: number; lng: number } | null>(null)
  const [history, setHistory] = useState<Edge[][]>([])
  const [future, setFuture] = useState<Edge[][]>([])
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [aiLoading, setAiLoading] = useState(false)
  const drawingRef = useRef<{ startLat: number; startLng: number } | null>(null)
  const [drawPreview, setDrawPreview] = useState<{ endLat: number; endLng: number } | null>(null)

  // Roof faces — closed polygons formed by edges, each with its own pitch
  const [faces, setFaces] = useState<RoofFace[]>([])
  const [selectedFaceId, setSelectedFaceId] = useState<string | null>(null)

  // ---------------------------------------------------------------------------
  // Measurements (computed from edges + faces)
  // ---------------------------------------------------------------------------

  const measurements = useMemo(() => {
    const sumLF = (type: EdgeType) =>
      Math.round(edges.filter(e => e.type === type).reduce((s, e) => s + e.lengthFt, 0) * 10) / 10

    const ridgeLF = sumLF('ridge')
    const valleyLF = sumLF('valley')
    const hipLF = sumLF('hip')
    const rakeLF = sumLF('rake')
    const eaveLF = sumLF('eave')
    const totalPerimeterLF = Math.round((rakeLF + eaveLF) * 10) / 10

    // Calculate area from faces (each face has its own pitch)
    let totalAreaSqft = 0
    if (faces.length > 0) {
      totalAreaSqft = faces.reduce((s, f) => s + f.slopeAreaSqft, 0)
    }

    // Fall back: if no faces, calculate from edge endpoints with no pitch adjustment
    if (totalAreaSqft === 0 && edges.length >= 3) {
      const allPoints: Array<{ lat: number; lng: number }> = []
      for (const e of edges) {
        allPoints.push({ lat: e.startLat, lng: e.startLng })
        allPoints.push({ lat: e.endLat, lng: e.endLng })
      }
      totalAreaSqft = computeConvexAreaSqft(allPoints)
    }

    const totalSquares = Math.round(totalAreaSqft / 100 * 10) / 10

    const valleyCount = edges.filter(e => e.type === 'valley').length
    const hipCount = edges.filter(e => e.type === 'hip').length
    const wasteFactor = Math.max(10, Math.min(25, 10 + valleyCount * 3 + hipCount * 2))
    const squaresWithWaste = Math.round(totalSquares * (1 + wasteFactor / 100) * 10) / 10
    const iceWaterShieldSqft = Math.round(valleyLF * 6)

    return {
      totalAreaSqft, totalSquares, ridgeLF, valleyLF, hipLF, rakeLF, eaveLF,
      totalPerimeterLF, wasteFactor, squaresWithWaste, iceWaterShieldSqft,
      faces: faces.map(f => ({ id: f.id, pitch: `${f.pitch}/12`, areaSqft: f.slopeAreaSqft, vertices: f.vertices })),
    }
  }, [edges, faces])

  // ---------------------------------------------------------------------------
  // History management
  // ---------------------------------------------------------------------------

  const pushHistory = useCallback((prev: Edge[]) => {
    setHistory(h => [...h.slice(-49), prev])
    setFuture([])
    setDirty(true)
  }, [])

  const undo = useCallback(() => {
    if (history.length === 0) return
    const prev = history[history.length - 1]
    setFuture(f => [...f, edges])
    setEdges(prev)
    setHistory(h => h.slice(0, -1))
  }, [history, edges])

  const redo = useCallback(() => {
    if (future.length === 0) return
    const next = future[future.length - 1]
    setHistory(h => [...h, edges])
    setEdges(next)
    setFuture(f => f.slice(0, -1))
  }, [future, edges])

  // ---------------------------------------------------------------------------
  // Initialize MapLibre map
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!mapContainerRef.current) return

    // Determine style based on available imagery
    let style: any
    if (nearmapTileUrl) {
      style = buildMapStyle({ nearmapTileUrl })
    } else if (aerialImageUrl && aerialImageUrl.startsWith('data:')) {
      // Stored aerial image — compute approximate bounds
      const metersPerPixel = 156543.03392 * Math.cos(centerLat * Math.PI / 180) / Math.pow(2, zoom)
      const halfWidthDeg = (mapWidth / 2 * metersPerPixel) / (111319.5 * Math.cos(centerLat * Math.PI / 180))
      const halfHeightDeg = (mapHeight / 2 * metersPerPixel) / 111319.5
      style = buildImageStyle(aerialImageUrl, [
        centerLng - halfWidthDeg, centerLat - halfHeightDeg,
        centerLng + halfWidthDeg, centerLat + halfHeightDeg,
      ])
    } else {
      style = buildMapStyle({ googleApiKey: 'satellite' })
    }

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style,
      center: [centerLng, centerLat],
      zoom: zoom - 1, // MapLibre zoom is slightly different scale
      maxZoom: 23,
      attributionControl: false,
    })

    map.addControl(new maplibregl.NavigationControl(), 'top-right')
    map.addControl(new maplibregl.ScaleControl({ unit: 'imperial' }), 'bottom-right')

    map.on('load', () => {
      mapRef.current = map
      setMapReady(true)
    })

    return () => { map.remove() }
  }, []) // Only init once

  // ---------------------------------------------------------------------------
  // Render edges + segments on map
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    // Remove old layers/sources
    for (const type of EDGE_TYPES) {
      if (map.getLayer(`edges-${type}`)) map.removeLayer(`edges-${type}`)
      if (map.getLayer(`edges-${type}-labels`)) map.removeLayer(`edges-${type}-labels`)
    }
    if (map.getLayer('segments-fill')) map.removeLayer('segments-fill')
    if (map.getLayer('segments-outline')) map.removeLayer('segments-outline')
    if (map.getLayer('segment-labels')) map.removeLayer('segment-labels')
    if (map.getLayer('faces-fill')) map.removeLayer('faces-fill')
    if (map.getLayer('faces-outline')) map.removeLayer('faces-outline')
    if (map.getLayer('faces-labels')) map.removeLayer('faces-labels')
    if (map.getSource('segments')) map.removeSource('segments')
    if (map.getSource('segment-labels-src')) map.removeSource('segment-labels-src')
    if (map.getSource('faces')) map.removeSource('faces')
    if (map.getSource('faces-labels-src')) map.removeSource('faces-labels-src')
    for (const type of EDGE_TYPES) {
      if (map.getSource(`edges-${type}`)) map.removeSource(`edges-${type}`)
    }

    // Add segment polygons
    const segmentFeatures: any[] = []
    const labelFeatures: any[] = []
    segments.forEach((seg, i) => {
      if (!seg.polygon || seg.polygon.length < 3) return
      const coords = seg.polygon.map(p => [p.lng, p.lat])
      coords.push(coords[0]) // close ring
      segmentFeatures.push({
        type: 'Feature',
        properties: { name: seg.name, pitch: seg.pitch, index: i },
        geometry: { type: 'Polygon', coordinates: [coords] },
      })
      // Label at centroid
      const cLat = seg.polygon.reduce((s, p) => s + p.lat, 0) / seg.polygon.length
      const cLng = seg.polygon.reduce((s, p) => s + p.lng, 0) / seg.polygon.length
      labelFeatures.push({
        type: 'Feature',
        properties: { label: seg.pitch },
        geometry: { type: 'Point', coordinates: [cLng, cLat] },
      })
    })

    if (segmentFeatures.length > 0) {
      map.addSource('segments', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: segmentFeatures },
      })
      map.addLayer({
        id: 'segments-fill',
        type: 'fill',
        source: 'segments',
        paint: {
          'fill-color': ['match', ['%', ['get', 'index'], 8],
            0, 'rgba(59,130,246,0.2)', 1, 'rgba(16,185,129,0.2)',
            2, 'rgba(245,158,11,0.2)', 3, 'rgba(239,68,68,0.2)',
            4, 'rgba(139,92,246,0.2)', 5, 'rgba(236,72,153,0.2)',
            6, 'rgba(20,184,166,0.2)', 7, 'rgba(249,115,22,0.2)',
            'rgba(59,130,246,0.2)'],
          'fill-opacity': 0.6,
        },
      })
      map.addLayer({
        id: 'segments-outline',
        type: 'line',
        source: 'segments',
        paint: { 'line-color': '#fff', 'line-width': 1, 'line-opacity': 0.4 },
      })
    }

    if (labelFeatures.length > 0) {
      map.addSource('segment-labels-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: labelFeatures },
      })
      map.addLayer({
        id: 'segment-labels',
        type: 'symbol',
        source: 'segment-labels-src',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 13,
          'text-font': ['Open Sans Bold'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': '#000',
          'text-halo-width': 1.5,
        },
      })
    }

    // Add detected face polygons (colored fills with pitch labels)
    if (faces.length > 0) {
      const FACE_COLORS = ['rgba(59,130,246,0.25)', 'rgba(16,185,129,0.25)', 'rgba(245,158,11,0.25)', 'rgba(239,68,68,0.25)', 'rgba(139,92,246,0.25)', 'rgba(236,72,153,0.25)', 'rgba(20,184,166,0.25)', 'rgba(249,115,22,0.25)']

      const faceFeatures = faces.map((face, i) => {
        const coords = face.vertices.map(v => [v.lng, v.lat])
        coords.push(coords[0])
        return {
          type: 'Feature' as const,
          properties: { label: `${face.pitch}/12`, index: i, selected: face.id === selectedFaceId },
          geometry: { type: 'Polygon' as const, coordinates: [coords] },
        }
      })

      const faceLabelFeatures = faces.map((face, i) => {
        const cLat = face.vertices.reduce((s, v) => s + v.lat, 0) / face.vertices.length
        const cLng = face.vertices.reduce((s, v) => s + v.lng, 0) / face.vertices.length
        return {
          type: 'Feature' as const,
          properties: { label: `${face.pitch}/12` },
          geometry: { type: 'Point' as const, coordinates: [cLng, cLat] },
        }
      })

      map.addSource('faces', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: faceFeatures },
      })
      map.addLayer({
        id: 'faces-fill',
        type: 'fill',
        source: 'faces',
        paint: {
          'fill-color': ['match', ['%', ['get', 'index'], 8],
            0, 'rgba(59,130,246,0.25)', 1, 'rgba(16,185,129,0.25)',
            2, 'rgba(245,158,11,0.25)', 3, 'rgba(239,68,68,0.25)',
            4, 'rgba(139,92,246,0.25)', 5, 'rgba(236,72,153,0.25)',
            6, 'rgba(20,184,166,0.25)', 7, 'rgba(249,115,22,0.25)',
            'rgba(59,130,246,0.25)'],
          'fill-opacity': 0.7,
        },
      })
      map.addLayer({
        id: 'faces-outline',
        type: 'line',
        source: 'faces',
        paint: {
          'line-color': ['case', ['get', 'selected'], '#f97316', '#ffffff'],
          'line-width': ['case', ['get', 'selected'], 3, 1],
          'line-opacity': 0.6,
        },
      })

      map.addSource('faces-labels-src', {
        type: 'geojson',
        data: { type: 'FeatureCollection', features: faceLabelFeatures },
      })
      map.addLayer({
        id: 'faces-labels',
        type: 'symbol',
        source: 'faces-labels-src',
        layout: {
          'text-field': ['get', 'label'],
          'text-size': 14,
          'text-font': ['Open Sans Bold'],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#FFD700',
          'text-halo-color': '#000',
          'text-halo-width': 2,
        },
      })
    }

    // Add edge lines grouped by type
    for (const type of EDGE_TYPES) {
      const typeEdges = edges.filter(e => e.type === type)
      if (typeEdges.length === 0) continue

      const features: any[] = typeEdges.map(e => ({
        type: 'Feature',
        properties: {
          id: e.id,
          label: `${e.lengthFt.toFixed(1)}'`,
          selected: e.id === selectedId,
        },
        geometry: {
          type: 'LineString',
          coordinates: [[e.startLng, e.startLat], [e.endLng, e.endLat]],
        },
      }))

      map.addSource(`edges-${type}`, {
        type: 'geojson',
        data: { type: 'FeatureCollection', features },
      })

      map.addLayer({
        id: `edges-${type}`,
        type: 'line',
        source: `edges-${type}`,
        paint: {
          'line-color': EDGE_COLORS[type],
          'line-width': ['case', ['get', 'selected'], 4, 2.5],
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round' },
      })

      map.addLayer({
        id: `edges-${type}-labels`,
        type: 'symbol',
        source: `edges-${type}`,
        layout: {
          'symbol-placement': 'line-center',
          'text-field': ['get', 'label'],
          'text-size': 11,
          'text-font': ['Open Sans Bold'],
          'text-offset': [0, -0.8],
          'text-allow-overlap': true,
        },
        paint: {
          'text-color': '#fff',
          'text-halo-color': EDGE_COLORS[type],
          'text-halo-width': 2,
        },
      })
    }
  }, [edges, segments, faces, selectedId, selectedFaceId, mapReady])

  // --- Live preview line while dragging in add mode ---
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    const sourceId = 'draw-preview'
    const layerId = 'draw-preview-line'

    if (drawingRef.current && drawPreview) {
      const geojson: any = {
        type: 'FeatureCollection',
        features: [{
          type: 'Feature',
          properties: {},
          geometry: {
            type: 'LineString',
            coordinates: [
              [drawingRef.current.startLng, drawingRef.current.startLat],
              [drawPreview.endLng, drawPreview.endLat],
            ],
          },
        }],
      }

      if (map.getSource(sourceId)) {
        (map.getSource(sourceId) as any).setData(geojson)
      } else {
        map.addSource(sourceId, { type: 'geojson', data: geojson })
        map.addLayer({
          id: layerId,
          type: 'line',
          source: sourceId,
          paint: {
            'line-color': EDGE_COLORS[addType] || '#fff',
            'line-width': 3,
            'line-dasharray': [4, 3],
            'line-opacity': 0.8,
          },
          layout: { 'line-cap': 'round' },
        })
      }
    } else {
      // Clear preview
      if (map.getLayer(layerId)) map.removeLayer(layerId)
      if (map.getSource(sourceId)) map.removeSource(sourceId)
    }
  }, [drawPreview, mapReady, addType])

  // ---------------------------------------------------------------------------
  // Map interaction handlers (click for select/delete, drag for add)
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const map = mapRef.current
    if (!map || !mapReady) return

    // --- ADD MODE: mousedown → drag preview → mouseup creates edge ---
    const handleMouseDown = (e: maplibregl.MapMouseEvent) => {
      if (mode !== 'add') return
      e.preventDefault()

      const { lat, lng } = e.lngLat
      const snapped = snapToNearby(lat, lng, edges)
      drawingRef.current = { startLat: snapped.lat, startLng: snapped.lng }
      setDrawPreview(null)

      // Disable map drag while drawing a line
      map.dragPan.disable()
    }

    const handleMouseMove = (e: maplibregl.MapMouseEvent) => {
      if (mode !== 'add' || !drawingRef.current) return
      const { lat, lng } = e.lngLat
      setDrawPreview({ endLat: lat, endLng: lng })
    }

    const handleMouseUp = (e: maplibregl.MapMouseEvent) => {
      if (mode !== 'add' || !drawingRef.current) {
        map.dragPan.enable()
        return
      }

      const { lat, lng } = e.lngLat
      const start = drawingRef.current
      const end = snapToNearby(lat, lng, edges)
      const lengthFt = haversineFeet(start.startLat, start.startLng, end.lat, end.lng)

      if (lengthFt > 0.5) {
        const newEdge: Edge = {
          id: makeEdgeId(),
          type: addType,
          startLat: start.startLat, startLng: start.startLng,
          endLat: end.lat, endLng: end.lng,
          lengthFt: Math.round(lengthFt * 10) / 10,
        }
        pushHistory(edges)
        setEdges(prev => [...prev, newEdge])
      }

      drawingRef.current = null
      setDrawPreview(null)
      map.dragPan.enable()
    }

    // --- SELECT/DELETE MODE: click ---
    const handleClick = async (e: maplibregl.MapMouseEvent) => {
      const { lat, lng } = e.lngLat

      if (mode === 'select') {
        const hit = findNearestEdge(lat, lng, edges, map)
        setSelectedId(hit?.id || null)
      } else if (mode === 'delete') {
        const hit = findNearestEdge(lat, lng, edges, map)
        if (hit) {
          pushHistory(edges)
          setEdges(prev => prev.filter(e => e.id !== hit.id))
        }
      } else if (mode === 'pitch') {
        handlePitchClick(lat, lng)
      } else if (mode === 'ai_segment') {
        await handleAiSegment(e)
      }
    }

    map.on('mousedown', handleMouseDown)
    map.on('mousemove', handleMouseMove)
    map.on('mouseup', handleMouseUp)
    map.on('click', handleClick)

    return () => {
      map.off('mousedown', handleMouseDown)
      map.off('mousemove', handleMouseMove)
      map.off('mouseup', handleMouseUp)
      map.off('click', handleClick)
    }
  }, [mode, addType, edges, mapReady])

  // ---------------------------------------------------------------------------
  // AI Segmentation (SAM 2)
  // ---------------------------------------------------------------------------

  const handleAiSegment = async (e: maplibregl.MapMouseEvent) => {
    const map = mapRef.current
    if (!map || aiLoading) return

    setAiLoading(true)
    try {
      // First try Nearmap AI (auto-detects full roof, no click needed)
      // Then fall back to SAM 2 (needs click point + image)
      const canvas = map.getCanvas()
      const pixelX = e.point.x
      const pixelY = e.point.y
      const dataUrl = canvas.toDataURL('image/png')
      const base64 = dataUrl.split(',')[1]

      const res = await fetch('/api/roof-reports/sam-segment', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({
          imageBase64: base64,
          clickPoints: [{ x: pixelX, y: pixelY }],
          labels: [1],
          imageWidth: canvas.width,
          imageHeight: canvas.height,
          centerLat,
          centerLng,
          zoom: map.getZoom(),
        }),
      })

      if (!res.ok) throw new Error('AI detection failed')

      const data = await res.json()

      // Parse edges from response (works for both Nearmap AI and SAM 2)
      const newEdges: Edge[] = (data.edges || []).map((e: any) => ({
        id: makeEdgeId(),
        type: e.type as EdgeType,
        startLat: e.startLat, startLng: e.startLng,
        endLat: e.endLat, endLng: e.endLng,
        lengthFt: e.lengthFt,
      }))

      if (newEdges.length > 0) {
        pushHistory(edges)
        // Nearmap AI returns the full roof — replace all edges
        // SAM 2 returns one segment — append edges
        if (data.source === 'nearmap_ai') {
          setEdges(newEdges)
        } else {
          setEdges(prev => [...prev, ...newEdges])
        }
      }

      // Show AI-detected property info
      if (data.roofCondition || data.roofMaterial) {
        console.log(`AI Detection: ${data.source}`, {
          condition: data.roofCondition,
          material: data.roofMaterial,
          treeOverhang: data.treeOverhangPct,
        })
      }
    } catch (err: any) {
      console.error('AI detection error:', err)
    } finally {
      setAiLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Snap + hit-test helpers
  // ---------------------------------------------------------------------------

  function snapToNearby(lat: number, lng: number, edges: Edge[]): { lat: number; lng: number } {
    let bestDist = SNAP_DISTANCE_METERS
    let best = { lat, lng }
    for (const e of edges) {
      for (const [eLat, eLng] of [[e.startLat, e.startLng], [e.endLat, e.endLng]]) {
        const d = haversineMeters(lat, lng, eLat, eLng)
        if (d < bestDist) {
          bestDist = d
          best = { lat: eLat, lng: eLng }
        }
      }
    }
    return best
  }

  function findNearestEdge(lat: number, lng: number, edges: Edge[], map: maplibregl.Map): Edge | null {
    const point = map.project([lng, lat])
    let bestDist = 15 // pixels
    let best: Edge | null = null

    for (const e of edges) {
      const p1 = map.project([e.startLng, e.startLat])
      const p2 = map.project([e.endLng, e.endLat])
      const dist = pointToSegmentDistance(point.x, point.y, p1.x, p1.y, p2.x, p2.y)
      if (dist < bestDist) {
        bestDist = dist
        best = e
      }
    }
    return best
  }

  /** Compute convex hull area in sqft from lat/lng points */
  function computeConvexAreaSqft(points: Array<{ lat: number; lng: number }>): number {
    if (points.length < 3) return 0
    const cLat = points.reduce((s, p) => s + p.lat, 0) / points.length
    const cLng = points.reduce((s, p) => s + p.lng, 0) / points.length
    const cosLat = Math.cos(cLat * Math.PI / 180)
    const feetPerDegLat = 364567.2
    const feetPerDegLng = feetPerDegLat * cosLat

    const sorted = points.map(p => ({
      x: (p.lng - cLng) * feetPerDegLng,
      y: (p.lat - cLat) * feetPerDegLat,
    }))
    sorted.sort((a, b) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x))

    const unique = [sorted[0]]
    for (let i = 1; i < sorted.length; i++) {
      const prev = unique[unique.length - 1]
      if (Math.abs(sorted[i].x - prev.x) > 0.5 || Math.abs(sorted[i].y - prev.y) > 0.5) {
        unique.push(sorted[i])
      }
    }

    let area = 0
    for (let i = 0; i < unique.length; i++) {
      const j = (i + 1) % unique.length
      area += unique[i].x * unique[j].y - unique[j].x * unique[i].y
    }
    return Math.round(Math.abs(area) / 2)
  }

  /** Compute area of a polygon defined by lat/lng vertices, in sqft */
  function polygonAreaSqft(vertices: Array<{ lat: number; lng: number }>): number {
    if (vertices.length < 3) return 0
    const cLat = vertices.reduce((s, p) => s + p.lat, 0) / vertices.length
    const cLng = vertices.reduce((s, p) => s + p.lng, 0) / vertices.length
    const cosLat = Math.cos(cLat * Math.PI / 180)
    const feetPerDegLat = 364567.2
    const feetPerDegLng = feetPerDegLat * cosLat

    const pts = vertices.map(p => ({
      x: (p.lng - cLng) * feetPerDegLng,
      y: (p.lat - cLat) * feetPerDegLat,
    }))

    let area = 0
    for (let i = 0; i < pts.length; i++) {
      const j = (i + 1) % pts.length
      area += pts[i].x * pts[j].y - pts[j].x * pts[i].y
    }
    return Math.round(Math.abs(area) / 2)
  }

  /** Check if a point is inside a polygon (ray casting) */
  function pointInPoly(lat: number, lng: number, poly: Array<{ lat: number; lng: number }>): boolean {
    let inside = false
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      if ((poly[i].lat > lat) !== (poly[j].lat > lat) &&
          lng < (poly[j].lng - poly[i].lng) * (lat - poly[i].lat) / (poly[j].lat - poly[i].lat) + poly[i].lng) {
        inside = !inside
      }
    }
    return inside
  }

  /** Handle click in pitch mode — find which face was clicked, prompt for pitch */
  function handlePitchClick(lat: number, lng: number) {
    for (const face of faces) {
      if (pointInPoly(lat, lng, face.vertices)) {
        setSelectedFaceId(face.id)
        return
      }
    }
    setSelectedFaceId(null)
  }

  /** Detect closed faces from the edge graph.
   * Simple approach: find all minimal cycles in the planar graph formed by edges.
   * For roofs, this works because edges form a planar subdivision.
   */
  function detectFaces(): RoofFace[] {
    if (edges.length < 3) return []

    // Build adjacency graph from edge endpoints
    const EPSILON = 0.000005 // ~0.5m in degrees
    const pointKey = (lat: number, lng: number) =>
      `${Math.round(lat / EPSILON) * EPSILON},${Math.round(lng / EPSILON) * EPSILON}`

    // Collect unique vertices
    const vertexMap = new Map<string, { lat: number; lng: number }>()
    const adjacency = new Map<string, Set<string>>()

    for (const e of edges) {
      const k1 = pointKey(e.startLat, e.startLng)
      const k2 = pointKey(e.endLat, e.endLng)
      if (k1 === k2) continue

      if (!vertexMap.has(k1)) vertexMap.set(k1, { lat: e.startLat, lng: e.startLng })
      if (!vertexMap.has(k2)) vertexMap.set(k2, { lat: e.endLat, lng: e.endLng })

      if (!adjacency.has(k1)) adjacency.set(k1, new Set())
      if (!adjacency.has(k2)) adjacency.set(k2, new Set())
      adjacency.get(k1)!.add(k2)
      adjacency.get(k2)!.add(k1)
    }

    // Find minimal cycles using right-hand wall following
    const usedDirected = new Set<string>()
    const detectedFaces: RoofFace[] = []
    let faceNum = 1

    for (const [startKey] of adjacency) {
      const neighbors = adjacency.get(startKey)!
      for (const nextKey of neighbors) {
        const dirKey = `${startKey}->${nextKey}`
        if (usedDirected.has(dirKey)) continue

        // Follow right-hand rule to trace a face
        const faceVerts: string[] = [startKey]
        let prevKey = startKey
        let currKey = nextKey
        let steps = 0
        const maxSteps = edges.length * 2

        while (currKey !== startKey && steps < maxSteps) {
          usedDirected.add(`${prevKey}->${currKey}`)
          faceVerts.push(currKey)

          const currNeighbors = Array.from(adjacency.get(currKey) || [])
          if (currNeighbors.length < 2) break

          // Find the next edge by turning right (smallest CCW angle from incoming direction)
          const currPt = vertexMap.get(currKey)!
          const prevPt = vertexMap.get(prevKey)!
          const inAngle = Math.atan2(prevPt.lat - currPt.lat, prevPt.lng - currPt.lng)

          let bestAngle = Infinity
          let bestNext = ''
          for (const nKey of currNeighbors) {
            if (nKey === prevKey) continue
            const nPt = vertexMap.get(nKey)!
            const outAngle = Math.atan2(nPt.lat - currPt.lat, nPt.lng - currPt.lng)
            let turn = outAngle - inAngle
            if (turn <= 0) turn += 2 * Math.PI
            if (turn < bestAngle) {
              bestAngle = turn
              bestNext = nKey
            }
          }

          if (!bestNext) break
          prevKey = currKey
          currKey = bestNext
          steps++
        }

        if (currKey === startKey && faceVerts.length >= 3 && faceVerts.length <= 20) {
          usedDirected.add(`${prevKey}->${currKey}`)

          const vertices = faceVerts.map(k => vertexMap.get(k)!)
          const footprintArea = polygonAreaSqft(vertices)

          // Skip tiny faces (< 20 sqft) and huge faces (> 10000 sqft, likely the outer boundary)
          if (footprintArea >= 20 && footprintArea <= 10000) {
            // Reuse existing face pitch if we have one at the same location
            const existingFace = faces.find(f => {
              const fCenter = { lat: f.vertices.reduce((s, v) => s + v.lat, 0) / f.vertices.length, lng: f.vertices.reduce((s, v) => s + v.lng, 0) / f.vertices.length }
              const newCenter = { lat: vertices.reduce((s, v) => s + v.lat, 0) / vertices.length, lng: vertices.reduce((s, v) => s + v.lng, 0) / vertices.length }
              return haversineMeters(fCenter.lat, fCenter.lng, newCenter.lat, newCenter.lng) < 3
            })

            const pitch = existingFace?.pitch || 4
            const pitchAngle = Math.atan(pitch / 12)
            const slopeAreaSqft = Math.round(footprintArea / Math.cos(pitchAngle))

            detectedFaces.push({
              id: existingFace?.id || `face-${faceNum++}`,
              vertices,
              pitch,
              areaSqft: footprintArea,
              slopeAreaSqft,
            })
          }
        }
      }
    }

    // Remove overlapping faces — if a face contains another face's centroid, it's
    // an enclosing polygon, not a minimal roof face. Keep only minimal faces.
    const minimalFaces = detectedFaces.filter(face => {
      const otherFaces = detectedFaces.filter(f => f.id !== face.id)
      // If this face contains any other face's centroid, it's an enclosing polygon
      for (const other of otherFaces) {
        const otherCenter = {
          lat: other.vertices.reduce((s, v) => s + v.lat, 0) / other.vertices.length,
          lng: other.vertices.reduce((s, v) => s + v.lng, 0) / other.vertices.length,
        }
        if (pointInPoly(otherCenter.lat, otherCenter.lng, face.vertices)) {
          return false // This face contains another face — it's not minimal
        }
      }
      return true
    })

    return minimalFaces
  }

  // Auto-detect faces whenever edges change
  useEffect(() => {
    if (edges.length >= 3) {
      const detected = detectFaces()
      if (detected.length > 0) setFaces(detected)
    }
  }, [edges])

  function pointToSegmentDistance(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1, dy = y2 - y1
    const lenSq = dx * dx + dy * dy
    if (lenSq === 0) return Math.sqrt((px - x1) ** 2 + (py - y1) ** 2)
    let t = ((px - x1) * dx + (py - y1) * dy) / lenSq
    t = Math.max(0, Math.min(1, t))
    const projX = x1 + t * dx, projY = y1 + t * dy
    return Math.sqrt((px - projX) ** 2 + (py - projY) ** 2)
  }

  // ---------------------------------------------------------------------------
  // Save handler
  // ---------------------------------------------------------------------------

  const handleSave = async () => {
    setSaving(true)
    try {
      const apiEdges = edges.map(e => ({
        type: e.type,
        lengthFt: e.lengthFt,
        startLat: e.startLat, startLng: e.startLng,
        endLat: e.endLat, endLng: e.endLng,
        segmentA: e.segmentA, segmentB: e.segmentB,
      }))
      await onSave(apiEdges, measurements, reportId)
      setDirty(false)
    } catch {
      // Parent handles error toast
    } finally {
      setSaving(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Keyboard shortcuts
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z' && e.shiftKey) { e.preventDefault(); redo() }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedId) {
          pushHistory(edges)
          setEdges(prev => prev.filter(e => e.id !== selectedId))
          setSelectedId(null)
        }
      }
      if (e.key === 'Escape') { setAddStart(null); setSelectedId(null) }
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [undo, redo, selectedId, edges, pushHistory])

  // ---------------------------------------------------------------------------
  // Cursor style based on mode
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const canvas = mapRef.current?.getCanvas()
    if (!canvas) return
    const cursors: Record<Mode, string> = {
      select: 'default', add: 'crosshair', delete: 'not-allowed', pitch: 'pointer', ai_segment: 'cell',
    }
    canvas.style.cursor = cursors[mode] || 'default'
  }, [mode, mapReady])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const selectedEdge = edges.find(e => e.id === selectedId)

  return (
    <div className="flex gap-4">
      {/* Map + Toolbar */}
      <div className="flex-1">
        {/* Toolbar */}
        <div className="flex items-center gap-2 mb-3 flex-wrap">
          {/* Mode buttons */}
          <div className="flex items-center bg-white rounded-lg border shadow-sm overflow-hidden">
            <button
              onClick={() => { setMode('select'); setAddStart(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium transition-colors ${mode === 'select' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <MousePointer2 className="w-3.5 h-3.5" /> Select
            </button>
            <button
              onClick={() => { setMode('add'); setAddStart(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-l transition-colors ${mode === 'add' ? 'bg-blue-50 text-blue-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Plus className="w-3.5 h-3.5" /> Add Line
            </button>
            <button
              onClick={() => { setMode('delete'); setAddStart(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-l transition-colors ${mode === 'delete' ? 'bg-red-50 text-red-700' : 'text-gray-600 hover:bg-gray-50'}`}
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete
            </button>
            <button
              onClick={() => { setMode('pitch'); setAddStart(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-l transition-colors ${mode === 'pitch' ? 'bg-orange-50 text-orange-700' : 'text-gray-600 hover:bg-gray-50'}`}
              title="Set pitch — click a roof face to assign its pitch"
            >
              <span className="text-xs font-bold">⟋</span> Pitch
              {faces.length > 0 && <span className="ml-1 px-1.5 py-0.5 bg-orange-100 text-orange-700 text-[10px] rounded-full font-bold">{faces.length}</span>}
            </button>
            <button
              onClick={() => { setMode('ai_segment'); setAddStart(null) }}
              className={`flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-l transition-colors ${mode === 'ai_segment' ? 'bg-purple-50 text-purple-700' : 'text-gray-600 hover:bg-gray-50'}`}
              title="AI Segment — click on a roof face to auto-detect its boundary"
            >
              {aiLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
              AI Segment
            </button>
          </div>

          {/* Edge type selector (for add mode) */}
          {mode === 'add' && (
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value as EdgeType)}
              className="px-2 py-2 text-xs border rounded-lg bg-white shadow-sm"
            >
              {EDGE_TYPES.map(t => (
                <option key={t} value={t}>{EDGE_LABELS[t]}</option>
              ))}
            </select>
          )}

          {/* Undo/Redo */}
          <div className="flex items-center gap-1 ml-auto">
            <button onClick={undo} disabled={history.length === 0} title="Undo (Ctrl+Z)"
              className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-colors">
              <Undo2 className="w-4 h-4" />
            </button>
            <button onClick={redo} disabled={future.length === 0} title="Redo (Ctrl+Shift+Z)"
              className="p-2 text-gray-500 hover:text-gray-700 disabled:opacity-30 transition-colors">
              <Redo2 className="w-4 h-4" />
            </button>
          </div>

          {/* Revert */}
          {onRevert && userEdited && (
            <button onClick={onRevert} className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-orange-600 hover:text-orange-700 border border-orange-200 rounded-lg hover:bg-orange-50 transition-colors">
              <RotateCcw className="w-3.5 h-3.5" /> Revert
            </button>
          )}

          {/* Save */}
          <button
            onClick={handleSave}
            disabled={saving || !dirty}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-semibold text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Save className="w-3.5 h-3.5" /> {saving ? 'Saving...' : 'Save'}
          </button>
        </div>

        {/* Add mode hint */}
        {mode === 'add' && (
          <div className="mb-2 px-3 py-1.5 bg-blue-50 text-blue-700 text-xs rounded-lg">
            Click and drag to draw a {addType} line. Release to place it.
          </div>
        )}

        {/* Pitch mode hint */}
        {mode === 'pitch' && (
          <div className="mb-2 px-3 py-1.5 bg-orange-50 text-orange-700 text-xs rounded-lg">
            {faces.length === 0
              ? 'Draw at least 3 edges to form roof faces, then click each face to set its pitch.'
              : `${faces.length} face${faces.length > 1 ? 's' : ''} detected. Click a face to set its pitch.`}
          </div>
        )}

        {/* AI mode hint */}
        {mode === 'ai_segment' && (
          <div className="mb-2 px-3 py-1.5 bg-purple-50 text-purple-700 text-xs rounded-lg">
            {aiLoading ? 'AI is analyzing the roof...' : 'Click on a roof face to auto-detect its boundary with AI.'}
          </div>
        )}

        {/* Map container */}
        <div
          ref={mapContainerRef}
          className="rounded-xl overflow-hidden border shadow-sm"
          style={{ width: mapWidth, height: mapHeight }}
        />

        {/* Edge legend */}
        <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
          {EDGE_TYPES.map(t => (
            <div key={t} className="flex items-center gap-1.5">
              <div className="w-4 h-0.5 rounded" style={{ backgroundColor: EDGE_COLORS[t] }} />
              {EDGE_LABELS[t]}
            </div>
          ))}
        </div>
      </div>

      {/* Right sidebar — selected edge + measurements */}
      <div className="w-64 space-y-4 shrink-0">
        {/* Selected edge */}
        {selectedEdge && mode === 'select' && (
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider">Selected Edge</h3>
            <div>
              <label className="text-xs text-gray-500">Type</label>
              <select
                value={selectedEdge.type}
                onChange={(e) => {
                  pushHistory(edges)
                  setEdges(prev => prev.map(ed =>
                    ed.id === selectedId ? { ...ed, type: e.target.value as EdgeType } : ed
                  ))
                }}
                className="w-full mt-1 px-2 py-1.5 text-sm border rounded-lg"
              >
                {EDGE_TYPES.map(t => <option key={t} value={t}>{EDGE_LABELS[t]}</option>)}
              </select>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-500">Length</span>
              <span className="font-medium">{selectedEdge.lengthFt.toFixed(1)} ft</span>
            </div>
            <button
              onClick={() => {
                pushHistory(edges)
                setEdges(prev => prev.filter(e => e.id !== selectedId))
                setSelectedId(null)
              }}
              className="w-full flex items-center justify-center gap-1.5 px-3 py-2 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" /> Delete Edge
            </button>
          </div>
        )}

        {/* Roof Faces + Pitch */}
        {faces.length > 0 && (
          <div className="bg-white rounded-xl border shadow-sm p-4">
            <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">
              Roof Faces ({faces.length})
            </h3>
            <div className="space-y-2">
              {faces.map((face, i) => (
                <div
                  key={face.id}
                  className={`p-2 rounded-lg border text-sm cursor-pointer transition-colors ${
                    selectedFaceId === face.id ? 'border-orange-400 bg-orange-50' : 'border-gray-100 hover:bg-gray-50'
                  }`}
                  onClick={() => { setSelectedFaceId(face.id); setMode('pitch') }}
                >
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-700">Face {i + 1}</span>
                    <span className="text-xs text-gray-500">{face.slopeAreaSqft.toLocaleString()} sqft</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    <label className="text-xs text-gray-500">Pitch:</label>
                    <select
                      value={face.pitch}
                      onChange={(e) => {
                        const newPitch = +e.target.value
                        setFaces(prev => prev.map(f => {
                          if (f.id !== face.id) return f
                          const pitchAngle = Math.atan(newPitch / 12)
                          return { ...f, pitch: newPitch, slopeAreaSqft: Math.round(f.areaSqft / Math.cos(pitchAngle)) }
                        }))
                        setDirty(true)
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="px-1.5 py-0.5 text-xs border rounded bg-white font-medium"
                    >
                      {[0,1,2,3,4,5,6,7,8,9,10,11,12].map(p => (
                        <option key={p} value={p}>{p}/12</option>
                      ))}
                    </select>
                    <span className="text-xs text-gray-400 ml-auto">
                      {face.areaSqft.toLocaleString()} sqft flat
                    </span>
                  </div>
                </div>
              ))}
            </div>
            <div className="mt-3 pt-2 border-t flex justify-between text-sm font-semibold">
              <span className="text-gray-700">Total Slope Area</span>
              <span className="text-blue-600">{faces.reduce((s, f) => s + f.slopeAreaSqft, 0).toLocaleString()} sqft</span>
            </div>
          </div>
        )}

        {/* Measurements */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <h3 className="text-xs font-semibold text-gray-900 uppercase tracking-wider mb-3">Measurements</h3>
          <div className="space-y-2 text-sm">
            {[
              { label: 'Ridge', value: measurements.ridgeLF, color: EDGE_COLORS.ridge },
              { label: 'Valley', value: measurements.valleyLF, color: EDGE_COLORS.valley },
              { label: 'Hip', value: measurements.hipLF, color: EDGE_COLORS.hip },
              { label: 'Rake', value: measurements.rakeLF, color: EDGE_COLORS.rake },
              { label: 'Eave', value: measurements.eaveLF, color: EDGE_COLORS.eave },
            ].map(m => (
              <div key={m.label} className="flex items-center justify-between">
                <span className="flex items-center gap-1.5 text-gray-600">
                  <div className="w-3 h-0.5 rounded" style={{ backgroundColor: m.color }} />
                  {m.label}
                </span>
                <span className="font-medium text-gray-900">{m.value} LF</span>
              </div>
            ))}
            <div className="border-t pt-2 mt-2 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Perimeter</span>
                <span className="font-medium">{measurements.totalPerimeterLF} LF</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Waste Factor</span>
                <span className="font-medium">{measurements.wasteFactor}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">Ice & Water Shield</span>
                <span className="font-medium">{measurements.iceWaterShieldSqft} sqft</span>
              </div>
            </div>
            <div className="border-t pt-2 mt-2 space-y-2">
              <div className="flex justify-between">
                <span className="text-gray-600">Total Squares</span>
                <span className="font-bold text-gray-900">{measurements.totalSquares}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-600">w/ Waste</span>
                <span className="font-bold text-blue-600">{measurements.squaresWithWaste}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
