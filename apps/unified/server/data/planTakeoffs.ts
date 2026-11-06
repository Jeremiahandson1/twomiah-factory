// Takeoffs on uploaded plans (landscaping parity row 4; Aspire's property takeoffs → estimate; feature plan_takeoffs, not ready). The
// routes are crm/landscaping/planTakeoffs.ts; the screen renders the plan (PDF.js for a PDF) and sends points.
//
//   · points are in page-width units: x and y both measured as a share of the page's WIDTH, so a distance means the same either way;
//   · the scale is feet per page width — set on the screen by drawing a line over a known length ("this line is 20 ft");
//   · an AREA is a closed outline (sq ft = shoelace × scale²), a LENGTH a line through its points (ft = Σ segments × scale), a COUNT
//     its points (each, e.g. shrubs to plant);
//   · a takeoff becomes quote lines: an area whose service has an Area Pricing rate is priced by the rate card (as the property's
//     measured area is); anything else is the measured quantity at the unit price typed for it.
// Raw reads here (RULEBOOK §2); nothing moves money until the lines are on a quote, which is priced and totalled as any other.
import { and, desc, eq } from 'drizzle-orm'
import { planTakeoff, serviceRate } from '../db/schema/index.ts'

export const PLAN_FEATURE = 'plan_takeoffs'
export const KINDS = ['area', 'length', 'count'] as const
export type Kind = typeof KINDS[number]
export const MAX_ITEMS = 200
export const MAX_POINTS = 500
export const MAX_PLAN_BYTES = 25 * 1024 * 1024
export const PLAN_TYPES = ['application/pdf', 'image/png', 'image/jpeg']
export const UNIT: Record<Kind, string> = { area: 'sq ft', length: 'ft', count: 'each' }

export interface TakeoffItem { id: string; kind: Kind; label: string; serviceType: string | null; unitPrice: number | null; points: Array<[number, number]> }

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/** The shoelace area of an outline, in squared page-width units. */
export function shoelace(points: Array<[number, number]>): number {
  let s = 0
  for (let i = 0; i < points.length; i++) { const [x1, y1] = points[i], [x2, y2] = points[(i + 1) % points.length]; s += x1 * y2 - x2 * y1 }
  return Math.abs(s) / 2
}
export function polyline(points: Array<[number, number]>): number {
  let s = 0
  for (let i = 1; i < points.length; i++) s += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1])
  return s
}

/** One item's measurement in its unit, or null while the plan has no scale (a count needs none). */
export function measure(item: Pick<TakeoffItem, 'kind' | 'points'>, feetPerWidth: number | null): number | null {
  if (item.kind === 'count') return item.points.length
  if (!feetPerWidth || !(feetPerWidth > 0)) return null
  if (item.kind === 'area') return item.points.length >= 3 ? Math.round(shoelace(item.points) * feetPerWidth * feetPerWidth) : 0
  return item.points.length >= 2 ? r2(polyline(item.points) * feetPerWidth) : 0
}

/** The scale from a line drawn over a known length: feet per page width. */
export function scaleFrom(a: [number, number], b: [number, number], feet: number): number | null {
  const d = Math.hypot(b[0] - a[0], b[1] - a[1])
  return d > 0 && feet > 0 ? r2(feet / d * 10_000) / 10_000 : null
}

