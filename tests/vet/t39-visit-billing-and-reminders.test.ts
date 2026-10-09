// crm-vet — billing a visit and the reminder engine, which is what a practice runs on. (T39)
//
// WHY THIS SUITE EXISTS AT ALL. crm-vet had 203 endpoint declarations and ZERO vertical-specific
// tests: only the shared contract test, which proves two fleet-wide invariants and nothing about a
// veterinary practice. The vet QA round closed 14 of 17 findings and none of them has been pinned
// since.
//
// TWO THINGS ARE TESTED, and one of them is about the suite's own foundations:
//
//   THE MOUNTS. crm-vet wires every one of its signature modules inside a try/catch that only
//   console.errors — `try { app.route('/api/patients', …) } catch (e) { console.error(...) }`. That
//   is exactly how crm-homecare's leads module was dead for a whole round: an import error inside
//   the factory left the route unmounted and the try/catch swallowed it, so the screen was empty and
//   nothing failed. A vet module that stops mounting would be just as silent, so the first block
//   asserts the routers answer at all.
//
//   BILLING A VISIT. POST /visits/:id/invoice is where a consult becomes money. The rules it
//   enforces were each a finding: a visit cannot be billed twice (409), a visit with no charge
//   cannot be billed, a patient with no owner cannot be billed, the invoice number continues from
//   the highest existing one (VET-03), and the invoice carries the ANIMAL's id as well as the
//   owner's so the chart's Invoices tab can show it (T12 M6).
//
// THE ASSERTIONS ARE FIGURES AND ROW COUNTS. "The invoice endpoint answered 201" would pass while
// billing the same visit twice.
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
const { company, user, contact, patient, visit, vaccination, invoice } = await import('./db/schema.ts')

