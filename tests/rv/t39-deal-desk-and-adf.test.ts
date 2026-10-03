// crm-rv — the deal desk and the ADF lead import, the two things a sales floor runs on. (T39)
//
// WHY THIS SUITE EXISTS AT ALL. crm-rv had 217 endpoint declarations and ZERO vertical-specific
// tests: only the shared contract test, which proves two fleet-wide invariants and nothing about
// selling a unit. Every rule below was established by a round and has been unprotected since.
//
//   THE DESK is where a sale's money is agreed: price, discount, accessories, trade allowance,
//   trade payoff, doc, freight, title and registration, prep, tax rate, down payment. `dealInput`
//   refuses anything that is not a finite number, anything negative, anything over $10,000,000, a
//   tax rate outside 0–25%, and a discount larger than the selling price. None of that was pinned.
//
//   THE ADF IMPORT is how marketplace leads arrive, and RV T19 H6 found two faults in it: the plain
//   text "garbage" created an "Unknown" contact and a lead, and the same ADF posted twice created
//   two leads. Marketplaces resend ADF, so a re-send has to return the lead that already exists.
//
// A SALES FLOOR CANNOT USE A ROUNDING BUG. The desk assertions check the stored figures, not that
// the save answered 200 — a desk that silently rounds 1,234.567 to 1,234.56 instead of 1,234.57
// loses a cent on every deal and no status code says so.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

const { setupSchema } = await import('./setup.ts')
await setupSchema()
const { db } = await import('./db/index.ts')
const { company, user, contact, unit, salesLead } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Zacho Powersports', slug: 'zacho-desk', email: 'zacho@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@zacho.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const viewer = await mkUser('viewer', 'viewer')

// rv's contact carries a single `name`, not firstName/lastName — unlike roof's. Checked, not assumed.
const [buyer] = await db.insert(contact).values({
  companyId: co.id, name: 'Marisol Vega', email: 'marisol@test.local', phone: '614-555-0142',
} as any).returning()
const [theUnit] = await db.insert(unit).values({
  companyId: co.id, category: 'travel_trailer', year: 2026, make: 'Grand Design',
  modelName: 'Imagine 2500RL', stockNumber: 'STK-7781', status: 'available', internetPrice: '41995.00',
} as any).returning()
const [lead] = await db.insert(salesLead).values({
  companyId: co.id, contactId: buyer.id, unitId: theUnit.id, stage: 'working',
} as any).returning()

