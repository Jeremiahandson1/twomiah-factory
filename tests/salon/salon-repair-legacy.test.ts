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
import { company, user, contact, invoice, serviceRecord, appointment, clientProfile } from './db/schema.ts'
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

// ── FULL0929 F1: visits standing against an appointment that was cancelled ───────────────────────
//
// Cancelling a completed visit now takes the visit record with it. That changed what happens NEXT,
// and the records the old build left are still on the chart — counted in the client's visit total,
// used as their last visit, and feeding the rebooking reminder. On the live tenant that is seven of
// them, one of which is the retest's own named symptom: LYR2 Papa on Due to Rebook for 8 October
// because of a cut that was cancelled.
const AUTO_NOTE = 'Logged automatically when the appointment was completed.'
const clientCancelled = await mkClient('Cass Cancelled')
const clientFormula = await mkClient('Col Formula')
const clientTypist = await mkClient('Tam Typist')
const clientReal = await mkClient('Rhea Real')
const clientNoShow = await mkClient('Nell Noshow')

const mkAppt = async (contactId: string, status: string) => (await db.insert(appointment).values({
  companyId: co.id, contactId, status, startTime: past, endTime: new Date(past.getTime() + 1800000),
} as any).returning())[0]
const mkVisitOn = async (contactId: string, apptId: string, extra: Record<string, any> = {}) =>
  (await db.insert(serviceRecord).values({
    companyId: co.id, contactId, appointmentId: apptId, performedAt: past, createdAt: past,
    priceCharged: '35.00', notes: AUTO_NOTE, ...extra,
  } as any).returning())[0]

const cancelledAppt = await mkAppt(clientCancelled.id, 'cancelled')
const staleVisit = await mkVisitOn(clientCancelled.id, cancelledAppt.id)

const formulaAppt = await mkAppt(clientFormula.id, 'cancelled')
const formulaVisit = await mkVisitOn(clientFormula.id, formulaAppt.id, { formula: [{ product: 'Colour 6N', developer: '20 vol' }] })

const typistAppt = await mkAppt(clientTypist.id, 'cancelled')
const typedVisit = await mkVisitOn(clientTypist.id, typistAppt.id, { notes: 'Client asked for half an inch off next time.' })

const realAppt = await mkAppt(clientReal.id, 'completed')
const realVisit = await mkVisitOn(clientReal.id, realAppt.id)

const noShowAppt = await mkAppt(clientNoShow.id, 'no_show')
const noShowVisit = await mkVisitOn(clientNoShow.id, noShowAppt.id)

const visitExists = async (id: string) => rows(await db.execute(sql`SELECT id FROM service_record WHERE id = ${id}`)).length === 1
const notesOf = async (id: string) => rows(await db.execute(sql`SELECT notes FROM service_record WHERE id = ${id}`))[0]?.notes

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

// Every visit standing against a cancelled appointment goes — ALL FOUR, not two. The earlier version
// kept back the ones a stylist had written on, because the formula lived nowhere else, and paid for
// it by leaving phantom visits driving rebooking reminders. A formula belongs to the CLIENT, so the
// work is lifted onto their card first and nothing has to be kept back.
check('F1: every visit that never happened is taken off the chart', r.json?.visitsRemoved === 4, { got: r.json?.visitsRemoved, want: 4 })
check('F1: …the cancelled one is gone', !(await visitExists(staleVisit.id)))
check('F1: …and so is the no-show, which the product treats the same way', !(await visitExists(noShowVisit.id)))
check('F1: …and so is the one carrying a formula', !(await visitExists(formulaVisit.id)))
check('F1: …and the one carrying a stylist\'s own note', !(await visitExists(typedVisit.id)))
check('F1: a visit against an appointment that actually happened is untouched', await visitExists(realVisit.id))
check('F1: …and keeps the note the system wrote', (await notesOf(realVisit.id)) === AUTO_NOTE, await notesOf(realVisit.id))

check('F1: the two stylists\' formulas were kept before their visits went', r.json?.formulasKept === 2, { got: r.json?.formulasKept, want: 2 })
{
  const keptFor = async (contactId: string) => {
    const [p] = await db.select().from(clientProfile).where(eq(clientProfile.contactId, contactId))
    return (Array.isArray(p?.formulas) ? p!.formulas : []) as any[]
  }
  const colour = (await keptFor(clientFormula.id))[0]
  check('F1: …the colour formula is on its client\'s card', colour?.formula?.[0]?.product === 'Colour 6N', colour)
  check('F1: …labelled so a stylist knows where it came from', /cancelled/i.test(String(colour?.label)), colour?.label)

  const typed = (await keptFor(clientTypist.id))[0]
  check('F1: …and the stylist\'s own words are on theirs', /half an inch/.test(String(typed?.note)), typed)

  check('F1: an untouched auto-logged visit leaves nothing on the card', (await keptFor(clientCancelled.id)).length === 0, await keptFor(clientCancelled.id))
  check('F1: …and the system\'s own note is never mistaken for a stylist\'s',
    !(await keptFor(clientCancelled.id)).some((f: any) => String(f.note || '').includes('Logged automatically')), await keptFor(clientCancelled.id))
}

{
  const again = await api('POST', '/api/service-records/repair-legacy')
  check('running it again changes nothing — it is idempotent',
    again.json?.invoicesVoided === 0 && again.json?.visitsRedated === 0 && again.json?.visitsRemoved === 0, again.json)
  check('F1: …and keeps no formula a second time, because the visits are already gone',
    again.json?.formulasKept === 0, again.json)
  const [p] = await db.select().from(clientProfile).where(eq(clientProfile.contactId, clientFormula.id))
  check('F1: …so the card does not collect duplicates of the same mix',
    (Array.isArray(p?.formulas) ? p!.formulas.length : 0) === 1, p?.formulas)
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
