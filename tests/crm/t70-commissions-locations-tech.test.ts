// Commissions, branches, the crew's phone view and parts on a job — new in the contractor CRM, and now ONE shared
// implementation for crm, crm-fieldservice, crm-landscaping and crm-basic. Every rule the shared copy added is
// asserted here against crm's real schema (migration 0041), its real permission matrix and its real wiring:
//
//   commissions  the server works the amount out from the plan; everything referenced is this company's; one
//                status order (paid is final); the expenses self-approval rule; names on the list; own-only below
//                commissions:read.
//   locations    a duplicate code is a 409 with words; the manager must be one of ours; edit; deactivate; back.
//   tech         own jobs only; forward only; jobs:update on every write; the template's job hooks run (a job
//                finished from the phone schedules its review request); the checklist saves against a form
//                template made once; the feature gate.
//   parts        a part recorded on a job comes back without its cost to a seat below margin:read.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S = await import('./db/schema.ts')
const { company, user, contact, job, invoice, reviewRequest, formTemplate, formSubmission, inventoryItem, inventoryLocation, stockLevel } = S as any

const FEATURES = ['contacts', 'jobs', 'invoices', 'team', 'commission_tracking', 'multi_location', 'tech_mobile_view', 'inventory', 'google_reviews']
const [co] = await db.insert(company).values({ name: 'Ridge Builders', slug: 'ridge-builders', email: 'o@ridge.test', settings: { reviewRequestEnabled: true, reviewRequestDelay: 24, googleReviewUrl: 'https://g.page/r/ridge' }, enabledFeatures: FEATURES } as any).returning()
const [other] = await db.insert(company).values({ name: 'Elsewhere', slug: 'elsewhere', email: 'e@else.test', settings: {}, enabledFeatures: FEATURES } as any).returning()
const mk = async (role: string, tag: string, companyId = co.id, extra: string[] = []) => (await db.insert(user).values({
  email: `${tag}@ridge.test`, passwordHash: 'x', firstName: tag[0].toUpperCase() + tag.slice(1), lastName: 'Test', role, companyId, isActive: true, extraPermissions: extra,
} as any).returning())[0]
const owner = await mk('owner', 'owner'), admin = await mk('admin', 'admin'), manager = await mk('manager', 'manager')
const field = await mk('field', 'field'), viewer = await mk('viewer', 'viewer')
// a manager who has been handed commissions:update — the case the self-approval rule is for
const lead = await mk('manager', 'lead', co.id, ['commissions:update', 'commissions:create'])
const stranger = await mk('owner', 'stranger', other.id)
const [cust] = await db.insert(contact).values({ name: "O'Brien & Sons", companyId: co.id, phone: '+15555550100', email: 'ob@cust.test' } as any).returning()

const { requireEnabledFeature } = await import('./src/middleware/enabledFeature.ts')
const { authenticate } = await import('./src/middleware/auth.ts')
const app = new Hono()
// gated exactly as index.ts gates them
for (const [p, f] of [['/api/locations', 'multi_location'], ['/api/commissions', 'commission_tracking'], ['/api/tech', 'tech_mobile_view'], ['/api/inventory', 'inventory']] as const) {
  app.use(p, authenticate, requireEnabledFeature(f)); app.use(`${p}/*`, authenticate, requireEnabledFeature(f))
}
app.route('/api/commissions', (await import('./src/routes/commissions.ts')).default)
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.route('/api/tech', (await import('./src/routes/tech.ts')).default)
app.route('/api/inventory', (await import('./src/routes/inventory.ts')).default)
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), A = as(admin), M = as(manager), F = as(field), V = as(viewer), L = as(lead), X = as(stranger)

