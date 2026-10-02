// T32 H1 — every write was checked against the permission matrix and every READ was not.
//
// The report signed in as `field` and as `viewer` and read, with a 200 each time: accounts payable
// and the AP outstanding total, purchase orders, bids, change orders, the pricebook's cost and
// margin, selections, takeoffs, equipment, /api/payroll/summary (the owner's own hours and pay) and
// the dashboard's quote pipeline ($26,865.96, approved $24,139.89). The writes on every one of those
// modules answered 403 correctly. Authentication was being asked; authorisation was not.
//
// This asserts the whole matrix on one axis, because the fault was never one endpoint — it was that
// nothing asked. A table of roles against reads is the only shape that catches the next one.
//
// Three decisions are asserted here rather than left implicit, and each is a judgement somebody can
// reverse by changing one line:
//
//   · PRICEBOOK stays READABLE by everyone, and only `cost` and `margin` are withheld. In
//     crm-fieldservice this module is the technician's flat-rate book and is how they price a job on
//     site — refusing it would stop the work. The price is theirs; what the company pays is not.
//   · EQUIPMENT stays readable by everyone. It is customer-asset tracking with no money on the
//     record, and a technician servicing a customer's unit needs it.
//   · THE TEAM ROSTER stays readable by viewer, but `hourlyRate` does not. `team:read` answers "may
//     you see who works here", which is not the same question as "may you see what they earn".
import { Hono } from 'hono'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const {
  company, user, contact, project, job, teamMember, vendorBill, pricebookCategory, pricebookItem,
  changeOrder,
  equipment,
} = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Matrix Co', slug: 'matrix-co', email: 'm@test.local', state: 'OH', settings: {},
  // Everything these endpoints gate on must be ON, or a 403 could be the feature switch rather than
  // the permission and the test would prove nothing.
  enabledFeatures: [
    'vendor_bills', 'purchase_orders', 'bid_management', 'change_orders', 'selections',
    'takeoff_tools', 'pricebook', 'flat_rate_pricebook', 'equipment_tracking', 'time_tracking',
    'projects', 'reports', 'job_costing',
    // T34: these three gate reads now, so their switches must be ON or a 403 could be the feature.
    'aia_forms', 'draw_schedules', 'lien_waivers',
  ],
} as any).returning()

