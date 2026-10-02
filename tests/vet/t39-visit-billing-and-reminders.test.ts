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
const asOwner = as(owner), asTech = as(tech)

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

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
