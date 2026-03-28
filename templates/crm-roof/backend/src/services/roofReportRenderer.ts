// Roof Report Renderer — generates professional HTML reports from computed roof data
// Uses Solar API aerial imagery (stored at generation time) with SVG measurement overlay
// PDF output is handled via browser print-to-PDF (no PDFKit dependency)

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type EdgeType = 'ridge' | 'valley' | 'hip' | 'rake' | 'eave'

export interface RoofEdge {
  type: EdgeType
  lengthFt: number
  startLat: number
  startLng: number
  endLat: number
  endLng: number
  segmentIndex?: number
}

export interface RoofSegmentDetail {
  name: string
  area: number          // sqft
  pitch: string         // e.g. "6/12"
  pitchDegrees: number
  azimuthDegrees: number
  center?: { lat: number; lng: number }
  polygon?: Array<{ lat: number; lng: number }>
}

export interface RoofMeasurements {
  totalAreaSqft: number
  totalSquares: number
  ridgeLF: number
  valleyLF: number
  hipLF: number
  rakeLF: number
  eaveLF: number
  totalPerimeterLF: number
  wasteFactor: number        // e.g. 15 for 15%
  squaresWithWaste: number
  iceWaterShieldSqft: number
}

export interface RoofReportData {
  center: { lat: number; lng: number }
  segments: RoofSegmentDetail[]
  edges: RoofEdge[]
  measurements: RoofMeasurements
  imageryQuality: 'HIGH' | 'MEDIUM' | 'LOW'
  imageryDate?: string | null
  aerialImageBase64?: string | null  // base64 data URL from stored Solar API imagery
  // Nearmap AI-detected data
  roofCondition?: number | null       // 0-100
  roofMaterial?: string | null        // shingle, tile, metal, flat
  treeOverhangPct?: number | null     // 0-100%
  imagerySource?: string | null       // nearmap, google_solar
  elevationSource?: string | null     // nearmap_dsm, usgs_3dep, google_dsm
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

const EDGE_WIDTHS: Record<EdgeType, number> = {
  ridge: 3,
  valley: 3,
  hip: 2.5,
  rake: 2,
  eave: 2,
}

const EDGE_LABELS: Record<EdgeType, string> = {
  ridge: 'Ridge',
  valley: 'Valley',
  hip: 'Hip',
  rake: 'Rake',
  eave: 'Eave',
}

const SEGMENT_FILL_COLORS = [
  'rgba(59,130,246,0.18)',
  'rgba(16,185,129,0.18)',
  'rgba(245,158,11,0.18)',
  'rgba(239,68,68,0.18)',
  'rgba(139,92,246,0.18)',
  'rgba(236,72,153,0.18)',
  'rgba(20,184,166,0.18)',
  'rgba(249,115,22,0.18)',
]

export const MAP_WIDTH = 800
export const MAP_HEIGHT = 600

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getApiKey(): string {
  const key = process.env.GOOGLE_SOLAR_API_KEY || process.env.GOOGLE_MAPS_API_KEY || ''
  if (!key) throw new Error('Missing GOOGLE_SOLAR_API_KEY or GOOGLE_MAPS_API_KEY environment variable')
  return key
}

/**
 * Format a number with thousands separators (server-safe, no locale dependency).
 */
function fmt(n: number, decimals = 0): string {
  const fixed = n.toFixed(decimals)
  const parts = fixed.split('.')
  parts[0] = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, ',')
  return parts.join('.')
}

// ---------------------------------------------------------------------------
// Zoom calculation — fit all segments in the viewport
// ---------------------------------------------------------------------------

function latRad(lat: number): number {
  const sin = Math.sin(lat * Math.PI / 180)
  const radX2 = Math.log((1 + sin) / (1 - sin)) / 2
  return Math.max(Math.min(radX2, Math.PI), -Math.PI) / 2
}

function zoomLevel(mapPx: number, worldPx: number, fraction: number): number {
  if (fraction <= 0) return 21
  return Math.log(mapPx / worldPx / fraction) / Math.LN2
}

