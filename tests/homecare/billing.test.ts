// crm-homecare — client billing, ported from CVHC (billingRoutes.js, claims engine, MIDAS claim days).
//
// Every expected number below is what CVHC's own logic gives on the same input (its
// generateLineItems / allocateEvvWeek / claimsEngine, read line by line), worked by hand in the
// comment next to the assertion. The agency is in Wisconsin, so its clock is America/Chicago and a
// 9:00 AM visit is a 14:00 UTC punch (CDT, UTC-5) in September/October.
//
// What is covered:
//   · the engine — scheduled vs clocked per day, private pay bills the clock, the 7-minute grace,
//     missed clock-outs, unscheduled punches (default skip), twin punches, a substitute covering,
//     the coverage extension, overlapping handoffs, per-15-minute rates, bi-weekly, cancelled and
//     reason-coded days, training shifts
//   · generation — atomic, duplicate period refused, draft (sent_at NULL), seq_number, billed_through
//   · the cadence — billing schedule, Create Due Invoices (complete periods only, stops on review)
//   · drafts — release / rescind, the portal and the public pay page hide drafts
//   · money — overpayment refused, partial → paid, line-item edit refused after a payment,
//     manual lines take the client's rate (never the form's), write-off lines, new rate retires old
//   · invoice from picked visits, the care note on the invoice
//   · insurer-portal claim days (S5125 / S5130), incl. the allowance trim
//   · claims — units from billable minutes, hourly ÷ 4, draft status, idempotent unit deduction
//   · who: a caregiver is refused every billing and claims route; the office reaches them
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { agencies, users, clients, referralSources, referralSourceRates, schedules, timeEntries, scheduleExceptions, invoices, careTypes } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 600)) }
}
const near = (a: any, b: number) => Math.abs(Number(a) - b) < 0.005
const rows = (r: any) => (r?.rows ?? r) as any[]

await setupSchema()

