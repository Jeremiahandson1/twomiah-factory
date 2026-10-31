// Saved material-list templates at /api/material-list/templates (docs/parity/roof-material-list.md #12): a name for a set of
// assumptions and the standing extra lines a roofer always adds, so the next roof starts from "Standard shingle re-roof" instead
// of from the defaults.
//
//   GET    /            the company's templates                                         jobs:read
//   POST   /            save one                                                        inventory:create
//   PUT    /:id         change one                                                      inventory:update
//   DELETE /:id         delete one                                                      inventory:delete
//
// Mounted beside the material-list router (field/index.ts) behind the same roof_material_list feature. A template holds numbers and words only;
// it has no prices. Names are the company's own and are not repeated (case aside).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import { materialListTemplate } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { DEFAULT_ASSUMPTIONS, cleanAssumptions } from '../materialList.ts'

const extraLine = z.object({
  description: z.string().trim().min(1, 'Each extra line needs a description.').max(200),
  qty: z.coerce.number().finite().positive('Each extra line needs a quantity above 0.'),
  unit: z.string().trim().max(30).optional(),
})
const templateSchema = z.object({
  name: z.string().trim().min(1, 'Name the template.').max(80),
  assumptions: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
  extraLines: z.array(extraLine).max(40).optional(),
  supplier: z.string().trim().max(120).optional(),
})

/** Only the numbers that differ from the defaults are kept, so a template does not freeze today's defaults into itself. */
export const templateAssumptions = (over: unknown): Record<string, number | string> => {
  const clean = cleanAssumptions(over as any) as Record<string, number | string>
  return Object.fromEntries(Object.entries(clean).filter(([k, v]) => (DEFAULT_ASSUMPTIONS as any)[k] !== v))
}

export const shapeTemplate = (r: any) => ({
  id: r.id, name: r.name, assumptions: r.assumptions ?? {}, extraLines: r.extraLines ?? [], supplier: r.supplier ?? null,
  createdAt: new Date(r.createdAt).toISOString(), updatedAt: new Date(r.updatedAt).toISOString(),
})

export function createMaterialListTemplateRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = async (companyId: string, id: string) =>
    (await db.select().from(materialListTemplate).where(and(eq(materialListTemplate.id, id), eq(materialListTemplate.companyId, companyId))).limit(1))[0]
  const taken = async (companyId: string, name: string, exceptId?: string) =>
    (await db.select().from(materialListTemplate).where(eq(materialListTemplate.companyId, companyId)))
      .some((r: any) => r.id !== exceptId && String(r.name).trim().toLowerCase() === name.trim().toLowerCase())

  app.get('/', requirePermission('jobs:read'), async (c) => {
    const me = c.get('user')
    const rows = await db.select().from(materialListTemplate).where(eq(materialListTemplate.companyId, me.companyId)).orderBy(asc(materialListTemplate.name))
    return list(c, rows.map(shapeTemplate), { page: 1, limit: rows.length || 1, total: rows.length })
  })

  app.post('/', requirePermission('inventory:create'), async (c) => {
    const me = c.get('user')
    const parsed = templateSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    if (await taken(me.companyId, v.name)) return fail(c, 409, 'You already have a template with that name.', 'name_taken')
    const [made] = await db.insert(materialListTemplate).values({
      companyId: me.companyId, name: v.name, assumptions: templateAssumptions(v.assumptions), extraLines: (v.extraLines ?? []).map((l) => ({ description: l.description, qty: l.qty, unit: l.unit || 'ea' })),
      supplier: v.supplier || null, createdById: me.userId,
    } as any).returning()
    return one(c, shapeTemplate(made), 201)
  })

  app.put('/:id', requirePermission('inventory:update'), async (c) => {
    const me = c.get('user')
    const found = await own(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Template not found')
    const parsed = templateSchema.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const v = parsed.data
    if (v.name !== undefined && (await taken(me.companyId, v.name, found.id))) return fail(c, 409, 'You already have a template with that name.', 'name_taken')
    const set: Record<string, unknown> = { updatedAt: new Date() }
    if (v.name !== undefined) set.name = v.name
    if (v.assumptions !== undefined) set.assumptions = templateAssumptions(v.assumptions)
    if (v.extraLines !== undefined) set.extraLines = v.extraLines.map((l) => ({ description: l.description, qty: l.qty, unit: l.unit || 'ea' }))
    if (v.supplier !== undefined) set.supplier = v.supplier || null
    const [saved] = await db.update(materialListTemplate).set(set as any).where(and(eq(materialListTemplate.id, found.id), eq(materialListTemplate.companyId, me.companyId))).returning()
    return one(c, shapeTemplate(saved))
  })

  app.delete('/:id', requirePermission('inventory:delete'), async (c) => {
    const me = c.get('user')
    const found = await own(me.companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Template not found')
    await db.delete(materialListTemplate).where(and(eq(materialListTemplate.id, found.id), eq(materialListTemplate.companyId, me.companyId)))
    return c.body(null, 204)
  })

  return app
}
