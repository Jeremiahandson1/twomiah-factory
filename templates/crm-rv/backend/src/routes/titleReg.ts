import { Hono } from 'hono'
import { and, eq } from 'drizzle-orm'
import { db } from '../../db/index.ts'
import { salesLead, contact, unit } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'

// ── Title & Registration ────────────────────────────────────────────────────
// Provider-agnostic DMV title/registration. Mock today (workflow built + demoable);
// swap to vituProvider (Vitu National API, 50-state) when the integration closes —
// UI/workflow unchanged. You never build 50 state DMVs; you integrate one rail.
const app = new Hono()
app.use('*', authenticate)

interface TitleProvider { name: string; live: boolean; submit(deal: any): Promise<any> }
// No DMV title/registration rail is connected, so we do NOT fabricate a "submitted"
// filing (fake ref number / made-up fees / ETA). Return honest not_submitted with the
// real required-document checklist; swap in vituProvider (Vitu National, 50-state) when live.
const notConfiguredProvider: TitleProvider = {
  name: 'not_configured', live: false,
  async submit(d) {
    const state = String(d.state || 'WI').toUpperCase()
    return {
      status: 'not_submitted', refNumber: null, state,
      checklist: ['Signed title / MSO', 'Bill of sale', 'Proof of insurance', 'Odometer / HIN disclosure', 'Buyer ID'],
      reason: 'Title & registration is not connected. Connect a DMV rail (e.g. Vitu) to submit.',
    }
  },
}
const provider: TitleProvider = notConfiguredProvider

// Title & registration is filed for a SOLD deal, from the deal's own buyer and unit; the title & reg fee is the one
// desked on the deal (#178), not a made-up figure. (RV T19 L1: "Not_submitted" showed a green tick with $0.00 fees
// while Desking had $250, and a lead that wasn't won could be submitted)
const SUBMISSIONS: any[] = []
app.post('/submit', requirePermission('contacts:update'), async (c) => {
  const user = c.get('user') as any
  const body = await c.req.json().catch(() => ({} as any))
  const leadId = typeof body?.leadId === 'string' ? body.leadId : ''
  if (!leadId) return c.json({ error: 'Pick the deal to title and register.' }, 400)
  const [row] = await db.select({ lead: salesLead, buyer: contact.name, year: unit.year, make: unit.make, model: unit.modelName, vin: unit.vin })
    .from(salesLead)
    .leftJoin(contact, eq(salesLead.contactId, contact.id))
    .leftJoin(unit, eq(salesLead.unitId, unit.id))
    .where(and(eq(salesLead.id, leadId), eq(salesLead.companyId, user.companyId)))
    .limit(1)
  if (!row) return c.json({ error: 'Deal not found.' }, 404)
  if (row.lead.stage !== 'closed_won') return c.json({ error: 'Title & registration is filed for a sold deal — mark the deal Sold first.' }, 409)
  if (!row.lead.unitId) return c.json({ error: 'This deal has no unit to title.' }, 409)

  const deal = (row.lead.deal || null) as any
  const fees = deal && Number.isFinite(Number(deal.titleReg)) ? { titleReg: Number(deal.titleReg), fromDesk: true } : { titleReg: null, fromDesk: false }
  let result: any
  try {
    result = await provider.submit({ state: body.state, buyer: { name: row.buyer }, unit: { year: row.year, make: row.make, model: row.model, vin: row.vin } })
  } catch (e: any) { return c.json({ error: 'DMV submit failed: ' + (e?.message || e) }, 502) }
  const record = { ...result, leadId, fees }
  SUBMISSIONS.unshift({ ...record, companyId: user.companyId })
  return c.json({ result: record, provider: provider.name, live: provider.live })
})
app.get('/list', requirePermission('contacts:read'), (c) => {
  const user = c.get('user') as any
  return c.json({ submissions: SUBMISSIONS.filter((s) => s.companyId === user.companyId).slice(0, 50) })
})

export default app