const [co] = await db.insert(company).values({
  name: 'Fernwood Veterinary', slug: 'fernwood-vet-t39', email: 'fernwood@test.local', state: 'OH',
  settings: {}, enabledFeatures: [],
} as any).returning()
const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}@fernwood.local`, passwordHash: 'x', firstName: tag, lastName: 'U',
  role, companyId: co.id, isActive: true,
} as any).returning())[0]
const owner = await mkUser('owner', 'owner')
const tech = await mkUser('field', 'tech')

// vet's contact carries a single `name`; a patient needs an owner and a name.
const [client] = await db.insert(contact).values({
  companyId: co.id, name: 'Priya Raman', email: 'priya@test.local', phone: '614-555-0188',
} as any).returning()
const [pet] = await db.insert(patient).values({
  companyId: co.id, ownerId: client.id, name: 'Biscuit', species: 'dog', breed: 'Beagle',
} as any).returning()
// A patient with NO owner — nobody to bill, which the route refuses rather than billing nobody.
const [stray] = await db.insert(patient).values({
  companyId: co.id, ownerId: client.id, name: 'Shadow', species: 'cat',
} as any).returning()

const app = new Hono()
for (const [mount, file] of [
  ['/api/patients', 'patients'], ['/api/visits', 'visits'],
  ['/api/vaccinations', 'vaccinations'], ['/api/reminders', 'reminders'],
  ['/api/appointments', 'appointments'],
] as const) {
  // Deliberately NOT inside a try/catch: if a module cannot be imported, this suite must fail
  // loudly. The product's own index.ts swallows it, which is the fault being guarded against.
  app.route(mount, (await import(`./src/routes/${file}.ts`)).default)
}
app.onError((await import('./src/utils/errors.ts')).errorHandler)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j, text: t }
}
// A manager seat too, because the T41 race mixed roles — owner, staff and manager all billed the
// same visit at once, and all three won.
const manager = await mkUser('manager', 'manager')
const asOwner = as(owner), asTech = as(tech), asManager = as(manager)

const count = async (q: any) => Number((((await db.execute(q)) as any).rows ?? [])[0]?.n ?? 0)

// ══════════ the signature modules actually mount and answer ══════════════════════════════════
//
// A route the product failed to mount answers 404 with no error anywhere — homecare's leads module
// shipped that way for a round.
console.log('\n══════════ the modules are reachable ══════════')
{
  for (const p of ['/api/patients', '/api/visits', '/api/vaccinations', '/api/appointments']) {
    const r = await asOwner('GET', p)
    check(`GET ${p} is mounted and answers`, r.status === 200, { status: r.status, body: r.text?.slice(0, 120) })
  }
  const due = await asOwner('GET', '/api/reminders/due')
  check('GET /api/reminders/due is mounted and answers', due.status === 200, { status: due.status, body: due.text?.slice(0, 120) })
}

// ══════════ billing a visit ══════════════════════════════════════════════════════════════════
console.log('\n══════════ a consult becomes an invoice ══════════')
let visitId = '', invoiceId = ''
{
  // An existing invoice, so the numbering has something to continue from (VET-03).
  await db.insert(invoice).values({
    companyId: co.id, contactId: client.id, number: 'INV-00041', subtotal: '10.00', total: '10.00',
    amountPaid: '0', taxAmount: '0', taxRate: '0', discount: '0', status: 'draft',
  } as any).returning()

  const [v] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-18T15:00:00Z'),
    reason: 'Limping on the left hind', total: '184.50',
  } as any).returning()
  visitId = v.id

  const billed = await asOwner('POST', `/api/visits/${visitId}/invoice`)
  check('a visit with a charge bills', billed.status === 201, { status: billed.status, body: billed.text?.slice(0, 200) })
  invoiceId = billed.json?.id
  check('…for the visit total, to the cent', Number(billed.json?.total) === 184.5, { total: billed.json?.total })
  check('…numbered INV-00042, continuing from the highest existing — not INV-00001',
    billed.json?.number === 'INV-00042', { number: billed.json?.number })
  check('…billed to the OWNER', billed.json?.contactId === client.id, { contactId: billed.json?.contactId })

  // T12 M6: the owner pays, but the charges are this animal's, and the chart reads patientId.
  check('…and carries the ANIMAL\'s id so the chart\'s Invoices tab can show it (T12 M6)',
    billed.json?.patientId === pet.id, { patientId: billed.json?.patientId, expected: pet.id })

  const li = await count(sql`SELECT COUNT(*)::int AS n FROM invoice_line_item WHERE invoice_id = ${invoiceId}`)
  check('…with exactly one line item', li === 1, { lineItems: li })
  const desc: any = await db.execute(sql`SELECT description, unit_price, total FROM invoice_line_item WHERE invoice_id = ${invoiceId}`)
  const row = ((desc as any).rows || desc)[0]
  check('…whose description names the animal, not "undefined"',
    /Biscuit/.test(String(row?.description)) && !/undefined|NaN/.test(String(row?.description)), row?.description)
  check('…and whose money matches the header', Number(row?.total) === 184.5, row)
}

// ══════════ a visit is billed once ═══════════════════════════════════════════════════════════
console.log('\n══════════ never twice ══════════')
{
  const before = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  const again = await asOwner('POST', `/api/visits/${visitId}/invoice`)
  check('billing the same visit again is refused', again.status === 409, { status: again.status, body: again.text?.slice(0, 160) })
  check('…and says it is already billed', /already been billed/i.test(String(again.json?.error)), again.json?.error)
  const after = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…and no second invoice was raised', after === before, { before, after })

  const stillOne = await count(sql`SELECT COUNT(*)::int AS n FROM invoice_line_item WHERE invoice_id = ${invoiceId}`)
  check('…and the first invoice did not grow a second line', stillOne === 1, { lineItems: stillOne })
}

// ══════════ T41 · the 409 path under parallel calls — AND WHAT THIS CANNOT PROVE ══════════════
//
// READ THIS BEFORE TRUSTING IT. This block fires four parallel bills at one visit and asserts one
// wins. It passes. It ALSO passes with the `FOR UPDATE` lock deleted from the handler — I checked.
// PGlite serialises the sandbox's requests, so there is no real concurrency here and this cannot
// observe the race in either direction.
//
// What it does earn: the 409 path, the invoice count, the visit link and the no-orphans invariant,
// all of which are worth keeping. What it must NOT be read as: evidence that the race is fixed.
//
// The race is proven two other ways, because this one cannot:
//   · scripts/check-billing-race-guarded.ts (#196) pins the lock and the shared write path in source
//   · scratchpad/race-vet-live.ts races the LIVE tenant on real Postgres, which is where T41 found it.
//     Before the fix: 4 of 5 rounds double-billed, one round turned 4 clicks into 4 invoices, with
//     duplicate numbers in four rounds.
console.log('\n══════════ parallel bills (the 409 path; PGlite cannot race) ══════════')
{
  const [v] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-25T15:00:00Z'),
    reason: 'Dental under anaesthetic', total: '412.75',
  } as any).returning()

  const before = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)

  // Four at once, from three different seats — the shape T41 used.
  const results = await Promise.all([
    asOwner('POST', `/api/visits/${v.id}/invoice`),
    asOwner('POST', `/api/visits/${v.id}/invoice`),
    asTech('POST', `/api/visits/${v.id}/invoice`),
    asManager('POST', `/api/visits/${v.id}/invoice`),
  ])
  const created = results.filter((r) => r.status === 201)
  const refused = results.filter((r) => r.status === 409)

  check('exactly ONE of four concurrent bills is accepted', created.length === 1,
    { statuses: results.map((r) => r.status), bodies: results.filter((r) => r.status >= 400).map((r) => r.text?.slice(0, 80)) })
  check('…and the other three are refused as already billed', refused.length === 3, { refused: refused.length, statuses: results.map((r) => r.status) })

  const after = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  check('…so the ledger grew by exactly one invoice', after === before + 1, { before, after })

  // The duplicate NUMBER is its own fault: a max() scan with nothing serialising it handed the same
  // number to both winners. insertInvoice numbers under pg_advisory_xact_lock.
  const dupes: any = await db.execute(sql`
    SELECT number, COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id} GROUP BY number HAVING COUNT(*) > 1`)
  const dupeRows = ((dupes as any).rows || dupes)
  check('…and no two invoices share a number', dupeRows.length === 0, dupeRows)

  // An orphan is the lasting damage: an invoice in AR that no visit points at.
  const linked: any = await db.execute(sql`SELECT invoice_id FROM visit WHERE id = ${v.id}`)
  const invoiceId = ((linked as any).rows || linked)[0]?.invoice_id
  check('…the visit points at the invoice that was raised', invoiceId === created[0]?.json?.id,
    { onVisit: invoiceId, created: created[0]?.json?.id })

  const orphans = await count(sql`
    SELECT COUNT(*)::int AS n FROM invoice i
     WHERE i.company_id = ${co.id} AND i.patient_id = ${pet.id}
       AND NOT EXISTS (SELECT 1 FROM visit vv WHERE vv.invoice_id = i.id)`)
  check('…and no orphaned invoice is left sitting in AR', orphans === 0, { orphans })
}

// ══════════ a visit with nothing to charge ═══════════════════════════════════════════════════
console.log('\n══════════ nothing to bill ══════════')
{
  const [free] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-20T15:00:00Z'),
    reason: 'Post-op check, no charge', total: '0',
  } as any).returning()
  const r = await asOwner('POST', `/api/visits/${free.id}/invoice`)
  check('a visit with a zero charge is not billed', r.status === 400, { status: r.status, body: r.text?.slice(0, 160) })
  check('…and says why', /no charge/i.test(String(r.json?.error)), r.json?.error)

  const [novalue] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-21T15:00:00Z'), reason: 'Nail trim',
  } as any).returning()
  const r2 = await asOwner('POST', `/api/visits/${novalue.id}/invoice`)
  check('a visit with no total at all is not billed either', r2.status === 400, { status: r2.status, body: r2.text?.slice(0, 140) })

  const missing = await asOwner('POST', `/api/visits/does-not-exist/invoice`)
  check('a visit that does not exist is a 404, not a 500', missing.status === 404, { status: missing.status })
}

// ══════════ who may turn a consult into money ════════════════════════════════════════════════
//
// A CLINICAL SEAT CAN BILL HERE, AND THAT IS DELIBERATE — the opposite of the contractor.
//
// My first version of this block asserted a `field` seat is REFUSED, because that is the rule on
// crm and crm-fieldservice where a technician sees no money. It failed: vet grants the field role
// contacts:create/update and invoices:read/create/update through `extraRolePermissions`, and says
// why at the wiring — "Clinical staff (technician/receptionist) must be able to record care and bill
// for it" (R2-02), with sms:send added because "your pet is out of surgery" is their message to send
// (T30 L-RB). The receptionist checking a client out IS the person who raises the invoice.
//
// So this pins the grant rather than fighting it: a sweep that applies the contractor's "field sees
// no money" rule across the fleet would break a working practice, and this assertion is what says so.
console.log('\n══════════ who may bill ══════════')
{
  const [v] = await db.insert(visit).values({
    companyId: co.id, patientId: stray.id, visitDate: new Date('2026-09-22T15:00:00Z'),
    reason: 'Vaccination visit', total: '95.00',
  } as any).returning()

  const byTech = await asTech('POST', `/api/visits/${v.id}/invoice`)
  check('a clinical (field) seat CAN raise the invoice — R2-02, the receptionist checks the client out',
    byTech.status === 201, { status: byTech.status, body: byTech.text?.slice(0, 160) })
  check('…for the right money', Number(byTech.json?.total) === 95, { total: byTech.json?.total })
  check('…and it is billed to the owner, not to nobody', byTech.json?.contactId === client.id, { contactId: byTech.json?.contactId })

  // …and it still stops somewhere: a read-only seat records nothing.
  const viewer = await mkUser('viewer', 'viewer')
  const [v2] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-23T15:00:00Z'),
    reason: 'Ear check', total: '60.00',
  } as any).returning()
  const before = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  const byViewer = await as(viewer)('POST', `/api/visits/${v2.id}/invoice`)
  check('a VIEWER cannot raise one', byViewer.status === 403, { status: byViewer.status, body: byViewer.text?.slice(0, 140) })
  check('…and no invoice appeared', (await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)) === before,
    { before, after: await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`) })
  const byViewerRead = await as(viewer)('GET', '/api/patients')
  check('…but may read the patient list', byViewerRead.status === 200, { status: byViewerRead.status })
}

