// The store's customer segments at /api/admin/segments (access 'user', behind the hidden feature store_segments;
// 2026-10-31, parity row 2 against Shopify's customer segments). A segment is a saved question about what customers spent,
// how often they ordered and what they bought (or did not buy), over a period — answered by the SAME SQL a campaign's
// audience, a follow-up email's "only these customers" and the audience export use (data/storeSegments.ts).
// The Menu row asks the same feature and marketing:read, as the routes do.
//   GET    /            the saved segments, each with how many customers match and how many can be emailed
//   GET    /choices     the categories and products the builder offers
//   POST   /preview     { definition } → who would be in it (count, emailable, a sample) — saves nothing
//   POST   /            save one (marketing:create)           PUT /:id change it (marketing:update)
//   DELETE /:id         remove it (marketing:delete); refused while a follow-up email still uses it
//   GET    /:id/customers  the first 100 people in it
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq } from 'drizzle-orm'
import type { Context } from 'hono'
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { company } from '../../../db/schema/index.ts'
import { storeSegment, type SegmentDefinition } from '../../../db/schema/store.ts'
import { segmentChoices, segmentCounts, segmentPeople } from '../../../data/storeSegments.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2026-10-01')
const ids = z.array(z.string().min(1).max(100)).max(50)
const cats = z.array(z.string().min(1).max(100)).max(50)
const cents = z.number().int().min(0).max(100_000_000)
const count = z.number().int().min(0).max(1_000_000)

export const definitionSchema = z.object({
  spend: z.object({ minCents: cents.optional(), maxCents: cents.optional() }).optional(),
  orders: z.object({ min: count.optional(), max: count.optional() }).optional(),
  period: z.union([z.object({ days: z.number().int().min(1).max(3650) }), z.object({ from: day, to: day.optional() })]).optional(),
  bought: z.object({ productIds: ids.optional(), categories: cats.optional() }).optional(),
  notBought: z.object({ productIds: ids.optional(), categories: cats.optional() }).optional(),
}).strict()

/** The sentence for a definition that asks nothing, or asks the impossible; null = fine. */
export function definitionProblem(def: SegmentDefinition): string | null {
  const asks = def.spend?.minCents != null || def.spend?.maxCents != null || def.orders?.min != null || def.orders?.max != null
    || !!def.bought?.productIds?.length || !!def.bought?.categories?.length || !!def.notBought?.productIds?.length || !!def.notBought?.categories?.length
  if (!asks) return 'Choose at least one thing to match on: what they spent, how many orders, or what they bought.'
  if (def.spend?.minCents != null && def.spend?.maxCents != null && def.spend.minCents > def.spend.maxCents) return 'The least spent is more than the most spent.'
  if (def.orders?.min != null && def.orders?.max != null && def.orders.min > def.orders.max) return 'The fewest orders is more than the most orders.'
  const p = def.period as any
  if (p?.from && p?.to && p.from > p.to) return 'The period ends before it starts.'
  for (const d of [p?.from, p?.to]) if (d && Number.isNaN(Date.parse(`${d}T00:00:00Z`))) return 'The period has a date that is not real.'
  return null
}

const nameSchema = z.object({ name: z.string().trim().min(1, 'Give it a name').max(80) })
const saveSchema = nameSchema.extend({ definition: definitionSchema })

const bad = (c: Context, sentence: string, error: z.ZodError) => {
  const fields: Record<string, string> = {}
  for (const i of error.issues) { const k = i.path.join('.'); if (k && !fields[k]) fields[k] = i.message }
  return fail(c, 400, sentence, 'validation_failed', fields)
}

