// crm-roof — who may read what a roof is worth. (T41)
//
// THE FINDING, quoted:
//
//   "Staff sees money: Reports (Invoiced, Collected, Outstanding, revenue by rep and by crew), all
//    76 invoices with balances, and estimatedRevenue/materialCost/laborCost in the GET /api/jobs
//    list (the single-job GET hides them). /api/quotes is 403, so access is inconsistent."
//
// "Inconsistent" is the whole diagnosis. The quote routes refused this seat and the invoice routes
// beside them did not, because roof forks invoicing (line items are JSON on the row, no payment
// table) and the fork missed the permission the rest of the fleet applies.
//
// TWO THINGS THIS FILE PINS THAT A STATUS-CODE TEST WOULD NOT:
//
//   1. The Reports page has no server. It builds Invoiced / Collected / Outstanding from
//      /api/invoices/summary and "revenue by rep" / "revenue by crew" IN THE BROWSER from
//      /api/jobs?limit=500. So the per-job figures never had to be rendered to be disclosed, and
//      gating the summary alone would have emptied the tiles while leaving the money in the payload
//      the page was aggregating. Both halves are asserted, and the field seat's job list is scanned
//      as TEXT for the figures so a renamed or nested leak still fails.
//
//   2. The report is wrong about the single-job GET. It says the detail "hides them"; the handler
//      spreads `...foundJob`, the whole row, exactly as the list did. What hides them is the detail
//      SCREEN, which does not render those fields — the tester was describing the page. Following
//      the report literally would have fixed the list and left the detail leaking the same three
//      figures one request away, so the detail is asserted here in both directions too.
//
// The allowed direction matters as much as the refusal: a gate that also refuses the manager running
// the Monday revenue meeting is not a fix, it is a different bug. VIEWER is in here deliberately —
// it is the lowest rung that holds invoices:read, so its 200 proves the gate asks a PERMISSION and
// not a rank.
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
const { company, user, contact, job, crew, invoice, quote, material } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Summit Ridge Roofing', slug: 'summit-ridge-money', email: 'money@test.local', state: 'OH',
  settings: {}, enabledFeatures: ['insurance', 'roof_reports'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@summit-money.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const manager = await mkUser('manager', 'manager')
const viewer = await mkUser('viewer', 'viewer')
// `field` is the roofing crew / sales seat the report logged in as. It holds jobs:read and
// jobs:update — it is SUPPOSED to see and work the job. It does not hold invoices:read.
const fieldUser = await mkUser('field', 'crewlead')

const [homeowner] = await db.insert(contact).values({
  companyId: co.id, firstName: 'Dana', lastName: 'Okafor', email: 'dana-money@test.local',
} as any).returning()

const [cr] = await db.insert(crew).values({
  companyId: co.id, name: 'Crew A', foremanName: 'Luis Ferrer', foremanPhone: '614-555-0142', size: 4,
} as any).returning()

// Two jobs, both carrying every money column, so "revenue by crew" has something real to add up.
const [jobA] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, assignedCrewId: cr.id, assignedSalesRepId: fieldUser.id,
  jobNumber: 'ROOF-0001', jobType: 'insurance', status: 'production', source: 'canvassing',
  propertyAddress: '144 Shingle Ln', city: 'Columbus', state: 'OH', zip: '43215',
  estimatedRevenue: '48500.00', materialCost: '16200.00', laborCost: '9800.00',
  deductible: '1000.00', rcv: '52000.00', acv: '41000.00',
  // T42: the four columns the strip MISSED. finalRevenue is what the job actually billed, and
  // approvedScope is the carrier's approved scope of work — the claim's money written out in words,
  // which is why it is treated as money and not as a note.
  finalRevenue: '50750.00',
  approvedScope: 'Full tear-off approved at 52000.00 RCV, less the 1000.00 deductible.',
} as any).returning()
const [jobB] = await db.insert(job).values({
  companyId: co.id, contactId: homeowner.id, assignedCrewId: cr.id, assignedSalesRepId: manager.id,
  jobNumber: 'ROOF-0002', jobType: 'retail', status: 'sold', source: 'referral',
  propertyAddress: '12 Cash Rd', city: 'Columbus', state: 'OH', zip: '43215',
  estimatedRevenue: '21750.00', materialCost: '7100.00', laborCost: '4300.00',
} as any).returning()

