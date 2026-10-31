// /api/care-split — a client's split billing (care_split_billing, not ready): who pays what share of each visit
// (core/splitBilling.ts). Mounted only for an agency with the feature on; the invoices are divided when they are made
// (core/invoiceEngine.ts createInvoiceWithLines), and an invoice already made is never re-divided.
//   GET /clients/:clientId   the client's payers in priority order — care-billing:read
//   PUT /clients/:clientId   replace them ({ payers: [{ payerId, kind: 'percent' | 'per_hour', value }] }, in order; [] = none)
//                            — care-billing:update
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { clientBillingSplits, clients, referralSources } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { splitRulesProblem } from '../core/splitBilling.ts'
import { who } from './shared.ts'

export function createSplitBillingRoutes(_core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-billing:read')
  const update = d.permissions.requirePermission('care-billing:update')

  const ownClient = async (companyId: string, clientId: string) =>
    (await db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1))[0] ?? null
  const rulesOf = async (companyId: string, clientId: string) =>
    (await db.select({ payerId: clientBillingSplits.payerId, payerName: referralSources.name, kind: clientBillingSplits.kind, value: clientBillingSplits.value, priority: clientBillingSplits.priority })
      .from(clientBillingSplits).innerJoin(referralSources, eq(referralSources.id, clientBillingSplits.payerId))
      .where(and(eq(clientBillingSplits.companyId, companyId), eq(clientBillingSplits.clientId, clientId)))
      .orderBy(asc(clientBillingSplits.priority)))
      .map((r: any) => ({ ...r, value: Number(r.value) }))

  app.get('/clients/:clientId', read, async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')
    if (!(await ownClient(companyId, clientId))) return fail(c, 404, 'Client not found')
    return one(c, { clientId, payers: await rulesOf(companyId, clientId) })
  })

  app.put('/clients/:clientId', update, async (c) => {
    const { companyId, userId } = who(c)
    const clientId = c.req.param('clientId')
    if (!(await ownClient(companyId, clientId))) return fail(c, 404, 'Client not found')
    const b: any = await c.req.json().catch(() => null)
    const payers: any[] = Array.isArray(b?.payers) ? b.payers : []
    if (!b || !Array.isArray(b.payers)) return fail(c, 400, 'Send { payers: [...] } — an empty list removes the split.')
    const active = new Set<string>((await db.select({ id: referralSources.id }).from(referralSources)
      .where(and(eq(referralSources.companyId, companyId), eq(referralSources.isActivePayer, true)))).map((r: any) => r.id as string))
    const problem = splitRulesProblem(payers, active)
    if (problem) return fail(c, 400, problem, 'validation_failed')
    await db.transaction(async (tx: any) => {
      await tx.delete(clientBillingSplits).where(and(eq(clientBillingSplits.companyId, companyId), eq(clientBillingSplits.clientId, clientId)))
      for (const [i, p] of payers.entries()) {
        await tx.insert(clientBillingSplits).values({ companyId, clientId, payerId: p.payerId, priority: i + 1, kind: p.kind, value: String(Math.round(Number(p.value) * 100) / 100) })
      }
    })
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'client-split-billing', entityId: clientId, userId, companyId, metadata: { payers: payers.length } } as any)
    return one(c, { clientId, payers: await rulesOf(companyId, clientId) })
  })

  return app
}
