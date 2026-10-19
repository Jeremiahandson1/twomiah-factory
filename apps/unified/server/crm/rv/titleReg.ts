// Title & registration, filed for a SOLD deal from its own buyer and unit, the fee the one desked on the deal. No DMV
// rail is connected, so a filing says so honestly with the real document checklist (RV T19 L1). Moved from
// templates/crm-rv/backend/src/routes/titleReg.ts.
import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { salesLead, contact, unit } from '../../db/schema/index.ts'
import type { AppEnv } from '../../http/env.ts'
import { fail, one } from '../../http/reply.ts'
import type { CrmDeps } from '../deps.ts'

interface TitleProvider { name: string; live: boolean; submit(deal: any): Promise<any> }
const notConfiguredProvider: TitleProvider = {
  name: 'not_configured', live: false,
  async submit(deal) {
    const state = String(deal.state || 'WI').toUpperCase()
    return {
      status: 'not_submitted', refNumber: null, state,
      checklist: ['Signed title / MSO', 'Bill of sale', 'Proof of insurance', 'Odometer / HIN disclosure', 'Buyer ID'],
      reason: 'Title & registration is not connected. Connect a DMV rail (e.g. Vitu) to submit.',
    }
  },
}
const provider: TitleProvider = notConfiguredProvider

export function createTitleRegRoutes(d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  // The attempts this process has seen, newest first (in memory, as the template kept them: nothing is filed).
  const SUBMISSIONS: any[] = []
  const app = new Hono<AppEnv>()

  app.post('/submit', requirePermission('contacts:update'), async (c) => {
    const u = c.get('user')
    const body = await c.req.json().catch(() => ({} as any))
    const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
    if (!leadId) return fail(c, 400, 'Pick the deal to title and register.')
    const [row] = await db.select({ lead: salesLead, buyer: contact.name, year: unit.year, make: unit.make, model: unit.modelName, vin: unit.vin })
      .from(salesLead)
      .leftJoin(contact, eq(salesLead.contactId, contact.id))
      .leftJoin(unit, eq(salesLead.unitId, unit.id))
      .where(and(eq(salesLead.id, leadId), eq(salesLead.companyId, u.companyId)))
      .limit(1)
    if (!row) return fail(c, 404, 'Deal not found.')
    if (row.lead.stage !== 'closed_won') return fail(c, 409, 'Title & registration is filed for a sold deal — mark the deal Sold first.')
    if (!row.lead.unitId) return fail(c, 409, 'This deal has no unit to title.')
    const deal = (row.lead.deal || null) as any
    const fees = deal && Number.isFinite(Number(deal.titleReg)) ? { titleReg: Number(deal.titleReg), fromDesk: true } : { titleReg: null, fromDesk: false }
    let result: any
    try {
      result = await provider.submit({ state: body.state, buyer: { name: row.buyer }, unit: { year: row.year, make: row.make, model: row.model, vin: row.vin } })
    } catch (e: any) { return fail(c, 502, 'DMV submit failed: ' + (e?.message || e)) }
    const record = { ...result, leadId, fees }
    SUBMISSIONS.unshift({ ...record, companyId: u.companyId })
    return one(c, { result: record, provider: provider.name, live: provider.live })
  })

  app.get('/list', requirePermission('contacts:read'), (c) => {
    const u = c.get('user')
    return one(c, { submissions: SUBMISSIONS.filter((s) => s.companyId === u.companyId).slice(0, 50) })
  })

  return app
}
