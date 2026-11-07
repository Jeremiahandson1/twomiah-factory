// A job's parameters (contractor parity row 9; JobTread's job parameters; feature quote_formulas, not ready): the named numbers
// every quote on the project reads in its formulas unless the quote sets its own (packages/tenant-backend invoicing/formulas.ts).
// Changing them works out every open quote on the project again; a quote whose formulas no longer work out is left as it was
// and named in the answer, with why. Takeoffs can fill them: a measured item's total becomes a parameter's value.
//
//   GET  /api/project-parameters/:projectId                 { parameters }                                       projects:read
//   PUT  /api/project-parameters/:projectId                 { parameters } → { parameters, quotes: [...] }      projects:update
//   POST /api/project-parameters/:projectId/from-takeoff    { items: [{ takeoffItemId, key, label? }] }          projects:update
//        each item's measured total (its measurement × how many) becomes the parameter `key`, added or replaced
import { Hono } from 'hono'
import { z } from 'zod'
import { and, eq, inArray } from 'drizzle-orm'
import { cleanParameters, recalculateQuote, round2, type FormulaParameter } from '@twomiah/tenant-backend'
import { project, quote, quoteLineItem, quoteProposalOption, takeoffItem, takeoffSheet, takeoff } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

export const QUOTE_FORMULAS = 'quote_formulas'
const OPEN = ['draft', 'sent', 'viewed']
const fromTakeoffBody = z.object({
  items: z.array(z.object({ takeoffItemId: z.string().min(1), key: z.string().trim().min(1), label: z.string().trim().max(80).optional() })).min(1, 'Pick at least one measurement').max(50),
})

export function createProjectParameterRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', async (c, next) => {
    if (!(await d.features.isFeatureEnabled((c.get('user') as any).companyId, QUOTE_FORMULAS))) return fail(c, 404, 'Not found')
    await next()
  })
  const own = async (companyId: string, id: string) =>
    (await db.select().from(project).where(and(eq(project.id, id), eq(project.companyId, companyId))).limit(1))[0] as any

  /** Save the parameters, then work out every open quote on the project again. */
  const save = async (companyId: string, projectId: string, parameters: FormulaParameter[]) => {
    await db.update(project).set({ parameters, updatedAt: new Date() } as any).where(eq(project.id, projectId))
    const open = await db.select({ id: quote.id, number: quote.number }).from(quote)
      .where(and(eq(quote.companyId, companyId), eq(quote.projectId, projectId), inArray(quote.status, OPEN))) as any[]
    const quotes = []
    for (const q of open) {
      const r = await recalculateQuote(db, { quote, quoteLineItem, project, quoteProposalOption } as any, companyId, q.id)
      if (!r) continue
      if ('error' in r) quotes.push({ id: q.id, number: q.number, error: r.error })
      else if (r.changed) quotes.push({ id: q.id, number: q.number, total: Number(r.quote.total), linesChanged: r.changed })
    }
    return { parameters, quotes }
  }

  app.get('/:projectId', requirePermission('projects:read'), async (c) => {
    const p = await own((c.get('user') as any).companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    return one(c, { parameters: Array.isArray(p.parameters) ? p.parameters : [] })
  })

  app.put('/:projectId', requirePermission('projects:update'), async (c) => {
    const me = c.get('user') as any
    const p = await own(me.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const body = await c.req.json().catch(() => ({}))
    const clean = cleanParameters(body?.parameters)
    if ('error' in clean) return fail(c, 400, clean.error)
    return one(c, await save(me.companyId, p.id, clean.parameters))
  })

  app.post('/:projectId/from-takeoff', requirePermission('projects:update'), async (c) => {
    const me = c.get('user') as any
    const p = await own(me.companyId, c.req.param('projectId'))
    if (!p) return fail(c, 404, 'Project not found')
    const parsed = fromTakeoffBody.safeParse(await c.req.json().catch(() => ({})))
    if (!parsed.success) return fail(c, 400, parsed.error.issues[0]?.message || 'Pick the measurements')
    // Each measurement must be on one of this project's takeoffs (by its sheet or its takeoff).
    const ids = parsed.data.items.map((i) => i.takeoffItemId)
    const rows = await db.select({ id: takeoffItem.id, name: takeoffItem.name, unit: takeoffItem.unit, value: takeoffItem.measurementValue, quantity: takeoffItem.quantity, sheetProject: takeoffSheet.projectId, sheetCompany: takeoffSheet.companyId, takeoffProject: takeoff.projectId, takeoffCompany: takeoff.companyId })
      .from(takeoffItem).leftJoin(takeoffSheet, eq(takeoffSheet.id, takeoffItem.sheetId)).leftJoin(takeoff, eq(takeoff.id, takeoffItem.takeoffId))
      .where(inArray(takeoffItem.id, ids)) as any[]
    const mine = (r: any) => (r.sheetCompany === me.companyId && r.sheetProject === p.id) || (r.takeoffCompany === me.companyId && r.takeoffProject === p.id)
    const byId = new Map(rows.filter(mine).map((r) => [r.id, r]))
    const missing = parsed.data.items.find((i) => !byId.has(i.takeoffItemId))
    if (missing) return fail(c, 400, 'Every measurement must be on one of this project’s takeoffs')
    const params = new Map<string, FormulaParameter>((Array.isArray(p.parameters) ? p.parameters : []).map((x: any) => [String(x.key).toLowerCase(), x]))
    for (const i of parsed.data.items) {
      const r = byId.get(i.takeoffItemId)
      params.set(i.key.toLowerCase(), { key: i.key, label: i.label || r.name, value: round2(Number(r.value || 0) * Number(r.quantity || 1)), ...(r.unit ? { unit: r.unit } : {}) })
    }
    const clean = cleanParameters([...params.values()])
    if ('error' in clean) return fail(c, 400, clean.error)
    return one(c, await save(me.companyId, p.id, clean.parameters))
  })

  return app
}
