// Automatic commissions, statements, and branches that mean something — on crm's real schema (migrations 0041 + 0042)
// and its real invoice routes. Money moves through POST /api/invoices/:id/payments and /refund exactly as the screen
// sends it; the commission is then looked for, not assumed.
//
//   earn      a plan set to pay the job's assignee / the job's booker pays when an invoice is paid IN FULL — not on a
//             part payment; once, however often it is looked at; never for an invoice paid before the plan went
//             automatic (imported history); never for an invoice that reaches no job, or a roster-only assignee
//   refund    a full refund cancels an unpaid earning, and books one reversal against a paid one
//   edit      an edit that lowers the total to what was paid stamps paidAt, so the sweep earns on it
//   margin    a margin plan cannot be automatic
//   statement one person, one period, totals; your own only below commissions:read
//   branches  job / person / stock location at a branch, refused across companies; jobs filter; revenue by branch with
//             one job per invoice; stock value by branch
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 400)) }
}
const until = async (fn: () => Promise<boolean>, ms = 2000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 40)) } return fn() }

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const S: any = await import('./db/schema.ts')

const FEATURES = ['contacts', 'jobs', 'quotes', 'invoices', 'team', 'commission_tracking', 'multi_location', 'inventory', 'reports']
const [co] = await db.insert(S.company).values({ name: 'Ridge Builders', slug: 'ridge2', email: 'o@ridge2.test', settings: {}, enabledFeatures: FEATURES } as any).returning()
const [other] = await db.insert(S.company).values({ name: 'Elsewhere', slug: 'else2', email: 'e@else2.test', settings: {}, enabledFeatures: FEATURES } as any).returning()
const mk = async (role: string, tag: string, companyId = co.id) => (await db.insert(S.user).values({ email: `${tag}@r2.test`, passwordHash: 'x', firstName: tag[0].toUpperCase() + tag.slice(1), lastName: 'R', role, companyId, isActive: true } as any).returning())[0]
const owner = await mk('owner', 'owner'), crew = await mk('field', 'crew'), seller = await mk('manager', 'seller'), stranger = await mk('owner', 'stranger', other.id)
const [cust] = await db.insert(S.contact).values({ name: 'Pat Client', companyId: co.id } as any).returning()
const [roster] = await db.insert(S.teamMember).values({ name: 'Roster Only', companyId: co.id } as any).returning()

