// ADAPTED COPY of tests/homecare/r3-billing.test.ts, for the unified app (tests/unified/harness/adapted.ts). Unchanged except the
// 8 read(s) marked "unified:", where the rulebook's reply shapes replaced the template's. The original keeps
// running against the template; tests/unified/harness/unified-divergences.ts names the assertions this copy stands in for.
// crm-homecare — E2E Run 3 billing findings, each reproduced on the tester's own numbers.
//
//   1. Invoice line math: a per-15-minute rate prints units × rate = amount in ONE unit, every writer
//      stamps the line's rate_type, a scheduled-basis line describes the SHIFT (not a 1-minute punch),
//      and the visit's care note comes back on the stored invoice.
//   2. One money rule for every report: Pat's $60 DRAFT is neither billed nor owed; Sam's released
//      $30 with $10 paid is billed $30, collected $10, owed $20 — on the Revenue tab, Overview, P&L,
//      Revenue Forecast, client revenue by month, A/R aging, the dashboard tiles and the billing
//      summary alike. Never prorated, though Sam's billing period ends after the report range.
//   3. A claim made from an invoice has its service date and reads the client's Medicaid ID.
//   4. Payments: an overpayment is refused with the server's reason; Mark Paid writes the ledger.
//   5. Authorization units: the claim's 15-minute units are converted to the authorization's unit.
//   6. EVV and authorization advice skip PRIVATE PAY by the payer's type.
//   7. The billing schedule's "Due Now" agrees with what Create Due Invoices would create (dry run).
//   8. The Rates warning uses the invoice engine's own rate test.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, referralSourceRates, schedules, timeEntries, careTypes } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 700)) }
}
const near = (a: any, b: number) => Math.abs(Number(a) - b) < 0.005
const rows = (r: any) => (r?.rows ?? r) as any[]
const snakeKey = (k: string) => k.replace(/[A-Z]/g, (m) => '_' + m.toLowerCase())
const templateShape = (v: any): any => Array.isArray(v) ? v.map(templateShape) : (v && typeof v === 'object') ? ((Array.isArray(v.data) && v.pagination) ? templateShape(v.data) : Object.fromEntries(Object.entries(v).flatMap(([k, x]) => { const s = templateShape(x); return snakeKey(k) === k ? [[k, s]] : [[k, s], [snakeKey(k), s]] }))) : v /* unified: templateShape reads a unified reply in the template's shape: a list reply ({ data, pagination }, RULEBOOK §3) as its rows, and every camelCase key (RULEBOOK §2) also under its snake_case name — what the template's own index.ts did to every reply (addSnakeAliases); the values are the server's, unchanged */

await setupSchema()

const [ag] = await db.insert(agencies).values({ name: 'Test Home Care Co', slug: 'thcc', state: 'WI', enabledFeatures: ['documents', 'reports', 'two_way_texting'] } as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-r3@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
} as any).returning())[0]
const admin = await mkUser('admin', 'Admin')
const cgA = await mkUser('caregiver', 'CaregiverA')

const [personal] = await db.insert(careTypes).values({ name: 'Personal Care' } as any).returning()
const [medicaid] = await db.insert(referralSources).values({ name: 'Medicaid', payerType: 'medicaid', isActivePayer: true } as any).returning()
const [ppPayer] = await db.insert(referralSources).values({ name: 'Private Pay', payerType: 'private_pay', isActivePayer: true } as any).returning()
await db.insert(referralSourceRates).values({ referralSourceId: medicaid.id, careTypeId: personal.id, rateAmount: '7.50', rateType: '15min', effectiveDate: '2026-01-01', isActive: true } as any)

const mkClient = async (first: string, v: Record<string, unknown>) => (await db.insert(clients).values({
  firstName: first, lastName: 'Example', isActive: true, ...v,
} as any).returning())[0]
const once = async (clientId: string, caregiverId: string, date: string, start: string, end: string) =>
  (await db.insert(schedules).values({
    clientId, caregiverId, scheduleType: 'one-time', date, startTime: new Date(`${date}T${start}:00Z`), endTime: new Date(`${date}T${end}:00Z`), isActive: true,
  } as any).returning())[0]
