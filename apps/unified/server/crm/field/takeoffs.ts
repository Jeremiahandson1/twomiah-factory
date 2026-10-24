// /api/takeoffs: assemblies, takeoff sheets, measured items, material totals and the export to a purchase order.
// Moved from the CRM template's routes/takeoffs.ts (templates/crm/backend/src/routes). The registry signs the person in
// and gates 'takeoff_tools'; every action, reads included, checks takeoffs:* (the template's T32 H1, on the mount).
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../../http/env.ts'
import { done, fail, one, listAll } from '../../http/reply.ts'
import { invalid } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'
import { createTakeoffsService } from './takeoffsService.ts'

/** What the INSERTs require: the fields the SQL has no fallback for (an empty body is a 400, never a 500). */
const assemblyBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough()
const sheetBody = z.object({ name: z.string().min(1, 'Name is required') }).passthrough()
const itemBody = z.object({ assemblyId: z.string().min(1, 'Pick an assembly') }).passthrough()
/** A price is a number of dollars, 0 or more, to the cent; the screen sends what was typed. */
const price = z.coerce.number({ invalid_type_error: 'A price must be a number' }).finite().min(0, 'A price cannot be negative').transform((n) => Math.round(n * 100) / 100)
const assemblyUpdateBody = z.object({
  materials: z.array(z.object({ id: z.string().min(1), unitCost: price.optional(), unitPrice: price.optional() })).optional(),
}).passthrough()

/** The default markup: a percent of the cost, 0 to 1000, to two places; null takes it away. */
const settingsBody = z.object({
  markupPercent: z.union([
    z.null(),
    z.coerce.number({ invalid_type_error: 'The markup must be a number' }).finite().min(0, 'The markup cannot be negative').max(1000, 'The markup is a percent of the cost, at most 1000').transform((n) => Math.round(n * 100) / 100),
  ]),
})

const all = <T,>(c: any, rows: T[]) => listAll(c, rows)

