// Shapes drawn on the satellite map for a property, and the areas they add up to (Area Pricing › Measure on the map).
// The server works the area out from the corners — a number typed by the screen is never trusted — and keeps the property's
// own columns (lawnSqft, bedSqft, …) equal to the sum of its shapes, so the rate card, which reads those columns, needs no change.
import { and, eq, asc } from 'drizzle-orm'
import { site, siteShape } from '../db/schema/index.ts'

export const SHAPE_AREA_TYPES = ['lawnSqft', 'bedSqft', 'hardscapeSqft', 'lotSqft', 'drivewaySqft'] as const
export type ShapeAreaType = (typeof SHAPE_AREA_TYPES)[number]
export const MAX_SHAPES = 100
export const MAX_CORNERS = 500
/** The most a single shape may measure: 100 million sq ft, about 3,600 acres — the property columns' own ceiling. */
export const MAX_SHAPE_SQFT = 100_000_000

const EARTH_RADIUS_M = 6_378_137
const SQFT_PER_SQM = 10.763910416709722

/**
 * The area inside a ring of [lat, lng] corners, in square feet, on the sphere (the same formula Google's computeArea uses,
 * so the figure on the map and the saved one agree). The ring is closed for you; the winding does not matter.
 */
export function polygonSqft(path: Array<[number, number]>): number {
  if (path.length < 3) return 0
  const rad = (d: number) => (d * Math.PI) / 180
  let sum = 0
  for (let i = 0; i < path.length; i++) {
    const [lat1, lng1] = path[i]
    const [lat2, lng2] = path[(i + 1) % path.length]
    let dLng = rad(lng2 - lng1)
    // The short way round the antimeridian.
    if (dLng > Math.PI) dLng -= 2 * Math.PI
    if (dLng < -Math.PI) dLng += 2 * Math.PI
    sum += dLng * (2 + Math.sin(rad(lat1)) + Math.sin(rad(lat2)))
  }
  return Math.round((Math.abs(sum) * EARTH_RADIUS_M * EARTH_RADIUS_M * SQFT_PER_SQM) / 2)
}

export interface ShapeInput { areaType: ShapeAreaType; mode: 'add' | 'cut'; label: string | null; path: Array<[number, number]> }

/** Read what the screen sent. Returns the shapes, or the sentence that says what is wrong. */
export function readShapes(raw: unknown): { shapes: ShapeInput[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'The shapes did not reach us. Draw them again and save.' }
  if (raw.length > MAX_SHAPES) return { error: `A property can hold ${MAX_SHAPES} shapes. Combine some before saving.` }
  const shapes: ShapeInput[] = []
  for (const [i, s] of (raw as any[]).entries()) {
    const n = i + 1
    if (!(SHAPE_AREA_TYPES as readonly string[]).includes(s?.areaType)) return { error: `Shape ${n}: choose what it measures — lawn, beds, hardscape, lot or driveway.` }
    const mode = s?.mode === 'cut' ? 'cut' : 'add'
    if (!Array.isArray(s?.path) || s.path.length < 3) return { error: `Shape ${n} needs at least three corners.` }
    if (s.path.length > MAX_CORNERS) return { error: `Shape ${n} has too many corners (${MAX_CORNERS} at most).` }
    const path: Array<[number, number]> = []
    for (const p of s.path) {
      const lat = Array.isArray(p) ? Number(p[0]) : Number(p?.lat)
      const lng = Array.isArray(p) ? Number(p[1]) : Number(p?.lng)
      if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { error: `Shape ${n} has a corner that is not on the map.` }
      path.push([Math.round(lat * 1e7) / 1e7, Math.round(lng * 1e7) / 1e7])
    }
    if (polygonSqft(path) > MAX_SHAPE_SQFT) return { error: `Shape ${n} is larger than 100 million sq ft. Check its corners.` }
    shapes.push({ areaType: s.areaType, mode, label: typeof s?.label === 'string' && s.label.trim() ? s.label.trim().slice(0, 80) : null, path })
  }
  return { shapes }
}

/** A property's shapes, in the order they were drawn. */
export const shapesOf = (db: any, companyId: string, siteId: string) =>
  db.select().from(siteShape).where(and(eq(siteShape.siteId, siteId), eq(siteShape.companyId, companyId))).orderBy(asc(siteShape.createdAt), asc(siteShape.id))

/**
 * Save the property's shapes — the whole set, as the map shows it — and set its columns from them: for each area type, the
 * shapes that add minus the shapes that cut (never below zero). A type the property had shapes for and now has none goes
 * blank; a type never drawn is left as typed by hand. Returns the property, or null when it is not this company's.
 */
export async function replaceShapes(db: any, companyId: string, siteId: string, shapes: ShapeInput[]) {
  return db.transaction(async (tx: any) => {
    const [found] = await tx.select({ id: site.id }).from(site).where(and(eq(site.id, siteId), eq(site.companyId, companyId))).limit(1).for('update')
    if (!found) return null
    const before: Array<{ areaType: string }> = await tx.select({ areaType: siteShape.areaType }).from(siteShape).where(and(eq(siteShape.siteId, siteId), eq(siteShape.companyId, companyId)))
    await tx.delete(siteShape).where(and(eq(siteShape.siteId, siteId), eq(siteShape.companyId, companyId)))
    const sums = new Map<string, number>()
    for (const s of shapes) {
      const sqft = polygonSqft(s.path)
      await tx.insert(siteShape).values({ companyId, siteId, areaType: s.areaType, mode: s.mode, label: s.label, path: s.path, areaSqft: sqft })
      sums.set(s.areaType, (sums.get(s.areaType) ?? 0) + (s.mode === 'cut' ? -sqft : sqft))
    }
    const patch: Record<string, unknown> = { updatedAt: new Date(), measuredAt: new Date(), measurementSource: 'aerial' }
    for (const [type, total] of sums) patch[type] = Math.max(0, Math.round(total))
    for (const b of before) if (!sums.has(b.areaType)) patch[b.areaType] = null
    const [updated] = await tx.update(site).set(patch).where(and(eq(site.id, siteId), eq(site.companyId, companyId))).returning()
    return updated
  })
}