// Central wall clock (CDT = UTC-5 in October 2026).
const cdt = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h + 5, m))
}
const punch = async (clientId: string, caregiverId: string, date: string, from: string, to: string) => {
  const s = cdt(date, from), e = cdt(date, to)
  return (await db.insert(timeEntries).values({
    clientId, caregiverId, startTime: s, endTime: e, isComplete: true, durationMinutes: Math.round((e.getTime() - s.getTime()) / 60000),
  } as any).returning())[0]
}

const app = new Hono()
for (const [mount, file] of [
  ['/api/billing', 'billing'], ['/api/claims', 'claims'], ['/api/reports', 'reports'], ['/api/dashboard', 'dashboard'],
  ['/api/forecast', 'forecast'], ['/api/evv', 'evv'], ['/api/authorizations', 'authorizations'],
] as const) app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
const A = async (method: string, path: string, b?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': admin.id, 'x-test-agency': ag.id, 'x-test-role': admin.role },
    body: b === undefined ? undefined : JSON.stringify(b),
  })
  const t = await res.text(); let j: any = t; try { j = templateShape(JSON.parse(t)) } catch {} /* unified: each reply read through templateShape */
  return { status: res.status, json: j }
}
const engine = await import('./src/services/invoiceEngine.ts')
const { agencyToday, addDays } = await import('./src/services/agencyTime.ts')
const today = await agencyToday()

// ══ 1. Pat: Medicaid, $7.50 per 15 minutes, a 2h visit punched 6:30–6:31 ══════════════════════════
const pat = await mkClient('Pat', { referredById: medicaid.id, careTypeId: personal.id, medicaidId: '1234567890' })
const sam = await mkClient('Sam', { isPrivatePay: true, privatePayRate: '15.00', privatePayRateType: 'hourly' })
const patSched = await once(pat.id, cgA.id, '2026-10-05', '09:30', '11:30')
const patPunch = await punch(pat.id, cgA.id, '2026-10-05', '06:30', '06:31')
await once(sam.id, cgA.id, '2026-10-06', '10:00', '12:00')
// The visit's care note (Visit Documentation), keyed on the visit: client, day, scheduled start, caregiver.
await db.execute(sql`INSERT INTO visit_documentation (id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note)
  VALUES ('vd-pat', ${pat.id}, ${cgA.id}, '2026-10-05', '09:30', '11:30', ${patSched.id}, '[{"taskName":"Bathing","done":true}]', 'Bathed and dressed; in good spirits')`)

