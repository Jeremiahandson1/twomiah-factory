// Material orders at /api/materials (materials). Moved from templates/crm-roof/backend/src/routes/materials.ts. The
// registry signs the person in and applies the gate.
//
// A material order's COST is money (T42, Roofing HIGH — "Materials shows Total Cost"): both reads withhold the order's
// total and each line's price without margin:read — what the business PAID, owner/admin/manager — not invoices:read,
// which the read-only seat holds for revenue, and not inventory:read, because what is on the truck is what a crew lead
// needs. The description, quantity and unit stay, so the order still reads as an order.
//
// Changes from the template:
//   · the list no longer carries `moneyWithheld` beside its { data, pagination } (RULEBOOK §3), nor the one order beside
//     its fields: the screen knows it from the same permission (margin:read), as roofing's jobs do (jobs.ts);
//   · an order's job must be one of the company's (the template stored any job id it was sent, another company's too);
//   · an edit and a delete are scoped to the company in the write itself; an unreadable date or body is a 400, and an
//     edit's '' date clears it (the template handed '' to the timestamp column, a 500).
import { Hono } from 'hono'
import { z } from 'zod'
import { and, count, desc, eq, gte, lt } from 'drizzle-orm'
import { companyTimeZone, isIsoDate, zonedWallTimeToUtc } from '@twomiah/tenant-backend'
import { job, material } from '../../../db/schema/index.ts'
import { invalid } from '../../../http/errors.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import { canSeeWith } from '../../deps.ts'
import { lineItemInput, materialOrderStatus, normaliseLineItems, optional } from '../validation.ts'

const MATERIAL_MONEY = ['totalCost'] as const
/** The money inside a line item. The canonical line is {code?, description, qty, unit, unitPrice, total}. */
const MATERIAL_LINE_MONEY = ['unitPrice', 'total'] as const

/** A material row with the prices removed — the order's own total and each line's. Used by BOTH reads. */
export const withoutMaterialMoney = (row: any) => {
  const out = { ...row }
  for (const f of MATERIAL_MONEY) delete out[f]
  if (Array.isArray(out.lineItems)) {
    out.lineItems = out.lineItems.map((li: any) => {
      const line = { ...li }
      for (const f of MATERIAL_LINE_MONEY) delete line[f]
      return line
    })
  }
  return out
}

// N1: both spellings of a line (qty | quantity, unitPrice | unitCost) are accepted and normalised, and the money is
// computed here — the client's totalCost is accepted for compatibility and never stored.
const materialSchema = z.object({
  jobId: z.string().min(1),
  supplier: z.string().min(1),
  orderStatus: optional(materialOrderStatus),
  orderDate: z.string().optional(),
  deliveryDate: z.string().optional(),
  lineItems: z.array(lineItemInput).min(1),
  totalCost: z.number().optional(),
  supplierOrderNumber: z.string().optional(),
  deliveryAddress: z.string().optional(),
  notes: z.string().optional(),
})

/** A date from the form: absent leaves it, '' clears it, one that does not parse is an error naming the field. */
const dateOf = (field: string, v: string | undefined): { value?: Date | null; error?: string } => {
  if (v === undefined) return {}
  if (v === '') return { value: null }
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? { error: `${field}: Enter a valid date.` } : { value: d }
}

