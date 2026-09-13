// Pricebook — flat-rate service catalog, ONE implementation for every CRM that offers `pricebook` or `flat_rate_pricebook`
// (crm, crm-fieldservice, crm-landscaping). Vendored into each template as ../shared.
//
// Before (live-proven 2026-09-13 on ctrtest + fstest): saving Good-Better-Best options 500'd on every template —
// `column "recommended" of relation "pricebook_good_better_best" does not exist`, and crm's raw INSERT also omitted the
// primary key. An unknown item 500'd ("Item not found" thrown as a plain Error). Item/category updates wrote the raw
// request body into the row (companyId, id, anything); create silently dropped customer description / labor hours /
// show-to-customer (and fieldservice/landscaping had no columns for them, nor for the flat-rate page's partsIncluded);
// options were read for any item id without an ownership check and came back best/better/good (alphabetical); search
// did not escape LIKE wildcards and the page size had no ceiling; the API answered with the feature switched off.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, count, eq, ilike, inArray, max, or, sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'

export interface PricebookTables { company: any; pricebookCategory: any; pricebookItem: any; pricebookGoodBetterBest: any }
export interface PricebookServiceDeps { db: any; tables: PricebookTables }
export interface PricebookRoutesDeps {
  service: PricebookService
  db: any
  tables: Pick<PricebookTables, 'company'>
  authenticate: any
  requirePermission: (permission: string) => any
  /** Any of these enabled opens the API. Default ['pricebook', 'flat_rate_pricebook']. */
  features?: string[]
}

export const PRICEBOOK_TIERS = ['good', 'better', 'best'] as const
const TIER_ORDER: Record<string, number> = { good: 1, better: 2, best: 3 }

export class PricebookError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message) }
}

const money = z.union([z.number(), z.string().trim().regex(/^-?\d+(\.\d+)?$/)]).transform(Number).pipe(z.number().min(0).max(10_000_000))
const optMoney = money.optional()
const text = (max: number) => z.string().trim().max(max)
const itemFields = {
  name: text(200).min(1),
  code: text(50).optional(),
  categoryId: z.string().trim().max(64).nullable().optional(),
  description: text(2000).nullable().optional(),
  customerDescription: text(2000).nullable().optional(),
  partsIncluded: text(1000).nullable().optional(),
  price: money,
  cost: optMoney,
  unit: text(20).min(1).optional(),
  type: text(30).min(1).optional(),
  taxable: z.boolean().optional(),
  active: z.boolean().optional(),
  showToCustomer: z.boolean().optional(),
  imageUrl: z.string().trim().url().max(1000).nullable().optional().or(z.literal('')),
  laborHours: z.union([z.number(), z.string().trim().regex(/^\d+(\.\d+)?$/), z.literal('')]).transform((v) => (v === '' ? null : Number(v))).pipe(z.number().min(0).max(1000).nullable()).optional(),
}
export const itemCreateSchema = z.object(itemFields)
export const itemUpdateSchema = z.object(itemFields).partial()
export const categorySchema = z.object({ name: text(120).min(1), description: text(500).nullable().optional(), parentId: z.string().trim().max(64).nullable().optional() })
export const categoryUpdateSchema = categorySchema.partial().extend({ active: z.boolean().optional(), sortOrder: z.number().int().min(0).max(100000).optional() })
export const optionsSchema = z.object({
  options: z.array(z.object({
    tier: z.enum(PRICEBOOK_TIERS),
    name: text(100).min(1),
    description: text(500).nullable().optional(),
    price: money,
    features: z.array(text(200).min(1)).max(20).optional(),
    recommended: z.boolean().optional(),
  })).max(3),
}).superRefine((v, ctx) => {
  const tiers = v.options.map((o) => o.tier)
  if (new Set(tiers).size !== tiers.length) ctx.addIssue({ code: 'custom', message: 'each tier (good, better, best) may appear once' })
  if (v.options.filter((o) => o.recommended).length > 1) ctx.addIssue({ code: 'custom', message: 'only one option can be recommended' })
})
const zodMsg = (e: z.ZodError) => e.issues.map((i) => `${i.path.join('.') || 'body'}: ${i.message}`).join('; ')
const escLike = (s: string) => s.replace(/[\\%_]/g, (ch) => '\\' + ch)
const clampInt = (v: unknown, min: number, maxV: number, dflt: number) => { const n = parseInt(String(v ?? ''), 10); return Number.isFinite(n) ? Math.min(maxV, Math.max(min, n)) : dflt }