// ══════════ the reminder engine — the retention model ════════════════════════════════════════
console.log('\n══════════ what is due, and what has lapsed ══════════')
{
  // Three vaccinations: one overdue, one due soon, one a year out.
  const day = 24 * 60 * 60 * 1000
  await db.insert(vaccination).values([
    { companyId: co.id, patientId: pet.id, vaccine: 'Rabies', givenDate: new Date(Date.now() - 400 * day), dueDate: new Date(Date.now() - 35 * day) },
    { companyId: co.id, patientId: pet.id, vaccine: 'Bordetella', givenDate: new Date(Date.now() - 350 * day), dueDate: new Date(Date.now() + 10 * day) },
    { companyId: co.id, patientId: stray.id, vaccine: 'FVRCP', givenDate: new Date(Date.now() - 20 * day), dueDate: new Date(Date.now() + 340 * day) },
  ] as any)
  // A vaccination with NO due date cannot be "due" — the route requires one.
  await db.insert(vaccination).values({
    companyId: co.id, patientId: pet.id, vaccine: 'Lepto (single dose)', givenDate: new Date(Date.now() - 5 * day),
  } as any)

  const due = await asOwner('GET', '/api/reminders/due')
  check('the due list answers', due.status === 200, { status: due.status })
  check('…and names the overdue Rabies', /Rabies/.test(due.text), due.text?.slice(0, 220))
  check('…and the animal it belongs to, not just an id', /Biscuit/.test(due.text), due.text?.slice(0, 220))
  check('…and the vaccination with no due date is NOT in it', !/Lepto/.test(due.text), due.text?.slice(0, 260))
  check('…and the one 340 days out is not treated as due', !/FVRCP/.test(due.text), due.text?.slice(0, 260))
  check('…with no NaN or undefined anywhere in it', !/NaN|undefined/.test(due.text), due.text?.slice(0, 200))

  const lapsed = await asOwner('GET', '/api/reminders/lapsed')
  check('the lapsed list answers too', lapsed.status === 200, { status: lapsed.status, body: lapsed.text?.slice(0, 140) })
}

