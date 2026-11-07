// Copy a route, and route templates (landscaping parity row 28; Yardbook's copy route; route_copy, not ready). Mounted at
// /api/recurring-routes/templates BEFORE the board's router, so these paths are never read as a route id. data/routeTemplates.ts
// has the rules.
//
//   POST   /copy/:routeId        a copy of the route on a day: { name, dayOfWeek }                      jobs:create
//   POST   /from/:routeId        save the route as a template: { name }                                  jobs:create
//   GET    /                     the templates (stop prices only for a seat that may see money)          jobs:read
//   POST   /:id/use              a route from a template: { name, dayOfWeek }                            jobs:create
//   DELETE /:id                                                                                          jobs:delete
//
// Copying stops with prices sets prices: the seat that may see money (invoices:read), as adding a priced stop asks. The billing mode
// is carried only for a seat that may raise invoices; otherwise the copy's is unset (billed monthly, as any new route).
import { Hono } from 'hono'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one, listAll } from '../../http/reply.ts'
import {
  ROUTE_COPY, MAX_TEMPLATES, routeShape, hasPrices, routeFromShape, saveTemplate, countTemplates, listTemplates, getTemplate, deleteTemplate, templateShape, type RouteShape,
} from '../../data/routeTemplates.ts'

const DAY_HELP = 'Pick the day the new route runs.'
const NAME_HELP = 'Give the new route a name — it is what the crew sees on the board.'
const MAX_NAME = 120

export function createRouteTemplateRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission, hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  const may = async (c: any, perm: string) => {
    const u = c.get('user')
    try { return hasPermission(u?.role, perm, await getExtraPermissions(u?.userId)) } catch { return false }
  }
  const gate = async (c: any) => (await d.features.isFeatureEnabled(c.get('user').companyId, ROUTE_COPY).catch(() => false)) ? null : fail(c, 404, 'Not found')
  const readName = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, MAX_NAME) : null)
  const readDay = (v: unknown) => { const n = Number(v); return v !== null && v !== '' && Number.isInteger(n) && n >= 0 && n <= 6 ? n : null }

  /** A new route from a shape, with the money rules; the reply the screen shows. */
  const make = async (c: any, shape: RouteShape, b: any, from: string) => {
    const u = c.get('user')
    const name = readName(b?.name)
    if (!name) return fail(c, 400, NAME_HELP, undefined, { name: NAME_HELP })
    const day = readDay(b?.dayOfWeek)
    if (day === null) return fail(c, 400, DAY_HELP, undefined, { dayOfWeek: DAY_HELP })
    if (hasPrices(shape) && !(await may(c, 'invoices:read'))) return fail(c, 403, 'Copying a route with priced stops is for an owner or manager.')
    const out = await routeFromShape(db, u.companyId, shape, { name, dayOfWeek: day, billing: await may(c, 'invoices:create') })
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'recurring_route', entityId: out.route.id, entityName: `${out.route.name} (from ${from})`, userId: u.userId, companyId: u.companyId })
    return one(c, { route: out.route, stops: out.stops, leftOut: out.leftOut }, 201)
  }

  app.post('/copy/:routeId', requirePermission('jobs:create'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const shape = await routeShape(db, c.get('user').companyId, c.req.param('routeId'))
    if (!shape) return fail(c, 404, 'Route not found')
    return make(c, shape, await c.req.json().catch(() => ({})), shape.name)
  })

  app.post('/from/:routeId', requirePermission('jobs:create'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const shape = await routeShape(db, u.companyId, c.req.param('routeId'))
    if (!shape) return fail(c, 404, 'Route not found')
    const b: any = await c.req.json().catch(() => ({}))
    const name = readName(b?.name)
    if (!name) return fail(c, 400, 'Name the template.', undefined, { name: 'Name it' })
    if ((await countTemplates(db, u.companyId)) >= MAX_TEMPLATES) return fail(c, 409, `You have ${MAX_TEMPLATES} route templates — delete one first.`)
    const row = await saveTemplate(db, u.companyId, u.userId, name, shape)
    audit.log({ req: c, action: audit.ACTIONS.CREATE, entity: 'recurring_route_template', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, name: row.name, stops: shape.stops.length }, 201)
  })

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const money = await may(c, 'invoices:read')
    const rows = await listTemplates(db, c.get('user').companyId)
    return listAll(c, rows.map((t: any) => {
      const shape = templateShape(t)
      return {
        id: t.id, name: t.name, startTime: shape.startTime, assignedToId: shape.assignedToId, billingMode: shape.billingMode, seasonStart: shape.seasonStart, seasonEnd: shape.seasonEnd,
        stopCount: shape.stops.length, estimatedMinutes: shape.stops.reduce((n, s) => n + s.estimatedMinutes, 0), createdAt: t.createdAt,
        ...(money ? { weeklyRevenue: Math.round(shape.stops.reduce((n, s) => n + Number(s.pricePerVisit), 0) * 100) / 100 } : {}),
      }
    }))
  })

  app.post('/:id/use', requirePermission('jobs:create'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const t = await getTemplate(db, c.get('user').companyId, c.req.param('id'))
    if (!t) return fail(c, 404, 'Template not found')
    return make(c, templateShape(t), await c.req.json().catch(() => ({})), `template ${t.name}`)
  })

  app.delete('/:id', requirePermission('jobs:delete'), async (c) => {
    const shut = await gate(c); if (shut) return shut
    const u = c.get('user')
    const row = await deleteTemplate(db, u.companyId, c.req.param('id'))
    if (!row) return fail(c, 404, 'Template not found')
    audit.log({ req: c, action: audit.ACTIONS.DELETE, entity: 'recurring_route_template', entityId: row.id, entityName: row.name, userId: u.userId, companyId: u.companyId })
    return one(c, { id: row.id, deleted: true })
  })

  return app
}