const app = new Hono()
app.route('/api/sales-leads', (await import('./src/routes/salesLeads.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const as = (who: any) => async (method: string, path: string, body?: unknown, raw?: string) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': raw ? 'application/xml' : 'application/json', 'x-test-user': who.id },
    body: raw !== undefined ? raw : (body === undefined ? undefined : JSON.stringify(body)),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asViewer = as(viewer)

/** A complete, valid desk. Individual assertions below override one field at a time. */
const DESK = {
  price: 41995, discount: 1500, accessories: 850, tradeAllow: 9000, tradePayoff: 11200,
  doc: 399, freight: 1295, titleReg: 128.5, prep: 495, taxRate: 7.25, down: 5000,
}

const dealOf = async (id: string) => {
  const r: any = await db.execute(sql`SELECT deal FROM sales_lead WHERE id = ${id}`)
  const row = ((r as any).rows || r)[0]
  return typeof row?.deal === 'string' ? JSON.parse(row.deal) : row?.deal
}

// ══════════ the desk starts empty and reads back what was saved ══════════════════════════════
console.log('\n══════════ desking the deal ══════════')
{
  const before = await asOwner('GET', `/api/sales-leads/${lead.id}/deal`)
  check('the desk reads for a lead with nothing desked', before.status === 200, { status: before.status, body: before.text?.slice(0, 160) })
  check('…and says no deal is saved yet', before.json?.deal === null && before.json?.dealSaved === false,
    { deal: before.json?.deal, dealSaved: before.json?.dealSaved })
  check('…and carries the unit and its internet price, which is what the desk opens with',
    before.json?.unit?.stockNumber === 'STK-7781' && Number(before.json?.unit?.price) === 41995,
    before.json?.unit)

  const saved = await asOwner('PUT', `/api/sales-leads/${lead.id}/deal`, DESK)
  check('a complete desk saves', saved.status === 200, { status: saved.status, body: saved.text?.slice(0, 180) })

  const stored = await dealOf(lead.id)
  check('…and every figure is stored as given', stored?.price === 41995 && stored?.tradePayoff === 11200 && stored?.down === 5000, stored)
  check('…including the half-cent title fee', stored?.titleReg === 128.5, { titleReg: stored?.titleReg })
  check('…and the tax rate', stored?.taxRate === 7.25, { taxRate: stored?.taxRate })
  check('…with a savedAt stamp, so the desk can say when it was agreed', typeof stored?.savedAt === 'string', { savedAt: stored?.savedAt })

  const read = await asOwner('GET', `/api/sales-leads/${lead.id}/deal`)
  check('…and the desk now reports it saved', read.json?.dealSaved === true && Number(read.json?.deal?.price) === 41995,
    { dealSaved: read.json?.dealSaved, price: read.json?.deal?.price })
}

// ══════════ money is rounded to the cent, and a rate to the thousandth ═══════════════════════
console.log('\n══════════ rounding ══════════')
{
  // 1234.567 → 1234.57 (half-up at the cent). A desk that truncates loses money on every deal.
  await asOwner('PUT', `/api/sales-leads/${lead.id}/deal`, { ...DESK, doc: 1234.567, taxRate: 6.8755 })
  const stored = await dealOf(lead.id)
  check('a doc fee of 1234.567 stores as 1234.57, not 1234.56', stored?.doc === 1234.57, { doc: stored?.doc })
  check('…and a tax rate keeps three decimals: 6.8755 → 6.876', stored?.taxRate === 6.876, { taxRate: stored?.taxRate })
}

// ══════════ what the desk refuses ════════════════════════════════════════════════════════════
console.log('\n══════════ the desk refuses bad money ══════════')
{
  const good = await dealOf(lead.id)

  const cases: Array<[string, any, RegExp]> = [
    ['a missing figure', { ...DESK, price: undefined }, /must be a number/i],
    ['a figure sent as a string', { ...DESK, price: '41995' }, /must be a number/i],
    ['NaN', { ...DESK, price: Number.NaN }, /must be a number/i],
    ['Infinity', { ...DESK, freight: Number.POSITIVE_INFINITY }, /must be a number/i],
    ['a negative trade payoff', { ...DESK, tradePayoff: -200 }, /negative/i],
    ['a price over $10,000,000', { ...DESK, price: 10_000_001 }, /too large/i],
    ['a tax rate above 25%', { ...DESK, taxRate: 25.1 }, /between 0% and 25%/i],
    ['a negative tax rate', { ...DESK, taxRate: -1 }, /between 0% and 25%/i],
    ['a discount larger than the price', { ...DESK, price: 1000, discount: 1001 }, /more than the selling price/i],
  ]
  for (const [label, body, expect] of cases) {
    const r = await asOwner('PUT', `/api/sales-leads/${lead.id}/deal`, body)
    check(`${label} is refused, and says why`, r.status === 400 && expect.test(String(r.json?.error)),
      { status: r.status, error: r.json?.error })
  }

  // THE ASSERTION THAT MAKES THE REFUSALS WORTH ANYTHING: none of them overwrote the saved desk.
  const after = await dealOf(lead.id)
  check('…and NINE refusals left the saved desk untouched', JSON.stringify(after) === JSON.stringify(good),
    { before: good?.doc, after: after?.doc })
}

// ══════════ a read-only seat cannot change the numbers ═══════════════════════════════════════
console.log('\n══════════ who may desk ══════════')
{
  const r = await asViewer('PUT', `/api/sales-leads/${lead.id}/deal`, { ...DESK, price: 1 })
  check('a viewer cannot save a desk', r.status === 403, { status: r.status, body: r.text?.slice(0, 140) })
  check('…and the price is still 41995', (await dealOf(lead.id))?.price === 41995, { price: (await dealOf(lead.id))?.price })
  const read = await asViewer('GET', `/api/sales-leads/${lead.id}/deal`)
  check('…but may read it', read.status === 200, { status: read.status })
}

// ══════════ RV T19 H6 · the ADF import ══════════════════════════════════════════════════════
console.log('\n══════════ ADF: garbage in is refused ══════════')
{
  // The literal fault: the word "garbage" produced an "Unknown" contact and a lead.
  const garbage = await asOwner('POST', '/api/sales-leads/import-adf', undefined, 'garbage')
  check('the text "garbage" is refused, not imported as "Unknown"', garbage.status === 400, { status: garbage.status, body: garbage.text?.slice(0, 160) })
  check('…and says what an ADF lead is', /adf/i.test(String(garbage.json?.error)), garbage.json?.error)

  const noCustomer = await asOwner('POST', '/api/sales-leads/import-adf', undefined,
    '<?xml version="1.0"?><adf><prospect><vehicle interest="buy"><year>2026</year></vehicle></prospect></adf>')
  check('an ADF with no <customer> is refused', noCustomer.status === 400 && /customer/i.test(String(noCustomer.json?.error)),
    { status: noCustomer.status, error: noCustomer.json?.error })

  const nameless = await asOwner('POST', '/api/sales-leads/import-adf', undefined,
    '<?xml version="1.0"?><adf><prospect><customer><contact><name part="first"></name></contact></customer></prospect></adf>')
  check('an ADF with no name, email or phone is refused', nameless.status === 400, { status: nameless.status, error: nameless.json?.error })

  /**
   * THE CASE ONLY THE <adf>/<prospect> GUARD CATCHES.
   *
   * Disabling that guard did not fail this block at first: the plain word "garbage" is also stopped
   * by the NEXT check, because it contains no <customer> — so the assertion passed while the guard
   * it was named for was gone. This document has a perfectly good <customer> with a name and no
   * <adf> wrapper at all, so the customer check cannot save it. Without the guard it imports.
   */
  const notAdf = await asOwner('POST', '/api/sales-leads/import-adf', undefined,
    '<?xml version="1.0"?><customer><contact><name part="full">Not An Adf Lead</name><email>nope@example.com</email></contact></customer>')
  check('XML with a real <customer> but no <adf>/<prospect> is refused', notAdf.status === 400, { status: notAdf.status, error: notAdf.json?.error })
  const stray: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE company_id = ${co.id} AND email = 'nope@example.com'`)
  check('…and it created no contact', Number(((stray as any).rows || stray)[0]?.n) === 0, ((stray as any).rows || stray)[0])

  const r: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE company_id = ${co.id} AND name ILIKE '%unknown%'`)
  check('…and no "Unknown" contact was created by any of them', Number(((r as any).rows || r)[0]?.n) === 0, ((r as any).rows || r)[0])
}

console.log('\n══════════ ADF: a resend keeps the lead it already made ══════════')
{
  const ADF = `<?xml version="1.0"?>
<adf><prospect>
  <customer><contact>
    <name part="first">Theo</name><name part="last">Brandt</name>
    <email>theo.brandt@example.com</email><phone>614-555-0199</phone>
  </contact></customer>
  <vehicle interest="buy"><year>2026</year><make>Grand Design</make><model>Imagine 2500RL</model></vehicle>
  <vehicle interest="trade-in"><year>2015</year><make>Jayco</make><model>Jay Flight</model></vehicle>
</prospect></adf>`

  const first = await asOwner('POST', '/api/sales-leads/import-adf', undefined, ADF)
  check('a real ADF lead imports', first.status === 201 && first.json?.success === true, { status: first.status, body: first.text?.slice(0, 200) })
  check('…with the customer\'s own name, not the dealer\'s', first.json?.contact?.name === 'Theo Brandt', { name: first.json?.contact?.name })
  check('…and the email the customer gave', first.json?.contact?.email === 'theo.brandt@example.com', { email: first.json?.contact?.email })

  // Marketplaces resend. The SAME document again must not make a second lead.
  const again = await asOwner('POST', '/api/sales-leads/import-adf', undefined, ADF)
  check('the same ADF again is NOT a second lead', again.json?.duplicate === true, { status: again.status, body: again.text?.slice(0, 180) })
  check('…and it returns the lead that already exists', again.json?.lead?.id === first.json?.lead?.id,
    { first: first.json?.lead?.id, again: again.json?.lead?.id })

  const n: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM sales_lead sl JOIN contact c ON c.id = sl.contact_id WHERE c.email = 'theo.brandt@example.com'`)
  check('…so Theo Brandt has exactly ONE lead, not two', Number(((n as any).rows || n)[0]?.n) === 1, ((n as any).rows || n)[0])

  const c2: any = await db.execute(sql`SELECT COUNT(*)::int AS n FROM contact WHERE company_id = ${co.id} AND email = 'theo.brandt@example.com'`)
  check('…and exactly one contact', Number(((c2 as any).rows || c2)[0]?.n) === 1, ((c2 as any).rows || c2)[0])

  // The trade-in vehicle is not what the customer wants to buy.
  check('the interest is the BUY vehicle, not the trade-in', !/Jay Flight/.test(JSON.stringify(first.json?.lead ?? {})),
    first.json?.lead)
}

// ══════════ another company's lead is not reachable ══════════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival RV', slug: 'rival-desk', email: 'rival@test.local', state: 'OH', settings: {}, enabledFeatures: [],
  } as any).returning()
  const [intruder] = await db.insert(user).values({
    email: 'intruder@rival.local', passwordHash: 'x', firstName: 'I', lastName: 'R', role: 'owner', companyId: other.id, isActive: true,
  } as any).returning()

  const peek = await as(intruder)('GET', `/api/sales-leads/${lead.id}/deal`)
  check('another company cannot read this desk', peek.status === 404, { status: peek.status, body: peek.text?.slice(0, 140) })
  // A VALID desk, deliberately. My first version sent price: 1 with the default discount of 1500,
  // which `dealInput` rejected as "discount larger than the price" — a 400 from validation, which
  // would have let this assertion pass for the wrong reason on a route with no ownership check at
  // all. The payload has to be one the route would otherwise accept.
  const write = await as(intruder)('PUT', `/api/sales-leads/${lead.id}/deal`, { ...DESK, price: 42000 })
  check('…nor change it', write.status === 404, { status: write.status, body: write.text?.slice(0, 140) })
  check('…and the price is untouched', (await dealOf(lead.id))?.price === 41995, { price: (await dealOf(lead.id))?.price })
}

// ══════════ T41 · a refused save names EVERY bad field ════════════════════════════════════════
//
//   "the API names only the first invalid field"
//
// A deal sheet or a unit posts the whole record. The handler answered with issues[0], so three bad
// values took three round trips to discover — and the second refusal reads as the first fix not
// having worked. The sentence for a single issue is unchanged, byte for byte, so nothing that reads
// `error` had to change; `fields` is the addition a form can mark its boxes from.
console.log('\n══════════ a refusal names every bad field ══════════')
{
  const { z } = await import('zod')
  const probe = new Hono()
  probe.post('/probe', async (c: any) => {
    z.object({ askingPrice: z.number(), tradeAllowance: z.number(), vin: z.string().min(17) }).parse(await c.req.json())
    return c.json({ ok: true })
  })
  probe.onError((await import('./src/utils/errors.ts')).errorHandler)
  const post = async (body: unknown) => {
    const res = await probe.request('/probe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const three = await post({ askingPrice: 'lots', tradeAllowance: null, vin: 'TOO-SHORT' })
  check('T41: a validation failure is still a 400', three.status === 400, { status: three.status })
  check('T41: …and every bad field is named in one answer',
    /askingPrice/.test(three.text) && /tradeAllowance/.test(three.text) && /vin/.test(three.text),
    three.json?.error)
  check('T41: …as a map the form can mark its boxes from',
    !!three.json?.fields?.askingPrice && !!three.json?.fields?.tradeAllowance && !!three.json?.fields?.vin,
    three.json?.fields)
  check('T41: …under a code a client can switch on', three.json?.code === 'validation_failed', three.json?.code)

  // One bad field still reads exactly as it did before this change.
  const one = await post({ askingPrice: 41995, tradeAllowance: 5000, vin: 'SHORT' })
  check('T41: a single bad field still reads "field: message"', /^vin: /.test(String(one.json?.error)), one.json?.error)
  check('T41: …and names only that field', Object.keys(one.json?.fields || {}).join(',') === 'vin', one.json?.fields)

  const good = await post({ askingPrice: 41995, tradeAllowance: 5000, vin: '1FDXE4FS8DDA12345' })
  check('a valid body still passes', good.status === 200, { status: good.status, body: good.text?.slice(0, 120) })
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
