// Salon T22 caveat, in the tester's words: "Both H3 and M4 fixed the write path without backfilling —
// four orphan invoices worth $70.53 are still Open, and the old future-dated visits still head Recent
// Services."
//
// H3 taught the delete to void the sale its visit raised; M4 taught create and edit to refuse a visit
// dated to a day that has not happened. Neither did anything for rows already written. This repairs them,
// by the same rules: an invoice holding money is never touched, voiding keeps the number, and a visit is
// moved back to the day its record was actually created — the one date we know is true about it.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, invoice, serviceRecord, appointment } from './db/schema.ts'
import { sql, eq } from 'drizzle-orm'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 260)) } }
const rows = (r: any): any[] => ((r as any)?.rows || r) as any[]
const VISIT_NOTE = 'Created from the appointment book'

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Snip', slug: 'snip-rep', email: 'r@test.local', settings: {}, enabledFeatures: ['contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'r@test.local', passwordHash: 'x', firstName: 'Ann', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
// Four separate clients, because the rule that tells an orphan from a pre-fix unlinked sale works per
// CLIENT and per price. One client holding everything at one price is not what a salon looks like, and it
// makes every case shadow every other.
const mkClient = async (name: string) => (await db.insert(contact).values({ companyId: co.id, name, email: `${name.replace(/\W/g, '').toLowerCase()}@test.local`, type: 'customer' } as any).returning())[0]
const client = await mkClient('Dana Orphans')        // the four the tester counted; no visits left at all
const clientKept = await mkClient('Kim Kept')        // a sale whose visit is still linked
const clientUnlinked = await mkClient('Sam Unlinked') // a pre-fix visit with no link, matching on price
const clientDates = await mkClient('Ali Dates')      // the future-dated visits

let n = 0
const mkInvoice = async (o: { contactId?: string; subtotal?: string; notes?: string | null; status?: string; paid?: string; refunded?: string; appointmentId?: string | null }) => {
  const sub = o.subtotal || '70.53'
  const [row] = await db.insert(invoice).values({
    companyId: co.id, contactId: o.contactId || client.id, number: `INV-${String(++n).padStart(5, '0')}`,
    status: o.status || 'open', subtotal: sub, total: sub, amountPaid: o.paid || '0', amountRefunded: o.refunded || '0',
    notes: o.notes === undefined ? VISIT_NOTE : o.notes, appointmentId: o.appointmentId ?? null,
  } as any).returning()
  return row
}
const mkVisit = async (o: { contactId?: string; performedAt: Date; createdAt: Date; price?: string | null; invoiceId?: string | null }) => {
  const [row] = await db.insert(serviceRecord).values({
    companyId: co.id, contactId: o.contactId || client.id, performedAt: o.performedAt, createdAt: o.createdAt,
    priceCharged: o.price === undefined ? '70.53' : o.price,
    ...(o.invoiceId ? { invoiceId: o.invoiceId } : {}),
  } as any).returning()
  return row
}

const DAY = 86400000
const past = new Date(Date.now() - 30 * DAY)
const future = new Date(Date.now() + 270 * DAY)   // the nine-months-out case the report describes

// The four the tester counted — 10.85 + 21.70 + 32.55 + 5.43 = $70.53, the exact figures from the tenant.
// This client has no visits left at all: every one was deleted before H3 taught the delete to answer for
// the sale it raised.
const orphans = [
  await mkInvoice({ subtotal: '10.85' }), await mkInvoice({ subtotal: '21.70' }),
  await mkInvoice({ subtotal: '32.55' }), await mkInvoice({ subtotal: '5.43' }),
]
// a visit-raised sale whose visit is still linked — must be left alone
const keptInv = await mkInvoice({ contactId: clientKept.id })
await mkVisit({ contactId: clientKept.id, performedAt: past, createdAt: past, invoiceId: keptInv.id })
// an orphan that was PAID: money blocks the void, exactly as the delete rule says
const paidOrphan = await mkInvoice({ paid: '70.53' })
// a manual invoice that never came from a visit — not ours to touch
const manual = await mkInvoice({ notes: 'Raised by hand for a product sale' })
// A visit logged BEFORE H3 has no link to its sale at all: no invoiceId, no appointmentId. Nothing points
// at its invoice, which is exactly what an orphan looks like — and it is not one, the visit is right
// there. The price is what tells them apart: the visit charged 50.00, the sale's SUBTOTAL is 50.00.
// Found on the live tenant, where the first version of this voided two real $54.25 sales. (T22)
const unlinkedInv = await mkInvoice({ contactId: clientUnlinked.id, subtotal: '50.00' })
await mkVisit({ contactId: clientUnlinked.id, performedAt: past, createdAt: past, price: '50.00' })
// one already void — nothing to do
const alreadyVoid = await mkInvoice({ status: 'void' })