// The ledger, with the figures chosen so every tile is a distinct number and the excluded statuses
// would change the answer if they leaked in:
//   INV-1  sent      total 30000  paid 12000  balance 18000
//   INV-2  paid      total 18500  paid 18500  balance     0
//   INV-3  draft     total  9000  paid     0  balance  9000   ← excluded from all three tiles
//   INV-4  void      total  7000  paid     0  balance  7000   ← excluded from all three tiles
// invoiced = 48500, collected = 30500, outstanding = 18000.
const mkInv = async (n: string, status: string, total: string, paid: string, balance: string, jobId: string) =>
  (await db.insert(invoice).values({
    companyId: co.id, jobId, contactId: homeowner.id, invoiceNumber: n, status,
    lineItems: [{ description: 'Tear-off and re-roof', quantity: 1, unitPrice: total }],
    subtotal: total, taxRate: '0.0000', taxAmount: '0.00', total, amountPaid: paid, balance,
  } as any).returning())[0]
const inv1 = await mkInv('INV-1', 'sent', '30000.00', '12000.00', '18000.00', jobA.id)
const inv2 = await mkInv('INV-2', 'paid', '18500.00', '18500.00', '0.00', jobB.id)
await mkInv('INV-3', 'draft', '9000.00', '0.00', '9000.00', jobA.id)
await mkInv('INV-4', 'void', '7000.00', '0.00', '7000.00', jobA.id)

await db.insert(quote).values({
  companyId: co.id, contactId: homeowner.id, jobId: jobA.id, quoteNumber: 'Q-1', status: 'approved',
  lineItems: [{ description: 'Re-roof', quantity: 1, unitPrice: '48500.00' }],
  subtotal: '48500.00', taxRate: '0.0000', taxAmount: '0.00', total: '48500.00',
  expiresAt: new Date(Date.now() + 30 * 86400000),
} as any)

// T42: a material order is a supplier's price list for one roof. The canonical line item is
// {description, qty, unit, unitPrice, total}, written by normaliseLineItems, and `totalCost` is the
// order's own total — computed on the server, never taken from the client.
const [order] = await db.insert(material).values({
  companyId: co.id, jobId: jobA.id, supplier: 'ABC Supply', orderStatus: 'ordered',
  lineItems: [
    { description: 'Owens Corning Duration — Onyx Black', qty: 45, unit: 'bundle', unitPrice: 725.10, total: 32629.50 },
    { description: 'Synthetic underlayment', qty: 6, unit: 'roll', unitPrice: 165.75, total: 994.50 },
  ],
  totalCost: '33624.00',
} as any).returning()

const app = new Hono()
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.route('/api/materials', (await import('./src/routes/materials.ts')).default)
app.route('/api/jobs', (await import('./src/routes/jobs.ts')).default)
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/crews', (await import('./src/routes/crews.ts')).default)
// Roof has no exported errorHandler — its handler is inline in src/index.ts. Mirrored here the same
// way tests/roof/t39-insurance-claims.test.ts documents: a ZodError is the caller's bad input, an
// error carrying its own 4xx keeps it, and anything else surfaces as 500 rather than being laundered
// into a tidy 400. A test that turns server faults into refusals counts a 500 as "correctly refused".
app.onError((err: any, c: any) => {
  if (err?.name === 'ZodError') {
    const first = (err.issues || [])[0] || {}
    const where = Array.isArray(first.path) && first.path.length ? first.path.join('.') + ': ' : ''
    return c.json({ error: where + (first.message || 'Validation error') }, 400)
  }
  const status = Number(err?.status || err?.statusCode || 0)
  if (status >= 400 && status < 500) return c.json({ error: err.message }, status)
  return c.json({ error: 'Internal server error', unexpected: String(err?.message || err) }, 500)
})
const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
const asOwner = as(owner), asManager = as(manager), asViewer = as(viewer), asField = as(fieldUser)

