// Customer groups at /api/admin/customer-groups (2026-10-24, the store upgrade): a group (e.g. "Wholesale") with a
// percent off the catalogue and/or its own price per variant, and the customers (contacts) in it. Where the prices
// apply is ./groupPricing.ts (an order the owner makes for a member: orders/draftOrders.ts).
//
// Who may: a group's prices are money given away, as a discount code is — the same permissions (discounts:read to see
// them, discounts:create / update / delete to change them), the manager's and the owner's; staff read them.
import { Hono } from 'hono'
import { z } from 'zod'
import { and, asc, eq, inArray } from 'drizzle-orm'
import { contact } from '../../../db/schema/index.ts'
import { storeCustomerGroup, storeCustomerGroupMember, storeGroupPrice, storeProduct, storeProductVariant } from '../../../db/schema/store.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { done, fail, listAll, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { partialOf } from '@twomiah/tenant-backend'

const groupSchema = z.object({
  name: z.string().trim().min(1, 'Name the group').max(80),
  percentOff: z.number().int().min(0, 'From 0 to 100').max(100, 'From 0 to 100').default(0),
})
const priceSchema = z.object({ priceCents: z.number().int().nonnegative().max(2147483647, 'Price is too large') })

export function createCustomerGroupRoutes(d: CrmDeps) {
  const { db, audit } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission('discounts:read'))
  const own = (c: any) => c.get('user').companyId as string
  const groupOf = async (companyId: string, id: string) =>
    (await db.select().from(storeCustomerGroup).where(and(eq(storeCustomerGroup.id, id), eq(storeCustomerGroup.companyId, companyId))).limit(1))[0] as typeof storeCustomerGroup.$inferSelect | undefined
  const taken = (c: any) => fail(c, 409, 'A group with that name already exists.', 'duplicate', { name: 'Already used' })

  app.get('/', async (c) => {
    const companyId = own(c)
    const groups: Array<typeof storeCustomerGroup.$inferSelect> = await db.select().from(storeCustomerGroup).where(eq(storeCustomerGroup.companyId, companyId)).orderBy(asc(storeCustomerGroup.name))
    const ids = groups.map((g) => g.id)
    const [members, prices]: [any[], any[]] = ids.length ? await Promise.all([
      db.select({ groupId: storeCustomerGroupMember.groupId, contactId: contact.id, name: contact.name, email: contact.email })
        .from(storeCustomerGroupMember).innerJoin(contact, eq(contact.id, storeCustomerGroupMember.contactId))
        .where(and(inArray(storeCustomerGroupMember.groupId, ids), eq(storeCustomerGroupMember.companyId, companyId))).orderBy(asc(contact.name)),
      db.select({ groupId: storeGroupPrice.groupId, variantId: storeGroupPrice.variantId, priceCents: storeGroupPrice.priceCents, sku: storeProductVariant.sku,
        variantName: storeProductVariant.name, productName: storeProduct.name, catalogueCents: storeProductVariant.priceCents })
        .from(storeGroupPrice).innerJoin(storeProductVariant, eq(storeProductVariant.id, storeGroupPrice.variantId))
        .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
        .where(and(inArray(storeGroupPrice.groupId, ids), eq(storeProduct.companyId, companyId))).orderBy(asc(storeProduct.name)),
    ]) : [[], []]
    return listAll(c, groups.map((g) => ({
      ...g,
      members: members.filter((m) => m.groupId === g.id).map(({ groupId: _g, ...m }) => m),
      prices: prices.filter((p) => p.groupId === g.id).map(({ groupId: _g, ...p }) => p),
    })))
  })

  app.post('/', requirePermission('discounts:create'), async (c) => {
    const parsed = groupSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = own(c)
    const [made] = await db.insert(storeCustomerGroup).values({ companyId, ...parsed.data }).onConflictDoNothing().returning()
    if (!made) return taken(c)
    await audit.log({ action: audit.ACTIONS.CREATE, entity: 'customer_group', entityId: made.id, entityName: made.name, metadata: { description: `Customer group ${made.name} added (${made.percentOff}% off)` }, req: c })
    return one(c, made, 201)
  })

  app.patch('/:id', requirePermission('discounts:update'), async (c) => {
    const parsed = partialOf(groupSchema).safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = own(c)
    const before = await groupOf(companyId, c.req.param('id'))
    if (!before) return fail(c, 404, 'Not found')
    try {
      const [updated] = await db.update(storeCustomerGroup).set({ ...parsed.data, updatedAt: new Date() })
        .where(and(eq(storeCustomerGroup.id, before.id), eq(storeCustomerGroup.companyId, companyId))).returning()
      await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'customer_group', entityId: updated.id, entityName: updated.name, changes: audit.diff({ name: before.name, percentOff: before.percentOff }, { name: updated.name, percentOff: updated.percentOff }), req: c })
      return one(c, updated)
    } catch (e: any) {
      if (String(e?.message || e?.cause?.message || '').includes('store_customer_groups_company_name_unique')) return taken(c)
      throw e
    }
  })

  app.delete('/:id', requirePermission('discounts:delete'), async (c) => {
    const [gone] = await db.delete(storeCustomerGroup).where(and(eq(storeCustomerGroup.id, c.req.param('id')), eq(storeCustomerGroup.companyId, own(c)))).returning()
    if (!gone) return fail(c, 404, 'Not found')
    await audit.log({ action: audit.ACTIONS.DELETE, entity: 'customer_group', entityId: gone.id, entityName: gone.name, req: c })
    return done(c)
  })

  // A customer joins this group (leaving any other: one group per customer).
  app.put('/:id/members/:contactId', requirePermission('discounts:update'), async (c) => {
    const companyId = own(c)
    const g = await groupOf(companyId, c.req.param('id'))
    if (!g) return fail(c, 404, 'Not found')
    const [who] = await db.select({ id: contact.id, name: contact.name }).from(contact).where(and(eq(contact.id, c.req.param('contactId')), eq(contact.companyId, companyId))).limit(1)
    if (!who) return fail(c, 404, 'That customer was not found.')
    await db.transaction(async (tx: any) => {
      await tx.delete(storeCustomerGroupMember).where(and(eq(storeCustomerGroupMember.contactId, who.id), eq(storeCustomerGroupMember.companyId, companyId)))
      await tx.insert(storeCustomerGroupMember).values({ companyId, groupId: g.id, contactId: who.id })
    })
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'customer_group', entityId: g.id, entityName: g.name, metadata: { description: `${who.name} added to ${g.name}` }, req: c })
    return done(c)
  })

  app.delete('/:id/members/:contactId', requirePermission('discounts:update'), async (c) => {
    const companyId = own(c)
    const g = await groupOf(companyId, c.req.param('id'))
    if (!g) return fail(c, 404, 'Not found')
    await db.delete(storeCustomerGroupMember).where(and(eq(storeCustomerGroupMember.groupId, g.id), eq(storeCustomerGroupMember.contactId, c.req.param('contactId')), eq(storeCustomerGroupMember.companyId, companyId)))
    return done(c)
  })

  // The group's own price for one variant (wins over its percent off); DELETE goes back to the percent.
  app.put('/:id/prices/:variantId', requirePermission('discounts:update'), async (c) => {
    const parsed = priceSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const companyId = own(c)
    const g = await groupOf(companyId, c.req.param('id'))
    if (!g) return fail(c, 404, 'Not found')
    const [v] = await db.select({ id: storeProductVariant.id, sku: storeProductVariant.sku }).from(storeProductVariant)
      .innerJoin(storeProduct, eq(storeProduct.id, storeProductVariant.productId))
      .where(and(eq(storeProductVariant.id, c.req.param('variantId')), eq(storeProduct.companyId, companyId))).limit(1)
    if (!v) return fail(c, 404, 'That product option was not found.')
    await db.insert(storeGroupPrice).values({ groupId: g.id, variantId: v.id, priceCents: parsed.data.priceCents })
      .onConflictDoUpdate({ target: [storeGroupPrice.groupId, storeGroupPrice.variantId], set: { priceCents: parsed.data.priceCents } })
    await audit.log({ action: audit.ACTIONS.UPDATE, entity: 'customer_group', entityId: g.id, entityName: g.name, metadata: { description: `${g.name} price for ${v.sku} set` }, req: c })
    return done(c)
  })

  app.delete('/:id/prices/:variantId', requirePermission('discounts:update'), async (c) => {
    const g = await groupOf(own(c), c.req.param('id'))
    if (!g) return fail(c, 404, 'Not found')
    await db.delete(storeGroupPrice).where(and(eq(storeGroupPrice.groupId, g.id), eq(storeGroupPrice.variantId, c.req.param('variantId'))))
    return done(c)
  })

  return app
}
