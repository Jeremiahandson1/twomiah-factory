// Territories from a KML file (roofing parity row 23; Spotio "Territory Importing"; feature territory_tools, not ready). Spotio's rules,
// read 11/06 (support.spotio.com/hc/en-us/articles/31119149855767): a placemark's title is the territory's name — a name that exists is
// updated with the new shape, a new one is created; one file may hold many territories; SIMPLE polygons only. So a placemark with a
// hole (innerBoundaryIs) or several polygons (MultiGeometry) is not imported and is named in the answer. Pure; the route is
// crm/roof/field/territories.ts POST /import.

export const MAX_KML_BYTES = 5 * 1024 * 1024
export const MAX_PLACEMARKS = 500

const decode = (s: string) => s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim()

export type KmlShape = { name: string; points: Array<[number, number]> }
export type KmlRead = { shapes: KmlShape[]; skipped: Array<{ name: string; reason: string }> }

/** The simple polygons of a KML file, by placemark: [lat, lng] corners, the closing corner dropped. */
export function readKml(text: string): KmlRead | { error: string } {
  if (!/<kml[\s>]/i.test(text)) return { error: 'That is not a KML file.' }
  const marks = text.match(/<Placemark[\s\S]*?<\/Placemark>/gi) || []
  if (!marks.length) return { error: 'The file has no placemarks to import.' }
  if (marks.length > MAX_PLACEMARKS) return { error: `A file can hold ${MAX_PLACEMARKS} territories at most.` }
  const shapes: KmlShape[] = []
  const skipped: Array<{ name: string; reason: string }> = []
  marks.forEach((m, i) => {
    const name = decode((m.match(/<name>([\s\S]*?)<\/name>/i) || [])[1] || '').slice(0, 80) || `Territory ${i + 1}`
    const polys = m.match(/<Polygon[\s\S]*?<\/Polygon>/gi) || []
    if (!polys.length) { skipped.push({ name, reason: 'not a polygon (a point or a line)' }); return }
    if (polys.length > 1 || /<MultiGeometry/i.test(m)) { skipped.push({ name, reason: 'several shapes — only simple polygons are imported' }); return }
    const poly = polys[0] ?? ''
    if (/<innerBoundaryIs/i.test(poly)) { skipped.push({ name, reason: 'a shape with a hole — only simple polygons are imported' }); return }
    const coords = ((poly.match(/<outerBoundaryIs[\s\S]*?<coordinates>([\s\S]*?)<\/coordinates>/i) || [])[1] || '').trim()
    const points: Array<[number, number]> = []
    for (const tuple of coords.split(/\s+/).filter(Boolean)) {
      const [lng, lat] = tuple.split(',').map(Number)
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) { skipped.push({ name, reason: 'a corner that is not a place on the map' }); return }
      points.push([Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7])
    }
    if (points.length > 1 && points[0][0] === points.at(-1)![0] && points[0][1] === points.at(-1)![1]) points.pop()
    if (points.length < 3) { skipped.push({ name, reason: 'fewer than three corners' }); return }
    shapes.push({ name, points })
  })
  return { shapes, skipped }
}

/** Would making `parentId` this territory's parent loop back to itself? `parentOf` maps each territory to its parent. */
export function makesLoop(id: string, parentId: string, parentOf: Map<string, string | null>): boolean {
  let at: string | null | undefined = parentId
  for (let i = 0; at && i < 1000; i++) {
    if (at === id) return true
    at = parentOf.get(at) ?? null
  }
  return false
}