export function createPricebookService(deps: PricebookServiceDeps) {
  const { db, tables: t } = deps
  const C = t.pricebookCategory, I = t.pricebookItem, G = t.pricebookGoodBetterBest

  const ownCategory = async (companyId: string, id: string) => {
    const [row] = await db.select({ id: C.id }).from(C).where(and(eq(C.id, id), eq(C.companyId, companyId))).limit(1)
    return !!row
  }
  const nextSort = async (companyId: string, parentId: string | null) => {
    const [r] = await db.select({ m: max(C.sortOrder) }).from(C).where(and(eq(C.companyId, companyId), parentId ? eq(C.parentId, parentId) : sql`${C.parentId} IS NULL`))
    return Number(r?.m || 0) + 1
  }
  const nextCode = async (companyId: string) => {
    const [r] = await db.select({ n: count() }).from(I).where(eq(I.companyId, companyId))
    return `SVC-${String(Number(r?.n || 0) + 1).padStart(4, '0')}`
  }
  const shape = (item: any, category: any) => {
    const price = Number(item.price), cost = Number(item.cost)
    return { ...item, category: category ? { id: category.id, name: category.name } : null, categoryName: category?.name || null, totalCost: cost, margin: price > 0 ? (((price - cost) / price) * 100).toFixed(1) : '0' }
  }
  const values = (companyId: string, d: any) => {
    const out: Record<string, any> = {}
    const set = (k: string, v: any) => { if (v !== undefined) out[k] = v }
    set('name', d.name); set('code', d.code); set('categoryId', d.categoryId === '' ? null : d.categoryId)
    set('description', d.description); set('customerDescription', d.customerDescription); set('partsIncluded', d.partsIncluded)
    set('price', d.price === undefined ? undefined : String(d.price)); set('cost', d.cost === undefined ? undefined : String(d.cost))
    set('unit', d.unit); set('type', d.type); set('taxable', d.taxable); set('active', d.active); set('showToCustomer', d.showToCustomer)
    set('imageUrl', d.imageUrl === '' ? null : d.imageUrl); set('laborHours', d.laborHours === undefined ? undefined : d.laborHours === null ? null : String(d.laborHours))
    return out
  }
  const checkCategory = async (companyId: string, categoryId: any) => {
    if (categoryId && !(await ownCategory(companyId, categoryId))) throw new PricebookError(400, 'Unknown category')
  }

  return {
    async getCategories(companyId: string, { flat = false, active = true }: { flat?: boolean; active?: boolean | null } = {}) {
      const where = [eq(C.companyId, companyId)]
      if (active !== null) where.push(eq(C.active, active))
      const cats = await db.select().from(C).where(and(...where)).orderBy(asc(C.sortOrder))
      const ids = cats.map((c: any) => c.id)
      const counts = ids.length ? await db.select({ categoryId: I.categoryId, n: count() }).from(I).where(inArray(I.categoryId, ids)).groupBy(I.categoryId) : []
      const withCounts = cats.map((c: any) => ({ ...c, _count: { items: Number(counts.find((x: any) => x.categoryId === c.id)?.n || 0), children: cats.filter((x: any) => x.parentId === c.id).length } }))
      if (flat) return withCounts
      const tree = (p: any): any => ({ ...p, children: withCounts.filter((c: any) => c.parentId === p.id).map(tree) })
      return withCounts.filter((c: any) => !c.parentId).map(tree)
    },
    async createCategory(companyId: string, input: unknown) {
      const p = categorySchema.safeParse(input); if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      if (p.data.parentId) await checkCategory(companyId, p.data.parentId)
      const [row] = await db.insert(C).values({ companyId, name: p.data.name, description: p.data.description ?? null, parentId: p.data.parentId || null, sortOrder: await nextSort(companyId, p.data.parentId || null), active: true }).returning()
      return row
    },
    async updateCategory(companyId: string, id: string, input: unknown) {
      const p = categoryUpdateSchema.safeParse(input); if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      if (!(await ownCategory(companyId, id))) throw new PricebookError(404, 'Category not found')
      if (p.data.parentId) { if (p.data.parentId === id) throw new PricebookError(400, 'A category cannot be its own parent'); await checkCategory(companyId, p.data.parentId) }
      const set: Record<string, any> = {}
      for (const k of ['name', 'description', 'parentId', 'active', 'sortOrder'] as const) if (p.data[k] !== undefined) set[k] = p.data[k]
      if (!Object.keys(set).length) throw new PricebookError(400, 'Nothing to update')
      const [row] = await db.update(C).set(set).where(and(eq(C.id, id), eq(C.companyId, companyId))).returning()
      return row
    },
    async reorderCategories(companyId: string, orderedIds: unknown) {
      if (!Array.isArray(orderedIds) || orderedIds.some((x) => typeof x !== 'string') || orderedIds.length > 1000) throw new PricebookError(400, 'orderedIds must be an array of category ids')
      await Promise.all((orderedIds as string[]).map((id, i) => db.update(C).set({ sortOrder: i }).where(and(eq(C.id, id), eq(C.companyId, companyId)))))
      return { success: true }
    },
    async getItems(companyId: string, q: Record<string, string | undefined>) {
      const page = clampInt(q.page, 1, 100000, 1), limit = clampInt(q.limit, 1, 200, 50)
      const where = [eq(I.companyId, companyId)]
      if (q.active !== 'all') where.push(eq(I.active, q.active === 'false' ? false : true))
      if (q.categoryId) where.push(eq(I.categoryId, q.categoryId))
      if (q.search?.trim()) { const s = `%${escLike(q.search.trim())}%`; where.push(or(ilike(I.name, s), ilike(I.code, s), ilike(I.description, s))!) }
      const w = and(...where)
      const [rows, [tot]] = await Promise.all([
        db.select().from(I).leftJoin(C, eq(I.categoryId, C.id)).where(w).orderBy(asc(I.name)).offset((page - 1) * limit).limit(limit),
        db.select({ n: count() }).from(I).where(w),
      ])
      const itemIds = rows.map((r: any) => r.pricebook_item.id)
      const gbb = itemIds.length ? await db.select({ itemId: G.pricebookItemId, n: count() }).from(G).where(inArray(G.pricebookItemId, itemIds)).groupBy(G.pricebookItemId) : []
      const total = Number(tot?.n || 0)
      return {
        data: rows.map((r: any) => ({ ...shape(r.pricebook_item, r.pricebook_category), _count: { goodBetterBest: Number(gbb.find((x: any) => x.itemId === r.pricebook_item.id)?.n || 0) } })),
        pagination: { page, limit, total, pages: Math.ceil(total / limit) },
      }
    },
    async getItem(companyId: string, id: string) {
      const [r] = await db.select().from(I).leftJoin(C, eq(I.categoryId, C.id)).where(and(eq(I.id, id), eq(I.companyId, companyId))).limit(1)
      if (!r) throw new PricebookError(404, 'Pricebook item not found')
      return shape(r.pricebook_item, r.pricebook_category)
    },
    async createItem(companyId: string, input: unknown) {
      const p = itemCreateSchema.safeParse(input); if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      await checkCategory(companyId, p.data.categoryId)
      const v = values(companyId, p.data)
      const [row] = await db.insert(I).values({ ...v, companyId, code: p.data.code || (await nextCode(companyId)), cost: v.cost ?? '0', unit: v.unit ?? 'each', type: v.type ?? 'service', taxable: v.taxable ?? true, showToCustomer: v.showToCustomer ?? true, active: v.active ?? true }).returning()
      return this.getItem(companyId, row.id)
    },
    async updateItem(companyId: string, id: string, input: unknown) {
      const p = itemUpdateSchema.safeParse(input); if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      await this.getItem(companyId, id)
      await checkCategory(companyId, p.data.categoryId)
      const v = values(companyId, p.data)
      if (!Object.keys(v).length) throw new PricebookError(400, 'Nothing to update')
      await db.update(I).set({ ...v, updatedAt: new Date() }).where(and(eq(I.id, id), eq(I.companyId, companyId)))
      return this.getItem(companyId, id)
    },
    async duplicateItem(companyId: string, id: string) {
      const o: any = await this.getItem(companyId, id)
      const [row] = await db.insert(I).values({
        companyId, code: await nextCode(companyId), name: `${o.name} (Copy)`.slice(0, 200), categoryId: o.categoryId, description: o.description, customerDescription: o.customerDescription,
        partsIncluded: o.partsIncluded, price: o.price, cost: o.cost, unit: o.unit, type: o.type, taxable: o.taxable, active: o.active, showToCustomer: o.showToCustomer, imageUrl: o.imageUrl, laborHours: o.laborHours,
      }).returning()
      const opts = await db.select().from(G).where(eq(G.pricebookItemId, id))
      if (opts.length) await db.insert(G).values(opts.map((x: any) => ({ id: createId(), pricebookItemId: row.id, tier: x.tier, name: x.name, description: x.description, price: x.price, features: x.features, recommended: !!x.recommended })))
      return this.getItem(companyId, row.id)
    },
    async deleteItem(companyId: string, id: string) {
      await this.getItem(companyId, id)
      try { await db.delete(I).where(and(eq(I.id, id), eq(I.companyId, companyId))) } catch (e: any) {
        if ((e?.code || e?.cause?.code) === '23503') throw new PricebookError(409, 'This item is used elsewhere (e.g. on a quote) — deactivate it instead')
        throw e
      }
      return { success: true }
    },
    async getOptions(companyId: string, itemId: string) {
      await this.getItem(companyId, itemId)
      const rows = await db.select().from(G).where(eq(G.pricebookItemId, itemId))
      return rows.map((r: any) => ({ ...r, features: Array.isArray(r.features) ? r.features : [] })).sort((a: any, b: any) => (TIER_ORDER[a.tier] || 9) - (TIER_ORDER[b.tier] || 9))
    },
    async setOptions(companyId: string, itemId: string, input: unknown) {
      const p = optionsSchema.safeParse(input); if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      await this.getItem(companyId, itemId)
      await db.transaction(async (tx: any) => {
        await tx.delete(G).where(eq(G.pricebookItemId, itemId))
        if (p.data.options.length) await tx.insert(G).values(p.data.options.map((o) => ({ id: createId(), pricebookItemId: itemId, tier: o.tier, name: o.name, description: o.description ?? null, price: String(o.price), features: o.features || [], recommended: !!o.recommended })))
      })
      return this.getOptions(companyId, itemId)
    },
    async bulkAdjust(companyId: string, input: any) {
      const p = z.object({ categoryId: z.string().max(64).optional(), itemIds: z.array(z.string().max(64)).max(5000).optional(), adjustmentType: z.enum(['percent', 'fixed']), adjustmentValue: z.coerce.number().finite().min(-1_000_000).max(1_000_000), applyTo: z.enum(['price', 'cost']) }).safeParse(input)
      if (!p.success) throw new PricebookError(400, zodMsg(p.error))
      const where = [eq(I.companyId, companyId)]
      if (p.data.categoryId) where.push(eq(I.categoryId, p.data.categoryId))
      if (p.data.itemIds?.length) where.push(inArray(I.id, p.data.itemIds))
      const rows = await db.select({ id: I.id, price: I.price, cost: I.cost }).from(I).where(and(...where))
      for (const r of rows) {
        const cur = Number((r as any)[p.data.applyTo])
        const next = Math.max(0, Math.round((p.data.adjustmentType === 'percent' ? cur * (1 + p.data.adjustmentValue / 100) : cur + p.data.adjustmentValue) * 100) / 100)
        await db.update(I).set({ [p.data.applyTo]: String(next), updatedAt: new Date() }).where(eq(I.id, r.id))
      }
      return { updated: rows.length }
    },
    async exportItems(companyId: string) {
      const rows = await db.select().from(I).leftJoin(C, eq(I.categoryId, C.id)).where(eq(I.companyId, companyId)).orderBy(asc(I.name))
      return rows.map((r: any) => ({ code: r.pricebook_item.code, name: r.pricebook_item.name, category: r.pricebook_category?.name || '', description: r.pricebook_item.description || '', price: r.pricebook_item.price, cost: r.pricebook_item.cost, taxable: r.pricebook_item.taxable, active: r.pricebook_item.active }))
    },
    async importItems(companyId: string, input: any) {
      if (!Array.isArray(input?.data) || input.data.length > 5000) throw new PricebookError(400, 'data must be an array of at most 5000 rows')
      const updateExisting = input.updateExisting === true
      const results = { created: 0, updated: 0, errors: [] as Array<{ row: number; error: string }> }
      for (const [i, row] of (input.data as any[]).entries()) {
        try {
          let categoryId: string | null = null
          const catName = typeof row?.category === 'string' ? row.category.trim().slice(0, 120) : ''
          if (catName) {
            const [ex] = await db.select({ id: C.id }).from(C).where(and(eq(C.companyId, companyId), eq(C.name, catName))).limit(1)
            categoryId = ex?.id || (await this.createCategory(companyId, { name: catName })).id
          }
          const code = typeof row?.code === 'string' ? row.code.trim().slice(0, 50) : ''
          const [existing] = code ? await db.select({ id: I.id }).from(I).where(and(eq(I.companyId, companyId), eq(I.code, code))).limit(1) : []
          const payload = { name: row?.name, code: code || undefined, categoryId, description: row?.description ?? null, price: row?.price ?? 0, cost: row?.cost ?? 0 }
          if (existing) { if (updateExisting) { await this.updateItem(companyId, existing.id, payload); results.updated++ } }
          else { await this.createItem(companyId, payload); results.created++ }
        } catch (e: any) { results.errors.push({ row: i + 1, error: String(e?.message || e).slice(0, 300) }) }
      }
      return results
    },
    async searchForQuoting(companyId: string, query: string) {
      const s = `%${escLike(String(query || '').trim().slice(0, 100))}%`
      const rows = await db.select().from(I).leftJoin(C, eq(I.categoryId, C.id)).where(and(eq(I.companyId, companyId), eq(I.active, true), or(ilike(I.name, s), ilike(I.code, s), ilike(C.name, s)))).orderBy(asc(I.name)).limit(20)
      return rows.map((r: any) => shape(r.pricebook_item, r.pricebook_category))
    },
  }
}
export type PricebookService = ReturnType<typeof createPricebookService>