// ── fixture ───────────────────────────────────────────────────────────────────────────────────
await db.insert(agencies).values({ name: 'Billing Care Agency', slug: 'billingcare', state: 'WI' } as any)
const mkUser = async (role: string, tag: string) => (await db.insert(users).values({
  email: `${tag}-billing@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const admin = await mkUser('admin', 'admin')
const cgA = await mkUser('caregiver', 'Alice')
const cgB = await mkUser('caregiver', 'Bea')

const [payer] = await db.insert(referralSources).values({ name: 'County Care Plan', payerType: 'mco_family_care' } as any).returning()
await db.insert(referralSourceRates).values({ referralSourceId: payer.id, rateAmount: '33.00', rateType: 'hourly', isActive: true } as any)
const [unitPayer] = await db.insert(referralSources).values({ name: 'Unit Payer', payerType: 'medicaid' } as any).returning()
await db.insert(referralSourceRates).values({ referralSourceId: unitPayer.id, rateAmount: '7.56', rateType: '15min', isActive: true } as any)

const mkClient = async (first: string, v: Record<string, unknown>) => (await db.insert(clients).values({
  firstName: first, lastName: 'Client', isActive: true, ...v,
} as any).returning())[0]

// Schedules store the wall-clock time on a base date (timestamp); weekday from the date given.
const dowOf = (d: string) => new Date(d + 'T12:00:00Z').getUTCDay()
const weekly = async (clientId: string, caregiverId: string, firstDate: string, start: string, end: string, extra: Record<string, unknown> = {}) =>
  (await db.insert(schedules).values({
    clientId, caregiverId, scheduleType: 'recurring', frequency: 'weekly', dayOfWeek: dowOf(firstDate),
    effectiveDate: firstDate, startTime: new Date(`${firstDate}T${start}:00Z`), endTime: new Date(`${firstDate}T${end}:00Z`),
    isActive: true, ...extra,
  } as any).returning())[0]
const once = async (clientId: string, caregiverId: string, date: string, start: string, end: string) =>
  (await db.insert(schedules).values({
    clientId, caregiverId, scheduleType: 'one-time', date, startTime: new Date(`${date}T${start}:00Z`), endTime: new Date(`${date}T${end}:00Z`), isActive: true,
  } as any).returning())[0]
// A punch at Central wall-clock time (CDT = UTC-5 in Sep/Oct 2026).
const cdt = (date: string, hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number)
  return new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)), h + 5, m))
}
const punch = async (clientId: string, caregiverId: string, date: string, from: string, to: string, extra: Record<string, unknown> = {}) => {
  const s = cdt(date, from), e = cdt(date, to)
  return (await db.insert(timeEntries).values({
    clientId, caregiverId, startTime: s, endTime: e, isComplete: true,
    durationMinutes: Math.round((e.getTime() - s.getTime()) / 60000), ...extra,
  } as any).returning())[0]
}

const billing = (await import('./src/routes/billing.ts')).default
const claimsRoutes = (await import('./src/routes/claims.ts')).default
const portalRoutes = (await import('./src/routes/portal.ts')).default
const stripeRoutes = (await import('./src/routes/stripe.ts')).default
const app = new Hono()
app.route('/api/billing', billing)
app.route('/api/claims', claimsRoutes)
app.route('/api/portal', portalRoutes)
app.route('/api/stripe', stripeRoutes)

const as = (who: any) => async (method: string, path: string, b?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id, 'x-test-role': who.role },
    body: b === undefined ? undefined : JSON.stringify(b),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const A = as(admin), O = as(owner), CG = as(cgA)
const reconcile = (clientId: string, s: string, e: string, choices?: any) =>
  A('POST', '/api/billing/invoices/reconcile', { clientId, billingPeriodStart: s, billingPeriodEnd: e, choices })
const preview = (clientId: string, s: string, e: string) =>
  A('POST', '/api/billing/invoices/preview', { clientId, billingPeriodStart: s, billingPeriodEnd: e })
const day = (r: any, date: string, cg?: string) => (r.json.reconcile || []).find((x: any) => x.service_date === date && (!cg || x.caregiver_id === cg))

// Weeks used (2026, all Mondays/Tuesdays unless said): Mon 2026-09-07, 09-14, 09-21, 09-28.

// ── 1. payer client: scheduled is the default; the 7-minute grace; short and long punches ──────
{
  const c1 = await mkClient('Payer', { referredById: payer.id })
  await weekly(c1.id, cgA.id, '2026-09-07', '09:00', '13:00') // Mondays, 4h
  await punch(c1.id, cgA.id, '2026-09-07', '09:02', '12:58')   // 236 min: |236-240| = 4 ≤ 7 → match
  await punch(c1.id, cgA.id, '2026-09-14', '09:00', '11:00')   // 120 min: short by 120 → needs a choice
  await punch(c1.id, cgA.id, '2026-09-21', '09:00', '23:30')   // 870 min: a missed clock-out
  // 09-28: no punch at all → bills scheduled, nothing to decide
  const r = await reconcile(c1.id, '2026-09-07', '2026-09-28')
  check('reconcile answers 200', r.status === 200, r.json)
  check('four billable days', r.json.reconcile?.length === 4, r.json.reconcile?.map((x: any) => x.status))
  const m = day(r, '2026-09-07'), s = day(r, '2026-09-14'), l = day(r, '2026-09-21'), n = day(r, '2026-09-28')
  check('within the grace: status match, no choice, scheduled $132.00', m?.status === 'match' && !m.needs_choice && m.chosen_basis === 'scheduled' && near(m.scheduled_amount, 132), m)
  check('short punch: needs a choice, defaults to scheduled', s?.status === 'short' && s.needs_choice === true && s.default_basis === 'scheduled', s)
  check('short punch: clocked would bill 2h × $33 = $66.00', near(s?.clocked_amount, 66), s)
  check('missed clock-out: long, needs a choice, defaults to scheduled', l?.status === 'long' && l.needs_choice && l.default_basis === 'scheduled', l)
  check('no punch: bills the schedule, no choice', n?.status === 'no_punch' && !n.needs_choice && near(n.scheduled_amount, 132), n)
  check('the punch time is shown on the agency clock (9:02 AM, not 2:02 PM UTC)', m?.clocked_start_label === '9:02 AM', m?.clocked_start_label)
  check('default total = 4 × $132 = $528.00', near(r.json.total, 528), r.json.total)
  check('counts: 1 match, 1 short, 1 long, 1 no punch, 2 need a choice', r.json.counts?.match === 1 && r.json.counts?.short === 1 && r.json.counts?.long === 1 && r.json.counts?.noPunch === 1 && r.json.counts?.needsChoice === 2, r.json.counts)

  const chosen = await reconcile(c1.id, '2026-09-07', '2026-09-28', { [s.key]: 'clocked' })
  check('choosing clocked for the short day: $528 − $132 + $66 = $462.00', near(chosen.json.total, 462), chosen.json.total)

  // Generate with that choice: one draft invoice, numbered, billed_through moves.
  const g = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: c1.id, billingPeriodStart: '2026-09-07', billingPeriodEnd: '2026-09-28', choices: { [s.key]: 'clocked' } })
  check('generate-with-rates creates the invoice (201)', g.status === 201, g.json)
  check('…for $462.00', near(g.json.total, 462), g.json.total)
  check('…as a DRAFT (sent_at NULL)', g.json.sent_at == null, g.json.sent_at)
  check('…with a friendly sequential number', Number.isInteger(Number(g.json.seq_number)) && Number(g.json.seq_number) >= 1, g.json.seq_number)
  const lines = rows(await db.execute(sql`SELECT billed_basis, scheduled_minutes, clocked_minutes, hours, amount, start_time::text AS st, to_char(service_date,'YYYY-MM-DD') AS d FROM invoice_line_items WHERE invoice_id = ${g.json.id} ORDER BY service_date`))
  check('each line records its basis and both sides', lines.length === 4
    && lines[0].billed_basis === 'scheduled' && lines[0].scheduled_minutes === 240 && lines[0].clocked_minutes === 236
    && lines[1].billed_basis === 'clocked' && near(lines[1].amount, 66)
    && lines[3].billed_basis === 'scheduled' && lines[3].clocked_minutes == null, lines)
  check('each line carries the visit identity (the scheduled start)', lines.every((l) => l.st === '09:00:00'), lines.map((l) => l.st))
  const [cl] = rows(await db.execute(sql`SELECT to_char(billed_through, 'YYYY-MM-DD') AS bt FROM clients WHERE id = ${c1.id}`))
  check('billed_through moved to the period end', cl.bt === '2026-09-28', cl)
  const dup = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: c1.id, billingPeriodStart: '2026-09-07', billingPeriodEnd: '2026-09-28' })
  check('the same period again is refused (400), naming the invoice', dup.status === 400 && /already exists/.test(dup.json.error), dup.json)
  const g2 = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: c1.id, billingPeriodStart: '2026-10-05', billingPeriodEnd: '2026-10-05' })
  check('the next invoice gets the next number', g2.status === 201 && Number(g2.json.seq_number) === Number(g.json.seq_number) + 1, [g.json.seq_number, g2.json.seq_number])
}

// ── 1b. the grace is exactly 7 minutes ────────────────────────────────────────────────────────
{
  const gr = await mkClient('Grace', { referredById: payer.id })
  await once(gr.id, cgA.id, '2026-09-22', '09:00', '11:00')
  await once(gr.id, cgB.id, '2026-09-22', '13:00', '15:00')
  await punch(gr.id, cgA.id, '2026-09-22', '09:00', '10:53') // 113 min: 7 short → within the grace
  await punch(gr.id, cgB.id, '2026-09-22', '13:00', '14:52') // 112 min: 8 short → a choice
  const r = await reconcile(gr.id, '2026-09-22', '2026-09-22')
  const a = day(r, '2026-09-22', cgA.id), b = day(r, '2026-09-22', cgB.id)
  check('7 minutes off is a match; 8 minutes off needs a choice', a?.status === 'match' && !a.needs_choice && b?.status === 'short' && b.needs_choice === true, [a, b])
}

// ── 2. private pay bills the clock ───────────────────────────────────────────────────────────────
{
  const pp = await mkClient('Private', { isPrivatePay: true, privatePayRate: '30.00', referredById: payer.id }) // lingering payer is ignored
  await weekly(pp.id, cgA.id, '2026-09-08', '14:00', '16:00') // Tuesdays, 2h
  await punch(pp.id, cgA.id, '2026-09-08', '13:58', '16:04') // 126 min: within grace → bills the clock
  await punch(pp.id, cgA.id, '2026-09-15', '14:00', '15:00') // 60 min short → bills the clock, no question
  await punch(pp.id, cgA.id, '2026-09-22', '14:00', '17:00') // 180 min long → held for review, default scheduled
  const r = await reconcile(pp.id, '2026-09-08', '2026-09-22')
  const a = day(r, '2026-09-08'), b = day(r, '2026-09-15'), c = day(r, '2026-09-22')
  check('private pay ignores the lingering payer: the client rate $30', near(r.json.rate?.rate, 30) && r.json.rate?.source === 'client_private_pay_rate', r.json.rate)
  check('private pay, within the grace: bills clocked 126 min = 2.1h × $30 = $63.00', a?.chosen_basis === 'clocked' && near(a.clocked_amount, 63), a)
  check('private pay, short: bills the clock, no choice asked', b?.status === 'short' && b.needs_choice === false && b.chosen_basis === 'clocked' && near(b.clocked_amount, 30), b)
  check('private pay, long: held for review, defaults to scheduled $60', c?.status === 'long' && c.needs_choice === true && c.default_basis === 'scheduled' && near(c.scheduled_amount, 60), c)
  check('private pay total = 63 + 30 + 60 = $153.00', near(r.json.total, 153), r.json.total)
}

// ── 3. a punch with no schedule behind it does not bill by default ─────────────────────────────
{
  const c3 = await mkClient('Orphan', { referredById: payer.id })
  const e = await punch(c3.id, cgB.id, '2026-09-09', '10:00', '12:00')
  const r = await reconcile(c3.id, '2026-09-07', '2026-09-13')
  const o = day(r, '2026-09-09')
  check('an unscheduled punch is listed: needs a choice, default skip', o?.status === 'unscheduled' && o.needs_choice === true && o.default_basis === 'skip' && o.chosen_basis === 'skip', o)
  check('…and bills nothing by default', near(r.json.total, 0), r.json.total)
  const none = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: c3.id, billingPeriodStart: '2026-09-07', billingPeriodEnd: '2026-09-13' })
  check('with nothing to bill, generation is refused rather than creating an empty invoice', none.status === 400, none.json)
  const opt = await reconcile(c3.id, '2026-09-07', '2026-09-13', { [o.key]: 'clocked' })
  check('opting in bills the clocked 2h × $33 = $66.00', near(opt.json.total, 66), opt.json.total)
  const pv = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: c3.id, billingPeriodStart: '2026-09-07', billingPeriodEnd: '2026-09-13', choices: { [o.key]: 'clocked' } })
  const [li] = rows(await db.execute(sql`SELECT billed_basis, time_entry_id, description FROM invoice_line_items WHERE invoice_id = ${pv.json.id}`))
  check('…as an "unscheduled" line tied to the punch', li?.billed_basis === 'unscheduled' && li.time_entry_id === e.id && /unscheduled/.test(li.description), li)
  // a sub-minute tap is not a visit at all
  const c3b = await mkClient('Tap', { referredById: payer.id })
  await punch(c3b.id, cgB.id, '2026-09-09', '10:00', '10:00', { billableMinutes: 0, durationMinutes: 0 })
  const tap = await reconcile(c3b.id, '2026-09-07', '2026-09-13')
  check('a 0-minute tap is not even listed', tap.json.reconcile?.length === 0, tap.json)
}

// ── 4. double-billing guards ────────────────────────────────────────────────────────────────────
{
  // (a) twin punch: one shift, two completed clock-ins → billed once
  const t = await mkClient('Twin', { referredById: payer.id })
  await weekly(t.id, cgA.id, '2026-09-07', '08:00', '12:00')
  await punch(t.id, cgA.id, '2026-09-07', '08:00', '12:00')
  await punch(t.id, cgA.id, '2026-09-07', '08:01', '12:00')
  const r = await reconcile(t.id, '2026-09-07', '2026-09-07')
  check('twin punch: one billable day, the twin is neither billed nor listed', r.json.reconcile?.length === 1 && near(r.json.total, 132), r.json.reconcile)

  // (b) a substitute's punch covers > 50% of the assigned caregiver's unclocked window → the
  //     assigned line is suppressed; the substitute's own scheduled visit bills.
  const s = await mkClient('Substitute', { referredById: payer.id })
  await once(s.id, cgA.id, '2026-09-10', '11:00', '14:00') // Alice scheduled, never came
  await once(s.id, cgB.id, '2026-09-10', '11:00', '14:00') // Bea scheduled the same window…
  await punch(s.id, cgB.id, '2026-09-10', '10:59', '14:02') // …and worked it
  const rs = await reconcile(s.id, '2026-09-10', '2026-09-10')
  check('substitute: only the visit that was worked bills (3h × $33 = $99.00)', rs.json.reconcile?.length === 1 && rs.json.reconcile[0].caregiver_id === cgB.id && near(rs.json.total, 99), rs.json.reconcile)

  // (c) coverage extension: Alice 8–10 stays to 1:10 and absorbs Bea's unclocked 10–1.
  //     Alice's own block 120 + Bea's 180 = 300 min; she worked 309 ≥ 300 − 7, so the combined block
  //     bills; |309 − 300| = 9 > 7 → a choice, default scheduled = 5h × $33 = $165.00.
  const cov = await mkClient('Coverage', { referredById: payer.id })
  await once(cov.id, cgA.id, '2026-09-11', '08:00', '10:00')
  await once(cov.id, cgB.id, '2026-09-11', '10:00', '13:00')
  await punch(cov.id, cgA.id, '2026-09-11', '08:01', '13:10')
  const rc = await reconcile(cov.id, '2026-09-11', '2026-09-11')
  const only = rc.json.reconcile?.[0]
  check('coverage: one day, billed to the coverer, combined scheduled block 300 min', rc.json.reconcile?.length === 1 && only.caregiver_id === cgA.id && only.scheduled_minutes === 300, rc.json.reconcile)
  check('coverage: default bills 5h × $33 = $165.00', near(rc.json.total, 165), rc.json.total)

  // (d) two caregivers' schedules overlapping on one day both bill — and both are flagged
  const ov = await mkClient('Overlap', { referredById: payer.id })
  await once(ov.id, cgA.id, '2026-09-14', '08:00', '15:00')
  await once(ov.id, cgB.id, '2026-09-14', '12:00', '15:00')
  const ro = await reconcile(ov.id, '2026-09-14', '2026-09-14')
  check('overlapping handoff: both flagged with the 180-minute overlap, by name',
    ro.json.reconcile?.length === 2 && ro.json.reconcile.every((x: any) => x.overlap_minutes === 180) && ro.json.reconcile.some((x: any) => x.overlap_with === 'Bea U'), ro.json.reconcile)
  check('…and both still bill (7h + 3h = 10h × $33 = $330.00) — the fix is the schedule', near(ro.json.total, 330), ro.json.total)

  // (e) the same caregiver on two duplicate schedules with one punch → one line
  const dd = await mkClient('DupSched', { referredById: payer.id })
  await weekly(dd.id, cgA.id, '2026-09-07', '09:00', '11:00')
  await once(dd.id, cgA.id, '2026-09-07', '09:00', '11:00')
  await punch(dd.id, cgA.id, '2026-09-07', '09:00', '11:00')
  const rd = await reconcile(dd.id, '2026-09-07', '2026-09-07')
  check('duplicate schedule rows with one clock-in bill once ($66.00)', rd.json.reconcile?.length === 1 && near(rd.json.total, 66), rd.json.reconcile)
}

// ── 5. rates: per-15-minute units; care-type preference; no rate refuses ──────────────────────
{
  const u = await mkClient('Units', { referredById: unitPayer.id })
  await once(u.id, cgA.id, '2026-09-16', '09:00', '12:00') // 3h = 12 units × $7.56
  const r = await preview(u.id, '2026-09-16', '2026-09-16')
  check('a per-15-minute rate bills units: 12 × $7.56 = $90.72', near(r.json.total, 90.72), r.json)

  const [ct] = await db.insert(careTypes).values({ name: 'Companion' } as any).returning()
  await db.insert(referralSourceRates).values({ referralSourceId: payer.id, careTypeId: ct.id, rateAmount: '28.00', rateType: 'hourly', isActive: true } as any)
  const ctc = await mkClient('CareType', { referredById: payer.id, careTypeId: ct.id })
  await once(ctc.id, cgA.id, '2026-09-16', '09:00', '11:00')
  const rc = await preview(ctc.id, '2026-09-16', '2026-09-16')
  check("the care type's own rate wins over the payer default: 2h × $28 = $56.00", near(rc.json.total, 56), rc.json.total)

  const nr = await mkClient('NoRate', {})
  await once(nr.id, cgA.id, '2026-09-16', '09:00', '11:00')
  const x = await reconcile(nr.id, '2026-09-16', '2026-09-16')
  check('no rate anywhere: refused (400) with the fix named — never a silent $25', x.status === 400 && /No billing rate/.test(x.json.error) && /Private Pay Rate/.test(x.json.message), x.json)
  const mr = await A('GET', '/api/billing/missing-rates')
  check('missing-rates lists nothing for a payer whose default rate covers every care type', mr.status === 200 && Array.isArray(mr.json), mr.json)
}

// ── 6. the schedule engine: bi-weekly, cancelled, reason-coded, training ──────────────────────
{
  const bw = await mkClient('Biweekly', { referredById: payer.id })
  await weekly(bw.id, cgA.id, '2026-09-07', '09:00', '10:00', { frequency: 'biweekly', anchorDate: '2026-09-07' })
  const r = await preview(bw.id, '2026-09-07', '2026-10-04')
  check('bi-weekly: 09-07 and 09-21 only', r.json.lineItems?.map((l: any) => l.service_date).join(',') === '2026-09-07,2026-09-21', r.json.lineItems?.map((l: any) => l.service_date))

  const cx = await mkClient('Cancelled', { referredById: payer.id })
  const sc = await weekly(cx.id, cgA.id, '2026-09-07', '09:00', '10:00')
  await db.insert(scheduleExceptions).values({ scheduleId: sc.id, exceptionDate: '2026-09-14', exceptionType: 'cancelled', createdBy: admin.id } as any)
  const rc = await reconcile(cx.id, '2026-09-07', '2026-09-20')
  check('a cancelled occurrence never bills', rc.json.reconcile?.map((x: any) => x.service_date).join(',') === '2026-09-07', rc.json.reconcile?.map((x: any) => x.service_date))
  check('…and without a cancel_reason column nothing is listed as skipped', Array.isArray(rc.json.skipped) && rc.json.skipped.length === 0, rc.json.skipped)

  // The visits port adds cancel_reason and is_training. Simulate it and the engine honours both.
  await db.execute(sql`ALTER TABLE schedule_exceptions ADD COLUMN IF NOT EXISTS cancel_reason varchar(40)`)
  await db.execute(sql`UPDATE schedule_exceptions SET cancel_reason = 'client_hospital', override_notes = 'In hospital' WHERE schedule_id = ${sc.id}`)
  const rc2 = await reconcile(cx.id, '2026-09-07', '2026-09-20')
  check('once cancel_reason exists, the reason-coded day is listed as not billed', rc2.json.skipped?.length === 1 && rc2.json.skipped[0].reason === 'client_hospital' && rc2.json.skipped[0].service_date === '2026-09-14', rc2.json.skipped)
  check('…and is still not billed', rc2.json.reconcile?.length === 1, rc2.json.reconcile)

  await db.execute(sql`ALTER TABLE schedules ADD COLUMN IF NOT EXISTS is_training boolean NOT NULL DEFAULT false`)
  const tr = await mkClient('Training', { referredById: payer.id })
  await once(tr.id, cgA.id, '2026-09-17', '09:00', '13:00')
  const trainee = await once(tr.id, cgB.id, '2026-09-17', '09:00', '13:00')
  await db.execute(sql`UPDATE schedules SET is_training = true WHERE id = ${trainee.id}`)
  await punch(tr.id, cgB.id, '2026-09-17', '09:00', '13:00', { scheduleId: trainee.id })
  const rt = await reconcile(tr.id, '2026-09-17', '2026-09-17')
  check("a training (shadow) shift and the trainee's punch never bill — the trainer's visit does", rt.json.reconcile?.length === 1 && rt.json.reconcile[0].caregiver_id === cgA.id && near(rt.json.total, 132), rt.json.reconcile)
}

// ── 7. drafts, the portal, payments, editing ───────────────────────────────────────────────────
{
  const pc = await mkClient('Portal', { referredById: payer.id, portalEnabled: true, portalToken: 'portal-tok-billing' })
  await weekly(pc.id, cgA.id, '2026-09-07', '09:00', '13:00')
  const g = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: pc.id, billingPeriodStart: '2026-09-07', billingPeriodEnd: '2026-09-20' })
  check('a two-week invoice: 2 Mondays × $132 = $264.00, a draft', g.status === 201 && near(g.json.total, 264) && g.json.sent_at == null, g.json)
  const portalInv = async () => {
    const r = await app.request('/api/portal/invoices', { headers: { 'x-portal-token': 'portal-tok-billing' } })
    return { status: r.status, json: await r.json() }
  }
  let p = await portalInv()
  check('the family portal does NOT show a draft', p.status === 200 && Array.isArray(p.json) && !p.json.some((i: any) => i.id === g.json.id), p.json)
  const pdf = await app.request(`/api/portal/invoices/${g.json.id}/pdf`, { headers: { 'x-portal-token': 'portal-tok-billing' } })
  check("…nor serve a draft's PDF (404)", pdf.status === 404, pdf.status)
  const rescindDraft = await A('POST', `/api/billing/invoices/${g.json.id}/rescind`)
  check('rescinding a draft is refused — nothing to rescind', rescindDraft.status === 400, rescindDraft.json)
  const rel = await A('POST', `/api/billing/invoices/${g.json.id}/release`)
  check('release stamps sent_at', rel.status === 200 && !!rel.json.sent_at, rel.json)
  p = await portalInv()
  check('once released, the portal shows it', p.json.some((i: any) => i.id === g.json.id), p.json?.map?.((i: any) => i.id))
  const { isClientVisibleInvoice } = await import('./src/services/invoiceEngine.ts')
  check('isClientVisibleInvoice: a draft no, sent yes, a paid or partial draft yes',
    !isClientVisibleInvoice({ sent_at: null, payment_status: 'pending' }) && isClientVisibleInvoice({ sent_at: new Date(), payment_status: 'pending' })
    && isClientVisibleInvoice({ sentAt: null, paymentStatus: 'partial' }) && isClientVisibleInvoice({ sent_at: null, payment_status: 'paid' }))
  const resc = await A('POST', `/api/billing/invoices/${g.json.id}/rescind`)
  check('rescind returns it to draft', resc.status === 200, resc.json)
  p = await portalInv()
  check('…and the portal hides it again', !p.json.some((i: any) => i.id === g.json.id), p.json)
  await A('POST', `/api/billing/invoices/${g.json.id}/release`)

  // payments: overpayment refused, partial, paid; edits locked once money is in
  const over = await A('POST', '/api/billing/invoice-payments', { invoiceId: g.json.id, amount: 264.02, paymentDate: '2026-09-25' })
  check('a payment past the balance is refused (409), naming the balance', over.status === 409 && near(over.json.balanceDue, 264), over.json)
  const neg = await A('POST', '/api/billing/invoice-payments', { invoiceId: g.json.id, amount: -5 })
  check('a non-positive payment is refused (400)', neg.status === 400, neg.json)
  const p1 = await A('POST', '/api/billing/invoice-payments', { invoiceId: g.json.id, amount: 100, paymentDate: '2026-09-25', paymentMethod: 'check' })
  let [inv] = rows(await db.execute(sql`SELECT payment_status, amount_paid FROM invoices WHERE id = ${g.json.id}`))
  check('$100 of $264: partial, amount_paid $100', p1.status === 201 && inv.payment_status === 'partial' && near(inv.amount_paid, 100), inv)
  const lockedResc = await A('POST', `/api/billing/invoices/${g.json.id}/rescind`)
  check('rescind is refused once a payment is recorded', lockedResc.status === 400 && /payment has been recorded/.test(lockedResc.json.error), lockedResc.json)
  const lockedEdit = await A('PUT', `/api/billing/invoices/${g.json.id}/line-items`, { lineItems: [{ description: 'x', hours: 1, caregiver_id: cgA.id }] })
  check('line items cannot be edited once a payment is recorded (409)', lockedEdit.status === 409, lockedEdit.json)
  const over2 = await A('POST', '/api/billing/invoice-payments', { invoiceId: g.json.id, amount: 164.5 })
  check('the second payment is checked against what is left ($164.00)', over2.status === 409 && near(over2.json.balanceDue, 164), over2.json)
  const p2 = await A('POST', '/api/billing/invoice-payments', { invoiceId: g.json.id, amount: 164, paymentDate: '2026-09-26' })
  ;[inv] = rows(await db.execute(sql`SELECT payment_status, amount_paid, to_char(payment_date,'YYYY-MM-DD') AS pd FROM invoices WHERE id = ${g.json.id}`))
  check('paid in full: status paid, amount_paid $264, dated the final payment', inv.payment_status === 'paid' && near(inv.amount_paid, 264) && inv.pd === '2026-09-26', inv)
  const del = await A('DELETE', `/api/billing/invoice-payments/${p2.json.id}`)
  ;[inv] = rows(await db.execute(sql`SELECT payment_status, amount_paid FROM invoices WHERE id = ${g.json.id}`))
  check('removing a payment rolls the invoice back to partial $100', del.status === 200 && inv.payment_status === 'partial' && near(inv.amount_paid, 100), inv)
  const adj = await A('POST', '/api/billing/invoice-adjustments', { invoiceId: g.json.id, amount: 164, type: 'write_off', reason: 'Hardship' })
  ;[inv] = rows(await db.execute(sql`SELECT payment_status, amount_adjusted FROM invoices WHERE id = ${g.json.id}`))
  check('a write-off of the rest settles it: paid', adj.status === 201 && inv.payment_status === 'paid' && near(inv.amount_adjusted, 164), inv)

  // editing an unpaid invoice: the rate is the client's, never the form's
  const g3 = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: pc.id, billingPeriodStart: '2026-09-21', billingPeriodEnd: '2026-09-27' })
  const ed = await A('PUT', `/api/billing/invoices/${g3.json.id}/line-items`, { lineItems: [
    { description: 'Home Care Services', hours: 3, rate: 50, serviceDate: '2026-09-21' },
    { description: 'Courtesy visit', hours: 1, rate: 0, serviceDate: '2026-09-22' },
  ] })
  check('edit: 3h at the payer rate $33 (not the $50 sent) + a $0 write-off line = $99.00', ed.status === 200 && near(ed.json.total, 99) && ed.json.line_items?.length === 2, ed.json)
}

// ── 8. manual invoices take the client's rate ──────────────────────────────────────────────────
{
  const mc = await mkClient('Manual', { isPrivatePay: true, privatePayRate: '30.00' })
  const r = await A('POST', '/api/billing/invoices/manual', {
    clientId: mc.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30', detailedMode: true,
    lineItems: [
      { caregiverId: cgA.id, description: 'Home Care Services', hours: '2', rate: '33.03', serviceDate: '2026-09-02', startTime: '13:30', endTime: '15:30' },
      { caregiverId: cgA.id, description: 'No charge', hours: '1', rate: '0', serviceDate: '2026-09-03' },
    ],
  })
  check('manual: the typed $33.03 is ignored, the client rate $30 stamped: 2h = $60.00', r.status === 201 && near(r.json.total, 60), r.json)
  check('…the detailed time prints 12-hour ("1:30 PM - 3:30 PM")', r.json.line_items?.[0]?.description === 'Home Care Services (1:30 PM - 3:30 PM)', r.json.line_items?.[0])
  const noCg = await A('POST', '/api/billing/invoices/manual', { clientId: mc.id, billingPeriodStart: '2026-10-01', billingPeriodEnd: '2026-10-31', lineItems: [{ hours: 1 }] })
  check('a manual line with no caregiver is refused before anything is written', noCg.status === 400 && /caregiver/.test(noCg.json.error), noCg.json)
  const nr = await mkClient('ManualNoRate', {})
  const r2 = await A('POST', '/api/billing/invoices/manual', { clientId: nr.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30', lineItems: [{ caregiverId: cgA.id, hours: 1, rate: 40 }] })
  check('manual with no client rate is refused even when the form sends one', r2.status === 400 && /No billing rate/.test(r2.json.error), r2.json)
  const uc = await mkClient('ManualUnits', { referredById: unitPayer.id })
  const r3 = await A('POST', '/api/billing/invoices/manual', { clientId: uc.id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30', lineItems: [{ caregiverId: cgA.id, hours: 3 }] })
  check('a per-15-minute payer rate bills units on a manual line too: 12 × $7.56 = $90.72', near(r3.json.total, 90.72), r3.json.total)
}

// ── 9. payer rates: a new rate retires the old one ─────────────────────────────────────────────
{
  const [rp] = await db.insert(referralSources).values({ name: 'Rate Payer', payerType: 'va' } as any).returning()
  const r1 = await A('POST', '/api/billing/referral-source-rates', { referralSourceId: rp.id, rateAmount: 31, rateType: 'hourly', effectiveDate: '2026-01-01' })
  const r2 = await A('POST', '/api/billing/referral-source-rates', { referralSourceId: rp.id, rateAmount: 34, rateType: 'hourly', effectiveDate: '2026-10-01' })
  const list = rows(await db.execute(sql`SELECT rate_amount, is_active, to_char(end_date,'YYYY-MM-DD') AS e FROM referral_source_rates WHERE referral_source_id = ${rp.id} ORDER BY effective_date`))
  check('the old rate is retired, ending on the new one\'s effective date', r1.status === 201 && r2.status === 201 && list[0].is_active === false && list[0].e === '2026-10-01' && list[1].is_active === true, list)
  const bad = await A('POST', '/api/billing/referral-source-rates', { referralSourceId: rp.id, rateAmount: 0 })
  check('a zero rate is refused', bad.status === 400, bad.json)
  const rc = await mkClient('RateHistory', { referredById: rp.id })
  await once(rc.id, cgA.id, '2026-09-15', '09:00', '10:00')
  const pv = await preview(rc.id, '2026-09-15', '2026-09-15')
  check("a September visit bills at the rate in force then ($31), not October's new $34", near(pv.json.total, 31), pv.json.total)
  const lst = await A('GET', '/api/billing/referral-source-rates')
  const row = lst.json.find((x: any) => x.referral_source_id === rp.id && x.is_active)
  check('rates list carries how many active clients use each', row?.client_count === 1, row)
}

// ── 10. Create Due Invoices: complete periods only, never on a guess ───────────────────────────
{
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const plus = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
  const bt = plus(today, -30)
  const cad = await mkClient('Cadence', { referredById: payer.id, billingFrequencyWeeks: 2, billedThrough: bt })
  await weekly(cad.id, cgA.id, '2026-01-05', '09:00', '13:00') // every Monday, 4h
  const rev = await mkClient('Review', { referredById: payer.id, billingFrequencyWeeks: 2, billedThrough: bt })
  await weekly(rev.id, cgA.id, '2026-01-06', '09:00', '13:00') // every Tuesday
  const firstTue = (() => { for (let i = 1; i <= 7; i++) { const d = plus(bt, i); if (new Date(d + 'T12:00:00Z').getUTCDay() === 2) return d } return '' })()
  await punch(rev.id, cgA.id, firstTue, '09:00', '10:00') // short by 3h in the first period → review
  const fresh = await mkClient('NoAnchor', { referredById: payer.id, billingFrequencyWeeks: 2 })

  const sched = await A('GET', '/api/billing/invoices/billing-schedule')
  const sc = sched.json.find((x: any) => x.id === cad.id)
  check('billing schedule: 30 days since billed_through at 2-week cadence → 2 periods due', sc?.periods_due === 2 && sc.billed_through === bt, sc)
  const bad = await A('PATCH', `/api/billing/invoices/billing-schedule/${fresh.id}`, { weeks: 9 })
  check('a cadence outside 1-8 weeks is refused', bad.status === 400, bad.json)

  const dry = await A('POST', '/api/billing/invoices/generate-due', { dryRun: true })
  const dryCad = dry.json.created?.filter((x: any) => x.name === 'Cadence Client') || []
  check('dry run: two complete periods for the cadence client, previewed at 2 × $132 = $264 each', dryCad.length === 2 && dryCad.every((x: any) => near(x.total, 264) && x.invoiceNumber === '(preview)'), dry.json)
  const [{ n: before }] = rows(await db.execute(sql`SELECT COUNT(*)::int AS n FROM invoices WHERE client_id = ${cad.id}`))
  check('…and wrote nothing', before === 0, before)

  const run = await A('POST', '/api/billing/invoices/generate-due', {})
  const made = run.json.created?.filter((x: any) => x.name === 'Cadence Client') || []
  check('Create Due Invoices: two drafts for the cadence client', made.length === 2, run.json)
  const periods = rows(await db.execute(sql`SELECT to_char(billing_period_start,'YYYY-MM-DD') AS s, to_char(billing_period_end,'YYYY-MM-DD') AS e, total, sent_at FROM invoices WHERE client_id = ${cad.id} ORDER BY billing_period_start`))
  check('…covering exactly the two complete periods after billed_through, as drafts',
    periods.length === 2 && periods[0].s === plus(bt, 1) && periods[0].e === plus(bt, 14) && periods[1].s === plus(bt, 15) && periods[1].e === plus(bt, 28) && periods.every((p) => p.sent_at == null && near(p.total, 264)), periods)
  const [cadRow] = rows(await db.execute(sql`SELECT to_char(billed_through,'YYYY-MM-DD') AS bt FROM clients WHERE id = ${cad.id}`))
  check('…and billed_through advanced to the end of the second period (the third is still in progress)', cadRow.bt === plus(bt, 28), cadRow)
  const revSkip = run.json.skipped?.find((x: any) => x.name === 'Review Client')
  check('a client with a clock-in that disagrees is skipped for review, not billed on a guess', !!revSkip?.needsReview && /clock-in/.test(revSkip.reason), run.json.skipped)
  const [revRow] = rows(await db.execute(sql`SELECT to_char(billed_through,'YYYY-MM-DD') AS bt, (SELECT COUNT(*)::int FROM invoices WHERE client_id = ${rev.id}) AS n FROM clients WHERE id = ${rev.id}`))
  check('…its billed_through does not move and no invoice exists', revRow.bt === bt && revRow.n === 0, revRow)
  check('a cadence client with no first invoice is skipped with the reason', run.json.skipped?.some((x: any) => x.name === 'NoAnchor Client' && /No previous invoice/.test(x.reason)), run.json.skipped)
  const again = await A('POST', '/api/billing/invoices/generate-due', {})
  check('running it again creates nothing for the cadence client', !(again.json.created || []).some((x: any) => x.name === 'Cadence Client'), again.json.created)

  // Deleting the latest auto-billed invoice steps billed_through back so the period is billed again.
  const [last] = rows(await db.execute(sql`SELECT id FROM invoices WHERE client_id = ${cad.id} ORDER BY billing_period_start DESC LIMIT 1`))
  const d = await A('DELETE', `/api/billing/invoices/${last.id}`)
  const [afterDel] = rows(await db.execute(sql`SELECT to_char(billed_through,'YYYY-MM-DD') AS bt FROM clients WHERE id = ${cad.id}`))
  check('deleting the latest period steps billed_through back to before it', d.status === 200 && afterDel.bt === plus(bt, 14), afterDel)
}

// ── 11. batch generation skips what needs review ──────────────────────────────────────────────
{
  const bOk = await mkClient('BatchOk', { referredById: payer.id })
  await once(bOk.id, cgA.id, '2026-08-03', '09:00', '11:00')
  const bRev = await mkClient('BatchReview', { referredById: payer.id })
  await once(bRev.id, cgA.id, '2026-08-04', '09:00', '13:00')
  await punch(bRev.id, cgA.id, '2026-08-04', '09:00', '10:00')
  const r = await A('POST', '/api/billing/invoices/batch-generate', { billingPeriodStart: '2026-08-01', billingPeriodEnd: '2026-08-31' })
  check('batch: the schedule-only client is invoiced (no punch needed) — 2h × $33', r.status === 200 && r.json.invoices?.some((i: any) => i.clientName === 'BatchOk Client' && near(i.total, 66)), r.json)
  check('batch: the client with an unresolved day is skipped for review', r.json.skippedClients?.some((s: any) => s.name === 'BatchReview Client' && s.needsReview), r.json.skippedClients)
}

// ── 12. invoice from picked visits; the care note prints on the invoice ───────────────────────
{
  const fv = await mkClient('Picked', { referredById: payer.id })
  await weekly(fv.id, cgB.id, '2026-09-07', '10:00', '12:00') // Mondays, 2h
  const vis = await A('GET', `/api/billing/scheduled-visits?clientId=${fv.id}&from=2026-09-07&to=2026-09-27`)
  check('scheduled visits for picking: three Mondays, none billed yet', vis.status === 200 && vis.json.length === 3 && vis.json.every((v: any) => v.billed_on == null), vis.json)
  const pick = (dates: string[]) => A('POST', '/api/billing/invoices/from-visits', { clientId: fv.id, visits: dates.map((d) => ({ visitDate: d, startTime: '10:00', caregiverId: cgB.id })) })
  const r = await pick(['2026-09-07', '2026-09-14'])
  check('two picked visits: 2 × 2h × $33 = $132.00, a draft', r.status === 201 && near(r.json.total, 132) && r.json.sent_at == null && r.json.visits === 2, r.json)
  const again = await pick(['2026-09-14'])
  check('a visit already billed is refused (409), naming the invoice', again.status === 409 && /already billed/.test(again.json.error), again.json)
  const off = await A('POST', '/api/billing/invoices/from-visits', { clientId: fv.id, visits: [{ visitDate: '2026-09-15', startTime: '10:00', caregiverId: cgB.id }] })
  check('a time that is not a scheduled visit is refused (400)', off.status === 400 && /not a scheduled visit/.test(off.json.error), off.json)
  const vis2 = await A('GET', `/api/billing/scheduled-visits?clientId=${fv.id}&from=2026-09-07&to=2026-09-27`)
  check('the picker now marks the billed visits', vis2.json.filter((v: any) => v.billed_on).length === 2, vis2.json)

  // visits' visit_documentation (the office-entered visit note) and care's client_task_templates
  await db.execute(sql`INSERT INTO visit_documentation (id, client_id, caregiver_id, visit_date, start_time, end_time, tasks, note)
    VALUES ('vd1', ${fv.id}, ${cgB.id}, '2026-09-07', '10:00', '12:00', ${JSON.stringify([{ taskName: 'Meal prep', done: true }])}, 'Ate well, walked to the mailbox.')`)
  const inv = await A('GET', `/api/billing/invoices/${r.json.id}`)
  const withNote = inv.json.line_items?.find((l: any) => l.service_date === '2026-09-07')
  const without = inv.json.line_items?.find((l: any) => l.service_date === '2026-09-14')
  check("the invoice carries each visit's own care note", withNote?.visit_note === 'Ate well, walked to the mailbox.' && without && without.visit_note == null, inv.json.line_items)

  await db.execute(sql`INSERT INTO client_task_templates (id, client_id, task_name, is_active, category, allotted_minutes)
    VALUES ('t1', ${fv.id}, 'Light housekeeping', true, 'iadl', 30)`)
  const split = await pick(['2026-09-21'])
  const sl = rows(await db.execute(sql`SELECT description, hours, scheduled_minutes FROM invoice_line_items WHERE invoice_id = ${split.json.id} ORDER BY scheduled_minutes DESC`))
  check('with a 30-minute homemaking task the visit bills 90 min aide + 30 min homemaking', sl.length === 2 && sl[0].scheduled_minutes === 90 && /^Home health aide/.test(sl[0].description) && sl[1].scheduled_minutes === 30 && /^Homemaking/.test(sl[1].description), sl)
}

// ── 13. insurer-portal claim days (CVHC's MIDAS S5125 / S5130 page) ───────────────────────────
{
  const cp = await A('GET', '/api/billing/claim-portals')
  const preset = cp.json.presets?.find((p: any) => p.id === 'wi-my-choice-midas')
  check('a Wisconsin agency is offered the My Choice / MIDAS preset', !!preset && preset.config.evvCode === 'S5125' && preset.config.otherCode === 'S5130', cp.json.presets)
  const [mco] = await db.insert(referralSources).values({ name: 'Family Care MCO', payerType: 'mco_family_care' } as any).returning()
  const none = await A('GET', `/api/billing/portal-claim-days?payerId=${mco.id}&weekStart=2026-09-09`)
  check('a payer with no portal set up is refused with the reason', none.status === 400 && /no portal export/.test(none.json.error), none.json)
  const badCfg = await A('PUT', `/api/billing/claim-portals/${mco.id}`, { claimPortal: { name: 'MIDAS' } })
  check('a portal config without both codes is refused', badCfg.status === 400, badCfg.json)
  const put = await A('PUT', `/api/billing/claim-portals/${mco.id}`, { claimPortal: preset.config })
  check('the preset saves onto the payer', put.status === 200 && put.json.claim_portal?.name === 'MIDAS', put.json)

  const ev = await mkClient('EvvMember', { referredById: mco.id, medicaidId: '1234567890' })
  const hm = await mkClient('NoMedicaid', { referredById: mco.id })
  const e1 = await punch(ev.id, cgA.id, '2026-09-07', '09:00', '10:08') // 68 min
  await punch(ev.id, cgA.id, '2026-09-08', '09:00', '10:08')
  const e3 = await punch(ev.id, cgA.id, '2026-09-09', '09:00', '10:08')
  await punch(hm.id, cgB.id, '2026-09-10', '09:00', '11:00') // 120 min, no Medicaid ID → not EVV
  const week = () => A('GET', `/api/billing/portal-claim-days?payerId=${mco.id}&weekStart=2026-09-09`)
  let w = await week()
  check('weekStart snaps back to its Sunday', w.status === 200 && w.json.week_start === '2026-09-06' && w.json.week_end === '2026-09-12', w.json)
  let evc = w.json.clients?.find((x: any) => x.client_id === ev.id)
  // No allowance entered (evv_weekly_units not there yet) → every EVV minute is EVV: round(68/15) = 5 a day.
  check('no allowance: three days of 5 EVV units (68 min → 4.53 → 5)', evc?.days?.map((d: any) => d.evvUnits).join(',') === '5,5,5' && evc.totals.evvUnits === 15 && evc.totals.homemakerUnits === 0, evc)
  const hmc = w.json.clients?.find((x: any) => x.client_id === hm.id)
  check('a member with no Medicaid ID is all homemaker time: 120 min = 8 units', hmc?.in_evv === false && hmc.totals.evvUnits === 0 && hmc.totals.homemakerUnits === 8, hmc)

  // The EVV port adds clients.evv_weekly_units and time_entries.sandata_required — simulate both.
  await db.execute(sql`ALTER TABLE clients ADD COLUMN IF NOT EXISTS evv_weekly_units integer`)
  await db.execute(sql`UPDATE clients SET evv_weekly_units = 14 WHERE id = ${ev.id}`)
  w = await week()
  evc = w.json.clients?.find((x: any) => x.client_id === ev.id)
  // 14 units = 210 min: Mon 68, Tue 68, Wed 68 of the remaining 74 → 5, 5, 5 = 15 > 14 → trim the
  // latest day: Wed 4 EVV + 1 homemaker.
  check('allowance 14: rounding never claims more — Wed trimmed to 4 EVV + 1 homemaker', evc?.days?.map((d: any) => `${d.evvUnits}/${d.homemakerUnits}`).join(',') === '5/0,5/0,4/1' && evc.totals.evvUnits === 14 && evc.totals.evvAuthorizedUnits === 14, evc?.days)
  await db.execute(sql`ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS sandata_required boolean`)
  await db.execute(sql`UPDATE time_entries SET sandata_required = false WHERE id = ${e3.id}`)
  await db.execute(sql`UPDATE time_entries SET sandata_required = true WHERE id = ${e1.id}`)
  w = await week()
  evc = w.json.clients?.find((x: any) => x.client_id === ev.id)
  check('a visit not sent to EVV bills homemaker: Wed 0 EVV + 5 homemaker', evc?.days?.map((d: any) => `${d.evvUnits}/${d.homemakerUnits}`).join(',') === '5/0,5/0,0/5', evc?.days)
  check('each day lists its visits on the agency clock', evc?.days?.[0]?.visits?.[0]?.clock_in === '9:00 AM' && evc.days[0].visits[0].clock_out === '10:08 AM', evc?.days?.[0]?.visits)
}

// ── 14. claims: units from billable minutes, hourly ÷ 4, draft, deduct once ───────────────────
{
  const { claimUnitsAndCharge } = await import('./src/services/claimsEngine.ts')
  const a = claimUnitsAndCharge({ billableMinutes: 120, payerRate: { rateAmount: 33, rateType: 'hourly' } })
  check('claim math: 120 billable min = 8 units × ($33 ÷ 4) = $66.00', a.units === 8 && a.charge === 66, a)
  const b = claimUnitsAndCharge({ billableMinutes: null, durationMinutes: 50, payerRate: { rateAmount: 7.56, rateType: '15min' } })
  check('claim math: no billable minutes → duration 50 min = 3.33 units × $7.56 = $25.17', b.units === 3.33 && b.charge === 25.17, b)
  const sc = claimUnitsAndCharge({ billableMinutes: 60, payerRate: null, serviceCodeRatePerUnit: 6.25 })
  check('claim math: no payer rate → the service code rate per unit (4 × $6.25 = $25.00)', sc.charge === 25, sc)

  const cc = await mkClient('Claimant', { referredById: payer.id, medicaidId: '5550001112' })
  const te = await punch(cc.id, cgA.id, '2026-09-07', '09:00', '13:30', { billableMinutes: 240 }) // raw 270, clean 240
  const [auth] = rows(await db.execute(sql`INSERT INTO authorizations (id, client_id, payer_id, auth_number, authorized_units, unit_type, used_units, start_date, end_date, status)
    VALUES ('auth-1', ${cc.id}, ${payer.id}, 'A-100', 100, '15min', 0, '2026-01-01', '2027-12-31', 'active') RETURNING id`))
  await db.execute(sql`INSERT INTO evv_visits (id, time_entry_id, client_id, caregiver_id, authorization_id, service_code, service_date, actual_start, units_of_service)
    VALUES ('evv-1', ${te.id}, ${cc.id}, ${cgA.id}, ${auth.id}, 'T1019', '2026-09-07', ${te.startTime.toISOString()}, 18)`)
  const bg = await A('POST', '/api/claims/batch-generate', { startDate: '2026-09-01', endDate: '2026-09-30' })
  check('batch-generate claims the visit', bg.status === 200 && bg.json.generated === 1, bg.json)
  const list = await A('GET', '/api/claims')
  const cl = Array.isArray(list.json) ? list.json.find((x: any) => x.evv_visit_id === 'evv-1') : null
  check('the claim is a DRAFT for 16 units (240 clean min, not the 270 raw) × $8.25 = $132.00', cl?.status === 'draft' && near(cl.units_billed, 16) && near(cl.charge_amount, 132), cl)
  const again = await A('POST', '/api/claims/batch-generate', { startDate: '2026-09-01', endDate: '2026-09-30' })
  check('a claimed visit is never claimed twice', again.json.generated === 0, again.json)
  const sub = await A('POST', `/api/claims/${cl.id}/submit`)
  let [au] = rows(await db.execute(sql`SELECT used_units FROM authorizations WHERE id = 'auth-1'`))
  check('submitting deducts the 16 units from the authorization', sub.status === 200 && near(au.used_units, 16), [sub.json, au])
  const re = await A('POST', '/api/claims/update-status', { claimId: cl.id, status: 'submitted' })
  ;[au] = rows(await db.execute(sql`SELECT used_units FROM authorizations WHERE id = 'auth-1'`))
  check('re-submitting deducts nothing more (idempotent)', re.status === 200 && re.json.unitsDeducted === false && near(au.used_units, 16), [re.json, au])
  const den = await A('PUT', `/api/claims/${cl.id}/status`, { status: 'denied', denialCode: 'CO-16', denialReason: 'Missing info' })
  const q = await A('GET', '/api/claims/denial-queue')
  check('a denied claim appears in the denial queue with its code', den.status === 200 && q.json.some((x: any) => x.id === cl.id && x.denial_code === 'CO-16'), q.json)
  const rs = await A('POST', `/api/claims/${cl.id}/resubmit`)
  const [orig] = rows(await db.execute(sql`SELECT status FROM claims WHERE id = ${cl.id}`))
  check('resubmitting voids the denied claim and opens a pending copy for the same amount', rs.status === 201 && rs.json.status === 'pending' && near(rs.json.billed_amount, 132) && rs.json.resubmitted_from === cl.id && orig.status === 'voided', [rs.json, orig])
  const bad = await A('PUT', `/api/claims/${cl.id}/status`, { status: 'whatever' })
  check('an unknown claim status is refused', bad.status === 400, bad.json)
  await A('PUT', `/api/claims/${rs.json.id}/status`, { status: 'draft' })
  const ex = await A('POST', '/api/claims/export/portal', { claimIds: [rs.json.id] })
  check('the portal export is a CSV titled with the payer\'s portal (no portal set: "Insurer Portal")', ex.status === 200 && /Insurer Portal Upload Packet/.test(ex.text) && !/Generated:/.test(ex.text), ex.text.slice(0, 200))
  const sum = await A('GET', '/api/claims/reports/summary')
  check('the claims summary answers with aging buckets', sum.status === 200 && sum.json.aging && 'under_30' in sum.json.aging, sum.json)
}

// ── 16. email, import, exports, summary ───────────────────────────────────────────────────────
{
  const ec = await mkClient('Emailed', { referredById: payer.id, email: 'family@test.local' })
  await once(ec.id, cgA.id, '2026-08-10', '09:00', '11:00')
  const g = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: ec.id, billingPeriodStart: '2026-08-10', billingPeriodEnd: '2026-08-10' })
  const se = await A('POST', `/api/billing/invoices/${g.json.id}/send-email`, {})
  const [still] = rows(await db.execute(sql`SELECT sent_at FROM invoices WHERE id = ${g.json.id}`))
  check('with no email provider, "send" says so (503) and the invoice stays a draft — nothing claims it was sent', se.status === 503 && still.sent_at == null, [se.status, se.json, still])
  const rem = await A('POST', `/api/billing/invoices/${g.json.id}/send-reminder`, {})
  check('…the reminder too (503)', rem.status === 503, rem.json)
  const noMail = await mkClient('NoMail', { referredById: payer.id })
  await once(noMail.id, cgA.id, '2026-08-11', '09:00', '10:00')
  const g2 = await A('POST', '/api/billing/invoices/generate-with-rates', { clientId: noMail.id, billingPeriodStart: '2026-08-11', billingPeriodEnd: '2026-08-11' })
  const se2 = await A('POST', `/api/billing/invoices/${g2.json.id}/send-email`, {})
  check('a client with no email on file is told so (400)', se2.status === 400 && /No email/.test(se2.json.error), se2.json)

  const imc = await mkClient('Imported', { referredById: payer.id, medicaidId: '9998887776' })
  const imp = await A('POST', '/api/billing/import-csv', { source: 'Portal export', rows: [
    { clientId: imc.id, caregiverId: cgA.id, serviceDate: '2026-07-02', hours: '2', rate: '33' },
    { clientId: imc.id, caregiverId: cgA.id, serviceDate: '2026-07-09', hours: '1', amount: '40.50' },
    { clientId: imc.id, caregiverId: cgA.id, serviceDate: '2026-08-01', hours: '1', rate: '33' },
    { clientId: imc.id, serviceDate: '2026-07-10', hours: '1', rate: '33' },
    { caregiverId: cgA.id, serviceDate: '2026-07-10', hours: '1' },
  ] })
  const imInv = rows(await db.execute(sql`SELECT to_char(billing_period_start,'YYYY-MM-DD') AS s, to_char(billing_period_end,'YYYY-MM-DD') AS e, total, sent_at FROM invoices WHERE client_id = ${imc.id} ORDER BY billing_period_start`))
  check('import: one draft invoice per client per month — July $66 + $40.50 = $106.50, August $33',
    imp.status === 200 && imp.json.imported === 3 && imp.json.invoicesCreated === 2 && imInv.length === 2
    && imInv[0].s === '2026-07-01' && imInv[0].e === '2026-07-31' && near(imInv[0].total, 106.5) && near(imInv[1].total, 33) && imInv.every((i) => i.sent_at == null), [imp.json, imInv])
  check('import: rows with no client or no caregiver are skipped with the reason', imp.json.skipped === 2 && imp.json.errors.some((e: any) => /No caregiver/.test(e.error)) && imp.json.errors.some((e: any) => /No client/.test(e.error)), imp.json)
  const again = await A('POST', '/api/billing/import-csv', { rows: [{ clientId: imc.id, caregiverId: cgA.id, serviceDate: '2026-07-20', hours: '1', rate: '33' }] })
  check('importing into a month already invoiced is refused for that group, not duplicated', again.json.invoicesCreated === 0 && /already exists/.test(again.json.errors?.[0]?.error || ''), again.json)

  const csv = await A('GET', '/api/billing/export/invoices-csv')
  check('the invoices CSV carries the friendly number and the draft/sent state', csv.status === 200 && /^"Invoice #","Invoice Number"/.test(csv.text) && /"draft"/.test(csv.text), csv.text.slice(0, 160))
  const evv = await A('GET', '/api/billing/export/evv')
  check('the EVV export answers a CSV', evv.status === 200 && /^"ServiceDate","ClientFirstName"/.test(evv.text), evv.text.slice(0, 120))
  const sum = await A('GET', '/api/billing/billing-summary')
  check('the billing summary answers billed / collected / outstanding with by-payer and by-caregiver', sum.status === 200 && Number(sum.json.summary?.invoice_count) > 0 && Array.isArray(sum.json.byPayer) && Array.isArray(sum.json.byCaregiver), sum.json.summary)
  const one = await A('GET', `/api/billing/invoices/${g.json.id}`)
  check('an invoice reads with its client, lines and total hours (2.00)', one.status === 200 && one.json.first_name === 'Emailed' && one.json.line_items?.length === 1 && one.json.total_hours === 2, one.json)
  const missing = await A('GET', '/api/billing/invoices/nope-not-an-id')
  check('a missing invoice is a 404', missing.status === 404, missing.status)
}

// ── 15. who may: billing and claims are the office's ──────────────────────────────────────────
{
  const anyInv = rows(await db.execute(sql`SELECT id, client_id FROM invoices LIMIT 1`))[0]
  const ROUTES: Array<[string, string, unknown]> = [
    ['GET', '/api/billing/invoices', undefined],
    ['GET', `/api/billing/invoices/${anyInv.id}`, undefined],
    ['POST', '/api/billing/invoices/reconcile', { clientId: anyInv.client_id, billingPeriodStart: '2026-09-01', billingPeriodEnd: '2026-09-30' }],
    ['POST', '/api/billing/invoices/generate-with-rates', { clientId: anyInv.client_id, billingPeriodStart: '2026-07-01', billingPeriodEnd: '2026-07-31' }],
    ['POST', '/api/billing/invoices/generate-due', {}],
    ['PATCH', `/api/billing/invoices/billing-schedule/${anyInv.client_id}`, { weeks: 2 }],
    ['POST', `/api/billing/invoices/${anyInv.id}/release`, undefined],
    ['POST', `/api/billing/invoices/${anyInv.id}/rescind`, undefined],
    ['PUT', `/api/billing/invoices/${anyInv.id}/line-items`, { lineItems: [{ hours: 1 }] }],
    ['DELETE', `/api/billing/invoices/${anyInv.id}`, undefined],
    ['POST', '/api/billing/invoice-payments', { invoiceId: anyInv.id, amount: 1 }],
    ['POST', '/api/billing/referral-source-rates', { referralSourceId: payer.id, rateAmount: 1 }],
    ['PUT', `/api/billing/claim-portals/${payer.id}`, { claimPortal: null }],
    ['POST', '/api/billing/import-csv', { rows: [{}] }],
    ['GET', '/api/claims', undefined],
    ['POST', '/api/claims/batch-generate', { startDate: '2026-09-01', endDate: '2026-09-30' }],
    ['POST', '/api/claims/update-status', { claimId: 'x', status: 'paid' }],
  ]
  for (const [m, p, b] of ROUTES) {
    const r = await CG(m, p, b)
    check(`a caregiver is refused: ${m} ${p.replace(/[a-z0-9]{20,}/g, ':id')}`, r.status === 403 && r.json?.error === 'Admin access required', { status: r.status, body: r.json })
  }
  const o = await O('GET', '/api/billing/invoices')
  check('an owner reaches billing', o.status === 200, o.status)
  const oc = await O('GET', '/api/claims')
  check('an owner reaches claims', oc.status === 200, oc.status)
}

console.log(`\nhomecare-billing: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