export function createSegmentRoutes(d: CrmDeps, inUse: (companyId: string, segmentId: string) => Promise<string | null>) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const own = (c: Context) => (c as any).get('user').companyId as string
  const zoneOf = async (companyId: string) => companyRowTimeZone((await db.select().from(company).where(eq(company.id, companyId)).limit(1))[0])
  app.use('*', requirePermission('marketing:read'))

  app.get('/', async (c) => {
    const companyId = own(c), tz = await zoneOf(companyId)
    const rows = await db.select().from(storeSegment).where(eq(storeSegment.companyId, companyId)).orderBy(asc(storeSegment.name)).limit(200)
    return listAll(c, await Promise.all(rows.map(async (r: any) => ({ id: r.id, name: r.name, definition: r.definition, ...(await segmentCounts(db, companyId, r.definition, tz)), updatedAt: r.updatedAt }))))
  })

  app.get('/choices', async (c) => one(c, await segmentChoices(db, own(c))))

  app.post('/preview', async (c) => {
    const parsed = z.object({ definition: definitionSchema }).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the segment: amounts and counts must be whole numbers, dates like 2026-10-01.', parsed.error)
    const problem = definitionProblem(parsed.data.definition)
    if (problem) return fail(c, 400, problem, 'validation_failed')
    const tz = await zoneOf(own(c))
    const [counts, sample] = await Promise.all([segmentCounts(db, own(c), parsed.data.definition, tz), segmentPeople(db, own(c), parsed.data.definition, tz, { limit: 10 })])
    return one(c, { ...counts, sample })
  })

  app.get('/:id/customers', async (c) => {
    const [row] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, c.req.param('id')), eq(storeSegment.companyId, own(c)))).limit(1)
    if (!row) return fail(c, 404, 'Not found')
    return listAll(c, await segmentPeople(db, own(c), row.definition, await zoneOf(own(c)), { limit: 100 }))
  })

  app.post('/', requirePermission('marketing:create'), async (c) => {
    const parsed = saveSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the segment: give it a name; amounts and counts must be whole numbers.', parsed.error)
    const problem = definitionProblem(parsed.data.definition)
    if (problem) return fail(c, 400, problem, 'validation_failed')
    const clash = await db.select({ id: storeSegment.id }).from(storeSegment).where(and(eq(storeSegment.companyId, own(c)), eq(storeSegment.name, parsed.data.name))).limit(1)
    if (clash.length) return fail(c, 409, 'You already have a segment with that name.', 'duplicate', { name: 'Already used' })
    const [row] = await db.insert(storeSegment).values({ companyId: own(c), name: parsed.data.name, definition: parsed.data.definition }).returning()
    await d.audit.log({ action: 'create', entity: 'segment', entityId: row.id, entityName: row.name, companyId: own(c), req: c })
    return one(c, row, 201)
  })

  app.put('/:id', requirePermission('marketing:update'), async (c) => {
    const parsed = saveSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return bad(c, 'Check the segment: give it a name; amounts and counts must be whole numbers.', parsed.error)
    const problem = definitionProblem(parsed.data.definition)
    if (problem) return fail(c, 400, problem, 'validation_failed')
    const [cur] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, c.req.param('id')), eq(storeSegment.companyId, own(c)))).limit(1)
    if (!cur) return fail(c, 404, 'Not found')
    if (parsed.data.name !== cur.name) {
      const clash = await db.select({ id: storeSegment.id }).from(storeSegment).where(and(eq(storeSegment.companyId, own(c)), eq(storeSegment.name, parsed.data.name))).limit(1)
      if (clash.length) return fail(c, 409, 'You already have a segment with that name.', 'duplicate', { name: 'Already used' })
    }
    const [row] = await db.update(storeSegment).set({ name: parsed.data.name, definition: parsed.data.definition, updatedAt: new Date() }).where(eq(storeSegment.id, cur.id)).returning()
    await d.audit.log({ action: 'update', entity: 'segment', entityId: row.id, entityName: row.name, companyId: own(c), req: c })
    return one(c, row)
  })

  app.delete('/:id', requirePermission('marketing:delete'), async (c) => {
    const [cur] = await db.select().from(storeSegment).where(and(eq(storeSegment.id, c.req.param('id')), eq(storeSegment.companyId, own(c)))).limit(1)
    if (!cur) return fail(c, 404, 'Not found')
    const user = await inUse(own(c), cur.id)
    if (user) return fail(c, 409, `${user} still sends to this segment. Choose another segment there first.`, 'in_use')
    await db.delete(storeSegment).where(eq(storeSegment.id, cur.id))
    await d.audit.log({ action: 'delete', entity: 'segment', entityId: cur.id, entityName: cur.name, companyId: own(c), req: c })
    return c.body(null, 204)
  })
  return app
}