// ══════════ another practice's animals are not reachable ═════════════════════════════════════
console.log('\n══════════ company scoping ══════════')
{
  const [other] = await db.insert(company).values({
    name: 'Rival Vets', slug: 'rival-vet-t39', email: 'rival@test.local', state: 'OH', settings: {}, enabledFeatures: [],
  } as any).returning()
  const [intruder] = await db.insert(user).values({
    email: 'intruder@rivalvet.local', passwordHash: 'x', firstName: 'I', lastName: 'R', role: 'owner', companyId: other.id, isActive: true,
  } as any).returning()

  const pats = await as(intruder)('GET', '/api/patients')
  check('another practice does not see Biscuit', !/Biscuit/.test(pats.text), { status: pats.status, body: pats.text?.slice(0, 160) })
  const dueThere = await as(intruder)('GET', '/api/reminders/due')
  check('…nor this practice\'s reminders', !/Rabies|Biscuit/.test(dueThere.text), dueThere.text?.slice(0, 160))

  // Its OWN unbilled visit: the earlier blocks have billed the others, and a 409 "already billed"
  // would let this assertion pass without the ownership check doing anything.
  const [fresh] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-24T15:00:00Z'),
    reason: 'Dental scale', total: '240.00',
  } as any).returning()
  const before = await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)
  const bill = await as(intruder)('POST', `/api/visits/${fresh.id}/invoice`)
  check('…and cannot bill a visit here', bill.status === 404, { status: bill.status, body: bill.text?.slice(0, 140) })
  check('…so no invoice was raised in this practice', (await count(sql`SELECT COUNT(*)::int AS n FROM invoice WHERE company_id = ${co.id}`)) === before,
    { before })
}