const MONEY_KEYS = ['estimatedRevenue', 'materialCost', 'laborCost', 'deductible'] as const
const rowsOf = (payload: any) => (Array.isArray(payload) ? payload : Array.isArray(payload?.data) ? payload.data : [])

// ══════════ the Reports tiles: Invoiced / Collected / Outstanding ════════════════════════════════
console.log('\n══════════ the Reports page tiles ══════════')
{
  const sum = await asOwner('GET', '/api/invoices/summary')
  check('the owner gets the summary', sum.status === 200, { status: sum.status, body: sum.text?.slice(0, 180) })
  check('…Invoiced is 48,500 — billed only, so the draft and the void are not in it',
    sum.json?.invoiced === 48500, sum.json)
  check('…Collected is 30,500', sum.json?.collected === 30500, sum.json)
  check('…Outstanding is 18,000 — the draft\'s 9,000 balance is not owed yet',
    sum.json?.outstanding === 18000, sum.json)

  const mgr = await asManager('GET', '/api/invoices/summary')
  check('the manager running the revenue meeting still gets the same figures',
    mgr.status === 200 && mgr.json?.invoiced === 48500 && mgr.json?.outstanding === 18000, { status: mgr.status, json: mgr.json })

  // viewer is the lowest rung holding invoices:read. If this 403s, the gate became a rank check.
  const vw = await asViewer('GET', '/api/invoices/summary')
  check('the VIEWER seat gets it too — the gate asks a permission, not a rank',
    vw.status === 200 && vw.json?.invoiced === 48500, { status: vw.status, json: vw.json })

  const staff = await asField('GET', '/api/invoices/summary')
  check('the crew seat is REFUSED the summary, so the three tiles have nothing to fill them',
    staff.status === 403, { status: staff.status, body: staff.text?.slice(0, 180) })
  check('…and no figure comes back with the refusal',
    !/48500|30500|18000/.test(staff.text || ''), staff.text?.slice(0, 200))
}

// ══════════ the invoice ledger itself ════════════════════════════════════════════════════════════
console.log('\n══════════ all 76 invoices with balances ══════════')
{
  const list = await asOwner('GET', '/api/invoices')
  check('the owner reads the ledger', list.status === 200 && rowsOf(list.json).length === 4,
    { status: list.status, n: rowsOf(list.json).length })

  const staffList = await asField('GET', '/api/invoices')
  check('the crew seat is refused the ledger', staffList.status === 403,
    { status: staffList.status, body: staffList.text?.slice(0, 180) })
  check('…refused with no invoice numbers or balances in the body',
    !/INV-1|INV-2|18000|30000/.test(staffList.text || ''), staffList.text?.slice(0, 200))

  const one = await asField('GET', `/api/invoices/${inv1.id}`)
  check('…and refused a single invoice by id', one.status === 403, { status: one.status })

  // The PDF is the same invoice in another wrapper. Only the refusal is exercised: the allowed path
  // constructs a real pdfkit document, which is not what this file is about.
  const pdf = await asField('GET', `/api/invoices/${inv2.id}/pdf`)
  check('…and refused the PDF, which is the invoice by another door', pdf.status === 403, { status: pdf.status })

  const ownerOne = await asOwner('GET', `/api/invoices/${inv1.id}`)
  check('the owner still opens an invoice and sees the balance',
    ownerOne.status === 200 && Number(ownerOne.json?.balance) === 18000, { status: ownerOne.status, bal: ownerOne.json?.balance })
}