const PERIOD = { billingPeriodStart: '2026-10-05', billingPeriodEnd: '2026-10-18' } // ends after the report range
let patInv: any, samInv: any
{
  const g = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: pat.id, ...PERIOD })
  check('Pat: the invoice is created (201) for $60.00', g.status === 201 && near(g.json.total, 60), g.json)
  patInv = g.json
  const inv = await A('GET', `/api/billing/invoices/${patInv.id}`)
  const li = inv.json.line_items?.[0]
  check('the stored line carries its unit: rate_type 15min, 2.00 h, $7.50, $60.00', li?.rate_type === '15min' && near(li.hours, 2) && near(li.rate, 7.5) && near(li.amount, 60), li)
  const q = engine.lineQuantity(li)
  check('…so it prints 8 units × $7.50 / 15 min = $60.00 (quantity × rate = amount)', q.quantityLabel === '8 units' && q.rateLabel === '$7.50 / 15 min' && near(q.quantity * Number(li.rate), Number(li.amount)), q)
  check('the line describes the SCHEDULED 2 hours it bills, not the 6:30–6:31 punch', /9:30 AM - 11:30 AM/.test(li?.description) && !/6:3\d AM/.test(li?.description), li?.description)
  check('…and identifies the visit by its scheduled start', li?.start_time === '09:30:00', li?.start_time)
  check('the visit\'s care note comes back on the stored invoice line', li?.visit_note === 'Bathed and dressed; in good spirits', li)
  check('an hourly line prints hours × $/h', engine.lineQuantity({ hours: 2, rate: 30, rate_type: 'hourly' }).quantityLabel === '2.00 h' && engine.lineQuantity({ hours: 2, rate: 30, rate_type: 'hourly' }).rateLabel === '$30.00 / h')

  const ps = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: sam.id, ...PERIOD })
  samInv = ps.json
  const sl = (await A('GET', `/api/billing/invoices/${samInv.id}`)).json.line_items?.[0]
  check('Sam: private pay $15/h, a 2h visit with no punch: $30.00 hourly line', ps.status === 201 && near(ps.json.total, 30) && sl?.rate_type === 'hourly', sl)

  // Every other writer of lines stamps the unit too.
  const man = await A('POST', '/api/billing/invoices/manual', {
    clientId: pat.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-07',
    lineItems: [{ caregiverId: cgA.id, description: 'Home Care Services', hours: 1, serviceDate: '2026-09-02' }],
  })
  const ml = rows(await db.execute(sql`SELECT rate_type, hours, rate, amount FROM invoice_line_items WHERE invoice_id = ${man.json.id}`))[0]
  check('manual invoice: the payer\'s per-15-minute rate is stamped (1 h = 4 units × $7.50 = $30.00)', man.status === 201 && ml?.rate_type === '15min' && near(ml.amount, 30), [man.json, ml])
  const ed = await A('PUT', `/api/billing/invoices/${man.json.id}/line-items`, { lineItems: [{ caregiver_id: cgA.id, description: 'Edited', hours: 0.5, serviceDate: '2026-09-02' }] })
  const el = rows(await db.execute(sql`SELECT rate_type, amount FROM invoice_line_items WHERE invoice_id = ${man.json.id}`))[0]
  check('editing lines keeps the unit (0.5 h = 2 units × $7.50 = $15.00)', ed.status === 200 && el?.rate_type === '15min' && near(el.amount, 15), [ed.json, el])
  const imp = await A('POST', '/api/billing/import-csv', { rows: [{ clientId: sam.id, caregiverId: cgA.id, serviceDate: '2026-08-04', hours: 2, rate: 20 }] })
  const il = rows(await db.execute(sql`SELECT ili.rate_type, ili.amount FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id WHERE i.client_id = ${sam.id} AND i.billing_period_start = '2026-08-01'`))[0]
  check('CSV import: an imported rate is per hour (2 × $20 = $40.00)', imp.json.invoicesCreated === 1 && il?.rate_type === 'hourly' && near(il.amount, 40), [imp.json, il])
  let threw = ''
  try { await engine.insertLineItems(db as any, man.json.id, [{ caregiver_id: cgA.id, description: 'x', hours: 1, rate: 1, amount: 1 }]) } catch (e: any) { threw = e.message }
  check('a line written without its unit is refused, not guessed', /rate_type/.test(threw), threw)
  // Those helper invoices are drafts; take them out so the reports below see only Pat and Sam.
  await A('DELETE', `/api/billing/invoices/${man.json.id}`)
  const impId = rows(await db.execute(sql`SELECT id FROM invoices WHERE client_id = ${sam.id} AND billing_period_start = '2026-08-01'`))[0]?.id
  await A('DELETE', `/api/billing/invoices/${impId}`)
}