const mk = async (role: string, tag: string, extra: Record<string, unknown> = {}) => (await db.insert(user).values({
  email: `${tag}@matrix.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true, ...extra,
} as any).returning())[0]
const owner = await mk('owner', 'owner')
const admin = await mk('admin', 'admin')
const manager = await mk('manager', 'manager')
const field = await mk('field', 'field', { hourlyRate: '31.00' })
const viewer = await mk('viewer', 'viewer')
const ROLES = { owner, admin, manager, field, viewer }

// ── enough data that a 200 is a real answer and not an empty list ────────────────────────────────
const [client] = await db.insert(contact).values({ companyId: co.id, name: 'Matrix Client', type: 'customer' } as any).returning()
const [vendorCo] = await db.insert(contact).values({ companyId: co.id, name: 'Matrix Vendor', type: 'vendor' } as any).returning()
const [proj] = await db.insert(project).values({ companyId: co.id, contactId: client.id, name: 'Matrix Site', number: 'PRJ-MX-1', status: 'active' } as any).returning()
await db.insert(job).values({ companyId: co.id, contactId: client.id, projectId: proj.id, number: 'JOB-MX-1', title: 'Work', status: 'scheduled' } as any)
await db.insert(vendorBill).values({ companyId: co.id, vendorId: vendorCo.id, number: 'MX-1', amount: '750.25', amountPaid: '0', status: 'open', billDate: new Date() } as any)
await db.insert(teamMember).values({ companyId: co.id, name: 'Rosa Teale', email: 'rosa@matrix.local', role: 'Lead', hourlyRate: '75.00', active: true } as any)
const [cat] = await db.insert(pricebookCategory).values({ companyId: co.id, name: 'Carpentry', sortOrder: 1, active: true } as any).returning()
await db.insert(pricebookItem).values({
  companyId: co.id, categoryId: cat.id, name: 'Hang a door', code: 'SVC-0001',
  price: '400.00', cost: '140.00', unit: 'each', type: 'service', taxable: true, active: true, showToCustomer: true,
} as any)
const [rig] = await db.insert(equipment).values({ companyId: co.id, name: 'Compressor', status: 'active' } as any).returning()

const app = new Hono()
for (const [path, mod] of [
  ['/api/bills', './src/routes/bills.ts'],
  ['/api/purchase-orders', './src/routes/purchaseOrders.ts'],
  ['/api/bids', './src/routes/bids.ts'],
  ['/api/change-orders', './src/routes/changeOrders.ts'],
  ['/api/selections', './src/routes/selections.ts'],
  ['/api/takeoffs', './src/routes/takeoffs.ts'],
  ['/api/payroll', './src/routes/payroll.ts'],
  ['/api/pricebook', './src/routes/pricebook.ts'],
  ['/api/team', './src/routes/team.ts'],
  ['/api/dashboard', './src/routes/dashboard.ts'],
  ['/api/equipment', './src/routes/equipment.ts'],
  ['/api/aia-forms', './src/routes/aiaForms.ts'],
  ['/api/draw-schedules', './src/routes/drawSchedules.ts'],
  ['/api/lien-waivers', './src/routes/lienWaivers.ts'],
  ['/api/projects', './src/routes/projects.ts'],
] as Array<[string, string]>) {
  app.route(path, (await import(mod)).default)
}
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = async (who: any, path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': who.id } })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json, text }
}

/**
 * One read, five roles, the expected status for each. `403` is the whole point: a read nobody checked
 * answered 200 for all five.
 */
type Expect = Record<keyof typeof ROLES, number>
const ALLOWED_TO_STAFF: Expect = { owner: 200, admin: 200, manager: 200, field: 200, viewer: 200 }
const MANAGER_UP: Expect = { owner: 200, admin: 200, manager: 200, field: 403, viewer: 403 }
/** bids and change-orders are in viewer's matrix (`bids:read`, `change-orders:read`) — field's they are not. */
const MANAGER_UP_PLUS_VIEWER: Expect = { owner: 200, admin: 200, manager: 200, field: 403, viewer: 200 }

const PERIOD = '?startDate=2026-09-01&endDate=2026-09-30'
const TABLE: Array<[string, Expect, string]> = [
  ['/api/bills', MANAGER_UP, 'accounts payable — what the company owes'],
  ['/api/bills/summary', MANAGER_UP, 'the AP outstanding total'],
  ['/api/purchase-orders', MANAGER_UP, 'committed spend'],
  ['/api/purchase-orders/summary', MANAGER_UP, 'committed-spend totals'],
  ['/api/bids', MANAGER_UP_PLUS_VIEWER, 'what the company bid'],
  ['/api/bids/stats', MANAGER_UP_PLUS_VIEWER, 'won value'],
  ['/api/change-orders', MANAGER_UP_PLUS_VIEWER, 'contract value changes'],
  ['/api/selections/categories', MANAGER_UP, 'selections'],
  [`/api/selections/project/${proj.id}/summary`, MANAGER_UP, 'selection allowances and overruns'],
  ['/api/takeoffs/assemblies', MANAGER_UP, 'takeoff assemblies'],
  [`/api/payroll/summary${PERIOD}`, MANAGER_UP, "the pay run — everyone's hours and pay"],
  ['/api/pricebook/export', MANAGER_UP, 'a full price AND cost dump of the book'],
  /*
   * T34 · three modules whose WRITES were gated and whose READS were not.
   *
   * create/update/delete have always required `aia-forms:*`, `draw-schedules:*` and
   * `lien-waivers:*` — owner, admin and manager only. The GETs required nothing but a session, so a
   * field user or a viewer could read every pay application, payment plan and subcontractor waiver
   * on the job. Empty on the tester's tenant, so nothing leaked that day; on a live job these are
   * the billing position with the owner and what each sub has been paid.
   */
  ['/api/aia-forms', MANAGER_UP, 'AIA pay applications — the billing position with the owner'],
  ['/api/draw-schedules', MANAGER_UP, 'the payment plan on the contract'],
  ['/api/lien-waivers', MANAGER_UP, 'what each subcontractor was paid'],
  // …and the two that stay open on purpose.
  ['/api/pricebook/items', ALLOWED_TO_STAFF, 'the price list a technician works from'],
  ['/api/equipment', ALLOWED_TO_STAFF, "the customer's equipment"],
]

console.log('\n══════════ every money read, against the matrix ══════════')
for (const [path, expect, what] of TABLE) {
  const got: Record<string, number> = {}
  for (const [name, who] of Object.entries(ROLES)) got[name] = (await as(who, path)).status
  const ok = Object.entries(expect).every(([r, s]) => got[r] === s)
  check(`GET ${path} — ${what}`, ok, { expected: expect, got })
}

// ══════════ the pricebook: the price is theirs, the cost is not ════════════════════════════════
console.log('\n══════════ pricebook — price open, cost withheld ══════════')
{
  for (const name of ['owner', 'admin', 'manager'] as const) {
    const r = await as(ROLES[name], '/api/pricebook/items')
    const item = r.json?.data?.[0]
    check(`${name} sees the cost and the margin`, Number(item?.cost) === 140 && item?.margin !== undefined,
      { cost: item?.cost, totalCost: item?.totalCost, margin: item?.margin })
  }
  for (const name of ['field', 'viewer'] as const) {
    const r = await as(ROLES[name], '/api/pricebook/items')
    const item = r.json?.data?.[0]
    check(`${name} still gets the item and its PRICE`, r.status === 200 && Number(item?.price) === 400,
      { status: r.status, price: item?.price })
    check(`…but no cost, totalCost or margin anywhere in the body`,
      !('cost' in (item || {})) && !('totalCost' in (item || {})) && !('margin' in (item || {})) && !/"cost"|"margin"/.test(r.text),
      { keys: Object.keys(item || {}).filter((k) => /cost|margin/i.test(k)) })
  }
}

// ══════════ the roster: who works here, not what they earn ═════════════════════════════════════
console.log('\n══════════ team — the roster is not the payroll ══════════')
{
  const rate = (body: any) => (body?.data || []).map((r: any) => r.hourlyRate).filter((v: any) => v !== undefined && v !== null)
  for (const name of ['admin', 'manager'] as const) {
    const r = await as(ROLES[name], '/api/team')
    check(`${name} sees pay rates on the roster`, r.status === 200 && rate(r.json).length > 0, { status: r.status, rates: rate(r.json) })
  }
  const v = await as(viewer, '/api/team')
  check('viewer still sees the roster (team:read is in their matrix)', v.status === 200, { status: v.status })
  check('…but not one hourly rate, and not the key either',
    rate(v.json).length === 0 && !/hourlyRate/.test(v.text), { rates: rate(v.json), hasKey: /hourlyRate/.test(v.text) })
  const f = await as(field, '/api/team')
  check('field has no team:read at all', f.status === 403, { status: f.status })
}

// ══════════ the dashboard: counts for everyone, money for the entitled ═════════════════════════
console.log('\n══════════ dashboard — the quote pipeline was handed to everyone ══════════')
{
  for (const name of ['owner', 'admin', 'manager', 'viewer'] as const) {
    const r = await as(ROLES[name], '/api/dashboard/stats')
    check(`${name} sees the quote pipeline value`, r.status === 200 && r.json?.quotes?.totalValue !== undefined,
      { status: r.status, quotes: r.json?.quotes })
  }
  const f = await as(field, '/api/dashboard/stats')
  check('field still gets the dashboard', f.status === 200, { status: f.status })
  check('…with the quote COUNTS, which are the work', typeof f.json?.quotes?.total === 'number', f.json?.quotes)
  check('…and no pipeline value, no approved value', f.json?.quotes?.totalValue === undefined && f.json?.quotes?.approvedValue === undefined, f.json?.quotes)
  check('…and no invoice money', f.json?.invoices === undefined, f.json?.invoices)
  check('…the keys are ABSENT, not zero — a $0.00 tile is a wrong figure, not a hidden one',
    !('totalValue' in (f.json?.quotes || {})), Object.keys(f.json?.quotes || {}))
}

// ══════════ a tenant boundary that was not there at all ════════════════════════════════════════
console.log('\n══════════ equipment service history crossed tenants ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Other Co', slug: 'other-matrix', email: 'o@test.local', state: 'OH', settings: {},
    enabledFeatures: ['equipment_tracking'],
  } as any).returning()
  const [theirs] = await db.insert(equipment).values({ companyId: other.id, name: 'Their Lift', status: 'active' } as any).returning()

  const mine = await as(owner, `/api/equipment/${rig.id}/history`)
  check('my own equipment history answers', mine.status === 200, { status: mine.status })
  const stolen = await as(owner, `/api/equipment/${theirs.id}/history`)
  check("another tenant's equipment history is NOT readable by id", stolen.status === 404, { status: stolen.status, body: stolen.text?.slice(0, 160) })

  const res = await app.request(`/api/equipment/${theirs.id}/history`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: JSON.stringify({ type: 'service', description: 'should not land', cost: 99 }),
  })
  check("…and a service record cannot be written onto it either", res.status === 404, { status: res.status })
  const after: any = await db.execute((await import('drizzle-orm')).sql`SELECT COUNT(*)::int AS n FROM equipment_maintenance WHERE equipment_id = ${theirs.id}`)
  check('…nothing was written', Number((after.rows || after)[0]?.n) === 0, (after.rows || after)[0])
}

// ══════════ T34 · a project is readable; what it is WORTH is not ═════════════════════════════════
//
// The report: "Field still sees project money — the project page shows Budget $40,000, approved
// change orders +$3,327 and Contract value $48,450."
//
// `projects:read` is the permission a technician needs to open the job they are standing on, and it
// was the only thing between them and the contract. So this is NOT a 403: a field user must still
// read the project. The money comes out of it.
//
// `invoices:read` is the line that already existed for exactly this question — owner, admin,
// manager and viewer hold it, field does not.
console.log('\n══════════ project money — the project opens, the figures do not ══════════')
{
  // Real figures, so "absent" cannot be confused with "zero" or "this tenant has no money on it".
  const { eq } = await import('drizzle-orm')
  await db.update(project).set({ budget: '40000.00', estimatedValue: '48450.00' }).where(eq(project.id, proj.id))

  for (const name of ['owner', 'admin', 'manager', 'viewer'] as const) {
    const r = await as(ROLES[name], `/api/projects/${proj.id}`)
    check(`${name} sees the project's money`, r.status === 200 && Number(r.json?.budget) === 40000 && !!r.json?.financials,
      { status: r.status, budget: r.json?.budget, hasFinancials: !!r.json?.financials })
    check(`…including the contract value`, Number(r.json?.financials?.revisedContractValue) === 48450,
      { revisedContractValue: r.json?.financials?.revisedContractValue })
  }

  const f = await as(ROLES.field, `/api/projects/${proj.id}`)
  check('field can still OPEN the project — refusing it would stop the work', f.status === 200, { status: f.status })
  check('…and still gets what the job IS', f.json?.name === 'Matrix Site' && !!f.json?.number, { name: f.json?.name, number: f.json?.number })
  check('…and its jobs, RFIs and punch list', Array.isArray(f.json?.jobs) && Array.isArray(f.json?.rfis), { jobs: Array.isArray(f.json?.jobs) })
  check('field gets NO budget', f.json?.budget === undefined, { budget: f.json?.budget })
  check('field gets NO estimatedValue — the raw column the page read for Contract value', f.json?.estimatedValue === undefined, { estimatedValue: f.json?.estimatedValue })
  check('field gets NO financials block at all', f.json?.financials === undefined, { financials: f.json?.financials })
  // The figures the tester actually read off the screen must not be anywhere in the body — the
  // whole-payload check, because stripping the block and leaving the spread fixed nothing.
  check('…and neither 40000 nor 48450 appears anywhere in the response', !/40000|48450/.test(f.text), { body: f.text?.slice(0, 200) })

  // The LIST carries the same columns, and fixing only the page the report named would have left
  // them there.
  const list = await as(ROLES.field, '/api/projects')
  check('field can still list projects', list.status === 200, { status: list.status })
  check('…with no money on the rows', !/budget|estimatedValue|40000|48450/.test(list.text), { body: list.text?.slice(0, 200) })
  const mgrList = await as(ROLES.manager, '/api/projects')
  check('…while a manager still gets it on the list', /40000|48450/.test(mgrList.text), { body: mgrList.text?.slice(0, 160) })

  // And the roll-up, whose totalValue is every project's contract value added up.
  const fStats = await as(ROLES.field, '/api/projects/stats')
  check('field can still see project COUNTS', fStats.status === 200 && typeof fStats.json?.total === 'number', { total: fStats.json?.total })
  check('…but not the total contract value of the company', fStats.json?.totalValue === undefined, { totalValue: fStats.json?.totalValue })
  const mStats = await as(ROLES.manager, '/api/projects/stats')
  check('…which a manager does get', Number(mStats.json?.totalValue) === 48450, { totalValue: mStats.json?.totalValue })

  /*
   * T35-6: THE SIDE DOOR. The money above came out, and the EMBEDDED CHANGE ORDERS kept their
   * amounts — so field read $2,877 off the same page and could add the approved ones back up to the
   * contract change. My own comment claimed that `amount` was "gated one layer up" by
   * change-orders:read; this route selected the rows itself, so nothing was gating it.
   *
   * The figure here is deliberately one field cannot get any other way: /api/change-orders is 403
   * for field (asserted in the module sweep above), so if 2877 appears in this body it came through
   * the project page.
   */
  await db.insert(changeOrder).values({
    companyId: co.id, projectId: proj.id, number: 'CO-SIDE', title: 'Kitchen island upgrade',
    amount: '2877.00', daysAdded: 3, status: 'approved',
  } as any)

  const f2 = await as(ROLES.field, `/api/projects/${proj.id}`)
  check('field still opens the project after a change order exists', f2.status === 200, { status: f2.status })
  check('…and the change-order AMOUNT is not in the body', !/2877/.test(f2.text), { body: f2.text?.slice(0, 240) })
  check('…the embedded list is an empty array, not a missing key the screen would crash on',
    Array.isArray(f2.json?.changeOrders) && f2.json.changeOrders.length === 0, { changeOrders: f2.json?.changeOrders })
  check('…and the title does not leak either — the row is gated, not just its money',
    !/Kitchen island upgrade/.test(f2.text), { body: f2.text?.slice(0, 240) })

  const m2 = await as(ROLES.manager, `/api/projects/${proj.id}`)
  check('a manager still gets the change orders, with the amount',
    Array.isArray(m2.json?.changeOrders) && m2.json.changeOrders.length === 1 && /2877/.test(m2.text),
    { n: m2.json?.changeOrders?.length })
  check('…and the approved total still reaches the people who may see money',
    Number(m2.json?.financials?.approvedChangeOrders) === 2877, { financials: m2.json?.financials })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