export function computeOptimalZoom(segments: RoofSegmentDetail[], imgWidth: number, imgHeight: number, edges?: RoofEdge[]): number {
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity
  for (const seg of segments) {
    if (!seg.polygon) continue
    for (const p of seg.polygon) {
      minLat = Math.min(minLat, p.lat)
      maxLat = Math.max(maxLat, p.lat)
      minLng = Math.min(minLng, p.lng)
      maxLng = Math.max(maxLng, p.lng)
    }
  }
  // Also use edge coordinates (for user-drawn reports)
  if (edges) {
    for (const e of edges) {
      if (e.startLat && e.startLng && e.endLat && e.endLng) {
        minLat = Math.min(minLat, e.startLat, e.endLat)
        maxLat = Math.max(maxLat, e.startLat, e.endLat)
        minLng = Math.min(minLng, e.startLng, e.endLng)
        maxLng = Math.max(maxLng, e.startLng, e.endLng)
      }
    }
  }
  if (minLat === Infinity) return 20 // fallback

  // Add 20% padding
  const latPad = (maxLat - minLat) * 0.2 || 0.0002
  const lngPad = (maxLng - minLng) * 0.2 || 0.0002
  minLat -= latPad; maxLat += latPad
  minLng -= lngPad; maxLng += lngPad

  // Calculate required zoom to fit the bounds
  const WORLD_SIZE = 256
  const latFraction = (latRad(maxLat) - latRad(minLat)) / Math.PI
  const lngFraction = (maxLng - minLng) / 360

  const latZoom = zoomLevel(imgHeight, WORLD_SIZE, latFraction)
  const lngZoom = zoomLevel(imgWidth, WORLD_SIZE, lngFraction)

  return Math.min(Math.floor(Math.min(latZoom, lngZoom)), 21)
}

// ---------------------------------------------------------------------------
// Geo / pixel helpers
// ---------------------------------------------------------------------------

function latLngToPixel(
  lat: number, lng: number,
  centerLat: number, centerLng: number,
  zoom: number, imgWidth: number, imgHeight: number,
): { x: number; y: number } {
  const scale = Math.pow(2, zoom) * 256
  const worldX = (lng + 180) / 360 * scale
  const worldY = (1 - Math.log(Math.tan(lat * Math.PI / 180) + 1 / Math.cos(lat * Math.PI / 180)) / Math.PI) / 2 * scale
  const centerWorldX = (centerLng + 180) / 360 * scale
  const centerWorldY = (1 - Math.log(Math.tan(centerLat * Math.PI / 180) + 1 / Math.cos(centerLat * Math.PI / 180)) / Math.PI) / 2 * scale
  return {
    x: imgWidth / 2 + (worldX - centerWorldX),
    y: imgHeight / 2 + (worldY - centerWorldY),
  }
}

/**
 * Fetch satellite image from Google Maps Static API and return as base64 data URL.
 * Used as FALLBACK when stored Solar API aerial imagery is not available.
 */
export async function fetchSatelliteImageBase64(
  lat: number,
  lng: number,
  zoom: number,
  nearmapImageBase64?: string | null,
): Promise<string> {
  // Use Nearmap imagery if provided (higher resolution)
  if (nearmapImageBase64) {
    return nearmapImageBase64
  }

  try {
    const url = `https://maps.googleapis.com/maps/api/staticmap?center=${lat},${lng}&zoom=${zoom}&size=${MAP_WIDTH}x${MAP_HEIGHT}&maptype=satellite&key=${getApiKey()}`
    const res = await fetch(url)
    if (!res.ok) {
      console.error(`[RoofReport] Satellite image fetch failed: ${res.status} ${res.statusText}`)
      return ''
    }
    const arrayBuf = await res.arrayBuffer()
    const base64 = Buffer.from(arrayBuf).toString('base64')
    const contentType = res.headers.get('content-type') || 'image/png'
    return `data:${contentType};base64,${base64}`
  } catch (err: any) {
    console.error('[RoofReport] Satellite image fetch error:', err.message)
    return ''
  }
}

function midpoint(x1: number, y1: number, x2: number, y2: number) {
  return { x: (x1 + x2) / 2, y: (y1 + y2) / 2 }
}