// ══ 4. payments: the server's reason, and one ledger ══════════════════════════════════════════════
{
  const rel = await A('POST', `/api/billing/invoices/${samInv.id}/release`)
  check('Sam\'s invoice is released', rel.status === 200, rel.json)
  const p = await A('POST', '/api/billing/invoice-payments', { invoiceId: samInv.id, amount: 10, paymentDate: today, paymentMethod: 'check' })
  check('a $10 payment is recorded', p.status === 201 && near(p.json.amount, 10), p.json)
  const over = await A('POST', '/api/billing/invoice-payments', { invoiceId: samInv.id, amount: 50, paymentDate: today })
  check('a $50 payment on a $20 balance is refused 409 WITH the reason the screen shows', over.status === 409
    && /^Payment of \$50\.00 exceeds the \$20\.00 balance due/.test(over.json.error), over)
  // Run 4: the office's screen (Billing → Record Payment) has no overpayment control, so the reason
  // names no developer flag — it says what to check.
  check('…in the office\'s words: no "allowOverpayment" flag, a thing to check instead', !/allowOverpayment|resubmit/i.test(over.json.error)
    && /check the invoice's payments before entering it again\.$/.test(over.json.error), over.json.error)
}

// ══ 2. one rule for every report ═════════════════════════════════════════════════════════════════
const R = { startDate: '2026-10-01', endDate: '2026-10-16' } // the invoices' periods end 10-18
async function figures() {
  const ov = (await A('POST', '/api/reports/overview', R)).json
  const rv = (await A('POST', '/api/reports/revenue', R)).json
  const pnl = (await A('GET', `/api/reports/pnl?startDate=${R.startDate}&endDate=${R.endDate}`)).json
  const fc = (await A('GET', '/api/forecast/revenue?months=36')).json
  const crm = (await A('GET', `/api/reports/client-revenue-by-month?startDate=${R.startDate}&endDate=${R.endDate}`)).json
  const dash = (await A('GET', '/api/dashboard/summary')).json
  const bs = (await A('GET', `/api/billing/billing-summary?startDate=${R.startDate}&endDate=${R.endDate}`)).json
  const paid = Number(rows(await db.execute(sql`SELECT COALESCE(SUM(amount), 0) AS s FROM invoice_payments`))[0].s)
  return {
    overview: Number(ov.summary.totalRevenue),
    revBilled: Number(rv.revenue.total), revCollected: Number(rv.revenue.collected), revOutstanding: Number(rv.revenue.outstanding), revCount: rv.revenue.invoiceCount,
    revByPayer: (rv.byPayer || []).reduce((s: number, r: any) => s + Number(r.billed), 0),
    ar: Number(rv.ar.total_outstanding),
    pnlBilled: Number(pnl.revenue.total_billed), pnlCollected: Number(pnl.revenue.total_collected),
    pnlByPayer: (pnl.revenueByPayer || []).reduce((s: number, r: any) => s + Number(r.billed), 0),
    fcBilled: (fc.actual || []).reduce((s: number, r: any) => s + Number(r.billed || 0), 0),
    fcCollected: (fc.actual || []).reduce((s: number, r: any) => s + Number(r.collected || 0), 0),
    crmBilled: (crm.rows || []).reduce((s: number, r: any) => s + Number(r.total_billed), 0),
    crmPaid: (crm.rows || []).reduce((s: number, r: any) => s + Number(r.total_paid), 0),
    dashOwed: Number(dash.pendingInvoices.amount), dashOwedCount: dash.pendingInvoices.count,
    dashDrafts: Number(dash.pendingInvoices.draftAmount), dashMonthCash: Number(dash.thisMonthRevenue),
    bsBilled: Number(bs.summary.total_billed), bsCollected: Number(bs.summary.total_collected),
    payments: paid,
  }
}
{
  const f = await figures()
  const allBilled = [f.overview, f.revBilled, f.revByPayer, f.pnlBilled, f.pnlByPayer, f.fcBilled, f.crmBilled, f.bsBilled]
  check('Pat\'s $60 DRAFT is not billed: every report bills Sam\'s $30 alone, whole (not prorated)', allBilled.every((x) => near(x, 30)), f)
  check('…one invoice on the Revenue tab', f.revCount === 1, f.revCount)
  const allCollected = [f.revCollected, f.pnlCollected, f.fcCollected, f.crmPaid, f.bsCollected]
  check('collected = the payments recorded ($10) everywhere', near(f.payments, 10) && allCollected.every((x) => near(x, f.payments)), f)
  check('owed = billed − collected = $20: Revenue outstanding, A/R aging and the dashboard tile agree', [f.revOutstanding, f.ar, f.dashOwed].every((x) => near(x, 20)) && f.dashOwedCount === 1, f)
  check('the dashboard reports the $60 draft apart, not as owed', near(f.dashDrafts, 60), f)
  check('this month\'s cash on the dashboard = the $10 recorded today', near(f.dashMonthCash, 10), f)

  // Releasing Pat's draft bills it, in every report at once.
  await A('POST', `/api/billing/invoices/${patInv.id}/release`)
  const g = await figures()
  check('released, Pat\'s $60 is billed everywhere: $90', [g.overview, g.revBilled, g.pnlBilled, g.fcBilled, g.crmBilled, g.bsBilled].every((x) => near(x, 90)), g)
  check('…and owed: A/R $80 = Revenue outstanding = dashboard', [g.revOutstanding, g.ar, g.dashOwed].every((x) => near(x, 80)), g)

  // Mark Paid writes the ledger, so Collected still equals the payments recorded.
  const mp = await A('PUT', `/api/billing/invoices/${samInv.id}/payment-status`, { status: 'paid' })
  const led = rows(await db.execute(sql`SELECT COALESCE(SUM(amount), 0) AS s, COUNT(*)::int AS n FROM invoice_payments WHERE invoice_id = ${samInv.id}`))[0]
  check('Mark Paid records a payment for the $20 balance (ledger $30 = amount_paid)', mp.status === 200 && mp.json.payment_status === 'paid' && near(led.s, 30) && near(mp.json.amount_paid, 30) && led.n === 2, [mp.json, led])
  const h = await figures()
  check('…and every report\'s Collected moves with it: $30', [h.revCollected, h.pnlCollected, h.fcCollected, h.bsCollected].every((x) => near(x, 30)) && near(h.payments, 30), h)
}

// ══ 3. a claim from Pat's invoice ═════════════════════════════════════════════════════════════════
{
  const c = await A('POST', '/api/claims', { invoiceId: patInv.id })
  check('the claim from the invoice has its service date: the visit\'s day', c.status === 201 && String(c.json.service_date).slice(0, 10) === '2026-10-05', c.json)
  const one = await A('GET', `/api/claims/${c.json.id}`)
  check('…its date span is the lines\' days, 8.00 units, $60.00', one.json.service_date_from === '2026-10-05' && one.json.service_date_to === '2026-10-05' && near(one.json.units_billed, 8) && near(one.json.charge_amount, 60), one.json)
  check('…and it reads the client\'s Medicaid ID', one.json.medicaid_id === '1234567890', one.json.medicaid_id)
}

// ══ 5. authorization units follow the authorization's unit_type ═══════════════════════════════════
{
  const mkAuth = async (id: string, unit: string, authorized: number, used = 0) => db.execute(sql`
    INSERT INTO authorizations (id, client_id, payer_id, auth_number, authorized_units, unit_type, used_units, start_date, end_date, status)
    VALUES (${id}, ${pat.id}, ${medicaid.id}, ${id}, ${authorized}, ${unit}, ${used}, '2026-01-01', '2027-12-31', 'active')`)
  const mkClaim = async (id: string, authId: string, from: string, to: string) => db.execute(sql`
    INSERT INTO claims (id, client_id, payer_id, authorization_id, service_date, service_date_from, service_date_to, units_billed, billed_amount, status)
    VALUES (${id}, ${pat.id}, ${medicaid.id}, ${authId}, ${from}, ${from}, ${to}, 8, 60, 'draft')`)
  const used = async (id: string) => Number(rows(await db.execute(sql`SELECT used_units FROM authorizations WHERE id = ${id}`))[0].used_units)
  for (const [unit, want, from, to] of [['15min', 8, '2026-10-05', '2026-10-05'], ['hours', 2, '2026-10-05', '2026-10-05'], ['visits', 1, '2026-10-05', '2026-10-05'], ['days', 3, '2026-10-05', '2026-10-07']] as const) {
    await mkAuth(`au-${unit}`, unit, 100)
    await mkClaim(`cl-${unit}`, `au-${unit}`, from, to)
    const s = await A('POST', `/api/claims/cl-${unit}/submit`)
    check(`a 2h claim (8 quarter-hours) uses ${want} of a "${unit}" authorization`, s.status === 200 && near(await used(`au-${unit}`), want), [s.json, await used(`au-${unit}`)])
  }
  await mkAuth('au-short', 'hours', 10, 7) // 3 hours left
  await mkClaim('cl-short', 'au-short', '2026-10-05', '2026-10-05')
  const chk = await A('GET', '/api/claims/cl-short/auth-check')
  check('the pre-submit check compares HOURS with hours: 2 h fits in 3 h left (8 units used to be refused)', chk.json.canSubmit === true && near(chk.json.unitsToBill, 2), chk.json)
  await mkAuth('au-tight', 'hours', 10, 9) // 1 hour left
  await mkClaim('cl-tight', 'au-tight', '2026-10-05', '2026-10-05')
  const t = await A('GET', '/api/claims/cl-tight/auth-check')
  check('…and refuses 2 h against 1 h left, in hours', t.json.canSubmit === false && t.json.blockers.some((b: string) => /requires 2 hours but only 1\.0 remain/.test(b)), t.json)
  const bad = await A('POST', '/api/authorizations', { clientId: pat.id, authNumber: 'X', authorizedUnits: 10, unitType: 'fortnights', startDate: '2026-01-01', endDate: '2026-12-31' })
  check('an authorization in an unknown unit is refused with the units it can be', bad.status === 400 && /15-minute units, hours, visits, days/.test(bad.json.error), bad.json)
  const alias = await A('POST', '/api/authorizations', { clientId: pat.id, authNumber: 'Y', authorizedUnits: 10, unitType: 'hourly', startDate: '2026-01-01', endDate: '2026-12-31' })
  check('an older spelling ("hourly") is stored as the one spelling: hours', alias.status === 201 && alias.json.unitType === 'hours', alias.json)
  const { authUnitsToHours } = await import('./src/services/authUnits.ts')
  check('authUnitsToHours: 40 units = 10 h; 10 hours = 10 h; visits and days have no hours', authUnitsToHours(40, '15min') === 10 && authUnitsToHours(10, 'hours') === 10 && authUnitsToHours(5, 'visits') === null && authUnitsToHours(5, 'days') === null)
}

// ══ 6. private pay: no EVV record, no authorization advice — by the payer's TYPE ══════════════════
{
  const evvSvc = await import('./src/services/evvVisits.ts')
  const { checkAuthorizationBalance } = await import('./src/helpers/authorizationCheck.ts')
  // Sam2: the Private Pay box unticked, but the payer on file is the private-pay payer.
  const sam2 = await mkClient('Sam2', { referredById: ppPayer.id })
  const te = await punch(sam2.id, cgA.id, '2026-10-07', '10:00', '12:00')
  check('no EVV record is built for a private-pay visit', (await evvSvc.createEVVFromTimeEntry(te.id)) === null)
  check('…including Sam, private pay by the client\'s own box', (await evvSvc.createEVVFromTimeEntry((await punch(sam.id, cgA.id, '2026-10-08', '10:00', '12:00')).id)) === null)
  const patEvv = await evvSvc.createEVVFromTimeEntry(patPunch.id)
  check('a Medicaid visit still gets its EVV record', !!patEvv?.id, patEvv)
  // A private-pay row written before this rule existed.
  await db.execute(sql`INSERT INTO evv_visits (id, time_entry_id, client_id, caregiver_id, service_code, service_date, actual_start)
    VALUES ('evv-old-sam2', ${te.id}, ${sam2.id}, ${cgA.id}, 'T1019', '2026-10-07', ${te.startTime.toISOString()})`)
  const list = await A('GET', '/api/evv'); const evvPage: any = await (await app.request('/api/evv', { headers: { 'x-test-user': admin.id, 'x-test-agency': ag.id, 'x-test-role': admin.role } })).json() /* unified: the EVV dashboard is a list reply ({ data, pagination }); its total is pagination.total */
  const ids = (Array.isArray(list.json) ? list.json : []).map((v: any) => v.clientId) /* unified: templateShape reads the list reply as its rows */
  check('the EVV Dashboard lists the Medicaid visit and not the private-pay one', list.status === 200 && ids.includes(pat.id) && !ids.includes(sam2.id) && evvPage?.pagination?.total === ids.length, list.json) /* unified: the count is the list reply's pagination.total */
  const make = await A('POST', `/api/evv/create-from-entry/${te.id}`)
  check('building EVV for a private-pay visit by hand is refused with the reason', make.status === 400 && /private-pay/.test(make.json.error), make.json)
  const a1 = await checkAuthorizationBalance(sam2.id, 2)
  const a2 = await checkAuthorizationBalance(sam.id, 2)
  const a3 = await checkAuthorizationBalance(pat.id, 2)
  check('no "No active authorization" warning for a private-pay client (by payer type, and by the box)', a1.warnings.length === 0 && a2.warnings.length === 0, [a1, a2])
  check('…while a Medicaid client with an authorization gets the balance advice in its own unit', a3.warnings.every((w: string) => !/No active authorization/.test(w)), a3)
}

// ══ 7. the billing schedule's Due Now = what Create Due Invoices would create ═════════════════════
{
  const bea = await mkClient('Bea', { isPrivatePay: true, privatePayRate: '20.00', privatePayRateType: 'hourly', billingFrequencyWeeks: 2, billedThrough: addDays(today, -3) })
  const row = async () => ((await A('GET', '/api/billing/invoices/billing-schedule')).json as any[]).find((r) => r.id === bea.id)
  const dry = async () => ((await A('POST', '/api/billing/invoices/generate-due', { dryRun: true })).json.created as any[]).filter((c) => c.name === 'Bea Example')
  check('billed through 3 days ago, every 2 weeks: Due Now is current (0), and the dry run would create nothing', (await row())?.periods_due === 0 && (await dry()).length === 0, await row())
  await db.execute(sql`UPDATE clients SET billed_through = ${addDays(today, -15)}::date WHERE id = ${bea.id}`)
  await once(bea.id, cgA.id, addDays(today, -10), '09:00', '11:00')
  const before = Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoices`))[0].n)
  const d = await dry()
  check('billed through 15 days ago: one complete period is due, and the dry run lists exactly it ($40.00)', (await row())?.periods_due === 1 && d.length === 1 && near(d[0].total, 40), [await row(), d])
  const after = Number(rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoices`))[0].n)
  const bt = rows(await db.execute(sql`SELECT to_char(billed_through, 'YYYY-MM-DD') AS b FROM clients WHERE id = ${bea.id}`))[0].b
  check('…and the dry run wrote nothing: no invoice, billed_through unchanged', after === before && bt === addDays(today, -15), [before, after, bt])
}