/** Items as sent, checked. A problem names the item. */
export function readItems(raw: unknown): { items: TakeoffItem[] } | { error: string } {
  if (!Array.isArray(raw)) return { error: 'The measurements did not reach us. Try again.' }
  if (raw.length > MAX_ITEMS) return { error: `A takeoff holds ${MAX_ITEMS} items at most.` }
  const items: TakeoffItem[] = []
  for (const [i, x] of (raw as any[]).entries()) {
    const n = i + 1
    if (!(KINDS as readonly string[]).includes(x?.kind)) return { error: `Item ${n}: pick whether it is an area, a length or a count.` }
    if (!Array.isArray(x.points) || x.points.length > MAX_POINTS) return { error: `Item ${n} has too many points (${MAX_POINTS} at most).` }
    const points: Array<[number, number]> = []
    for (const p of x.points) {
      const px = Number(p?.[0]), py = Number(p?.[1])
      if (!Number.isFinite(px) || !Number.isFinite(py) || px < -0.01 || px > 1.01 || py < -0.01 || py > 50) return { error: `Item ${n} has a point off the plan.` }
      points.push([Math.round(px * 1e6) / 1e6, Math.round(py * 1e6) / 1e6])
    }
    if (x.kind === 'area' && points.length < 3) return { error: `Item ${n}: an area needs at least three corners.` }
    if (x.kind === 'length' && points.length < 2) return { error: `Item ${n}: a length needs at least two points.` }
    if (x.kind === 'count' && points.length < 1) return { error: `Item ${n}: mark at least one.` }
    const unitPrice = x.unitPrice === null || x.unitPrice === undefined || x.unitPrice === '' ? null : Number(x.unitPrice)
    if (unitPrice !== null && !(Number.isFinite(unitPrice) && unitPrice >= 0 && unitPrice <= 1_000_000)) return { error: `Item ${n}: the price must be a number, 0 or more.` }
    items.push({
      id: typeof x.id === 'string' && x.id ? x.id.slice(0, 40) : `i${n}`, kind: x.kind, label: String(x.label ?? '').trim().slice(0, 120),
      serviceType: typeof x.serviceType === 'string' && x.serviceType.trim() ? x.serviceType.trim().slice(0, 60) : null, unitPrice: unitPrice === null ? null : r2(unitPrice), points,
    })
  }
  return { items }
}

/** A stored takeoff with each item's measurement. */
export function withMeasures(row: any) {
  const scale = row.feetPerWidth == null ? null : Number(row.feetPerWidth)
  const items = (readItems(row.items) as any).items ?? []
  return { ...row, feetPerWidth: scale, items: items.map((it: TakeoffItem) => ({ ...it, unit: UNIT[it.kind], quantity: measure(it, scale) })) }
}

export async function listTakeoffs(db: any, companyId: string, siteId?: string | null) {
  const where = [eq(planTakeoff.companyId, companyId)]
  if (siteId) where.push(eq(planTakeoff.siteId, siteId))
  return db.select().from(planTakeoff).where(and(...where)).orderBy(desc(planTakeoff.updatedAt)).limit(200)
}
export async function getTakeoff(db: any, companyId: string, id: string) {
  const [row] = await db.select().from(planTakeoff).where(and(eq(planTakeoff.id, id), eq(planTakeoff.companyId, companyId))).limit(1)
  return row ?? null
}

/** Minimum charge and rate per 1,000 sq ft, as Area Pricing prices it (crm/landscaping/areaPricing.ts computeAreaPrice). */
const areaPrice = (sqft: number, rate: number, min: number) => r2(Math.max(min, (sqft / 1000) * rate))

/**
 * The quote lines a takeoff's items make. An area with an active Area Pricing rate for its service: one line at the rate card's price;
 * anything else: the quantity at its unit price (0 when none was typed — the office prices it on the quote). Items with no
 * measurement yet (no scale) are left out and named.
 */
export async function takeoffLines(db: any, companyId: string, row: any, itemIds: string[] | null) {
  const t = withMeasures(row)
  const pick = (t.items as any[]).filter((it) => !itemIds || itemIds.includes(it.id))
  const rates: any[] = await db.select().from(serviceRate).where(and(eq(serviceRate.companyId, companyId), eq(serviceRate.active, true)))
  const lines: Array<{ description: string; quantity: number; unitPrice: number; type: string }> = []
  const skipped: string[] = []
  for (const it of pick) {
    const name = it.label || it.serviceType || (it.kind === 'area' ? 'Area' : it.kind === 'length' ? 'Length' : 'Count')
    if (it.quantity == null || !(it.quantity > 0)) { skipped.push(name); continue }
    const qty = it.kind === 'length' ? Math.round(it.quantity * 10) / 10 : Math.round(it.quantity)
    const rate = it.kind === 'area' && it.serviceType ? rates.find((r) => r.serviceType === it.serviceType) : null
    if (rate) {
      const price = areaPrice(qty, Number(rate.ratePer1000Sqft), Number(rate.minCharge))
      lines.push({ description: `${name} — ${qty.toLocaleString()} sq ft @ $${rate.ratePer1000Sqft}/1,000 sq ft (plan: ${t.name})`, quantity: 1, unitPrice: price, type: 'service' })
    } else {
      lines.push({ description: `${name} — ${qty.toLocaleString()} ${it.unit} (plan: ${t.name})`, quantity: qty, unitPrice: it.unitPrice ?? 0, type: it.kind === 'count' ? 'material' : 'service' })
    }
  }
  return { lines, skipped }
}
