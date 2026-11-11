// Moved from templates/crm-roof/frontend/src/pages/roofReports/Roof3DViewer.tsx. Changed: the roof's heights come from
// the sections themselves (roofHeights.ts) — the server grid it used to load had cells 11 metres across, so every roof
// was drawn flat — and it opens at true scale rather than doubled.
import { useState, useEffect, useMemo, useRef, useCallback } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { buildRoofMeshes, buildEdgeLines } from './Roof3DMesh'
import { solveRoofHeights } from './roofHeights'
import { RotateCcw } from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Segment {
  name: string
  pitch: string
  pitchDegrees: number
  azimuthDegrees: number
  area: number
  polygon?: Array<{ lat: number; lng: number }>
}

export interface Edge {
  type: string
  startLat: number; startLng: number
  endLat: number; endLng: number
  lengthFt: number
}

interface Props {
  segments: Segment[]
  edges: Edge[]
  centerLat: number
  centerLng: number
  reportId?: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function Roof3DViewer({ segments, edges, centerLat, centerLng }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null)
  const sceneRef = useRef<THREE.Scene | null>(null)
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null)
  const controlsRef = useRef<OrbitControls | null>(null)
  const animFrameRef = useRef<number>(0)

  const [exaggeration, setExaggeration] = useState(1.0)
  const loading = false
  // How high each corner stands, from the sections' pitch and facing.
  const heights = useMemo(() => solveRoofHeights(segments, edges, { lat: centerLat, lng: centerLng }), [segments, edges, centerLat, centerLng])

  // ---------------------------------------------------------------------------
  // Initialize Three.js scene
  // ---------------------------------------------------------------------------

  const initScene = useCallback(() => {
    if (!containerRef.current) return

    const width = containerRef.current.clientWidth
    const height = 500

    // Scene
    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x1a1a2e)
    sceneRef.current = scene

    // Camera
    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 1000)
    camera.position.set(20, -30, 25)
    camera.up.set(0, 0, 1) // Z is up
    cameraRef.current = camera

    // Renderer
    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setSize(width, height)
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    containerRef.current.appendChild(renderer.domElement)
    rendererRef.current = renderer

    // Controls
    const controls = new OrbitControls(camera, renderer.domElement)
    controls.enableDamping = true
    controls.dampingFactor = 0.05
    controls.maxPolarAngle = Math.PI / 2.1 // Prevent going below ground
    controlsRef.current = controls

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6)
    scene.add(ambientLight)

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8)
    dirLight.position.set(20, 20, 30)
    dirLight.castShadow = false
    scene.add(dirLight)

    const fillLight = new THREE.DirectionalLight(0x8888ff, 0.3)
    fillLight.position.set(-10, -10, 20)
    scene.add(fillLight)

    // Grid helper (ground plane)
    const gridHelper = new THREE.GridHelper(50, 20, 0x444444, 0x333333)
    gridHelper.rotation.x = Math.PI / 2 // Rotate to XY plane (Z-up)
    scene.add(gridHelper)

    // Animation loop
    function animate() {
      animFrameRef.current = requestAnimationFrame(animate)
      controls.update()
      renderer.render(scene, camera)
    }
    animate()

    // Resize handler
    const handleResize = () => {
      if (!containerRef.current) return
      const w = containerRef.current.clientWidth
      camera.aspect = w / height
      camera.updateProjectionMatrix()
      renderer.setSize(w, height)
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      cancelAnimationFrame(animFrameRef.current)
      renderer.dispose()
      if (containerRef.current?.contains(renderer.domElement)) {
        containerRef.current.removeChild(renderer.domElement)
      }
    }
  }, [])

  useEffect(() => {
    const cleanup = initScene()
    return cleanup
  }, [initScene])

  // ---------------------------------------------------------------------------
  // Build roof meshes when data changes
  // ---------------------------------------------------------------------------

  useEffect(() => {
    const scene = sceneRef.current
    if (!scene || loading) return

    // Remove old roof group
    const oldGroup = scene.getObjectByName('roof-group')
    if (oldGroup) scene.remove(oldGroup)
    const oldEdges = scene.getObjectByName('edge-group')
    if (oldEdges) scene.remove(oldEdges)

    // Build segment meshes
    const roofGroup = buildRoofMeshes(segments, null, centerLat, centerLng, exaggeration, heights.heightAt)
    roofGroup.name = 'roof-group'
    scene.add(roofGroup)

    // Build edge lines
    const edgeGroup = buildEdgeLines(edges, null, centerLat, centerLng, exaggeration, heights.heightAt)
    edgeGroup.name = 'edge-group'
    scene.add(edgeGroup)

    // Auto-fit camera to roof bounds
    const box = new THREE.Box3().setFromObject(roofGroup)
    if (!box.isEmpty()) {
      const center = box.getCenter(new THREE.Vector3())
      const size = box.getSize(new THREE.Vector3())
      const maxDim = Math.max(size.x, size.y, size.z)

      if (controlsRef.current) {
        controlsRef.current.target.copy(center)
        controlsRef.current.update()
      }
      if (cameraRef.current) {
        cameraRef.current.position.set(
          center.x + maxDim * 0.8,
          center.y - maxDim * 1.2,
          center.z + maxDim * 0.9,
        )
      }
    }
  }, [segments, edges, heights, exaggeration, loading, centerLat, centerLng])

  // ---------------------------------------------------------------------------
  // Controls
  // ---------------------------------------------------------------------------

  const resetCamera = () => {
    if (cameraRef.current && controlsRef.current) {
      cameraRef.current.position.set(20, -30, 25)
      controlsRef.current.target.set(0, 0, 0)
      controlsRef.current.update()
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-3">
      {/* Controls bar */}
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-sm">
          <label className="text-gray-500 dark:text-slate-400">Elevation:</label>
          <input
            type="range"
            min="0.5"
            max="5"
            step="0.5"
            value={exaggeration}
            onChange={(e) => setExaggeration(parseFloat(e.target.value))}
            className="w-24"
          />
          <span className="text-gray-700 font-medium w-8 dark:text-slate-200">{exaggeration}x</span>
        </div>
        <button
          onClick={resetCamera}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-gray-600 border rounded-lg hover:bg-gray-50 dark:hover:bg-slate-800 transition-colors dark:text-slate-400"
        >
          <RotateCcw className="w-3.5 h-3.5" /> Reset View
        </button>
        <div className="ml-auto text-xs text-gray-500 dark:text-slate-400">
          Drag to rotate, scroll to zoom, right-click to pan
        </div>
      </div>

      {/* 3D viewport */}
      <div
        ref={containerRef}
        className="rounded-xl overflow-hidden border shadow-sm bg-gray-900"
        style={{ height: 500 }}
      >
        {loading && (
          <div className="flex items-center justify-center h-full">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-orange-400" />
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-slate-400">
        <span className="font-medium">Segments:</span>
        {segments.slice(0, 8).map((seg, i) => (
          <div key={i} className="flex items-center gap-1">
            <div
              className="w-3 h-3 rounded-sm"
              style={{
                backgroundColor: [
                  '#3B82F6', '#10B981', '#F59E0B', '#EF4444',
                  '#8B5CF6', '#EC4899', '#14B8A6', '#F97316',
                ][i % 8],
                opacity: 0.85,
              }}
            />
            {seg.pitch}
          </div>
        ))}
      </div>
    </div>
  )
}
