// Remittance batches (a payer's payment advice and its lines). Moved from
// templates/crm-homecare/backend/src/routes/remittance.ts.
//
// Who: the template's router was requireAdmin. Reading is care-billing:read; recording a batch care-billing:create;
// editing one care-billing:update.
//
// Changes from the template: the company's rows only; the lists are { data, pagination }; a body can no longer set a
// batch's or line's id or company (the template spread it into the insert and the update); editing a batch that does not
// exist is a 404 (it answered an empty 200).
import { Hono } from 'hono'
import { and, eq, desc, asc, inArray } from 'drizzle-orm'
import { remittanceBatches, remittanceLineItems, referralSources } from '../../../db/schema/index.ts'
import type { HomecareCore } from '../core/index.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, list, one } from '../../../http/reply.ts'
import { body, who, withoutOwnership } from './shared.ts'

export function createRemittanceRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const app = new Hono<AppEnv>()
  const read = requirePermission('care-billing:read')

  // GET / — every batch with its payer and lines, newest first. A list reply.
  app.get('/', read, async (c) => {
    const { companyId } = who(c)
    const rows = await db.select({ batch: remittanceBatches, payerName: referralSources.name })
      .from(remittanceBatches)
      .leftJoin(referralSources, eq(remittanceBatches.payerId, referralSources.id))
      .where(eq(remittanceBatches.companyId, companyId))
      .orderBy(desc(remittanceBatches.createdAt))
    const batchIds = rows.map((r: any) => r.batch.id)
    const byBatch: Record<string, any[]> = {}
    if (batchIds.length > 0) {
      const items = await db.select().from(remittanceLineItems)
        .where(and(eq(remittanceLineItems.companyId, companyId), inArray(remittanceLineItems.batchId, batchIds)))
      for (const li of items) (byBatch[li.batchId] ||= []).push(li)
    }
    const result = rows.map((r: any) => ({ ...r.batch, payer: r.payerName ? { name: r.payerName } : null, lineItems: byBatch[r.batch.id] || [] }))
    return list(c, result, { page: 1, limit: result.length, total: result.length })
  })

  // GET /payers — payers are referral sources here. A list reply.
  app.get('/payers', read, async (c) => {
    const rows = await db.select({ id: referralSources.id, name: referralSources.name, type: referralSources.type })
      .from(referralSources).where(eq(referralSources.companyId, who(c).companyId)).orderBy(asc(referralSources.name))
    return list(c, rows, { page: 1, limit: rows.length, total: rows.length })
  })

  // GET /payer-summary — remittance totals grouped by payer. A list reply.
  app.get('/payer-summary', read, async (c) => {
    const rows = await db.select({ batch: remittanceBatches, payerName: referralSources.name })
      .from(remittanceBatches)
      .leftJoin(referralSources, eq(remittanceBatches.payerId, referralSources.id))
      .where(eq(remittanceBatches.companyId, who(c).companyId))
    const num = (v: any) => Number(v || 0)
    const byPayer: Record<string, { payerId: string | null; payerName: string; batches: number; totalPaid: number }> = {}
    for (const r of rows as any[]) {
      const key = r.batch.payerId || 'unassigned'
      if (!byPayer[key]) byPayer[key] = { payerId: r.batch.payerId ?? null, payerName: r.payerName || 'Unassigned', batches: 0, totalPaid: 0 }
      byPayer[key].batches++
      byPayer[key].totalPaid += num(r.batch.totalPaid ?? r.batch.totalAmount)
    }
    const out = Object.values(byPayer).map((p) => ({ ...p, totalPaid: Number(p.totalPaid.toFixed(2)) }))
    return list(c, out, { page: 1, limit: out.length, total: out.length })
  })

  // POST / — a batch and its lines.
  app.post('/', requirePermission('care-billing:create'), async (c) => {
    const { companyId, userId } = who(c)
    const { lineItems: lineItemsData, ...data } = await body(c)
    const out = await db.transaction(async (tx: any) => {
      const [batch] = await tx.insert(remittanceBatches).values({ ...withoutOwnership(data), companyId, createdById: userId }).returning()
      let created: any[] = []
      if (Array.isArray(lineItemsData) && lineItemsData.length > 0) {
        created = await tx.insert(remittanceLineItems)
          .values(lineItemsData.map((li: any) => ({ ...withoutOwnership(li), companyId, batchId: batch.id })))
          .returning()
      }
      return { ...batch, lineItems: created }
    })
    return one(c, out, 201)
  })

  // PATCH /:id
  app.patch('/:id', requirePermission('care-billing:update'), async (c) => {
    const [batch] = await db.update(remittanceBatches)
      .set({ ...withoutOwnership(await body(c)), updatedAt: new Date() })
      .where(and(eq(remittanceBatches.id, c.req.param('id')), eq(remittanceBatches.companyId, who(c).companyId)))
      .returning()
    if (!batch) return fail(c, 404, 'Remittance batch not found')
    return one(c, batch)
  })

  return app
}