// ─────────────────────────────── commissions ───────────────────────────────
{
  const bad = await O('POST', '/api/commissions/plans', { name: 'Greedy', planType: 'percent_of_invoice', percentRate: 500 })
  check(`plan: a 500% rate is refused with words (${bad.status})`, bad.status === 400 && /more than 100/.test(bad.json?.error), bad.json)
  const m = await M('POST', '/api/commissions/plans', { name: 'Mine', planType: 'flat_rate', flatRateAmount: 50 })
  check(`plan: a manager (commissions:read only) cannot create one (${m.status})`, m.status === 403)
}
const pct = (await O('POST', '/api/commissions/plans', { name: 'Sales 10%', planType: 'percent_of_invoice', percentRate: 10, appliesToRole: 'sales_rep' })).json
const flat = (await O('POST', '/api/commissions/plans', { name: 'Crew flat', planType: 'flat_rate', flatRateAmount: 75, appliesToRole: 'technician' })).json
const margin = (await O('POST', '/api/commissions/plans', { name: 'Margin 20%', planType: 'percent_of_margin', percentRate: 20 })).json
const [inv] = await db.insert(invoice).values({ number: 'INV-00001', status: 'sent', subtotal: '1000.00', discount: '100.00', taxRate: '8', taxAmount: '72.00', total: '972.00', contactId: cust.id, companyId: co.id } as any).returning()
const [draftInv] = await db.insert(invoice).values({ number: 'INV-00002', status: 'draft', subtotal: '500.00', total: '500.00', contactId: cust.id, companyId: co.id } as any).returning()
const [otherInv] = await db.insert(invoice).values({ number: 'INV-90001', status: 'sent', subtotal: '9000.00', total: '9000.00', companyId: other.id } as any).returning()
let rec: any
{
  const r = await O('POST', '/api/commissions', { userId: manager.id, planId: pct.id, invoiceId: inv.id })
  rec = r.json
  check(`record: 10% of the invoice BEFORE tax, after the discount = $90.00 (got ${r.json?.commissionAmount} on ${r.json?.baseAmount})`, r.status === 201 && Number(r.json?.baseAmount) === 900 && Number(r.json?.commissionAmount) === 90 && Number(r.json?.rateApplied) === 10, r.json)
  const sent = await O('POST', '/api/commissions', { userId: manager.id, planId: pct.id, invoiceId: inv.id, commissionAmount: 99999 })
  check('record: a commissionAmount sent beside a plan is ignored — the plan decides', sent.status === 201 && Number(sent.json?.commissionAmount) === 90, sent.json)
  const f = await O('POST', '/api/commissions', { userId: field.id, planId: flat.id })
  check(`record: a flat-rate plan pays its flat amount ($75.00 — got ${f.json?.commissionAmount})`, f.status === 201 && Number(f.json?.commissionAmount) === 75)
  const mg = await O('POST', '/api/commissions', { userId: field.id, planId: margin.id, invoiceId: inv.id })
  check(`record: a margin plan needs the margin, not the invoice (${mg.status})`, mg.status === 400 && /margin/i.test(mg.json?.error), mg.json)
  const mg2 = await O('POST', '/api/commissions', { userId: field.id, planId: margin.id, baseAmount: 400 })
  check(`record: …given it, 20% of $400 = $80.00 (${mg2.json?.commissionAmount})`, mg2.status === 201 && Number(mg2.json?.commissionAmount) === 80)
  const d = await O('POST', '/api/commissions', { userId: manager.id, planId: pct.id, invoiceId: draftInv.id })
  check(`record: nothing is earned on a draft invoice (${d.status})`, d.status === 400 && /draft/.test(d.json?.error), d.json)
  const oi = await O('POST', '/api/commissions', { userId: manager.id, planId: pct.id, invoiceId: otherInv.id })
  check(`record: another company's invoice is refused (${oi.status})`, oi.status === 400 && /not on this account/.test(oi.json?.error), oi.json)
  const ou = await O('POST', '/api/commissions', { userId: stranger.id, planId: flat.id })
  check(`record: another company's person is refused (${ou.status})`, ou.status === 400 && /not on this account/.test(ou.json?.error), ou.json)
  const np = await O('POST', '/api/commissions', { userId: field.id })
  check(`record: no plan and no amount is refused (${np.status})`, np.status === 400)
  const oneOff = await O('POST', '/api/commissions', { userId: field.id, commissionAmount: 42.5, notes: 'Referral bonus' })
  check(`record: no plan + an agreed amount is stored as given ($42.50 — ${oneOff.json?.commissionAmount})`, oneOff.status === 201 && Number(oneOff.json?.commissionAmount) === 42.5)
  const neg = await O('POST', '/api/commissions', { userId: field.id, commissionAmount: -10 })
  check(`record: a negative amount is refused (${neg.status})`, neg.status === 400)
  await O('DELETE', `/api/commissions/plans/${flat.id}`)
  const ret = await O('POST', '/api/commissions', { userId: field.id, planId: flat.id })
  check(`record: a retired plan is refused (${ret.status})`, ret.status === 400 && /retired/.test(ret.json?.error), ret.json)
  const back = await O('PUT', `/api/commissions/plans/${flat.id}`, { isActive: true })
  check('plan: PUT isActive:true brings a retired plan back (T58k shape)', back.status === 200 && back.json?.isActive === true, back.json)
}
{
  const { commissionFor } = await import('./src/shared/index.ts')
  const tiers = { planType: 'tiered', tiers: [{ min: 0, max: 9999.99, rate: 5 }, { min: 10000, max: 1e9, rate: 7 }] }
  const lo = commissionFor(tiers, 8000) as any, hi = commissionFor(tiers, 12000) as any, none = commissionFor({ planType: 'tiered', tiers: [{ min: 100, max: 200, rate: 5 }] }, 50) as any
  check(`tiered: the bracket the whole amount falls in — $8,000 → $400.00, $12,000 → $840.00 (${lo.amount}, ${hi.amount})`, lo.amount === 400 && hi.amount === 840)
  check('tiered: an amount outside every bracket earns nothing and says so', typeof none.error === 'string')
}
{
  const paidEarly = await O('POST', `/api/commissions/${rec.id}/mark-paid`)
  check(`order: a pending commission cannot be marked paid before it is approved (${paidEarly.status})`, paidEarly.status === 409 && paidEarly.json?.code === 'status_order', paidEarly.json)
  const ap = await O('POST', `/api/commissions/${rec.id}/approve`)
  check('order: approve → approved', ap.status === 200 && ap.json?.status === 'approved')
  const again = await O('POST', `/api/commissions/${rec.id}/approve`)
  check(`order: approving twice is refused (${again.status})`, again.status === 409)
  const pd = await O('POST', `/api/commissions/${rec.id}/mark-paid`)
  check('order: mark paid → paid, with paidAt', pd.status === 200 && pd.json?.status === 'paid' && !!pd.json?.paidAt)
  const reopen = await O('POST', `/api/commissions/${rec.id}/approve`)
  check(`order: paid is final — approving it again no longer reopens it (${reopen.status})`, reopen.status === 409 && /has been paid/.test(reopen.json?.error), reopen.json)
  const disp = await O('POST', `/api/commissions/${rec.id}/dispute`, { notes: 'x' })
  check(`order: …nor can a paid one be disputed (${disp.status})`, disp.status === 409)
  const [row] = await db.select().from(S.commission).where(eq(S.commission.id, rec.id))
  check('order: the row is still paid', row.status === 'paid')
}
{
  const mine = (await O('POST', '/api/commissions', { userId: lead.id, planId: pct.id, invoiceId: inv.id })).json
  const self = await L('POST', `/api/commissions/${mine.id}/approve`)
  check(`self: a manager holding commissions:update cannot approve their own (${self.status} ${self.json?.code})`, self.status === 403 && self.json?.code === 'self_approval', self.json)
  const ownAdmin = (await O('POST', '/api/commissions', { userId: admin.id, planId: pct.id, invoiceId: inv.id })).json
  const adminSelf = await A('POST', `/api/commissions/${ownAdmin.id}/approve`)
  check(`self: an admin may, exactly as expenses allow (${adminSelf.status})`, adminSelf.status === 200)
  const otherApprove = await L('POST', `/api/commissions/${ownAdmin.id}/dispute`, { notes: 'Wrong invoice' })
  check('self: disputing is not signing off — the lead may dispute the admin\'s', otherApprove.status === 200 && otherApprove.json?.status === 'disputed' && otherApprove.json?.notes === 'Wrong invoice')
  const reApprove = await O('POST', `/api/commissions/${ownAdmin.id}/approve`)
  check('order: a disputed commission is resolved by approving it again', reApprove.status === 200 && reApprove.json?.status === 'approved')
}
{
  const all = await O('GET', '/api/commissions')
  const names = new Set((all.json?.data || []).map((r: any) => r.userName))
  check(`list: the earner's NAME comes with each row (${[...names].join(', ')})`, names.has('Manager Test') && names.has('Field Test'), all.json?.data?.slice(0, 2))
  const own = await F('GET', '/api/commissions')
  check(`list: the field seat sees only their own (${own.json?.data?.length} rows, all theirs)`, own.status === 200 && own.json.data.length > 0 && own.json.data.every((r: any) => r.userId === field.id))
  const plansAsField = await F('GET', '/api/commissions/plans')
  check(`list: the pay structure is not an open read (${plansAsField.status})`, plansAsField.status === 403)
  const x = await X('GET', '/api/commissions')
  check('list: another company sees none of it', x.status === 200 && x.json?.data?.length === 0)
}