function polygonCentroid(points: Array<{ x: number; y: number }>): { x: number; y: number } {
  if (points.length === 0) return { x: 0, y: 0 }
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length
  return { x: cx, y: cy }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

// ---------------------------------------------------------------------------
// Imagery date helpers
// ---------------------------------------------------------------------------

function parseImageryMonth(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null
  const parts = dateStr.split('-')
  if (parts.length >= 2) return parseInt(parts[1], 10)
  return null
}

function imagerySeasonLabel(dateStr: string | null | undefined): { label: string; color: string; warning: string } {
  const month = parseImageryMonth(dateStr)
  if (!month) return { label: 'Unknown', color: '#718096', warning: '' }
  if (month >= 6 && month <= 8) return {
    label: 'Summer',
    color: '#C53030',
    warning: 'Summer imagery — deciduous trees may obscure portions of the roof structure. On-site verification recommended for shaded areas.',
  }
  if (month >= 3 && month <= 5) return {
    label: 'Spring',
    color: '#D69E2E',
    warning: 'Spring imagery — early foliage may partially obscure roof edges near trees.',
  }
  if (month >= 9 && month <= 11) return {
    label: 'Fall',
    color: '#DD6B20',
    warning: '',
  }
  // Dec, Jan, Feb
  return { label: 'Winter', color: '#2B6CB0', warning: '' }
}

// ---------------------------------------------------------------------------
// SVG overlay builder (shared by both HTML and PDF-print paths)
// ---------------------------------------------------------------------------

function buildSvgOverlay(
  segments: RoofSegmentDetail[],
  edges: RoofEdge[],
  centerLat: number,
  centerLng: number,
  zoom: number,
): string {
  const svgParts: string[] = []

  // Draw segment polygons with subtle fill
  segments.forEach((seg, i) => {
    if (!seg.polygon || seg.polygon.length < 3) return
    const fill = SEGMENT_FILL_COLORS[i % SEGMENT_FILL_COLORS.length]
    const points = seg.polygon.map(p => {
      const px = latLngToPixel(p.lat, p.lng, centerLat, centerLng, zoom, MAP_WIDTH, MAP_HEIGHT)
      return `${px.x},${px.y}`
    }).join(' ')
    svgParts.push(`<polygon points="${points}" fill="${fill}" stroke="rgba(255,255,255,0.4)" stroke-width="1" />`)
  })

  // Draw edges with color coding and glow effect for visibility
  edges.forEach(edge => {
    const start = latLngToPixel(edge.startLat, edge.startLng, centerLat, centerLng, zoom, MAP_WIDTH, MAP_HEIGHT)
    const end = latLngToPixel(edge.endLat, edge.endLng, centerLat, centerLng, zoom, MAP_WIDTH, MAP_HEIGHT)
    const color = EDGE_COLORS[edge.type] || '#FFFFFF'
    const width = EDGE_WIDTHS[edge.type] || 2
    // Dark outline for contrast
    svgParts.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="rgba(0,0,0,0.5)" stroke-width="${width + 2}" stroke-linecap="round" />`
    )
    svgParts.push(
      `<line x1="${start.x}" y1="${start.y}" x2="${end.x}" y2="${end.y}" stroke="${color}" stroke-width="${width}" stroke-linecap="round" />`
    )
    // Measurement label with improved readability
    const mid = midpoint(start.x, start.y, end.x, end.y)
    svgParts.push(
      `<text x="${mid.x}" y="${mid.y}" text-anchor="middle" dominant-baseline="central" font-size="11" font-weight="bold" fill="#FFFFFF" style="text-shadow: 0 0 3px #000, 0 0 6px #000, 0 1px 2px #000;">${fmt(edge.lengthFt)}'</text>`
    )
  })

  // Pitch labels per segment
  segments.forEach(seg => {
    if (!seg.polygon || seg.polygon.length < 3) return
    const pixelPoints = seg.polygon.map(p =>
      latLngToPixel(p.lat, p.lng, centerLat, centerLng, zoom, MAP_WIDTH, MAP_HEIGHT)
    )
    const c = seg.center
      ? latLngToPixel(seg.center.lat, seg.center.lng, centerLat, centerLng, zoom, MAP_WIDTH, MAP_HEIGHT)
      : polygonCentroid(pixelPoints)
    svgParts.push(
      `<text x="${c.x}" y="${c.y}" text-anchor="middle" dominant-baseline="central" font-size="13" font-weight="bold" fill="#FFD700" style="text-shadow: 0 0 4px #000, 0 0 8px #000, 0 1px 3px #000;">${seg.pitch}</text>`
    )
  })

  return svgParts.join('\n      ')
}

// ---------------------------------------------------------------------------
// Shared HTML body (used by both report and print-PDF paths)
// ---------------------------------------------------------------------------