// ══════════ revenue by rep and by crew: the job LIST ═════════════════════════════════════════════
console.log('\n══════════ the job list the Reports page aggregates ══════════')
{
  const ownerJobs = await asOwner('GET', '/api/jobs?limit=500')
  const oRows = rowsOf(ownerJobs.json)
  check('the owner gets both jobs', ownerJobs.status === 200 && oRows.length === 2,
    { status: ownerJobs.status, n: oRows.length })
  check('…with the money on them, so revenue by rep and by crew still add up',
    oRows.reduce((s: number, j: any) => s + Number(j.estimatedRevenue || 0), 0) === 70250, oRows.map((j: any) => j.estimatedRevenue))
  check('…and the costs', oRows.every((j: any) => j.materialCost !== undefined && j.laborCost !== undefined),
    oRows.map((j: any) => ({ m: j.materialCost, l: j.laborCost })))

  const staffJobs = await asField('GET', '/api/jobs?limit=500')
  const sRows = rowsOf(staffJobs.json)
  check('the crew seat STILL GETS THE JOBS — this is its work, not a refusal',
    staffJobs.status === 200 && sRows.length === 2, { status: staffJobs.status, n: sRows.length })
  for (const k of MONEY_KEYS) {
    check(`…with no ${k} on any row`, sRows.every((j: any) => !(k in j)),
      sRows.map((j: any) => (k in j ? j[k] : '«absent»')))
  }
  // Deleted, not nulled: a null still tells the page the field exists, and `Number(null)` is 0, so a
  // client summing it would silently report $0 revenue instead of showing nothing.
  check('…the keys are ABSENT, not null', !(staffJobs.text || '').includes('estimatedRevenue'),
    (staffJobs.text || '').slice(0, 200))
  // Text scan: catches the figure arriving under a different name, or nested inside contact/crew.
  check('…and none of the figures appear anywhere in the payload',
    !/48500|16200|9800|21750|7100|4300/.test(staffJobs.text || ''), (staffJobs.text || '').slice(0, 300))

  // The job itself is intact. If this fails the fix went too far and the crew cannot work.
  const a = sRows.find((j: any) => j.jobNumber === 'ROOF-0001')
  check('…the job, address, status, dates, contact and crew are all still there',
    !!a && a.propertyAddress === '144 Shingle Ln' && a.status === 'production' &&
    a.contact?.lastName === 'Okafor' && a.assignedCrewId === cr.id, a)
}

// ══════════ the single-job GET the report said was already safe ══════════════════════════════════
console.log('\n══════════ the job detail (the report\'s parenthetical was wrong) ══════════')
{
  const ownerOne = await asOwner('GET', `/api/jobs/${jobA.id}`)
  check('the owner opens the job and sees what it is worth',
    ownerOne.status === 200 && Number(ownerOne.json?.estimatedRevenue) === 48500 &&
    Number(ownerOne.json?.materialCost) === 16200, { status: ownerOne.status, er: ownerOne.json?.estimatedRevenue })
  check('…including the carrier figures on an insurance job',
    Number(ownerOne.json?.rcv) === 52000 && Number(ownerOne.json?.acv) === 41000, { rcv: ownerOne.json?.rcv, acv: ownerOne.json?.acv })
  check('…and the job\'s quotes and invoices',
    (ownerOne.json?.quotes || []).length === 1 && (ownerOne.json?.invoices || []).length === 3,
    { q: (ownerOne.json?.quotes || []).length, i: (ownerOne.json?.invoices || []).length })

  const staffOne = await asField('GET', `/api/jobs/${jobA.id}`)
  check('the crew seat opens the same job', staffOne.status === 200, { status: staffOne.status, body: staffOne.text?.slice(0, 160) })
  for (const k of [...MONEY_KEYS, 'rcv', 'acv']) {
    check(`…with no ${k}`, !(k in (staffOne.json || {})), (staffOne.json || {})[k])
  }
  check('…no figure anywhere in the detail payload either',
    !/48500|16200|9800|52000|41000/.test(staffOne.text || ''), (staffOne.text || '').slice(0, 300))
  // The quotes and invoices hanging off the job are money in their own right. Handing them over here
  // would walk straight around the invoice routes that were just gated.
  check('…and the job\'s quotes and invoices come back empty, not withheld-and-leaked',
    Array.isArray(staffOne.json?.quotes) && staffOne.json.quotes.length === 0 &&
    Array.isArray(staffOne.json?.invoices) && staffOne.json.invoices.length === 0,
    { q: staffOne.json?.quotes, i: staffOne.json?.invoices })
  check('…while the homeowner, the crew, the photos and the notes are all still there',
    staffOne.json?.contact?.lastName === 'Okafor' && staffOne.json?.crew?.name === 'Crew A' &&
    Array.isArray(staffOne.json?.photos) && Array.isArray(staffOne.json?.notes),
    { contact: staffOne.json?.contact?.lastName, crew: staffOne.json?.crew?.name })

  // The quote routes already refused this seat before T41 — that refusal is what made the invoice
  // routes "inconsistent". Pinned so a later widening of quotes:read re-opens the argument honestly.
  const q = await asField('GET', '/api/quotes')
  check('the quote list was already refused this seat, and still is', q.status === 403, { status: q.status })
}

