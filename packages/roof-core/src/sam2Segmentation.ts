// SAM 2 (Segment Anything Model) Integration via Replicate API
// Provides one-click AI-powered roof plane segmentation.
// User clicks a point on the roof → SAM returns pixel-perfect polygon masks.

import logger from './logger.ts'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Sam2Request {
  /** Aerial image as base64 (PNG/JPEG) */
  imageBase64: string
  /** Click points in pixel coordinates on the image */
  points: Array<{ x: number; y: number }>
  /** Labels: 1 = include (foreground), 0 = exclude (background) */
  labels: number[]
  /** Image dimensions */
  imageWidth: number
  imageHeight: number
}

export interface Sam2Mask {
  /** Polygon vertices in pixel coordinates */
  polygon: Array<{ x: number; y: number }>
  /** Model confidence score (0-1) */
  confidence: number
  /** Pixel area of the mask */
  area: number
}

export interface Sam2Result {
  masks: Sam2Mask[]
  processingTimeMs: number
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

function getReplicateToken(): string {
  const token = process.env.REPLICATE_API_TOKEN || ''
  if (!token) throw new Error('Missing REPLICATE_API_TOKEN environment variable')
  return token
}

function isConfigured(): boolean {
  return !!process.env.REPLICATE_API_TOKEN
}

// ---------------------------------------------------------------------------
// Core segmentation
// ---------------------------------------------------------------------------

/**
 * Run SAM 2 segmentation on an aerial image with point prompts.
 * Calls the Replicate API and returns polygon masks.
 */
export async function segmentRoof(req: Sam2Request): Promise<Sam2Result> {
  if (!isConfigured()) {
    throw new Error('SAM 2 segmentation is not configured (missing REPLICATE_API_TOKEN)')
  }

  const startTime = Date.now()
  const token = getReplicateToken()

  try {
    // Format points for SAM 2 input
    // SAM expects points as [[x1,y1],[x2,y2]] and labels as [1,1]
    const inputPoints = req.points.map(p => [Math.round(p.x), Math.round(p.y)])
    const inputLabels = req.labels

    // Create prediction using Replicate API
    const createRes = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Prefer': 'wait',  // Wait for result (up to 60s)
      },
      body: JSON.stringify({
        version: 'fe97b453a6455861e3bec01b3e7ca0de48bfa01f6c23c4464e0e32f0e8117068', // SAM 2.1 Large
        input: {
          image: `data:image/png;base64,${req.imageBase64}`,
          point_coords: inputPoints,
          point_labels: inputLabels,
          multimask_output: true,
          return_logits: false,
        },
      }),
      signal: AbortSignal.timeout(120_000), // 2 min timeout (includes cold start)
    })

    if (!createRes.ok) {
      const errBody = await createRes.text()
      logger.error('Replicate API error', { status: createRes.status, body: errBody })
      throw new Error(`Replicate API error: ${createRes.status}`)
    }

    let prediction = await createRes.json() as any

    // If not completed yet (no Prefer: wait support), poll for result
    if (prediction.status !== 'succeeded') {
      prediction = await pollPrediction(prediction.id, token)
    }

    if (prediction.status === 'failed') {
      throw new Error(`SAM 2 prediction failed: ${prediction.error || 'unknown error'}`)
    }

    // Parse SAM 2 output — returns base64 mask images
    const masks = await parseSam2Output(prediction.output, req.imageWidth, req.imageHeight)

    const processingTimeMs = Date.now() - startTime
    logger.info('SAM 2 segmentation complete', {
      masks: masks.length,
      processingTimeMs,
      points: req.points.length,
    })

    return { masks, processingTimeMs }
  } catch (err: any) {
    logger.error('SAM 2 segmentation failed', { error: err.message })
    throw err
  }
}

// ---------------------------------------------------------------------------
// Polling (fallback if Prefer: wait not supported)
// ---------------------------------------------------------------------------

async function pollPrediction(id: string, token: string, maxWaitMs: number = 120_000): Promise<any> {
  const startTime = Date.now()
  const pollInterval = 2_000

  while (Date.now() - startTime < maxWaitMs) {
    await new Promise(resolve => setTimeout(resolve, pollInterval))

    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { 'Authorization': `Bearer ${token}` },
    })

    if (!res.ok) throw new Error(`Poll failed: ${res.status}`)

    const prediction = await res.json() as any
    if (prediction.status === 'succeeded' || prediction.status === 'failed') {
      return prediction
    }
  }

  throw new Error('SAM 2 prediction timed out')
}

// ---------------------------------------------------------------------------
// Output parsing — convert SAM masks to polygons
// ---------------------------------------------------------------------------