// ══════════ T41 · the DATABASE refuses a second bill, not just the route ════════════════════════
//
// The T41 blocker asked for four things: a transactional check, a row lock, a unique visit→invoice
// constraint and a unique invoice number. The first two are in the route and are what actually stops
// the race; these are the other two, from migration 0029, and they are asserted here because a
// constraint nobody tests is a constraint that quietly fails to be created.
//
// This is also the only part of the blocker a suite CAN prove. PGlite serialises requests, so the
// race itself is unobservable here — the block above says so, and guard #196 is what holds the lock
// in place. A constraint, by contrast, either exists or does not.
console.log('\n══════════ the constraints under bill-once ══════════')
{
  const oneRow = async (q: any) => { const r: any = await db.execute(q); return ((r.rows || r) as any[])[0] }

  // Both indexes must EXIST. Asserted by name against pg_indexes, because a CREATE INDEX that fails
  // during setup is only logged, and a constraint nobody checks for is one that quietly isn't there.
  const idx = async (name: string) =>
    !!(await oneRow(sql`SELECT indexname FROM pg_indexes WHERE indexname = ${name}`))
  check('T41: visit_invoice_id_unique_idx exists', await idx('visit_invoice_id_unique_idx'))
  check('T41: invoice_company_number_live_unique_idx exists', await idx('invoice_company_number_live_unique_idx'))

  // ── one visit bills once ──
  const [v] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-28T09:00:00Z'),
    reason: 'Constraint probe', total: '60.00',
  } as any).returning()
  const billed = await asOwner('POST', `/api/visits/${v.id}/invoice`)
  check('T41: the probe visit bills once', billed.status === 201, { status: billed.status })
  const invId = billed.json?.id

  // Point a SECOND visit at the same invoice by hand. The route would never do this; the index must
  // refuse it anyway, because that is the invariant — one invoice, one visit.
  const [v2] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date('2026-09-28T10:00:00Z'),
    reason: 'Second visit, same invoice', total: '60.00',
  } as any).returning()
  let refusedVisit = false
  try {
    await db.execute(sql`UPDATE visit SET invoice_id = ${invId} WHERE id = ${v2.id}`)
  } catch { refusedVisit = true }
  check('T41: two visits CANNOT share one invoice — visit_invoice_id_unique_idx exists', refusedVisit,
    { invoiceId: invId })

  // ── one live invoice number per practice ──
  const dup = await oneRow(sql`SELECT number FROM invoice WHERE id = ${invId}`)
  let refusedNumber = false
  try {
    await db.execute(sql`
      INSERT INTO invoice (id, number, status, issue_date, due_date, subtotal, tax_rate, tax_amount,
                           discount, total, amount_paid, company_id, contact_id)
      VALUES ('t41-dup-probe', ${dup.number}, 'draft', NOW(), NOW(), '1', '0', '0', '0', '1', '0',
              ${co.id}, ${client.id})
    `)
  } catch { refusedNumber = true }
  check('T41: a SECOND live invoice cannot reuse a number — the duplicate INV-00061/70 shape is refused',
    refusedNumber, { number: dup.number })

  // …but a VOIDED invoice may keep a duplicated number, which is what let the constraint be added to
  // a tenant where the race had already happened and the orphans were voided.
  let voidedAllowed = true
  try {
    await db.execute(sql`
      INSERT INTO invoice (id, number, status, issue_date, due_date, subtotal, tax_rate, tax_amount,
                           discount, total, amount_paid, company_id, contact_id)
      VALUES ('t41-void-probe', ${dup.number}, 'void', NOW(), NOW(), '1', '0', '0', '0', '1', '0',
              ${co.id}, ${client.id})
    `)
  } catch { voidedAllowed = false }
  check('T41: …while a VOIDED duplicate is allowed, so the index could go on a tenant that already raced',
    voidedAllowed, { number: dup.number })
  await db.execute(sql`DELETE FROM invoice WHERE id IN ('t41-void-probe', 't41-dup-probe')`)
}