// ══════════ crews: examined, and deliberately NOT gated ═════════════════════════════════════════
console.log('\n══════════ /api/crews — read because Reports reads it ══════════')
{
  // The Reports page fetches /api/crews to put names on the revenue-by-crew rows. It was checked for
  // money and has none: the crew table is name, foreman, phone, size, subcontractor flag, active
  // flag. So no gate here — and these assertions are what makes that a finding rather than a guess,
  // and will fail the day a pay rate is added to the table.
  const crews = await asField('GET', '/api/crews')
  const list = rowsOf(crews.json)
  check('the crew seat reads the crew list', crews.status === 200 && list.length === 1,
    { status: crews.status, n: list.length })
  check('…and the crew record carries no money at all',
    !/rate|cost|revenue|pay|wage|price/i.test(JSON.stringify(list)), JSON.stringify(list).slice(0, 240))

  const detail = await asField('GET', `/api/crews/${cr.id}`)
  check('the crew detail lists its jobs', detail.status === 200 && (detail.json?.activeJobs || []).length === 2,
    { status: detail.status, n: (detail.json?.activeJobs || []).length })
  check('…and those job rows carry no money either — the projection is explicit, not a spread',
    !/48500|16200|9800|21750/.test(detail.text || ''), (detail.text || '').slice(0, 300))
}