const { requireEnabledFeature } = await import('./src/middleware/enabledFeature.ts')
const { authenticate } = await import('./src/middleware/auth.ts')
const app = new Hono()
for (const [p, f] of [['/api/locations', 'multi_location'], ['/api/commissions', 'commission_tracking'], ['/api/inventory', 'inventory']] as const) {
  app.use(p, authenticate, requireEnabledFeature(f)); app.use(`${p}/*`, authenticate, requireEnabledFeature(f))
}
app.route('/api/commissions', (await import('./src/routes/commissions.ts')).default)
app.route('/api/locations', (await import('./src/routes/locations.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/team', (await import('./src/routes/team.ts')).default)
app.route('/api/reports', (await import('./src/routes/reporting.ts')).default)
app.route('/api/inventory', (await import('./src/routes/inventory.ts')).default)
const earner = (await import('./src/services/commissionEarner.ts')).default
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': who.id }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const O = as(owner), C = as(crew), X = as(stranger), M = as(seller)

let n = 0
const deal = async (opts: { assignedToId?: string | null; memberId?: string; createdById?: string; noJob?: boolean; total?: number; locationId?: string | null } = {}) => {
  n++
  const [q] = await db.insert(S.quote).values({ number: `QTE-9${String(n).padStart(4, '0')}`, name: `Deck ${n}`, companyId: co.id, contactId: cust.id, status: 'approved', total: String(opts.total ?? 1080) } as any).returning()
  let j: any = null
  if (!opts.noJob) [j] = await db.insert(S.job).values({ number: `JOB-9${String(n).padStart(4, '0')}`, title: `Deck ${n}`, status: 'completed', companyId: co.id, contactId: cust.id, quoteId: q.id, assignedToId: opts.assignedToId === undefined ? crew.id : opts.assignedToId, assignedToMemberId: opts.memberId || null, createdById: opts.createdById ?? seller.id, locationId: opts.locationId ?? null } as any).returning()
  const total = opts.total ?? 1080
  const [inv] = await db.insert(S.invoice).values({ number: `INV-9${String(n).padStart(4, '0')}`, status: 'sent', subtotal: String(total / 1.08), discount: '0', taxRate: '8', taxAmount: String(total - total / 1.08), total: String(total), amountPaid: '0', contactId: cust.id, quoteId: q.id, companyId: co.id } as any).returning()
  return { q, j, inv }
}
const autosFor = async (invoiceId: string) => db.select().from(S.commission).where(and(eq(S.commission.invoiceId, invoiceId), eq(S.commission.source, 'auto')))

// an invoice paid LAST MONTH, before any plan went automatic — imported history
const old = await deal()
await db.update(S.invoice).set({ status: 'paid', amountPaid: '1080', paidAt: new Date(Date.now() - 30 * 86400000) } as any).where(eq(S.invoice.id, old.inv.id))

// ─────────────── plans ───────────────
const crewPlan = (await O('POST', '/api/commissions/plans', { name: 'Crew 5%', planType: 'percent_of_invoice', percentRate: 5, appliesToRole: 'technician', autoEarn: 'job_assignee' })).json
const salesPlan = (await O('POST', '/api/commissions/plans', { name: 'Sales flat', planType: 'flat_rate', flatRateAmount: 150, appliesToRole: 'sales_rep', autoEarn: 'job_creator' })).json
check('plan: an automatic plan is stamped with when it went automatic', crewPlan?.autoEarn === 'job_assignee' && !!crewPlan?.autoSince && salesPlan?.autoEarn === 'job_creator', crewPlan)
{
  const m = await O('POST', '/api/commissions/plans', { name: 'Margin auto', planType: 'percent_of_margin', percentRate: 20, autoEarn: 'job_assignee' })
  check(`plan: a margin plan cannot be automatic (${m.status})`, m.status === 400 && m.json?.code === 'margin_not_automatic', m.json)
  const manual = (await O('POST', '/api/commissions/plans', { name: 'Toggle', planType: 'flat_rate', flatRateAmount: 1 })).json
  const on = await O('PUT', `/api/commissions/plans/${manual.id}`, { autoEarn: 'job_assignee' })
  const off = await O('PUT', `/api/commissions/plans/${manual.id}`, { autoEarn: 'none' })
  check('plan: switching automatic on stamps autoSince, switching it off clears it', !!on.json?.autoSince && off.json?.autoSince === null && off.json?.autoEarn === 'none')
  await O('DELETE', `/api/commissions/plans/${manual.id}`)
}

// ─────────────── earn ───────────────
const a = await deal()
{
  const part = await O('POST', `/api/invoices/${a.inv.id}/payments`, { amount: 500, method: 'cash' })
  await new Promise((r) => setTimeout(r, 200))
  check(`earn: a part payment earns nothing (${part.status})`, part.status === 201 && (await autosFor(a.inv.id)).length === 0)
  const rest = await O('POST', `/api/invoices/${a.inv.id}/payments`, { amount: 580, method: 'cash' })
  const earned = await until(async () => (await autosFor(a.inv.id)).length === 2)
  const rows = await autosFor(a.inv.id)
  const crewRow = rows.find((r: any) => r.userId === crew.id), salesRow = rows.find((r: any) => r.userId === seller.id)
  check(`earn: paid in full → the crew earns 5% of $1,000.00 before tax ($50.00) and the seller $150.00, straight away (${rest.status})`, earned && Number(crewRow?.commissionAmount) === 50 && Number(crewRow?.baseAmount) === 1000 && Number(salesRow?.commissionAmount) === 150 && crewRow?.jobId === a.j.id, rows)
  check('earn: …stamped with when the invoice was paid, pending approval, marked automatic', crewRow?.status === 'pending' && crewRow?.source === 'auto' && !!crewRow?.earnedAt)
  const again = await earner.earnForInvoice(a.inv.id)
  const swept = await earner.sweep()
  check(`earn: looked at again — by hand and by the sweep — it still earned once (${(await autosFor(a.inv.id)).length} rows, ${again.earned} + ${swept.earned} new)`, (await autosFor(a.inv.id)).length === 2 && again.earned === 0)
  check('earn: imported history paid before the plan went automatic earns nothing', (await autosFor(old.inv.id)).length === 0)
}
{
  const nj = await deal({ noJob: true })
  await O('POST', `/api/invoices/${nj.inv.id}/payments`, { amount: 1080, method: 'cash' })
  const rm = await deal({ assignedToId: null, memberId: roster.id })
  await O('POST', `/api/invoices/${rm.inv.id}/payments`, { amount: 1080, method: 'cash' })
  await earner.sweep()
  const rmRows = await autosFor(rm.inv.id)
  check('earn: an invoice that reaches no job pays nobody', (await autosFor(nj.inv.id)).length === 0)
  check('earn: a roster-only assignee (no login) is skipped; the booker is still paid', rmRows.length === 1 && rmRows[0].userId === seller.id, rmRows)
}
{
  // the sweep catches a door that has no hook: bulk / boot repair / a raw status write
  const b = await deal()
  await db.update(S.invoice).set({ status: 'paid', amountPaid: '1080', paidAt: new Date() } as any).where(eq(S.invoice.id, b.inv.id))
  const r = await earner.sweep()
  check(`earn: an invoice paid through a door with no hook is caught by the sweep (${r.earned} earned)`, (await autosFor(b.inv.id)).length === 2)
}
{
  // edit lowering the total to what was paid: paid AND paidAt stamped
  const e = await deal({ total: 1080 })
  await O('POST', `/api/invoices/${e.inv.id}/payments`, { amount: 540, method: 'cash' })
  const ed = await O('PUT', `/api/invoices/${e.inv.id}`, { lineItems: [{ description: 'Deck, smaller', quantity: 1, unitPrice: 500 }], taxRate: 8, discount: 0 })
  check(`edit: lowered to what was paid → paid, with paidAt (${ed.status} ${ed.json?.status})`, ed.status === 200 && ed.json?.status === 'paid' && !!ed.json?.paidAt, ed.json)
  await earner.sweep()
  const er = await autosFor(e.inv.id)
  check(`edit: …and the sweep earns on it (crew 5% of $500.00 = $25.00 — ${er.find((x: any) => x.userId === crew.id)?.commissionAmount})`, Number(er.find((x: any) => x.userId === crew.id)?.commissionAmount) === 25, er)
}

// ─────────────── refund ───────────────
{
  const rows = await autosFor(a.inv.id)
  const salesRow = rows.find((r: any) => r.userId === seller.id), crewRow = rows.find((r: any) => r.userId === crew.id)
  await O('POST', `/api/commissions/${salesRow.id}/approve`); await O('POST', `/api/commissions/${salesRow.id}/mark-paid`)
  const ref = await O('POST', `/api/invoices/${a.inv.id}/refund`, { amount: 1080, method: 'cash', reason: 'Job cancelled' })
  const settled = await until(async () => {
    const all = await db.select().from(S.commission).where(eq(S.commission.invoiceId, a.inv.id))
    return all.some((x: any) => x.source === 'reversal') && all.find((x: any) => x.id === crewRow.id)?.status === 'cancelled'
  })
  const all = await db.select().from(S.commission).where(eq(S.commission.invoiceId, a.inv.id))
  const rev = all.filter((x: any) => x.source === 'reversal')
  check(`refund: refunded in full (${ref.status}) → the unpaid crew earning is cancelled`, settled && all.find((x: any) => x.id === crewRow.id)?.status === 'cancelled', all)
  check(`refund: …and the paid sales earning gets ONE reversal of −$150.00 (${rev.map((r: any) => r.commissionAmount)})`, rev.length === 1 && Number(rev[0].commissionAmount) === -150 && rev[0].reversalOf === salesRow.id && rev[0].userId === seller.id)
  check('refund: the paid row itself is untouched — money that went out is corrected by a new record', all.find((x: any) => x.id === salesRow.id)?.status === 'paid')
  await earner.sweep(); await earner.earnForInvoice(a.inv.id)
  const after = await db.select().from(S.commission).where(and(eq(S.commission.invoiceId, a.inv.id), eq(S.commission.source, 'reversal')))
  check('refund: swept again, still one reversal', after.length === 1)
}

// ─────────────── statement ───────────────
{
  const today = new Date().toLocaleDateString('en-CA')
  const st = await O('GET', `/api/commissions/statement?userId=${seller.id}&from=2020-01-01&to=${today}`)
  const sum = (st.json?.lines || []).reduce((s: number, l: any) => s + Number(l.commissionAmount), 0)
  check(`statement: the seller's lines and totals add up (lines ${st.json?.lines?.length}, paid ${st.json?.totals?.paid}, owed ${st.json?.totals?.owed})`, st.status === 200 && st.json.person?.name === 'Seller R' && Math.abs(sum - (st.json.totals.paid + st.json.totals.pending + st.json.totals.approved + st.json.totals.disputed)) < 0.005, st.json?.totals)
  const mine = await C('GET', '/api/commissions/statement')
  check('statement: the crew member gets their own without asking for it', mine.status === 200 && mine.json?.person?.id === crew.id)
  const theirs = await C('GET', `/api/commissions/statement?userId=${seller.id}`)
  check(`statement: …but not somebody else's (${theirs.status})`, theirs.status === 403)
  const bad = await O('GET', '/api/commissions/statement?from=yesterday')
  check(`statement: a bad date is a 400 (${bad.status})`, bad.status === 400)
  const cancelledShown = (st.json?.lines || []).some((l: any) => l.status === 'cancelled')
  check('statement: cancelled earnings are left off', !cancelledShown)
}

// ─────────────── branches ───────────────
const north = (await O('POST', '/api/locations', { name: 'North', code: 'NTH' })).json
const south = (await O('POST', '/api/locations', { name: 'South', code: 'STH' })).json
const theirBranch = (await X('POST', '/api/locations', { name: 'Theirs', code: 'THR' })).json
{
  const j = await O('POST', '/api/jobs', { title: 'Porch at North', locationId: north.id })
  check(`jobs: a job is put at a branch, and comes back naming it (${j.status})`, j.status === 201 && j.json?.locationId === north.id, j.json)
  const got = await O('GET', `/api/jobs/${j.json.id}`)
  check('jobs: the job reads back with its branch', got.json?.location?.name === 'North' && got.json?.location?.code === 'NTH', got.json?.location)
  const foreign = await O('POST', '/api/jobs', { title: 'Wrong', locationId: theirBranch.id })
  check(`jobs: another company's branch is refused (${foreign.status})`, foreign.status === 400 && /not one of your branches/.test(foreign.json?.error), foreign.json)
  await O('POST', '/api/jobs', { title: 'Porch at South', locationId: south.id })
  const list = await O('GET', `/api/jobs?locationId=${north.id}`)
  check(`jobs: the list filters by branch (${list.json?.data?.length})`, list.json?.data?.length === 1 && list.json.data[0].title === 'Porch at North')
  const cleared = await O('PUT', `/api/jobs/${j.json.id}`, { locationId: '' })
  check('jobs: clearing the branch clears it', cleared.status === 200 && cleared.json?.locationId === null, cleared.json)
}
{
  const t = await O('POST', '/api/team', { name: 'Sam Carpenter', locationId: south.id })
  check(`team: a person is put at a branch (${t.status})`, t.status === 201 && t.json?.locationId === south.id, t.json)
  const bad = await O('PUT', `/api/team/${t.json.id}`, { locationId: theirBranch.id })
  check(`team: …never at another company's (${bad.status})`, bad.status === 400)
  const clr = await O('PUT', `/api/team/${t.json.id}`, { locationId: null })
  check('team: and can be taken off it', clr.status === 200 && clr.json?.locationId === null, clr.json)
}
{
  // revenue by branch: two paid invoices at North (one whose quote became TWO jobs), one at South, one with no job
  const n1 = await deal({ locationId: north.id, total: 1080 })
  await db.insert(S.job).values({ number: 'JOB-DUP', title: 'Second job off the same quote', status: 'scheduled', companyId: co.id, quoteId: n1.q.id, locationId: south.id } as any)
  const s1 = await deal({ locationId: south.id, total: 540 })
  for (const d of [n1, s1]) await O('POST', `/api/invoices/${d.inv.id}/payments`, { amount: Number(d.inv.total), method: 'cash' })
  const r = await O('GET', '/api/reports/revenue/locations')
  const row = (name: string) => (r.json || []).find((x: any) => (x.location?.name || 'No branch') === name)
  check(`reports: revenue by branch — North $1,080.00 collected, counted once though its quote became two jobs (${row('North')?.collected})`, r.status === 200 && row('North')?.collected === 1080 && row('North')?.invoiceCount === 1, r.json)
  check(`reports: South $540.00 (${row('South')?.collected})`, row('South')?.collected === 540)
  const totalInvoiced = (r.json || []).reduce((s: number, x: any) => s + x.invoiced, 0)
  const [{ all }] = (await db.execute(`SELECT coalesce(sum(total::numeric),0)::float AS all FROM invoice WHERE company_id = '${co.id}' AND status NOT IN ('draft','void')`) as any).rows ?? (await db.execute(`SELECT 1`) as any)
  check(`reports: the rows add up to everything invoiced, "No branch" included (${totalInvoiced} vs ${all})`, Math.abs(totalInvoiced - Number(all)) < 0.01)
  const asCrew = await C('GET', '/api/reports/revenue/locations')
  check(`reports: reports:read, like every report (${asCrew.status})`, asCrew.status === 403)
}
{
  const wh = await O('POST', '/api/inventory/locations', { name: 'North yard', type: 'warehouse', branchId: north.id })
  check(`inventory: a stock location belongs to a branch (${wh.status})`, wh.status === 201 && wh.json?.branchId === north.id, wh.json)
  const bad = await O('POST', '/api/inventory/locations', { name: 'Theirs', branchId: theirBranch.id })
  check(`inventory: …never another company's (${bad.status})`, bad.status === 400)
  const truck = (await O('POST', '/api/inventory/locations', { name: 'Truck 2', type: 'truck' })).json
  const moved = await O('PUT', `/api/inventory/locations/${truck.id}`, { branchId: south.id, name: 'Truck 2 (South)' })
  check('inventory: a location can be edited — renamed and moved to a branch', moved.status === 200 && moved.json?.branchId === south.id && moved.json?.name === 'Truck 2 (South)', moved.json)
  const crewEdit = await C('PUT', `/api/inventory/locations/${truck.id}`, { name: 'x' })
  check(`inventory: editing a location is inventory:update (${crewEdit.status})`, crewEdit.status === 403)
  const [item] = await db.insert(S.inventoryItem).values({ sku: 'B-1', name: 'Boards', companyId: co.id, unitCost: '10', unitPrice: '15' } as any).returning()
  await db.insert(S.stockLevel).values([{ itemId: item.id, locationId: wh.json.id, quantity: 10 }, { itemId: item.id, locationId: truck.id, quantity: 4 }] as any)
  const list = await O('GET', '/api/inventory/locations')
  check('inventory: each location names its branch', (list.json || []).find((l: any) => l.id === wh.json.id)?.branch?.name === 'North')
  const val = await O('GET', '/api/inventory/reports/value')
  const vb = (name: string) => (val.json?.byBranch || []).find((b: any) => b.branch?.name === name)
  check(`inventory: stock value by branch — North $100.00 cost, South $40.00 (${vb('North')?.cost}, ${vb('South')?.cost})`, vb('North')?.cost === 100 && vb('South')?.cost === 40, val.json?.byBranch)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