// ══════════ T41 — ONCE THE BILL IS RAISED, THE CHARGE IS WHAT THE BILL SAYS ══════════════════
//
//   "A billed visit's total can still be edited after invoicing (PUT 999 → 200; the invoice stays
//    125.50)."
//
// The two figures simply stopped agreeing: the visit said 999, the invoice said 125.50, and the
// owner is holding the 125.50 one. Every surface that totals visits then reads a number nobody was
// asked to pay.
//
// ONLY THE MONEY IS FROZEN, and that half is asserted just as hard: a vet finishing the write-up
// that evening, a lab result, a mistyped weight — all must still save on a billed visit, or the
// work goes somewhere other than the medical record.
console.log('\n══════════ editing a visit after it has been billed ══════════')
{
  const [billed] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date(), reason: 'Lame on the left fore',
    total: '125.50', assessment: 'Soft-tissue strain', weightLb: '31.2',
  } as any).returning()
  const [inv] = await db.insert(invoice).values({
    companyId: co.id, contactId: client.id, number: 'INV-T41-VIS', subtotal: '125.50', total: '125.50',
    amountPaid: '0', taxAmount: '0', taxRate: '0', discount: '0', status: 'sent',
  } as any).returning()
  await db.execute(sql`UPDATE visit SET invoice_id = ${inv.id} WHERE id = ${billed.id}`)

  const row = async () => {
    const r: any = await db.execute(sql`SELECT total, assessment, weight_lb, notes FROM visit WHERE id = ${billed.id}`)
    return ((r as any).rows || r)[0]
  }

  const raise = await asOwner('PUT', `/api/visits/${billed.id}`, { patientId: pet.id, total: 999 })
  check('T41: raising the charge on an invoiced visit is REFUSED', raise.status === 400,
    { status: raise.status, body: raise.text?.slice(0, 200) })
  check('T41: …and the refusal says what to do instead — credit or void the invoice',
    /credit or void/i.test(String(raise.json?.error)) && raise.json?.code === 'visit_already_invoiced',
    raise.json)
  check('T41: …the charge is untouched at 125.50', Number((await row())?.total) === 125.5, await row())

  // Lowering it is the same fault in the other direction, and a test that only tried 999 would miss
  // a fix written as `if (updates.total > existing.total)`.
  const lower = await asOwner('PUT', `/api/visits/${billed.id}`, { patientId: pet.id, total: 1 })
  check('T41: LOWERING it is refused too', lower.status === 400 && Number((await row())?.total) === 125.5,
    { status: lower.status, total: (await row())?.total })

  // The clinical half.
  const clinical = await asOwner('PUT', `/api/visits/${billed.id}`, {
    patientId: pet.id, assessment: 'Soft-tissue strain, improving; recheck in 10 days', notes: 'Owner rang Tuesday',
  })
  check('T41: the clinical write-up still saves on a billed visit', clinical.status === 200,
    { status: clinical.status, body: clinical.text?.slice(0, 200) })
  check('T41: …and it really changed', /recheck in 10 days/.test(String((await row())?.assessment)), await row())
  check('T41: …without disturbing the charge', Number((await row())?.total) === 125.5, await row())

  // The edit form posts every field back, including the total it was shown. That must not be a
  // refusal — it is a save that changes nothing about the money.
  const resave = await asOwner('PUT', `/api/visits/${billed.id}`, {
    patientId: pet.id, total: 125.5, notes: 'Second call Thursday',
  })
  check('T41: re-saving the form with the SAME total is accepted, not refused', resave.status === 200,
    { status: resave.status, body: resave.text?.slice(0, 200) })
  check('T41: …and the note landed', /Thursday/.test(String((await row())?.notes)), await row())

  // An UNbilled visit is still freely editable — the rule must be about the invoice, not about
  // visits in general.
  const [open] = await db.insert(visit).values({
    companyId: co.id, patientId: pet.id, visitDate: new Date(), reason: 'Vaccination', total: '22.00',
  } as any).returning()
  const openEdit = await asOwner('PUT', `/api/visits/${open.id}`, { patientId: pet.id, total: 45 })
  const openRow: any = await db.execute(sql`SELECT total FROM visit WHERE id = ${open.id}`)
  check('T41: a visit that has NOT been billed can still have its charge corrected',
    openEdit.status === 200 && Number((((openRow as any).rows || openRow)[0])?.total) === 45,
    { status: openEdit.status, rows: (openRow as any).rows })
}