async function parseSam2Output(
  output: any,
  imageWidth: number,
  imageHeight: number,
): Promise<Sam2Mask[]> {
  const masks: Sam2Mask[] = []

  // SAM 2 on Replicate returns either:
  // 1. Array of base64 mask images (multimask_output=true returns 3 masks)
  // 2. A single combined output with mask data

  const maskOutputs = Array.isArray(output) ? output : [output]

  for (const maskOutput of maskOutputs) {
    if (typeof maskOutput === 'string') {
      // It's a URL to a mask image — download and trace contour
      try {
        const polygon = await maskUrlToPolygon(maskOutput, imageWidth, imageHeight)
        if (polygon && polygon.length >= 3) {
          const area = computePolygonArea(polygon)
          // Filter out tiny masks (less than 1% of image area)
          if (area > imageWidth * imageHeight * 0.01) {
            masks.push({
              polygon,
              confidence: 0.9, // SAM doesn't return per-mask confidence in this format
              area,
            })
          }
        }
      } catch (err: any) {
        logger.warn('Failed to process SAM mask', { error: err.message })
      }
    }
  }

  // Sort by area descending (largest mask first)
  masks.sort((a, b) => b.area - a.area)

  return masks
}

/**
 * Download a mask image URL, threshold it, and extract the contour as a polygon.
 */
async function maskUrlToPolygon(
  url: string,
  imageWidth: number,
  imageHeight: number,
): Promise<Array<{ x: number; y: number }> | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null

    const arrayBuf = await res.arrayBuffer()
    const sharp = (await import('sharp')).default

    // Convert mask image to raw grayscale pixels
    const { data, info } = await sharp(Buffer.from(arrayBuf))
      .resize(imageWidth, imageHeight, { fit: 'fill' })
      .grayscale()
      .raw()
      .toBuffer({ resolveWithObject: true })

    // Threshold: pixels > 128 are foreground
    const w = info.width
    const h = info.height
    const binary = new Uint8Array(w * h)
    for (let i = 0; i < data.length; i++) {
      binary[i] = data[i] > 128 ? 1 : 0
    }

    // Extract boundary pixels using simple contour tracing
    return extractContour(binary, w, h)
  } catch {
    return null
  }
}

/**
 * Extract the outer contour of a binary mask as a simplified polygon.
 * Uses Moore neighborhood contour tracing for correct handling of concave shapes.
 */
function extractContour(
  mask: Uint8Array,
  width: number,
  height: number,
): Array<{ x: number; y: number }> {
  // Moore neighborhood: 8 directions clockwise starting from right
  const mooreX = [1, 1, 0, -1, -1, -1, 0, 1]
  const mooreY = [0, 1, 1, 1, 0, -1, -1, -1]

  // Find starting pixel: topmost row, then leftmost column
  let startX = -1, startY = -1
  outer: for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 1) {
        startX = x; startY = y
        break outer
      }
    }
  }
  if (startX < 0) return []

  // Trace boundary using Moore neighborhood algorithm
  const boundary: Array<{ x: number; y: number }> = []
  let curX = startX, curY = startY
  let enterDir = 6 // came from the left (since we found leftmost in top row)
  const maxIter = width * height

  for (let iter = 0; iter < maxIter; iter++) {
    if (boundary.length > 0 && curX === startX && curY === startY) break
    boundary.push({ x: curX, y: curY })

    // Search clockwise starting from backtrack direction + 1
    let searchStart = (enterDir + 5) % 8
    let found = false

    for (let d = 0; d < 8; d++) {
      const dir = (searchStart + d) % 8
      const nx = curX + mooreX[dir]
      const ny = curY + mooreY[dir]

      if (nx >= 0 && nx < width && ny >= 0 && ny < height && mask[ny * width + nx] === 1) {
        enterDir = (dir + 4) % 8
        curX = nx; curY = ny
        found = true
        break
      }
    }

    if (!found) break
  }

  if (boundary.length < 3) return []

  // Douglas-Peucker simplification (tolerance = 2 pixels)
  return douglasPeucker(boundary, 2.0)
}

function douglasPeucker(
  points: Array<{ x: number; y: number }>,
  tolerance: number,
): Array<{ x: number; y: number }> {
  if (points.length <= 2) return points

  let maxDist = 0
  let maxIdx = 0
  const first = points[0]
  const last = points[points.length - 1]

  for (let i = 1; i < points.length - 1; i++) {
    const dist = perpendicularDistance(points[i], first, last)
    if (dist > maxDist) {
      maxDist = dist
      maxIdx = i
    }
  }

  if (maxDist > tolerance) {
    const left = douglasPeucker(points.slice(0, maxIdx + 1), tolerance)
    const right = douglasPeucker(points.slice(maxIdx), tolerance)
    return [...left.slice(0, -1), ...right]
  }

  return [first, last]
}

function perpendicularDistance(
  point: { x: number; y: number },
  lineStart: { x: number; y: number },
  lineEnd: { x: number; y: number },
): number {
  const dx = lineEnd.x - lineStart.x
  const dy = lineEnd.y - lineStart.y
  const len = Math.sqrt(dx * dx + dy * dy)
  if (len === 0) return Math.sqrt((point.x - lineStart.x) ** 2 + (point.y - lineStart.y) ** 2)
  return Math.abs(dy * point.x - dx * point.y + lineEnd.x * lineStart.y - lineEnd.y * lineStart.x) / len
}

function computePolygonArea(polygon: Array<{ x: number; y: number }>): number {
  let area = 0
  const n = polygon.length
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n
    area += polygon[i].x * polygon[j].y
    area -= polygon[j].x * polygon[i].y
  }
  return Math.abs(area) / 2
}