function buildReportBody(
  report: RoofReportData,
  company: any,
  address: string,
  satelliteDataUrl: string,
  svgContent: string,
): string {
  const { segments, measurements } = report
  const companyName = company?.name || company?.companyName || 'Roofing Company'
  const companyPhone = company?.phone || ''
  const companyEmail = company?.email || ''
  const companyLogo = company?.logoUrl || company?.logo || ''
  const season = imagerySeasonLabel(report.imageryDate)

  // Build legend HTML
  const legendItems = (['ridge', 'valley', 'hip', 'rake', 'eave'] as EdgeType[]).map(type =>
    `<span style="display:inline-flex;align-items:center;margin-right:18px;">
      <span style="display:inline-block;width:24px;height:4px;background:${EDGE_COLORS[type]};border-radius:2px;margin-right:6px;"></span>
      ${EDGE_LABELS[type]}
    </span>`
  ).join('')

  // Imagery source badge
  const imagerySource = report.imagerySource === 'nearmap'
    ? 'Nearmap — 5-7cm Resolution Aerial'
    : report.aerialImageBase64
      ? 'Google Solar API — High-Resolution Aerial'
      : 'Google Maps Satellite'

  return `
    <!-- Company Header -->
    <div class="header">
      <div class="header-left">
        ${companyLogo ? `<img class="header-logo" src="${companyLogo}" alt="${companyName}" />` : ''}
        <div>
          <h1>${escapeHtml(companyName)}</h1>
          <div style="font-size:12px;color:#718096;font-weight:500;margin-top:2px;">Professional Roof Measurement Report</div>
        </div>
      </div>
      <div class="header-contact">
        ${companyPhone ? `<div>${escapeHtml(companyPhone)}</div>` : ''}
        ${companyEmail ? `<div>${escapeHtml(companyEmail)}</div>` : ''}
        <div style="color:#a0aec0;font-size:11px;margin-top:4px;">Generated ${new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
      </div>
    </div>

    <!-- Property Address -->
    <div class="address-bar">
      <div>${escapeHtml(address)}</div>
    </div>

    <!-- Imagery Metadata Bar -->
    <div class="imagery-meta">
      <span>
        <strong>Source:</strong> ${imagerySource}
        ${report.imageryDate ? ` &middot; <strong>Captured:</strong> ${report.imageryDate}` : ''}
        ${season.label !== 'Unknown' ? ` <span class="season-badge" style="background:${season.color};">${season.label}</span>` : ''}
      </span>
      <span class="quality-badge quality-${report.imageryQuality.toLowerCase()}">${report.imageryQuality} Quality</span>
    </div>

    ${season.warning ? `<div class="season-warning">${season.warning}</div>` : ''}

    <!-- Satellite Image with SVG Overlay -->
    <div class="map-container">
      ${satelliteDataUrl
        ? `<img src="${satelliteDataUrl}" alt="Aerial view of ${escapeHtml(address)}" width="${MAP_WIDTH}" height="${MAP_HEIGHT}" />`
        : `<div style="width:${MAP_WIDTH}px;height:${MAP_HEIGHT}px;background:#2d3748;display:flex;align-items:center;justify-content:center;color:#a0aec0;font-size:14px;">Aerial imagery unavailable</div>`}
      <svg viewBox="0 0 ${MAP_WIDTH} ${MAP_HEIGHT}" preserveAspectRatio="xMidYMid meet">
        ${svgContent}
      </svg>
    </div>

    <!-- Color Legend -->
    <div class="legend">${legendItems}</div>

    <!-- Key Metrics Cards -->
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-value">${fmt(measurements.totalSquares, 2)}</div>
        <div class="metric-label">Total Squares</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${fmt(measurements.squaresWithWaste, 2)}</div>
        <div class="metric-label">Squares + ${measurements.wasteFactor}% Waste</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${fmt(measurements.totalAreaSqft)}</div>
        <div class="metric-label">Total Area (sqft)</div>
      </div>
      <div class="metric-card">
        <div class="metric-value">${segments.length}</div>
        <div class="metric-label">Roof Segments</div>
      </div>
    </div>

    ${(report.roofCondition != null || report.roofMaterial || report.treeOverhangPct != null) ? `
    <!-- AI Roof Insights -->
    <div style="background:linear-gradient(135deg,#F3E8FF,#EBF4FF);border:1px solid #D6BCFA;border-radius:8px;padding:16px 20px;margin-bottom:16px;">
      <div style="font-size:12px;font-weight:700;color:#553C9A;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:10px;">AI Roof Analysis</div>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${report.roofCondition != null ? `
        <div>
          <div style="font-size:11px;color:#718096;">Condition Score</div>
          <div style="font-size:20px;font-weight:700;color:${report.roofCondition >= 70 ? '#22543D' : report.roofCondition >= 40 ? '#744210' : '#742A2D'};">${report.roofCondition}<span style="font-size:13px;color:#a0aec0;">/100</span></div>
        </div>` : ''}
        ${report.roofMaterial ? `
        <div>
          <div style="font-size:11px;color:#718096;">Material Detected</div>
          <div style="font-size:16px;font-weight:600;color:#2D3748;text-transform:capitalize;">${escapeHtml(report.roofMaterial)}</div>
        </div>` : ''}
        ${report.treeOverhangPct != null ? `
        <div>
          <div style="font-size:11px;color:#718096;">Tree Overhang</div>
          <div style="font-size:16px;font-weight:600;color:#2D3748;">${report.treeOverhangPct.toFixed(1)}%</div>
        </div>` : ''}
      </div>
    </div>` : ''}

    <!-- Summary Table -->
    <div class="section-title">Measurement Summary</div>
    <table class="summary-table">
      <thead>
        <tr><th>Measurement</th><th>Value</th></tr>
      </thead>
      <tbody>
        <tr><td>Total Roof Area</td><td>${fmt(measurements.totalAreaSqft)} sqft</td></tr>
        <tr><td>Total Squares</td><td>${fmt(measurements.totalSquares, 2)}</td></tr>
        <tr><td>Ridge</td><td>${fmt(measurements.ridgeLF)} LF</td></tr>
        ${measurements.valleyLF > 0
          ? `<tr class="highlight"><td>Valley (ice &amp; water shield needed)</td><td>${fmt(measurements.valleyLF)} LF</td></tr>`
          : `<tr><td>Valley</td><td>${fmt(measurements.valleyLF)} LF</td></tr>`}
        <tr><td>Hip</td><td>${fmt(measurements.hipLF)} LF</td></tr>
        <tr><td>Rake</td><td>${fmt(measurements.rakeLF)} LF</td></tr>
        <tr><td>Eave</td><td>${fmt(measurements.eaveLF)} LF</td></tr>
        <tr><td>Total Perimeter</td><td>${fmt(measurements.totalPerimeterLF)} LF</td></tr>
        <tr><td>Waste Factor</td><td>${measurements.wasteFactor}%</td></tr>
        <tr class="total-row"><td>Squares with Waste</td><td>${fmt(measurements.squaresWithWaste, 2)}</td></tr>
        ${measurements.iceWaterShieldSqft > 0
          ? `<tr class="highlight"><td>Ice &amp; Water Shield</td><td>${fmt(measurements.iceWaterShieldSqft)} sqft</td></tr>`
          : ''}
      </tbody>
    </table>

    <!-- Segment Detail Table -->
    <div class="section-title">Segment Details</div>
    <table class="detail-table">
      <thead>
        <tr><th>#</th><th>Area (sqft)</th><th>Pitch</th><th>Azimuth</th><th>Facing</th></tr>
      </thead>
      <tbody>
        ${segments.map((seg, i) => `
        <tr>
          <td><span class="seg-dot" style="background:${SEGMENT_FILL_COLORS[i % SEGMENT_FILL_COLORS.length].replace('0.18', '0.8')}"></span>${escapeHtml(seg.name)}</td>
          <td>${fmt(seg.area)}</td>
          <td>${escapeHtml(seg.pitch)}</td>
          <td>${seg.azimuthDegrees}&deg;</td>
          <td>${azimuthToCardinal(seg.azimuthDegrees)}</td>
        </tr>`).join('')}
      </tbody>
    </table>

    <!-- Disclaimer -->
    <div class="disclaimer">
      <strong>Disclaimer:</strong> This roof measurement report is generated using aerial imagery and
      automated analysis from the Google Solar API. Measurements are approximate and should be verified
      by an on-site inspection before being used for material ordering, bidding, or construction purposes.
      Actual roof conditions, including hidden damage, structural issues, and complex architectural details,
      may not be fully captured by aerial imagery. The generating company assumes no liability for
      inaccuracies in this report.
    </div>

    <div class="footer">
      Powered by Twomiah Factory &middot; ${report.imagerySource === 'nearmap' ? 'Imagery by Nearmap' : 'Satellite analysis by Google Solar API'}${report.roofCondition != null ? ' &middot; AI analysis by Nearmap' : ''}
    </div>`
}