export function createMaterialRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const canSee = canSeeWith(d.permissions)
  const app = new Hono<AppEnv>()
  const maySeeCost = async (c: any) => { const u = c.get('user'); try { return !!(await canSee(u.role, 'margin:read', u.userId)) } catch { return false } }
  const ownJob = async (companyId: string, id: string) =>
    !!(await db.select({ id: job.id }).from(job).where(and(eq(job.id, id), eq(job.companyId, companyId))).limit(1))[0]
  const ownOrder = async (companyId: string, id: string) =>
    (await db.select().from(material).where(and(eq(material.id, id), eq(material.companyId, companyId))).limit(1))[0]

  // GET / — orders, filtered; each with its job's number. ?status= is the screen's name for orderStatus.
  app.get('/', async (c) => {
    const { companyId } = c.get('user')
    const supplier = c.req.query('supplier')
    const orderStatus = c.req.query('orderStatus') || c.req.query('status')
    const jobId = c.req.query('jobId')
    const page = Math.max(parseInt(c.req.query('page') || '1') || 1, 1)
    const limit = Math.max(parseInt(c.req.query('limit') || '50') || 50, 1)
    const conditions: any[] = [eq(material.companyId, companyId)]
    if (supplier) conditions.push(eq(material.supplier, supplier))
    if (orderStatus) conditions.push(eq(material.orderStatus, orderStatus))
    if (jobId) conditions.push(eq(material.jobId, jobId))
    // The order date from / to, whole days on the company's clock (the screen sends YYYY-MM-DD). The template's screen
    // sent them and no server read them, so the filter did nothing (found moving the screens, 2026-10-19).
    const dateFrom = c.req.query('dateFrom'), dateTo = c.req.query('dateTo')
    for (const [name, v] of [['dateFrom', dateFrom], ['dateTo', dateTo]] as const) {
      if (v && !isIsoDate(v)) return fail(c, 400, `${name} must be a date (YYYY-MM-DD)`)
    }
    if (dateFrom || dateTo) {
      const tz = await companyTimeZone(db, companyId)
      if (dateFrom) conditions.push(gte(material.orderDate, zonedWallTimeToUtc(dateFrom, '00:00', tz)))
      if (dateTo) {
        const next = new Date(`${dateTo}T12:00:00Z`); next.setUTCDate(next.getUTCDate() + 1)
        conditions.push(lt(material.orderDate, zonedWallTimeToUtc(next.toISOString().slice(0, 10), '00:00', tz)))
      }
    }
    const where = and(...conditions)
    const [rows, [{ value: total }]] = await Promise.all([
      db.select({ material, jobNumber: job.number }).from(material)
        .leftJoin(job, and(eq(material.jobId, job.id), eq(job.companyId, companyId)))
        .where(where).orderBy(desc(material.createdAt), desc(material.id)).offset((page - 1) * limit).limit(limit),
      db.select({ value: count() }).from(material).where(where),
    ])
    // The job's number (not its id), and orderStatus as `status` too, which is what the list reads.
    const data = rows.map((r: any) => ({ ...r.material, jobNumber: r.jobNumber, status: r.material.orderStatus }))
    return list(c, (await maySeeCost(c)) ? data : data.map(withoutMaterialMoney), { page, limit, total: Number(total) })
  })

  app.post('/', requirePermission('inventory:create'), async (c) => {
    const { companyId } = c.get('user')
    const parsed = materialSchema.safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    const orderDate = dateOf('orderDate', data.orderDate)
    const deliveryDate = dateOf('deliveryDate', data.deliveryDate)
    if (orderDate.error || deliveryDate.error) return fail(c, 400, (orderDate.error || deliveryDate.error)!)
    if (!(await ownJob(companyId, data.jobId))) return fail(c, 404, 'That job does not exist.')
    // The order is worth what its line items are worth.
    const { lineItems, total } = normaliseLineItems(data.lineItems)
    const [created] = await db.insert(material).values({
      companyId, jobId: data.jobId, supplier: data.supplier, orderStatus: data.orderStatus || 'not_ordered',
      orderDate: orderDate.value ?? null, deliveryDate: deliveryDate.value ?? null,
      lineItems, totalCost: total.toFixed(2),
      supplierOrderNumber: data.supplierOrderNumber, deliveryAddress: data.deliveryAddress, notes: data.notes,
    } as any).returning()
    return one(c, created, 201)
  })

  app.get('/:id', async (c) => {
    const found = await ownOrder(c.get('user').companyId, c.req.param('id'))
    if (!found) return fail(c, 404, 'Material order not found')
    return one(c, (await maySeeCost(c)) ? found : withoutMaterialMoney(found))
  })

  app.put('/:id', requirePermission('inventory:update'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    const parsed = materialSchema.partial().safeParse(await c.req.json().catch(() => null))
    if (!parsed.success) return invalid(c, parsed.error)
    const data = parsed.data
    if (!(await ownOrder(companyId, id))) return fail(c, 404, 'Material order not found')
    if (data.jobId && !(await ownJob(companyId, data.jobId))) return fail(c, 404, 'That job does not exist.')
    const orderDate = dateOf('orderDate', data.orderDate)
    const deliveryDate = dateOf('deliveryDate', data.deliveryDate)
    if (orderDate.error || deliveryDate.error) return fail(c, 400, (orderDate.error || deliveryDate.error)!)
    const { orderDate: _o, deliveryDate: _d, ...fields } = data
    const updateData: Record<string, any> = { ...fields, updatedAt: new Date() }
    if (orderDate.value !== undefined) updateData.orderDate = orderDate.value
    if (deliveryDate.value !== undefined) updateData.deliveryDate = deliveryDate.value
    // Same rule as create: an edit that changes the lines recomputes the total; the client's totalCost is never stored.
    delete updateData.totalCost
    if (data.lineItems) {
      const { lineItems, total } = normaliseLineItems(data.lineItems)
      updateData.lineItems = lineItems
      updateData.totalCost = total.toFixed(2)
    }
    const [updated] = await db.update(material).set(updateData as any).where(and(eq(material.id, id), eq(material.companyId, companyId))).returning()
    return one(c, updated)
  })

  app.delete('/:id', requirePermission('inventory:delete'), async (c) => {
    const { companyId } = c.get('user')
    const id = c.req.param('id')
    if (!(await ownOrder(companyId, id))) return fail(c, 404, 'Material order not found')
    await db.delete(material).where(and(eq(material.id, id), eq(material.companyId, companyId)))
    return c.body(null, 204)
  })

  return app
}