// visits dated to a day that has not happened, plus a normal one
const futureVisit = await mkVisit({ contactId: clientDates.id, performedAt: future, createdAt: past })
const normalVisit = await mkVisit({ contactId: clientDates.id, performedAt: past, createdAt: past })

const app = new Hono()
app.route('/api/service-records', (await import('./src/routes/serviceRecords.ts')).default)
app.onError(errorHandler)
const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text(); let json: any = text; try { json = JSON.parse(text) } catch {}
  return { status: res.status, json }
}
const statusOf = async (id: string) => rows(await db.execute(sql`SELECT status FROM invoice WHERE id = ${id}`))[0]?.status
const performedOf = async (id: string) => rows(await db.execute(sql`SELECT performed_at, created_at FROM service_record WHERE id = ${id}`))[0]

// Captured as the RAW stored value: PGlite hands timestamps back without a zone, so re-parsing them in
// JS shifts by the local offset and a comparison against the original Date would fail on an unchanged row.
const normalBefore = String(rows(await db.execute(sql`SELECT performed_at FROM service_record WHERE id = ${normalVisit.id}`))[0]?.performed_at)

const r = await api('POST', '/api/service-records/repair-legacy')
check('the repair runs', r.status === 200, { status: r.status, body: r.json })
check('H3: the four orphan sales are voided — the tester\'s $70.53 each', r.json?.invoicesVoided === 4, { got: r.json?.invoicesVoided, want: 4 })
for (const o of orphans) check(`…${o.number} is void`, (await statusOf(o.id)) === 'void', await statusOf(o.id))
check('a sale whose visit is still there is untouched', (await statusOf(keptInv.id)) === 'open', await statusOf(keptInv.id))
check('an orphan holding money is NOT voided — the same rule the delete enforces', (await statusOf(paidOrphan.id)) === 'open', await statusOf(paidOrphan.id))
check('an invoice raised by hand is not ours to void', (await statusOf(manual.id)) === 'open', await statusOf(manual.id))
check('one already void stays void and is not recounted', (await statusOf(alreadyVoid.id)) === 'void', await statusOf(alreadyVoid.id))
check('H3: a sale whose pre-fix visit is still there — unlinked, but matching on price — is LEFT ALONE', (await statusOf(unlinkedInv.id)) === 'open', { status: await statusOf(unlinkedInv.id), note: 'this is the one the live run got wrong' })

check('M4: the future-dated visit is redated', r.json?.visitsRedated === 1, { got: r.json?.visitsRedated, want: 1 })
{
  const v = await performedOf(futureVisit.id)
  check('…to the day the record was actually created, so it stops heading Recent Services', new Date(v.performed_at).getTime() === new Date(v.created_at).getTime(), v)
  check('…and it is no longer in the future', new Date(v.performed_at).getTime() <= Date.now(), v?.performed_at)
}
{
  const v = await performedOf(normalVisit.id)
  check('a visit that already happened keeps its own date, to the millisecond', String(v?.performed_at) === normalBefore, { before: normalBefore, after: v?.performed_at })
}

{
  const again = await api('POST', '/api/service-records/repair-legacy')
  check('running it again changes nothing — it is idempotent', again.json?.invoicesVoided === 0 && again.json?.visitsRedated === 0, again.json)
}

// ── a repair that writes to money has to be reversible ────────────────────────────────────────────
{
  const undo = await api('POST', '/api/service-records/repair-legacy/undo')
  check('the repair can be put back', undo.status === 200 && undo.json?.restored === 4, { status: undo.status, restored: undo.json?.restored })
  for (const o of orphans) check(`…${o.number} is open again`, (await statusOf(o.id)) === 'open', await statusOf(o.id))
  const notes = rows(await db.execute(sql`SELECT notes FROM invoice WHERE id = ${orphans[0].id}`))[0]?.notes
  check('…and the line the repair wrote is gone with it', !String(notes || '').includes('Voided: the visit this sale came from'), notes)
  check('an invoice voided by a person is NOT restored — only the repair\'s own work', (await statusOf(alreadyVoid.id)) === 'void', await statusOf(alreadyVoid.id))

  const redo = await api('POST', '/api/service-records/repair-legacy')
  check('and the repair can run again afterwards', redo.json?.invoicesVoided === 4, redo.json?.invoicesVoided)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