// ══ 8. the Rates warning uses the engine's rate test ══════════════════════════════════════════════
{
  const [county] = await db.insert(referralSources).values({ name: 'County Plan', payerType: 'mco_family_care' } as any).returning()
  const cc = await mkClient('Cory', { referredById: county.id, careTypeId: personal.id })
  await db.insert(referralSourceRates).values({ referralSourceId: county.id, careTypeId: personal.id, rateAmount: '30', rateType: 'hourly', effectiveDate: addDays(today, 5), isActive: true } as any)
  const listed = async () => ((await A('GET', '/api/billing/missing-rates')).json as any[]).some((m) => m.payer_id === county.id)
  check('a rate that starts next week does not price today: listed as missing, as the engine would refuse', await listed())
  check('Medicaid + Personal Care with its $7.50 rate in force is NOT listed', !((await A('GET', '/api/billing/missing-rates')).json as any[]).some((m) => m.payer_id === medicaid.id))
  const add = await A('POST', '/api/billing/referral-source-rates', { referralSourceId: county.id, careTypeId: personal.id, rateAmount: 31, rateType: 'hourly', effectiveDate: today })
  check('adding a rate in force today clears the warning', add.status === 201 && !(await listed()), add.json)
  void cc
}

// ══ the invoice engine reads private pay by the one rule ═════════════════════════════════════
// A client on the "Private Pay" payer with the box left unticked is private pay for EVV and
// authorizations (helpers/payerFunding); the engine used to read the box alone and bill them like a
// payer client (scheduled basis, invoice type 'insurance').
{
  const [boxOff] = await db.insert(clients).values({ firstName: 'Una', lastName: 'Ticked', referredById: ppPayer.id, isPrivatePay: false } as any).returning()
  const [boxOn] = await db.insert(clients).values({ firstName: 'Tess', lastName: 'Ticked', isPrivatePay: true, privatePayRate: '30' } as any).returning()
  const [payerClient] = await db.insert(clients).values({ firstName: 'Mae', lastName: 'Payer', isPrivatePay: false } as any).returning()
  const a = await engine.loadBillingClient(db as any, boxOff.id)
  const b = await engine.loadBillingClient(db as any, boxOn.id)
  const c = await engine.loadBillingClient(db as any, payerClient.id)
  check('engine: the Private Pay payer makes a client private pay with the box unticked', a?.privatePayByRule === true, a) /* unified: the invoice engine's client row is camelCase (server/data/homecareBilling.ts billingClient) */
  check('engine: the box alone still does', b?.privatePayByRule === true, b) /* unified: camelCase row */
  check('engine: a client with no payer and no box is not private pay', c?.privatePayByRule === false, c) /* unified: camelCase row */
}

console.log(`\nhomecare-r3-billing: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
