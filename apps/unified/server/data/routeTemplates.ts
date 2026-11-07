// Copy a route, and routes saved as templates (landscaping parity row 28; Yardbook's "copy route"; feature route_copy, not ready).
// The routes are crm/landscaping/routeTemplates.ts.
//
// A copy is a new route with everything the old one has — its stops in order (property, customer, service, minutes, price, "no visit
// message"), crew, start time, hours, billing mode, season and notes — on the day it is given. A template is the same, kept apart from
// the board (a template never makes visits); using one makes a route. A stop whose property has since been deleted is left out and
// counted. Nothing here makes visits: the route's own top-up does, as for any new route (data/routeVisits.ts).
import { and, asc, desc, eq, inArray } from 'drizzle-orm'
import { recurringRoute, recurringRouteStop, recurringRouteTemplate, site } from '../db/schema/index.ts'

export const ROUTE_COPY = 'route_copy'
export const MAX_TEMPLATES = 200

export interface StopShape { siteId: string; contactId: string | null; serviceType: string; estimatedMinutes: number; pricePerVisit: string; skipVisitMessage: boolean }
export interface RouteShape {
  assignedToId: string | null; estimatedHours: string; startTime: string; billingMode: string | null
  seasonStart: string | null; seasonEnd: string | null; notes: string | null; stops: StopShape[]
}

/** A route and its stops in order, as a shape to copy or keep. Null when the route is not this company's. */
export async function routeShape(db: any, companyId: string, routeId: string): Promise<(RouteShape & { name: string }) | null> {
  const [r] = await db.select().from(recurringRoute).where(and(eq(recurringRoute.id, routeId), eq(recurringRoute.companyId, companyId))).limit(1)
  if (!r) return null
  const stops: any[] = await db.select().from(recurringRouteStop).where(and(eq(recurringRouteStop.recurringRouteId, routeId), eq(recurringRouteStop.companyId, companyId))).orderBy(asc(recurringRouteStop.sortOrder), asc(recurringRouteStop.createdAt))
  return {
    name: r.name, assignedToId: r.assignedToId ?? null, estimatedHours: String(r.estimatedHours ?? '0'), startTime: r.startTime || '08:00', billingMode: r.billingMode ?? null,
    seasonStart: r.seasonStart ?? null, seasonEnd: r.seasonEnd ?? null, notes: r.notes ?? null,
    stops: stops.map((s) => ({ siteId: s.siteId, contactId: s.contactId ?? null, serviceType: s.serviceType, estimatedMinutes: Number(s.estimatedMinutes) || 0, pricePerVisit: String(s.pricePerVisit ?? '0'), skipVisitMessage: !!s.skipVisitMessage })),
  }
}

/** Whether any stop of a shape carries a price (copying it is setting a price: the seat that may see money). */
export const hasPrices = (shape: RouteShape) => shape.stops.some((s) => Number(s.pricePerVisit) !== 0)

/**
 * A new route from a shape, on `dayOfWeek`, named `name`. `billing` false leaves the billing mode unset (a seat that may not raise
 * invoices does not choose how a route is billed). Stops whose property is gone are left out: `{ route, stops, leftOut }`.
 */
export async function routeFromShape(db: any, companyId: string, shape: RouteShape, opts: { name: string; dayOfWeek: number; billing: boolean }) {
  const ids = [...new Set(shape.stops.map((s) => s.siteId))]
  const live = ids.length ? new Set((await db.select({ id: site.id }).from(site).where(and(eq(site.companyId, companyId), inArray(site.id, ids)))).map((r: any) => r.id)) : new Set<string>()
  const keep = shape.stops.filter((s) => live.has(s.siteId))
  return db.transaction(async (tx: any) => {
    const [route] = await tx.insert(recurringRoute).values({
      companyId, name: opts.name, dayOfWeek: opts.dayOfWeek, assignedToId: shape.assignedToId, estimatedHours: shape.estimatedHours,
      startTime: shape.startTime, billingMode: opts.billing ? shape.billingMode : null, seasonStart: shape.seasonStart, seasonEnd: shape.seasonEnd,
      notes: shape.notes, status: 'active',
    }).returning()
    if (keep.length) {
      await tx.insert(recurringRouteStop).values(keep.map((s, i) => ({
        companyId, recurringRouteId: route.id, siteId: s.siteId, contactId: s.contactId, serviceType: s.serviceType || 'mowing',
        sortOrder: i, estimatedMinutes: s.estimatedMinutes, pricePerVisit: s.pricePerVisit, skipVisitMessage: s.skipVisitMessage,
      })))
    }
    return { route, stops: keep.length, leftOut: shape.stops.length - keep.length }
  })
}

export async function saveTemplate(db: any, companyId: string, userId: string | null, name: string, shape: RouteShape) {
  const [row] = await db.insert(recurringRouteTemplate).values({
    companyId, name, assignedToId: shape.assignedToId, estimatedHours: shape.estimatedHours, startTime: shape.startTime, billingMode: shape.billingMode,
    seasonStart: shape.seasonStart, seasonEnd: shape.seasonEnd, notes: shape.notes, stops: shape.stops, createdById: userId,
  }).returning()
  return row
}

export async function countTemplates(db: any, companyId: string): Promise<number> {
  return (await db.select({ id: recurringRouteTemplate.id }).from(recurringRouteTemplate).where(eq(recurringRouteTemplate.companyId, companyId))).length
}

export async function listTemplates(db: any, companyId: string) {
  return db.select().from(recurringRouteTemplate).where(eq(recurringRouteTemplate.companyId, companyId)).orderBy(desc(recurringRouteTemplate.createdAt))
}

export async function getTemplate(db: any, companyId: string, id: string) {
  const [row] = await db.select().from(recurringRouteTemplate).where(and(eq(recurringRouteTemplate.id, id), eq(recurringRouteTemplate.companyId, companyId))).limit(1)
  return row ?? null
}

export async function deleteTemplate(db: any, companyId: string, id: string) {
  const [row] = await db.delete(recurringRouteTemplate).where(and(eq(recurringRouteTemplate.id, id), eq(recurringRouteTemplate.companyId, companyId))).returning({ id: recurringRouteTemplate.id, name: recurringRouteTemplate.name })
  return row ?? null
}

/** A template row as a shape (its stops checked as it is read: a hand-edited row never breaks a copy). */
export function templateShape(t: any): RouteShape {
  const stops = (Array.isArray(t.stops) ? t.stops : []).filter((s: any) => s && typeof s.siteId === 'string').map((s: any) => ({
    siteId: s.siteId, contactId: typeof s.contactId === 'string' ? s.contactId : null, serviceType: String(s.serviceType || 'mowing'),
    estimatedMinutes: Number(s.estimatedMinutes) || 0, pricePerVisit: String(s.pricePerVisit ?? '0'), skipVisitMessage: !!s.skipVisitMessage,
  }))
  return { assignedToId: t.assignedToId ?? null, estimatedHours: String(t.estimatedHours ?? '0'), startTime: t.startTime || '08:00', billingMode: t.billingMode ?? null, seasonStart: t.seasonStart ?? null, seasonEnd: t.seasonEnd ?? null, notes: t.notes ?? null, stops }
}