// ══════════ T41 — a booster cannot be due before the shot that needs it ══════════════════════
//
//   "A vaccination due date before the given date is accepted."
//
// Not an unusual case — a typo, a year mistyped or the two fields filled in the wrong order — and
// the practice pays twice: the reminder engine calls the owner in for a booster that is not due, and
// a rabies certificate prints an expiry that has already passed, which is the document a shelter or
// a groomer relies on.
console.log('\n══════════ vaccination dates ══════════')
{
  const mk = (givenDate: string, dueDate: string | null) =>
    asOwner('POST', '/api/vaccinations', { patientId: pet.id, vaccine: 'Rabies 1yr', givenDate, dueDate, isRabies: true })

  const backwards = await mk('2026-10-01', '2025-10-01')
  check('T41: a due date BEFORE the date given is refused', backwards.status === 400,
    { status: backwards.status, body: backwards.text?.slice(0, 200) })
  check('T41: …and the message names both dates, so the typo is findable',
    /2025-10-01/.test(String(backwards.json?.error)) && /2026-10-01/.test(String(backwards.json?.error)),
    backwards.json)

  const oneDayBefore = await mk('2026-10-01', '2026-09-30')
  check('T41: one day before is refused too — this is not a tolerance', oneDayBefore.status === 400,
    { status: oneDayBefore.status })

  // Same day is a real entry: a puppy brought back that afternoon for the next of a series.
  const sameDay = await mk('2026-10-01', '2026-10-01')
  check('T41: the SAME day is allowed — a series can be written up that way', sameDay.status === 201,
    { status: sameDay.status, body: sameDay.text?.slice(0, 200) })
  const normal = await mk('2026-10-01', '2027-10-01')
  check('a year later is of course allowed', normal.status === 201, { status: normal.status })
  const noDue = await mk('2026-10-01', null)
  check('…and so is no due date at all — not every vaccine has one', noDue.status === 201, { status: noDue.status })

  // The edit form is exactly where a date gets corrected, and where it gets mistyped again.
  const vaccId = normal.json?.id
  const editBackwards = await asOwner('PUT', `/api/vaccinations/${vaccId}`, { dueDate: '2026-01-01' })
  check('T41: the same rule applies on EDIT', editBackwards.status === 400,
    { status: editBackwards.status, body: editBackwards.text?.slice(0, 200) })
  // …and it has to compare against the STORED date, not only against a date in the same request.
  const movedGiven = await asOwner('PUT', `/api/vaccinations/${vaccId}`, { givenDate: '2028-01-01' })
  check('T41: …including when only the GIVEN date moves, past a due date already on the row',
    movedGiven.status === 400, { status: movedGiven.status, body: movedGiven.text?.slice(0, 200) })
  const r: any = await db.execute(sql`SELECT given_date, due_date FROM vaccination WHERE id = ${vaccId}`)
  const kept = ((r as any).rows || r)[0]
  check('T41: …and neither refusal wrote anything', String(kept?.given_date).startsWith('2026-10-01')
    && String(kept?.due_date).startsWith('2027-10-01'), kept)
  const goodEdit = await asOwner('PUT', `/api/vaccinations/${vaccId}`, { dueDate: '2027-12-01' })
  check('a sensible correction still saves', goodEdit.status === 200, { status: goodEdit.status })
}