export function createPricebookRoutes(deps: PricebookRoutesDeps) {
  const { service: svc, db, tables, authenticate, requirePermission } = deps
  const features = deps.features || ['pricebook', 'flat_rate_pricebook']
  const app = new Hono()
  app.use('*', authenticate)
  const cache = new Map<string, { at: number; list: string[] }>()
  app.use('*', async (c, next) => {
    const u = c.get('user') as any
    if (!u?.companyId) return c.json({ error: 'Authentication required' }, 401)
    const hit = cache.get(u.companyId)
    let list = hit && Date.now() - hit.at < 15_000 ? hit.list : null
    if (!list) { const [co] = await db.select({ f: tables.company.enabledFeatures }).from(tables.company).where(eq(tables.company.id, u.companyId)).limit(1); list = Array.isArray(co?.f) ? co.f : []; cache.set(u.companyId, { at: Date.now(), list }) }
    if (!features.some((f) => list!.includes(f))) return c.json({ error: 'Pricebook is not enabled for your account.', code: 'FEATURE_NOT_ENABLED', feature: features[0] }, 403)
    await next()
  })
  const run = (fn: (c: any, u: any) => Promise<any>, status = 200) => async (c: any) => {
    try { return c.json(await fn(c, c.get('user')), status) } catch (e) { if (e instanceof PricebookError) return c.json({ error: e.message }, e.status); throw e }
  }
  const body = async (c: any) => { try { return await c.req.json() } catch { return {} } }

  app.get('/categories', run(async (c, u) => svc.getCategories(u.companyId, { flat: c.req.query('flat') === 'true', active: c.req.query('active') === 'all' ? null : c.req.query('active') !== 'false' })))
  app.post('/categories', requirePermission('pricebook:create'), run(async (c, u) => svc.createCategory(u.companyId, await body(c)), 201))
  app.put('/categories/:id', requirePermission('pricebook:update'), run(async (c, u) => svc.updateCategory(u.companyId, c.req.param('id'), await body(c))))
  app.post('/categories/reorder', requirePermission('pricebook:update'), run(async (c, u) => svc.reorderCategories(u.companyId, (await body(c))?.orderedIds)))
  app.get('/items', run(async (c, u) => svc.getItems(u.companyId, c.req.query())))
  app.get('/search', run(async (c, u) => svc.searchForQuoting(u.companyId, c.req.query('q') || '')))
  app.get('/export', run(async (_c, u) => svc.exportItems(u.companyId)))
  app.post('/import', requirePermission('pricebook:create'), run(async (c, u) => svc.importItems(u.companyId, await body(c))))
  app.post('/bulk/adjust-prices', requirePermission('pricebook:update'), run(async (c, u) => svc.bulkAdjust(u.companyId, await body(c))))
  app.get('/calculate-price', run(async (c) => {
    const cost = Number(c.req.query('cost')), margin = Number(c.req.query('targetMargin'))
    if (!Number.isFinite(cost) || cost < 0 || !Number.isFinite(margin) || margin < 0 || margin >= 100) throw new PricebookError(400, 'cost must be ≥ 0 and targetMargin between 0 and 99.99')
    return { cost, targetMargin: margin, suggestedPrice: Math.round((cost / (1 - margin / 100)) * 100) / 100 }
  }))
  app.get('/items/:id', run(async (c, u) => svc.getItem(u.companyId, c.req.param('id'))))
  app.post('/items', requirePermission('pricebook:create'), run(async (c, u) => svc.createItem(u.companyId, await body(c)), 201))
  app.put('/items/:id', requirePermission('pricebook:update'), run(async (c, u) => svc.updateItem(u.companyId, c.req.param('id'), await body(c))))
  app.post('/items/:id/duplicate', requirePermission('pricebook:create'), run(async (c, u) => svc.duplicateItem(u.companyId, c.req.param('id')), 201))
  app.delete('/items/:id', requirePermission('pricebook:delete'), run(async (c, u) => svc.deleteItem(u.companyId, c.req.param('id'))))
  app.get('/items/:id/options', run(async (c, u) => svc.getOptions(u.companyId, c.req.param('id'))))
  app.put('/items/:id/options', requirePermission('pricebook:update'), run(async (c, u) => svc.setOptions(u.companyId, c.req.param('id'), await body(c))))
  return app
}