// ══════════ T42: the four columns the strip missed, and the signal the SCREEN needed ═════════════
//
//   "Staff still see money: GET /api/jobs still returns finalRevenue, rcv, acv and approvedScope;
//    Reports shows Avg Job Value $13,525 and Pipeline $54,100 (owner sees $9,636 and $115,631, so
//    the figures are also wrong); Materials shows Total Cost."            — Roofing, HIGH
//
// The leak and the WRONG FIGURES were one cause. There were two hand-written field lists, one per
// read: the list stripped four keys and the detail stripped six. Reports builds Avg Job Value and
// Pipeline in the browser from `finalRevenue ?? estimatedRevenue ?? rcv ?? 0`, so deleting SOME of
// those keys did not remove the figure — it moved the chain onto a column nobody had considered, and
// staff and the owner then computed different totals off the same page with nothing to show either of
// them that they disagreed. One list (JOB_MONEY) is used by both reads now.
//
// Completing the list is necessary and not sufficient: with every key gone the chain reaches `?? 0`
// and the tiles read "$0", which is T42's own fleet-wide complaint ("Hidden money shown as $0 instead
// of hidden"). So the list read also says `moneyWithheld`, and the page drops those tiles.
console.log('\n══════════ T42: finalRevenue, rcv, acv, approvedScope — and moneyWithheld ══════════')
const T42_JOB_MONEY = ['finalRevenue', 'rcv', 'acv', 'approvedScope'] as const
{
  const ownerJobs = await asOwner('GET', '/api/jobs?limit=500')
  const oRow = rowsOf(ownerJobs.json).find((j: any) => j.jobNumber === 'ROOF-0001')
  check('the owner\'s job list carries all four', !!oRow && T42_JOB_MONEY.every((k) => k in oRow),
    T42_JOB_MONEY.map((k) => ({ [k]: oRow?.[k] })))
  check('…and says nothing about money being withheld', ownerJobs.json?.moneyWithheld === undefined,
    ownerJobs.json?.moneyWithheld)

  const staffJobs = await asField('GET', '/api/jobs?limit=500')
  const sRows = rowsOf(staffJobs.json)
  for (const k of T42_JOB_MONEY) {
    check(`…the crew seat's list has no ${k}`, sRows.every((j: any) => !(k in j)),
      sRows.map((j: any) => (k in j ? j[k] : '«absent»')))
  }
  check('…and no final-revenue or carrier figure appears anywhere in the list payload',
    !/50750|52000|41000/.test(staffJobs.text || ''), (staffJobs.text || '').slice(0, 300))
  // The signal, not the zero: the two browser-computed tiles have to KNOW to hide rather than add up
  // a list with the money taken out of it.
  check('…and the list TELLS the page the money was withheld, so the tiles hide instead of reading $0',
    staffJobs.json?.moneyWithheld === true, staffJobs.json?.moneyWithheld)
  check('…the jobs themselves are still all there', sRows.length === 2, sRows.length)

  const staffOne = await asField('GET', `/api/jobs/${jobA.id}`)
  for (const k of T42_JOB_MONEY) {
    check(`…the detail has no ${k} either — one list, both reads`, !(k in (staffOne.json || {})),
      (staffOne.json || {})[k])
  }
  check('…and the approved scope of work, which states the money in words, is gone with the figures',
    !/50750|52000/.test(staffOne.text || '') && !/Full tear-off approved/i.test(staffOne.text || ''),
    (staffOne.text || '').slice(0, 300))
}