function azimuthToCardinal(deg: number): string {
  const dirs = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW']
  const idx = Math.round(((deg % 360) + 360) % 360 / 22.5) % 16
  return dirs[idx]
}

// ---------------------------------------------------------------------------
// CSS
// ---------------------------------------------------------------------------

const BASE_CSS = `
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1a202c; background: #f7fafc; line-height: 1.5; }
    .container { max-width: 860px; margin: 0 auto; padding: 32px 24px; }
    .header { display: flex; align-items: center; justify-content: space-between; border-bottom: 2px solid #e2e8f0; padding-bottom: 16px; margin-bottom: 20px; }
    .header-left { display: flex; align-items: center; gap: 16px; }
    .header-logo { max-height: 60px; max-width: 200px; object-fit: contain; }
    .header h1 { font-size: 22px; font-weight: 700; line-height: 1.2; }
    .header-contact { text-align: right; font-size: 13px; color: #4a5568; }
    .address-bar { background: linear-gradient(135deg, #2d3748, #1a202c); color: #fff; padding: 14px 20px; border-radius: 8px; font-size: 17px; font-weight: 600; margin-bottom: 12px; letter-spacing: 0.2px; }

    .imagery-meta { display: flex; align-items: center; justify-content: space-between; font-size: 12px; color: #718096; padding: 8px 14px; background: #edf2f7; border-radius: 6px; margin-bottom: 8px; }
    .season-badge { display: inline-block; color: #fff; font-size: 10px; font-weight: 700; padding: 2px 8px; border-radius: 10px; margin-left: 6px; vertical-align: middle; text-transform: uppercase; letter-spacing: 0.5px; }
    .quality-badge { font-size: 11px; font-weight: 600; padding: 3px 10px; border-radius: 10px; }
    .quality-high { background: #C6F6D5; color: #22543D; }
    .quality-medium { background: #FEFCBF; color: #744210; }
    .quality-low { background: #FED7D7; color: #742A2D; }

    .season-warning { background: #FFFBEB; border: 1px solid #F6E05E; border-radius: 6px; padding: 10px 14px; font-size: 12px; color: #744210; margin-bottom: 12px; line-height: 1.5; }

    .map-container { position: relative; width: ${MAP_WIDTH}px; max-width: 100%; margin: 0 auto 12px; border-radius: 8px; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.15); border: 2px solid #e2e8f0; }
    .map-container img { display: block; width: 100%; height: auto; }
    .map-container svg { position: absolute; top: 0; left: 0; width: 100%; height: 100%; }
    .legend { display: flex; flex-wrap: wrap; align-items: center; font-size: 13px; color: #4a5568; margin-bottom: 20px; padding: 8px 14px; background: #edf2f7; border-radius: 6px; }

    .metrics-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
    .metric-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 8px; padding: 16px; text-align: center; }
    .metric-value { font-size: 24px; font-weight: 800; color: #2d3748; line-height: 1.2; }
    .metric-label { font-size: 12px; color: #718096; margin-top: 4px; font-weight: 500; }

    .summary-table, .detail-table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
    .summary-table th, .detail-table th { text-align: left; background: #2d3748; color: #fff; padding: 10px 14px; font-size: 12px; font-weight: 600; text-transform: uppercase; letter-spacing: 0.5px; }
    .summary-table td, .detail-table td { padding: 9px 14px; border-bottom: 1px solid #e2e8f0; font-size: 14px; }
    .summary-table tr:nth-child(even), .detail-table tr:nth-child(even) { background: #f7fafc; }
    .highlight { background: #FFF5F5 !important; }
    .highlight td { color: #C53030; font-weight: 600; }
    .total-row { background: #EBF8FF !important; }
    .total-row td { font-weight: 700; color: #2B6CB0; }
    .section-title { font-size: 17px; font-weight: 700; margin-bottom: 10px; color: #2d3748; }

    .seg-dot { display: inline-block; width: 10px; height: 10px; border-radius: 50%; margin-right: 8px; vertical-align: middle; }

    .disclaimer { margin-top: 32px; padding: 16px; background: #fffbeb; border: 1px solid #f6e05e; border-radius: 6px; font-size: 11px; color: #744210; line-height: 1.6; }
    .footer { text-align: center; margin-top: 16px; font-size: 11px; color: #a0aec0; padding: 8px 0; }
`