// ─────────────────────────────── locations ───────────────────────────────
let loc: any
{
  const c = await O('POST', '/api/locations', { name: 'Main office', code: 'main', city: 'Fort Worth', state: 'TX', managerUserId: manager.id })
  loc = c.json
  check(`locations: created, code upper-cased (${c.json?.code})`, c.status === 201 && c.json?.code === 'MAIN' && c.json?.managerUserId === manager.id, c.json)
  const dup = await O('POST', '/api/locations', { name: 'Second', code: 'MAIN' })
  check(`locations: a duplicate code is a 409 with words, not a 500 (${dup.status})`, dup.status === 409 && dup.json?.code === 'location_code_taken' && /already uses/.test(dup.json?.error), dup.json)
  const foreign = await O('POST', '/api/locations', { name: 'Third', code: 'THR', managerUserId: stranger.id })
  check(`locations: the manager must be one of our people (${foreign.status})`, foreign.status === 400, foreign.json)
  const other2 = await O('POST', '/api/locations', { name: 'North', code: 'NTH' })
  const clash = await O('PUT', `/api/locations/${other2.json.id}`, { code: 'MAIN' })
  check(`locations: editing to a taken code is the same 409 (${clash.status})`, clash.status === 409)
  const ed = await O('PUT', `/api/locations/${loc.id}`, { phone: '(817) 555-0100' })
  check('locations: edit saves, and leaves the time zone alone', ed.status === 200 && ed.json?.phone === '(817) 555-0100' && ed.json?.timezone === 'America/Chicago')
  const mgr = await M('POST', '/api/locations', { name: 'Mine', code: 'MGR' })
  check(`locations: a manager reads, does not create (${mgr.status})`, mgr.status === 403)
  const fr = await F('GET', '/api/locations')
  check('locations: any seat can read the branch list', fr.status === 200 && fr.json?.data?.length === 2)
  const off = await O('DELETE', `/api/locations/${loc.id}`)
  const on = await O('PUT', `/api/locations/${loc.id}`, { isActive: true })
  check('locations: deactivate, then bring back', off.status === 200 && off.json?.isActive === false && on.status === 200 && on.json?.isActive === true)
  const xr = await X('GET', `/api/locations/${loc.id}`)
  check(`locations: another company cannot read ours (${xr.status})`, xr.status === 404)
}