// ══════════ T42: the material order's cost ═══════════════════════════════════════════════════════
//
// Every write on this router asked for an inventory permission; neither read asked for anything at
// all, so the crew seat read the supplier's prices straight off the Materials list. Gated on
// `invoices:read` — the same question the job and invoice reads ask — and not on inventory:read,
// because knowing what is on the truck is the part of this screen the crew is there for.
console.log('\n══════════ T42: Materials shows Total Cost ══════════')
{
  const ownerMats = await asOwner('GET', '/api/materials')
  const oRows = rowsOf(ownerMats.json)
  check('the owner reads the order with its cost', ownerMats.status === 200 && oRows.length === 1 &&
    Number(oRows[0]?.totalCost) === 33624, { status: ownerMats.status, n: oRows.length, c: oRows[0]?.totalCost })
  check('…and each line still carries its unit price and line total',
    oRows[0]?.lineItems?.[0]?.unitPrice === 725.1 && oRows[0]?.lineItems?.[0]?.total === 32629.5,
    oRows[0]?.lineItems?.[0])
  check('…with no withheld flag on it', ownerMats.json?.moneyWithheld === undefined, ownerMats.json?.moneyWithheld)

  /**
   * THE READ-ONLY SEAT GETS THE ORDER AND NOT THE PRICE, and that is a decision, not an oversight.
   *
   * This assertion first said the opposite. The gate was written asking `invoices:read` — the
   * fleet's revenue-read permission, which `viewer` holds — and T42's RV HIGH is that exact mistake
   * one vertical over: "Viewer sees what staff can't: /api/units cost … /api/fi/products cost".
   * Revenue is a bookkeeper's business; a SUPPLIER'S PRICES are the shop's cost, and anyone holding
   * them can price every job in the book. It asks `margin:read` now — owner, admin, manager.
   *
   * The manager's 200 below is what keeps this a PERMISSION and not a rank: manager is not the
   * owner, and still sees the cost.
   */
  const viewerMats = await asViewer('GET', '/api/materials')
  check('the read-only seat still reads the ORDER', viewerMats.status === 200 && rowsOf(viewerMats.json).length === 1,
    { status: viewerMats.status, n: rowsOf(viewerMats.json).length })
  check('…and NOT the supplier\'s prices — that is cost, not revenue (margin:read)',
    !('totalCost' in (rowsOf(viewerMats.json)[0] || {})) && viewerMats.json?.moneyWithheld === true,
    { c: rowsOf(viewerMats.json)[0]?.totalCost, withheld: viewerMats.json?.moneyWithheld })
  check('…while the MANAGER does see the cost — a permission, not a rank',
    Number(rowsOf((await asManager('GET', '/api/materials')).json)[0]?.totalCost) === 33624,
    rowsOf((await asManager('GET', '/api/materials')).json)[0]?.totalCost)

  const staffMats = await asField('GET', '/api/materials')
  const sRows = rowsOf(staffMats.json)
  check('the crew seat STILL GETS THE ORDER — it needs to know what is arriving',
    staffMats.status === 200 && sRows.length === 1, { status: staffMats.status, n: sRows.length })
  check('…with no totalCost on it', !('totalCost' in (sRows[0] || {})), sRows[0]?.totalCost)
  check('…and no price inside any line item',
    (sRows[0]?.lineItems || []).every((li: any) => !('unitPrice' in li) && !('total' in li)),
    sRows[0]?.lineItems)
  check('…no figure from the order anywhere in the payload',
    !/33624|32629|725\.1|165\.75|994\.5/.test(staffMats.text || ''), (staffMats.text || '').slice(0, 300))
  check('…the list says the money was withheld, so the column goes rather than showing a dash',
    staffMats.json?.moneyWithheld === true, staffMats.json?.moneyWithheld)
  // What the crew actually came for. If this fails the gate went too far.
  check('…while the supplier, the status, the description, the quantity and the unit are all intact',
    sRows[0]?.supplier === 'ABC Supply' && sRows[0]?.status === 'ordered' &&
    sRows[0]?.jobNumber === 'ROOF-0001' && sRows[0]?.lineItems?.[0]?.qty === 45 &&
    sRows[0]?.lineItems?.[0]?.unit === 'bundle' &&
    sRows[0]?.lineItems?.[0]?.description === 'Owens Corning Duration — Onyx Black', sRows[0])

  // The detail is the same order one request away. The list used to be the only place anybody looked.
  const staffOne = await asField('GET', `/api/materials/${order.id}`)
  check('the crew seat opens the order', staffOne.status === 200, { status: staffOne.status })
  check('…and the detail withholds the same prices the list does',
    !('totalCost' in (staffOne.json || {})) && staffOne.json?.moneyWithheld === true &&
    (staffOne.json?.lineItems || []).every((li: any) => !('unitPrice' in li) && !('total' in li)),
    staffOne.json)
  check('…no figure in the detail payload either',
    !/33624|32629|725\.1|165\.75|994\.5/.test(staffOne.text || ''), (staffOne.text || '').slice(0, 300))

  const ownerOne = await asOwner('GET', `/api/materials/${order.id}`)
  check('the owner opens the same order and sees what it cost',
    ownerOne.status === 200 && Number(ownerOne.json?.totalCost) === 33624, { status: ownerOne.status, c: ownerOne.json?.totalCost })

  const mat: any = await db.execute(sql`SELECT total_cost FROM material WHERE id = ${order.id}`)
  check('and the cost is still ON the order — a read gate, not a deletion',
    Number(((mat as any).rows || mat)[0]?.total_cost) === 33624, ((mat as any).rows || mat)[0])
}

// ══════════ the database still says what it said ═════════════════════════════════════════════════
console.log('\n══════════ nothing was redacted at rest ══════════')
{
  const r: any = await db.execute(sql`SELECT estimated_revenue, material_cost FROM job WHERE id = ${jobA.id}`)
  const row = ((r as any).rows || r)[0]
  check('the money is still ON the job — this is a read gate, not a deletion',
    Number(row?.estimated_revenue) === 48500 && Number(row?.material_cost) === 16200, row)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