// ---------------------------------------------------------------------------
// HTML Report (screen view)
// ---------------------------------------------------------------------------

export async function generateReportHTML(
  report: RoofReportData,
  company: any,
  address: string,
): Promise<string> {
  const { center, segments, edges } = report

  // Compute optimal zoom to fit all segments
  const zoom = computeOptimalZoom(segments, MAP_WIDTH, MAP_HEIGHT)

  // Always use Google Static Maps at the computed zoom so the SVG overlay aligns.
  // The stored Solar API aerial image covers a 150m tile which doesn't match
  // the zoom level needed for the building-focused overlay.
  const satelliteDataUrl = await fetchSatelliteImageBase64(center.lat, center.lng, zoom)

  // Build SVG overlay
  const svgContent = buildSvgOverlay(segments, edges, center.lat, center.lng, zoom)

  // Build page body
  const body = buildReportBody(report, company, address, satelliteDataUrl, svgContent)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Roof Measurement Report — ${escapeHtml(address)}</title>
  <style>
    ${BASE_CSS}
    @media print { body { background: #fff; } .container { padding: 0; } }
  </style>
</head>
<body>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// PDF Report (print-optimized HTML — use browser print-to-PDF)
// ---------------------------------------------------------------------------

export async function generateReportPDF(
  report: RoofReportData,
  company: any,
  address: string,
): Promise<string> {
  const { center, segments, edges } = report

  // Compute optimal zoom to fit all segments
  const zoom = computeOptimalZoom(segments, MAP_WIDTH, MAP_HEIGHT)

  // Always use Google Static Maps at the computed zoom for overlay alignment
  const satelliteDataUrl = await fetchSatelliteImageBase64(center.lat, center.lng, zoom)

  // Build SVG overlay
  const svgContent = buildSvgOverlay(segments, edges, center.lat, center.lng, zoom)

  // Build page body
  const body = buildReportBody(report, company, address, satelliteDataUrl, svgContent)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Roof Measurement Report — ${escapeHtml(address)}</title>
  <style>
    ${BASE_CSS}

    /* Print-optimized styles */
    @page {
      size: letter;
      margin: 0.5in;
    }

    .print-btn {
      display: block;
      margin: 0 auto 24px;
      padding: 12px 32px;
      background: #2d3748;
      color: #fff;
      border: none;
      border-radius: 6px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
    }
    .print-btn:hover {
      background: #4a5568;
    }

    @media print {
      body { background: #fff; }
      .container { padding: 0; max-width: 100%; }
      .print-btn { display: none !important; }
      .map-container { box-shadow: none; break-inside: avoid; }
      .metrics-grid { break-inside: avoid; }
      .summary-table, .detail-table { break-inside: avoid; }
      .disclaimer { break-inside: avoid; }
      .address-bar { border-radius: 0; }
      .season-warning { break-inside: avoid; }
    }
  </style>
</head>
<body>
  <div class="container">
    <button class="print-btn" onclick="window.print()">Download PDF</button>
    ${body}
  </div>
  <script>window.onload = () => window.print()</script>
</body>
</html>`
}

// ---------------------------------------------------------------------------
// PDF-ready HTML (for Puppeteer server-side rendering — no print button/script)
// ---------------------------------------------------------------------------

export async function generatePdfReadyHTML(
  report: RoofReportData,
  company: any,
  address: string,
): Promise<string> {
  const { center, segments, edges } = report

  const zoom = computeOptimalZoom(segments, MAP_WIDTH, MAP_HEIGHT)
  const satelliteDataUrl = await fetchSatelliteImageBase64(center.lat, center.lng, zoom)
  const svgContent = buildSvgOverlay(segments, edges, center.lat, center.lng, zoom)
  const body = buildReportBody(report, company, address, satelliteDataUrl, svgContent)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Roof Measurement Report — ${escapeHtml(address)}</title>
  <style>
    ${BASE_CSS}

    @page {
      size: letter;
      margin: 0.5in;
    }

    body { background: #fff; }
    .container { padding: 0; max-width: 100%; }
    .map-container { box-shadow: none; break-inside: avoid; }
    .metrics-grid { break-inside: avoid; }
    .summary-table, .detail-table { break-inside: avoid; }
    .disclaimer { break-inside: avoid; }
    .address-bar { border-radius: 0; }
    .season-warning { break-inside: avoid; }
  </style>
</head>
<body>
  <div class="container">
    ${body}
  </div>
</body>
</html>`
}
