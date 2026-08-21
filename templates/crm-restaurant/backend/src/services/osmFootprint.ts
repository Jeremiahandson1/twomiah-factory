/**
 * Fetch building footprints from OpenStreetMap via the Overpass API.
 *
 * OSM often has traced building outlines including extensions, garages,
 * and wings.  These can be used to:
 * 1. Improve footprint accuracy (vs mask-derived contour)
 * 2. Identify extension regions for constrained RANSAC
 * 3. Seed polygon expectations before plane fitting
 */

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'

interface OsmBuilding {
  id: number
  polygon: Array<{ lat: number; lng: number }>
  tags: Record<string, string>
}

/**
 * Query Overpass for building footprints within a radius of a point.
 * Returns building polygons sorted by distance to the target point
 * (closest first — likely the target building).
 */
export async function fetchOsmBuildings(
  lat: number,
  lng: number,
  radiusMeters = 30,
): Promise<OsmBuilding[]> {
  const query = `
    [out:json][timeout:10];
    way["building"](around:${radiusMeters},${lat},${lng});
    (._;>;);
    out body;
  `

  try {
    const res = await fetch(OVERPASS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `data=${encodeURIComponent(query)}`,
      signal: AbortSignal.timeout(10000),
    })

    if (!res.ok) {
      console.log(`[OSM] Overpass API returned ${res.status}`)
      return []
    }

    const data = await res.json()
    const nodes: Record<number, { lat: number; lon: number }> = {}
    const buildings: OsmBuilding[] = []

    // Index nodes
    for (const el of data.elements) {
      if (el.type === 'node') {
        nodes[el.id] = { lat: el.lat, lon: el.lon }
      }
    }

    // Build polygons from ways
    for (const el of data.elements) {
      if (el.type !== 'way' || !el.tags?.building) continue
      const polygon = el.nodes
        .map((nid: number) => nodes[nid])
        .filter(Boolean)
        .map((n: { lat: number; lon: number }) => ({ lat: n.lat, lng: n.lon }))

      if (polygon.length >= 3) {
        buildings.push({ id: el.id, polygon, tags: el.tags })
      }
    }

    // Sort by distance to target
    buildings.sort((a, b) => {
      const distA = Math.hypot(a.polygon[0].lat - lat, a.polygon[0].lng - lng)
      const distB = Math.hypot(b.polygon[0].lat - lat, b.polygon[0].lng - lng)
      return distA - distB
    })

    console.log(`[OSM] Found ${buildings.length} buildings near (${lat.toFixed(5)}, ${lng.toFixed(5)})`)
    return buildings
  } catch (err: any) {
    console.log(`[OSM] Overpass query failed: ${err.message}`)
    return []
  }
}

/**
 * Convert an OSM building polygon to local meter coordinates.
 */
export function osmPolygonToLocal(
  polygon: Array<{ lat: number; lng: number }>,
  originLat: number,
  originLng: number,
): Array<{ x: number; y: number }> {
  const METERS_PER_DEG = 111320
  return polygon.map(p => ({
    x: (p.lng - originLng) * METERS_PER_DEG * Math.cos(originLat * Math.PI / 180),
    y: (p.lat - originLat) * METERS_PER_DEG,
  }))
}