export function createTakeoffsRoutes(d: CrmDeps) {
  const { requirePermission } = d.permissions
  const takeoffs = createTakeoffsService(d)
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('takeoffs:read'))

  // ── assemblies ─────────────────────────────────────────────────────────────────────────────────

  app.get('/assemblies', async (c) => {
    const user = c.get('user')
    const active = c.req.query('active')
    const assemblies = await takeoffs.getAssemblies(user.companyId, {
      category: c.req.query('category'),
      active: active === 'false' ? false : active === 'all' ? null : true,
    })
    return all(c, assemblies)
  })

  app.get('/assemblies/:id', async (c) => {
    const user = c.get('user')
    const assembly = await takeoffs.getAssembly(c.req.param('id'), user.companyId)
    if (!assembly) return fail(c, 404, 'Assembly not found')
    return one(c, assembly)
  })

  app.post('/assemblies', requirePermission('takeoffs:create'), async (c) => {
    const user = c.get('user')
    const parsed = assemblyBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const assembly = await takeoffs.createAssembly(user.companyId, parsed.data)
    return one(c, assembly as object, 201)
  })

  app.put('/assemblies/:id', requirePermission('takeoffs:update'), async (c) => {
    const user = c.get('user')
    const parsed = assemblyUpdateBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    if (!(await takeoffs.getAssembly(c.req.param('id'), user.companyId))) return fail(c, 404, 'Assembly not found')
    await takeoffs.updateAssembly(c.req.param('id'), user.companyId, parsed.data)
    return one(c, await takeoffs.getAssembly(c.req.param('id'), user.companyId))
  })

  app.post('/assemblies/seed', requirePermission('takeoffs:create'), async (c) => {
    const user = c.get('user')
    await takeoffs.seedDefaultAssemblies(user.companyId)
    return done(c)
  })

  // ── settings ───────────────────────────────────────────────────────────────────────────────────

  // The company's default markup on a material's cost: a material with no selling price of its own is quoted at its
  // cost plus this (takeoffsService.sellingPrice). null: none.
  app.get('/settings', async (c) => one(c, await takeoffs.getSettings(c.get('user').companyId)))

  app.put('/settings', requirePermission('takeoffs:update'), async (c) => {
    const parsed = settingsBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    return one(c, await takeoffs.setSettings(c.get('user').companyId, { markupPercent: parsed.data.markupPercent }))
  })

  // ── sheets ─────────────────────────────────────────────────────────────────────────────────────

  app.get('/project/:projectId', async (c) => {
    const user = c.get('user')
    return all(c, await takeoffs.getProjectTakeoffs(c.req.param('projectId'), user.companyId))
  })

  app.get('/sheets/:id', async (c) => {
    const user = c.get('user')
    const sheet = await takeoffs.getTakeoffSheet(c.req.param('id'), user.companyId)
    if (!sheet) return fail(c, 404, 'Sheet not found')
    return one(c, sheet)
  })

  app.post('/project/:projectId', requirePermission('takeoffs:create'), async (c) => {
    const user = c.get('user')
    const parsed = sheetBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const sheet = await takeoffs.createTakeoffSheet(user.companyId, { ...parsed.data, projectId: c.req.param('projectId') })
    return one(c, sheet, 201)
  })

  // ── items ──────────────────────────────────────────────────────────────────────────────────────

  app.post('/sheets/:sheetId/items', requirePermission('takeoffs:create'), async (c) => {
    const user = c.get('user')
    const parsed = itemBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return invalid(c, parsed.error)
    const item = await takeoffs.addTakeoffItem(c.req.param('sheetId'), user.companyId, parsed.data)
    if (!item) return fail(c, 404, 'Item not found')
    return one(c, item, 201)
  })

  app.put('/items/:id', requirePermission('takeoffs:update'), async (c) => {
    const user = c.get('user')
    const body = await c.req.json()
    const item = await takeoffs.updateTakeoffItem(c.req.param('id'), user.companyId, body)
    if (!item) return fail(c, 404, 'Item not found')
    return one(c, item)
  })

  app.delete('/items/:id', requirePermission('takeoffs:delete'), async (c) => {
    const user = c.get('user')
    await takeoffs.deleteTakeoffItem(c.req.param('id'), user.companyId)
    return done(c)
  })

  // ── totals ─────────────────────────────────────────────────────────────────────────────────────

  app.get('/sheets/:id/totals', async (c) => {
    const user = c.get('user')
    // A sheet that is not there is a 404, as at every other door to a sheet (the service throws for it).
    const sheet = await takeoffs.getTakeoffSheet(c.req.param('id'), user.companyId)
    if (!sheet) return fail(c, 404, 'Sheet not found')
    return one(c, await takeoffs.getSheetMaterialTotals(c.req.param('id'), user.companyId))
  })

  app.get('/project/:projectId/totals', async (c) => {
    const user = c.get('user')
    return one(c, await takeoffs.getProjectMaterialTotals(c.req.param('projectId'), user.companyId))
  })

  // ── export ─────────────────────────────────────────────────────────────────────────────────────

  // The sheet's materials as quote lines (takeoffsService.quoteLines); the screen hands them to /api/quotes, which asks
  // its own quotes:create / quotes:update.
  app.get('/sheets/:id/quote-lines', async (c) => {
    const user = c.get('user')
    const sheet = await takeoffs.getTakeoffSheet(c.req.param('id'), user.companyId)
    if (!sheet) return fail(c, 404, 'Sheet not found')
    return one(c, await takeoffs.quoteLines(c.req.param('id'), user.companyId))
  })

  app.post('/sheets/:id/export-po', requirePermission('takeoffs:create'), async (c) => {
    const user = c.get('user')
    const { vendorId } = await c.req.json()
    const po = await takeoffs.exportToPurchaseOrder(c.req.param('id'), user.companyId, { vendorId })
    return one(c, po, 201)
  })

  return app
}