// ══════════ T41 — a visit is a record of something that HAPPENED ═══════════════════════════════
//
//   "Recent Visits is led by a future-dated 2027 visit."
//
// Nothing checked visitDate, so a mistyped year saved and then sat at the top of every list that
// orders by it. A visit carries vitals, an assessment and a charge, so a future-dated one is a
// consultation the clinic is asserting it has already done. Appointments are the future; visits are
// not. The tolerance is 36 hours, because the date arrives as the browser's local day.
console.log('\n══════════ a visit cannot be in the future ══════════')
{
  const future = await asOwner('POST', '/api/visits', { patientId: pet.id, visitDate: '2027-11-02T15:00:00Z', reason: 'Mistyped year' })
  check('T41: a 2027 visit is refused', future.status === 400, { status: future.status, body: future.text?.slice(0, 200) })
  check('T41: …and says what to do instead', /appointment/i.test(String(future.json?.error)), future.json)

  const noneWritten = await count(sql`SELECT COUNT(*)::int AS n FROM visit WHERE reason = 'Mistyped year'`)
  check('T41: …and wrote nothing', noneWritten === 0, { rows: noneWritten })

  // Later TODAY is still today — on the practice's calendar (Ohio → America/New_York). T41 used "now +
  // 6 hours", which is tomorrow from 6pm ET and so passed or failed by the hour the suite ran; the
  // owner's 11:24pm run then showed the rule itself was wrong across midnight (T59). Both claims are
  // now made against the practice's own day boundary, so they hold whatever time it is.
  const { storeDayRange } = await import('./src/shared/index.ts')
  const dayEnd = storeDayRange('America/New_York').end.getTime()
  const soon = new Date(Math.max(Date.now(), dayEnd - 60_000)).toISOString()
  const ok = await asOwner('POST', '/api/visits', { patientId: pet.id, visitDate: soon, reason: 'Entered from a clock ahead of UTC' })
  check('T41→T59: the last minute of the practice\'s day is still today, and accepted', ok.status === 201,
    { status: ok.status, body: ok.text?.slice(0, 200) })
  const pastMidnight = await asOwner('POST', '/api/visits', { patientId: pet.id, visitDate: new Date(dayEnd + 13 * 60_000).toISOString(), reason: 'Just after the practice midnight' })
  check('T59: 12:13am on the practice\'s next day is refused — the owner\'s case', pastMidnight.status === 400 && pastMidnight.json?.code === 'visit_date_in_future',
    { status: pastMidnight.status, body: pastMidnight.text?.slice(0, 200) })

  // The edit is the likelier typo of the two, so it has the same rule.
  const moved = await asOwner('PUT', `/api/visits/${ok.json?.id}`, { visitDate: '2030-01-01T09:00:00Z' })
  check('T41: the same rule applies on EDIT', moved.status === 400, { status: moved.status, body: moved.text?.slice(0, 200) })
  const stillOk = await asOwner('GET', `/api/visits/${ok.json?.id}`)
  check('T41: …and the stored date was left alone', new Date(String(stillOk.json?.visitDate)).getFullYear() < 2030,
    { visitDate: stillOk.json?.visitDate })

  // An edit that does not mention the date is unaffected.
  const otherEdit = await asOwner('PUT', `/api/visits/${ok.json?.id}`, { reason: 'Corrected reason' })
  check('an edit that does not touch the date still saves', otherEdit.status === 200, { status: otherEdit.status })
}

// ══════════ T41 — the age on a rabies certificate is the age on the DAY ════════════════════════
//
//   "the certificate shows the current age, not the age at vaccination"
//
// It read Date.now(), so the same certificate reprinted a year later aged the animal by a year —
// two copies of one legal record disagreeing about one event. Months under two years, because a
// puppy's first rabies certificate said "0 yr".
console.log('\n══════════ the certificate ══════════')
{
  const [puppy] = await db.insert(patient).values({
    companyId: co.id, ownerId: client.id, name: 'Pip', species: 'dog', breed: 'Collie',
    dob: '2024-01-10',
  } as any).returning()
  const shot = await asOwner('POST', '/api/vaccinations', {
    patientId: puppy.id, vaccine: 'Rabies 3yr', givenDate: '2024-05-10', dueDate: '2027-05-10', isRabies: true,
  })
  check('a rabies vaccination is recorded', shot.status === 201, { status: shot.status, body: shot.text?.slice(0, 200) })

  const cert = await asOwner('GET', `/api/reminders/rabies/${shot.json?.id}`)
  check('the certificate renders', cert.status === 200, { status: cert.status })
  // 10 Jan 2024 → 10 May 2024 is four months. The animal is over two years old TODAY, which is
  // exactly the number the old code printed.
  check('T41: it prints the age at vaccination — 4 mo, not the age today', /<td class="v">4 mo<\/td>/.test(cert.text || ''),
    (cert.text || '').slice((cert.text || '').indexOf('Age'), (cert.text || '').indexOf('Age') + 120))
  check('T41: …and the label says which age it means', /Age at vaccination/.test(cert.text || ''),
    /Age at vaccination/.test(cert.text || ''))
  check('T41: …so the figure is not the current age in years', !/<td class="v">[23] yr<\/td>/.test(cert.text || ''),
    (cert.text || '').slice((cert.text || '').indexOf('Age'), (cert.text || '').indexOf('Age') + 120))
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
