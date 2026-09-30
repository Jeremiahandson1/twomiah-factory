// crm-salon — RR2 R1, R2 and R3.
//
// R1 (HIGH) is mine, and it came out of my own N7 decision. I chose to ACCEPT a plain-string formula
// rather than refuse it, so nothing an API caller typed would be lost — and then normalised it on
// the CARD path only. The service-record writer copied its whitelist straight from the body, so
// PUT /api/service-records/:id { formula: "6N + 20vol" } answered 200 and stored the string. The
// client chart's visit list then ran `(r.formula || []).map(...)` on it and threw. The error boundary
// caught it and took down the WHOLE chart: formulas, appointments, account balance, for that client.
// `formula: true` did the same.
//
// `(x || [])` guards null. It does not guard a STRING, which is truthy and has no .map.
//
// THE RULE this file pins: a formula is ALWAYS a list of step objects, normalised at EVERY write —
// and the reader does not assume, because rows can already be in the table from the CSV importer, a
// migration, or any integration, and fixing the writer never heals what is already written.
//
// R2 (low)  "percent" and "pct" were on the percentage-word list and "percentage" was not, so
//           tipPercent 150 was refused and tipPercentage 150 saved.
// R3 (low)  N8 fixed the WRITE. 105 of 122 existing records still had no price and showed $0.00.
import { Hono } from 'hono'
import { eq, and, sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, serviceRecord } from './db/schema.ts'
import { normaliseFormula } from './src/services/clientFormulas.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'RR2 Salon', slug: 'rr2salon', email: 'rr2@test.local', enabledFeatures: ['salon_booking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-rr2@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [cut] = await db.insert(serviceMenu).values({
  name: "Women's Cut & Style", price: '65', durationMin: 45, companyId: co.id,
} as any).returning()
const [client] = await db.insert(contact).values({ name: 'RR2 Price', type: 'client', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.route('/api/company', (await import('./src/routes/company.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }

const mkVisit = async (opts: { price?: string | null; performedAt?: Date } = {}) => {
  const start = opts.performedAt || new Date(Date.now() - 5 * 86400000)
  const [appt] = await db.insert(appointment).values({
    companyId: co.id, contactId: client.id, serviceId: cut.id,
    startTime: start, endTime: new Date(start.getTime() + 45 * 60000), status: 'completed', title: 'Cut',
  } as any).returning()
  const [rec] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: client.id, appointmentId: appt.id, serviceId: cut.id,
    performedAt: start, formula: [], priceCharged: opts.price ?? null,
  } as any).returning()
  return { appt, rec }
}

// ══════════ R1 · a formula is a list of steps at EVERY write ════════════════════════════════════
{
  const { rec } = await mkVisit()

  // The exact call from the report.
  const str = await api('PUT', `/api/service-records/${rec.id}`, { formula: '6N + 20vol' })
  check('R1: PUT with a string formula is accepted, as N7 decided', str.status === 200, { status: str.status, body: str.json })

  const [afterStr] = await rows(sql`SELECT formula FROM service_record WHERE id = ${rec.id}`)
  const stored = typeof afterStr?.formula === 'string' ? JSON.parse(afterStr.formula) : afterStr?.formula
  check('R1: …and STORED as a list of steps, not the raw string', Array.isArray(stored), stored)
  check('R1: …keeping what was typed', stored?.[0]?.product === '6N + 20vol', stored)

  // `formula: true` — the other shape that crashed the chart.
  const bool = await api('PUT', `/api/service-records/${rec.id}`, { formula: true })
  const [afterBool] = await rows(sql`SELECT formula FROM service_record WHERE id = ${rec.id}`)
  const storedBool = typeof afterBool?.formula === 'string' ? JSON.parse(afterBool.formula) : afterBool?.formula
  check('R1: a boolean is accepted and stored as nothing, not as true', bool.status === 200 && Array.isArray(storedBool) && storedBool.length === 0,
    { status: bool.status, stored: storedBool })

  const num = await api('PUT', `/api/service-records/${rec.id}`, { formula: 42 })
  const [afterNum] = await rows(sql`SELECT formula FROM service_record WHERE id = ${rec.id}`)
  const storedNum = typeof afterNum?.formula === 'string' ? JSON.parse(afterNum.formula) : afterNum?.formula
  check('R1: …and so is a number', num.status === 200 && Array.isArray(storedNum) && storedNum.length === 0, { stored: storedNum })

  // Structured steps are untouched.
  const steps = await api('PUT', `/api/service-records/${rec.id}`, { formula: [{ product: '6N', parts: '1' }] })
  const [afterSteps] = await rows(sql`SELECT formula FROM service_record WHERE id = ${rec.id}`)
  const storedSteps = typeof afterSteps?.formula === 'string' ? JSON.parse(afterSteps.formula) : afterSteps?.formula
  check('R1: real steps are untouched', steps.status === 200 && storedSteps?.[0]?.product === '6N' && storedSteps?.[0]?.parts === '1', storedSteps)
}

// …and the CREATE path keeps a string rather than silently dropping it.
{
  const created = await api('POST', '/api/service-records', {
    contactId: client.id, serviceId: cut.id, formula: '4N + 10vol', performedAt: new Date(Date.now() - 86400000).toISOString(),
  })
  check('R1: POST with a string formula is created', created.status === 200 || created.status === 201, { status: created.status, body: created.json })
  const [row] = await rows(sql`SELECT formula FROM service_record WHERE id = ${created.json?.id}`)
  const f = typeof row?.formula === 'string' ? JSON.parse(row.formula) : row?.formula
  check('R1: …with the mix kept as one step, not dropped to []', f?.[0]?.product === '4N + 10vol', f)
}

// …and the MERGE path, which is the third writer in this file and the one my first pass at this
// test never reached. Complete auto-creates a record for the appointment; logging the visit
// afterwards merges into that row rather than writing a second one (SALON-H4). It is a separate
// assignment to `formula` and therefore a separate chance to store a raw string.
{
  const { appt, rec } = await mkVisit()
  const merged = await api('POST', '/api/service-records', {
    contactId: client.id, appointmentId: appt.id, serviceId: cut.id, formula: '7N + 20vol',
  })
  check('R1: logging a visit onto an auto-created record merges', merged.status === 200 && merged.json?.merged === true,
    { status: merged.status, merged: merged.json?.merged })
  const [row] = await rows(sql`SELECT formula FROM service_record WHERE id = ${rec.id}`)
  const f = typeof row?.formula === 'string' ? JSON.parse(row.formula) : row?.formula
  check('R1: …and the merged formula is a list of steps, not the raw string',
    Array.isArray(f) && f[0]?.product === '7N + 20vol', f)
}

// The rule, asked directly — one normaliser, and it is the same one the card uses.
{
  check('R1: the normaliser turns a string into one step', normaliseFormula('6N')[0]?.product === '6N')
  check('R1: …a boolean into nothing', normaliseFormula(true).length === 0)
  check('R1: …a number into nothing', normaliseFormula(42).length === 0)
  check('R1: …and always returns an array', [null, undefined, '', 'x', 7, {}, [{ a: 1 }]].every((v) => Array.isArray(normaliseFormula(v))))
}

// ══════════ R2 · "percentage" is the word "percentage" ══════════════════════════════════════════
{
  for (const k of ['tipPercentage', 'depositPercentage', 'defaultTipPercentage', 'commissionPercentage', 'taxPercentage']) {
    const r = await api('PUT', '/api/company', { settings: { [k]: 150 } })
    check(`R2: settings.${k} = 150 is refused as a percentage`, r.status === 400, { status: r.status, body: r.json })
  }
  const ok = await api('PUT', '/api/company', { settings: { tipPercentage: 15 } })
  check('R2: …and a real percentage still saves', ok.status === 200, { status: ok.status, body: ok.json })

  // RR3 observation: the test read the END of the name, so a key that LEADS with the word slipped
  // through — discountPct 150 refused, percentageOff 150 saved. Not filed, because no such key
  // exists in the product today; closed anyway, because "which end of the name the word falls on"
  // was never the rule.
  for (const k of ['percentageOff', 'percentDiscount', 'pctBonus', 'PercentageMarkup']) {
    const r = await api('PUT', '/api/company', { settings: { [k]: 150 } })
    check(`R2: settings.${k} = 150 is refused — the word leads the name`, r.status === 400, { status: r.status, body: r.json })
  }
  const lead = await api('PUT', '/api/company', { settings: { percentageOff: 20 } })
  check('R2: …and a sane one still saves', lead.status === 200, { status: lead.status, body: lead.json })
  // The money rates from RR0929 must not have been caught by widening the word list.
  for (const [k, v] of [['hourlyRate', 150], ['chairRentalRate', 250], ['boothRentRate', 300]] as const) {
    const r = await api('PUT', '/api/company', { settings: { [k]: v } })
    check(`R2: settings.${k} = ${v} still saves — it is money`, r.status === 200, { status: r.status, body: r.json })
  }
}

// ══════════ R3 · the visits written before N8 ═══════════════════════════════════════════════════
{
  // Three priceless visits: one with a sale, one with only a quoted price, one with only its menu.
  const withSale = await mkVisit()
  await db.execute(sql`
    INSERT INTO invoice (id, company_id, contact_id, appointment_id, number, status, subtotal, total, notes, created_at, updated_at)
    VALUES (gen_random_uuid(), ${co.id}, ${client.id}, ${withSale.appt.id}, 'INV-RR2-1', 'open', 70.00, 70.00, 'Created from the appointment book', NOW(), NOW())
  `)
  const quoted = await mkVisit()
  await db.execute(sql`UPDATE appointment SET quoted_price = 80.00 WHERE id = ${quoted.appt.id}`)
  const menuOnly = await mkVisit()

  // …and one somebody priced by hand, which must not be touched.
  const byHand = await mkVisit({ price: '12.34' })

  const repair = await api('POST', '/api/service-records/repair-legacy', {})
  check('R3: the repair runs', repair.status === 200, { status: repair.status, body: repair.json })
  check('R3: …and reports how many visits it priced', Number(repair.json?.visitsPriced) >= 3, repair.json?.visitsPriced)

  const priceOf = async (id: string) => Number((await rows(sql`SELECT price_charged FROM service_record WHERE id = ${id}`))[0]?.price_charged)
  check('R3: a visit with a sale takes the SALE subtotal', (await priceOf(withSale.rec.id)) === 70, await priceOf(withSale.rec.id))
  check('R3: …one with only a quote takes the quote', (await priceOf(quoted.rec.id)) === 80, await priceOf(quoted.rec.id))
  check('R3: …and one with neither takes the menu price', (await priceOf(menuOnly.rec.id)) === 65, await priceOf(menuOnly.rec.id))
  check('R3: a price somebody typed by hand is left alone', (await priceOf(byHand.rec.id)) === 12.34, await priceOf(byHand.rec.id))

  // Idempotent: nothing left to price.
  const again = await api('POST', '/api/service-records/repair-legacy', {})
  check('R3: running it again prices nothing', Number(again.json?.visitsPriced) === 0, again.json?.visitsPriced)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
