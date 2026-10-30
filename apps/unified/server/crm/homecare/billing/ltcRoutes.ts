// /api/care-ltc — long-term care insurance billing (item 3, docs/parity/homecare-privatepay.md). Mounted only for an agency with
// care_ltc_billing (not ready). The work is core/ltc.ts.
//
//   GET /invoices                      invoices billed to a long-term-care payer, with whether the client's policy is on file
//   GET /clients/:clientId/policy      the client's policy and claim numbers and daily maximum
//   PUT /clients/:clientId/policy      save them
//   GET /invoices/:invoiceId/claim-packet   the claim packet (PDF) for one sent invoice
//
// Who: reading and the packet are care-billing:read; saving a policy is care-billing:update.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one, listAll } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { who } from './shared.ts'

export function createLtcRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const read = d.permissions.requirePermission('care-billing:read')
  const update = d.permissions.requirePermission('care-billing:update')

  app.get('/invoices', read, async (c) => listAll(c, await core.ltc.invoices(who(c).companyId)))

  app.get('/clients/:clientId/policy', read, async (c) => {
    const p = await core.ltc.getPolicy(who(c).companyId, c.req.param('clientId'))
    return p ? one(c, p) : fail(c, 404, 'Client not found')
  })

  app.put('/clients/:clientId/policy', update, async (c) => {
    const { companyId, userId } = who(c)
    const out = await core.ltc.savePolicy(companyId, c.req.param('clientId'), await c.req.json().catch(() => ({})), userId)
    if ('problem' in out) return fail(c, out.status as any, out.problem)
    d.audit.log({ req: c, action: d.audit.ACTIONS.UPDATE, entity: 'client-ltc-policy', entityId: c.req.param('clientId'), userId, companyId })
    return one(c, out)
  })

  app.get('/invoices/:invoiceId/claim-packet', read, async (c) => {
    const { companyId, userId } = who(c)
    const out = await core.ltc.claimPacket(companyId, c.req.param('invoiceId'))
    if ('problem' in out) return fail(c, out.status as any, out.problem, out.code)
    d.audit.log({ req: c, action: d.audit.ACTIONS.EXPORT, entity: 'ltc-claim-packet', entityId: c.req.param('invoiceId'), userId, companyId })
    return c.body(new Uint8Array(out.pdf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${out.fileName}"` })
  })

  return app
}