// ─────────────────────────────── tech ───────────────────────────────
const today = new Date(); today.setHours(9, 0, 0, 0)
const mkJob = async (n: string, assignedToId: string, status = 'scheduled') => (await db.insert(job).values({ number: n, title: `Deck ${n}`, status, companyId: co.id, contactId: cust.id, assignedToId, scheduledDate: today, address: '1 Main St', city: 'Fort Worth' } as any).returning())[0]
const j1 = await mkJob('JOB-00001', field.id)
const jConfirmed = await mkJob('JOB-00002', field.id, 'confirmed')
const jViewer = await mkJob('JOB-00003', viewer.id)
const jOthers = await mkJob('JOB-00004', manager.id)
{
  const mine = await F('GET', '/api/tech/my-jobs')
  check(`tech: my jobs are the field seat's own, with the customer (${mine.json?.length})`, mine.status === 200 && mine.json.length === 2 && mine.json.every((j: any) => j.assignedToId === field.id) && mine.json[0].contact?.name === "O'Brien & Sons", mine.json)
  const omw = await F('POST', `/api/tech/${j1.id}/on-my-way`)
  check('tech: on my way → dispatched', omw.status === 200 && omw.json?.status === 'dispatched')
  const twice = await F('POST', `/api/tech/${j1.id}/on-my-way`)
  check(`tech: on my way twice is refused (${twice.status})`, twice.status === 409 && twice.json?.code === 'status_order', twice.json)
  const site = await F('POST', `/api/tech/${j1.id}/on-site`)
  check('tech: on site → in progress', site.status === 200 && site.json?.status === 'in_progress')
  const done = await F('POST', `/api/tech/${j1.id}/complete-job`, { notes: 'Stained and sealed' })
  check('tech: complete → completed, stamped, with the note', done.status === 200 && done.json?.status === 'completed' && !!done.json?.completedAt && /Stained and sealed/.test(done.json?.internalNotes || ''))
  const back = await F('POST', `/api/tech/${j1.id}/on-my-way`)
  check(`tech: a finished job does not go back to "en route" (${back.status})`, back.status === 409, back.json)
  const [still] = await db.select().from(job).where(eq(job.id, j1.id))
  check('tech: …and kept its completion time', still.status === 'completed' && !!still.completedAt)
  // the job hook, run by the phone exactly as by the Jobs page: a review request is scheduled
  let req: any[] = []
  for (let i = 0; i < 40 && !req.length; i++) { req = await db.select().from(reviewRequest).where(eq(reviewRequest.jobId, j1.id)); if (!req.length) await new Promise((r) => setTimeout(r, 50)) }
  check('tech: finishing from the phone scheduled the review request (services/jobHooks.ts)', req.length === 1 && req[0].status === 'pending', req)
  const conf = await F('POST', `/api/tech/${jConfirmed.id}/on-site`)
  check('tech: a confirmed job can be started (it had no button before)', conf.status === 200 && conf.json?.status === 'in_progress')
  const vw = await V('POST', `/api/tech/${jViewer.id}/on-my-way`)
  check(`tech: a viewer assigned a job cannot move it — jobs:update (${vw.status})`, vw.status === 403, vw.json)
  const notMine = await F('POST', `/api/tech/${jOthers.id}/on-my-way`)
  check(`tech: somebody else's job is not found (${notMine.status})`, notMine.status === 404)
}
{
  const items = [{ id: 'cleanup', label: 'Debris removed', status: 'pass' }, { id: 'walkthrough', label: 'Walkthrough done', status: 'attention', notes: 'Customer away' }]
  const c1 = await F('POST', `/api/tech/${jConfirmed.id}/checklist`, { items, overallNotes: 'Fine' })
  check(`checklist: saves at all — it never could (${c1.status})`, c1.status === 201 && !!c1.json?.templateId, c1.json)
  const c2 = await F('POST', `/api/tech/${jConfirmed.id}/checklist`, { items })
  const tpls = await db.select().from(formTemplate).where(and(eq(formTemplate.companyId, co.id), eq(formTemplate.category, 'site_checklist')))
  check(`checklist: one form template per company, made once and reused (${tpls.length})`, c2.status === 201 && tpls.length === 1 && c2.json.templateId === tpls[0].id && tpls[0].name === 'Site checklist')
  const got = await F('GET', `/api/tech/${jConfirmed.id}/checklist`)
  check(`checklist: read back, newest first (${got.json?.length})`, got.status === 200 && got.json.length === 2 && got.json[0].values?.type === 'site_checklist')
  const peek = await M('GET', `/api/tech/${jConfirmed.id}/checklist`)
  check(`checklist: the read is scoped to the caller's own job like the write (${peek.status})`, peek.status === 404)
  const empty = await F('POST', `/api/tech/${jConfirmed.id}/checklist`, { items: [] })
  check(`checklist: an empty checklist is refused (${empty.status})`, empty.status === 400)
  const [sub] = await db.select().from(formSubmission).where(eq(formSubmission.id, c1.json.id))
  check('checklist: stored against the job and the person', sub.jobId === jConfirmed.id && sub.submittedById === field.id)
}
{
  // A company that never had it (the gate caches a company's list for 15 s, so toggling one mid-run would test the cache).
  const [offCo] = await db.insert(company).values({ name: 'No Field View', slug: 'no-field-view', email: 'n@nfv.test', settings: {}, enabledFeatures: FEATURES.filter((f) => f !== 'tech_mobile_view') } as any).returning()
  const offField = await mk('field', 'offfield', offCo.id)
  const off = await as(offField)('GET', '/api/tech/my-jobs')
  check(`gate: with tech_mobile_view off, /api/tech is refused on the server (${off.status})`, off.status === 403, off.json)
}

// ─────────────────────────────── parts on a job ───────────────────────────────
{
  const [item] = await db.insert(inventoryItem).values({ sku: 'DECK-SCREW', name: 'Deck screws (box)', companyId: co.id, unitCost: '12.00', unitPrice: '20.00' } as any).returning()
  const [wh] = await db.insert(inventoryLocation).values({ name: 'Shop', companyId: co.id } as any).returning()
  await db.insert(stockLevel).values({ itemId: item.id, locationId: wh.id, quantity: 10 } as any)
  const use = await M('POST', '/api/inventory/use', { jobId: jConfirmed.id, itemId: item.id, locationId: wh.id, quantity: 3 })
  check(`parts: a manager records 3 boxes on the job (${use.status})`, use.status === 200 || use.status === 201, use.json)
  const asField = await F('GET', `/api/inventory/job/${jConfirmed.id}`)
  const row = (Array.isArray(asField.json) ? asField.json : [])[0]
  check('parts: the field seat sees what was used and its retail price…', asField.status === 200 && row?.quantity === 3 && Number(row?.unitPrice) === 20 && row?.item?.name === 'Deck screws (box)', asField.json)
  check('parts: …but not what the company paid (no unitCost / totalCost below margin:read)', row && !('unitCost' in row) && !('totalCost' in row), row)
  const asOwner = await O('GET', `/api/inventory/job/${jConfirmed.id}`)
  check('parts: the owner sees the cost', Number(asOwner.json?.[0]?.unitCost) === 12 && Number(asOwner.json?.[0]?.totalCost) === 36, asOwner.json)
  const fieldUse = await F('POST', '/api/inventory/use', { jobId: jConfirmed.id, itemId: item.id, locationId: wh.id, quantity: 1 })
  check(`parts: recording stock is inventory:update — the field seat is refused (${fieldUse.status})`, fieldUse.status === 403)
  const ret = await M('POST', '/api/inventory/return', { usageId: row.id, returnQuantity: 1, locationId: wh.id })
  const [lvl] = await db.select().from(stockLevel).where(and(eq(stockLevel.itemId, item.id), eq(stockLevel.locationId, wh.id)))
  check(`parts: one box returned to stock (shelf ${lvl?.quantity}, was 7)`, (ret.status === 200 || ret.status === 201) && lvl?.quantity === 8, ret.json)
}

// ─────────────────────────────── wiring ───────────────────────────────
{
  const ROOT = (process.env.FACTORY_ROOT || '').replace(/\/?$/, '/')
  const { readFileSync } = await import('node:fs')
  const read = (p: string) => readFileSync(ROOT + p, 'utf8').replace(/\r\n/g, '\n')
  const jobsRoute = read('templates/crm/backend/src/routes/jobs.ts'), techRoute = read('templates/crm/backend/src/routes/tech.ts')
  check('wiring: the Jobs page and the phone run the SAME hooks file', /onComplete: jobHooks\.onComplete/.test(jobsRoute) && /hooks: jobHooks/.test(techRoute))
  const { FEATURE_MAP, getFeaturesForPlan } = await import('./src/shared/index.ts')
  for (const id of ['commission_tracking', 'multi_location', 'tech_mobile_view']) {
    check(`registry: crm offers ${id}`, FEATURE_MAP[id]?.templates?.includes('crm'))
  }
  const starter10 = getFeaturesForPlan('crm', 'starter10')
  check('registry: every crm signup plan includes all three', ['commission_tracking', 'multi_location', 'tech_mobile_view'].every((f) => starter10.includes(f)))
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
