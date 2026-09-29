// crm-salon — RR0929 N6, N7, N8. Three server-side lows, each one a place where two bits of the
// same code read the same thing two different ways.
//
// N6  Keeping the same visit's formula twice answered `added: true` both times, so the toast said
//     "Kept on the card" when the card had actually re-dated the one row it already had. The screen
//     was already written to say "Already on the card — re-dated as used again" when told; it was
//     never told. keepFromRecord threw away the `created` flag keepFormula had just worked out, and
//     the route hardcoded true in its place.
//
// N7  A formula sent as a plain STRING saved with a 200 and arrived EMPTY. `hasSubstance` wrapped a
//     non-array into `[input.formula]` and said there was something to keep; `keepFormula` then did
//     `Array.isArray(input.formula) ? input.formula : []` and deleted it. The request passed the
//     check that decides whether there is anything to keep, and then had the thing itself removed.
//
// N8  A visit record from a completed appointment had `priceCharged: null` and showed $0.00 beside
//     an invoice for the real amount. onVisitCompleted resolved the price as "what was quoted, else
//     what the menu charges" for the SALE, and then re-declared `const price = Number(quotedPrice)`
//     for the VISIT, with no menu fallback. Most bookings carry no quoted price — it comes off the
//     service — so most visits were written at nothing.
import { Hono } from 'hono'
import { eq, and } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, serviceMenu, appointment, invoice, serviceRecord, clientProfile } from './db/schema.ts'
import { normaliseFormula, hasSubstance } from './src/services/clientFormulas.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'RR Salon', slug: 'rrsalon', email: 'rr@test.local', enabledFeatures: ['salon_booking'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-rr@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [cut] = await db.insert(serviceMenu).values({ name: 'Root touch-up', price: '32.55', durationMin: 45, companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ name: 'Ada Client', type: 'client', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/appointments', (await import('./src/routes/appointments.ts')).default)
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
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

// ── N8 · the sale and the visit agree about what it cost ────────────────────────────────────────
//
// Booked with NO quoted price, which is the ordinary case: the price comes off the service.
let recordId = ''
{
  const start = new Date(Date.now() - 3 * 86400000)
  const [appt] = await db.insert(appointment).values({
    companyId: co.id, contactId: client.id, serviceId: cut.id,
    startTime: start, endTime: new Date(start.getTime() + 45 * 60000),
    status: 'scheduled', title: 'Root touch-up',
  } as any).returning()

  const done = await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  check('N8: the appointment completes', done.status === 200, { status: done.status, body: done.json })

  const [rec] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.appointmentId, appt.id), eq(serviceRecord.companyId, co.id))).limit(1)
  recordId = rec?.id
  check('N8: …and writes a visit record', !!rec, rec)
  check('N8: …carrying the price the service charges, not null',
    Number(rec?.priceCharged) === 32.55, rec?.priceCharged)

  const [inv] = await db.select().from(invoice)
    .where(and(eq(invoice.appointmentId, appt.id), eq(invoice.companyId, co.id))).limit(1)
  check('N8: …and the SALE says the same number, which is the actual property',
    Math.abs(Number(inv?.subtotal ?? inv?.total) - Number(rec?.priceCharged)) < 0.005,
    { invoice: inv?.subtotal ?? inv?.total, record: rec?.priceCharged })
}

// ── N8b · a quoted price still wins over the menu ───────────────────────────────────────────────
{
  const start = new Date(Date.now() - 2 * 86400000)
  const [appt] = await db.insert(appointment).values({
    companyId: co.id, contactId: client.id, serviceId: cut.id, quotedPrice: '50',
    startTime: start, endTime: new Date(start.getTime() + 45 * 60000),
    status: 'scheduled', title: 'Root touch-up',
  } as any).returning()
  await api('PUT', `/api/appointments/${appt.id}`, { status: 'completed' })
  const [rec] = await db.select().from(serviceRecord)
    .where(and(eq(serviceRecord.appointmentId, appt.id), eq(serviceRecord.companyId, co.id))).limit(1)
  check('N8: a quoted price still beats the menu', Number(rec?.priceCharged) === 50, rec?.priceCharged)
}

// ── N7 · the two halves of "is there a formula here" agree ──────────────────────────────────────
{
  check('N7: a plain string is one step, not nothing',
    normaliseFormula('6N + 20vol').length === 1 && normaliseFormula('6N + 20vol')[0].product === '6N + 20vol',
    normaliseFormula('6N + 20vol'))
  check('N7: …and hasSubstance agrees with it', hasSubstance({ formula: '6N + 20vol' }) === true)
  check('N7: a list of strings becomes a list of steps',
    normaliseFormula(['6N', '20vol']).length === 2 && normaliseFormula(['6N', '20vol'])[1].product === '20vol',
    normaliseFormula(['6N', '20vol']))
  check('N7: structured steps are untouched',
    JSON.stringify(normaliseFormula([{ product: '6N', parts: '1' }])) === JSON.stringify([{ product: '6N', parts: '1' }]))
  check('N7: a single step sent unwrapped is wrapped', normaliseFormula({ product: '6N' }).length === 1)
  for (const junk of [7, true, null, undefined, '', '   ']) {
    check(`N7: ${JSON.stringify(junk)} is not a formula`, normaliseFormula(junk).length === 0, normaliseFormula(junk))
  }
  check('N7: …and nothing at all is not substance', hasSubstance({ formula: 7 }) === false)

  // End to end: the string reaches the card WITH its content, which is what was being lost.
  const kept = await api('POST', `/api/clients/${client.id}/formulas`, { label: 'Typed in', formula: '6N + 20vol' })
  check('N7: a string formula is kept', kept.status === 200, { status: kept.status, body: kept.json })
  check('N7: …and arrives with the mix on it, not empty',
    (kept.json?.formula?.formula || []).length === 1 && kept.json.formula.formula[0].product === '6N + 20vol',
    kept.json?.formula)

  const [profile] = await db.select({ formulas: clientProfile.formulas }).from(clientProfile)
    .where(and(eq(clientProfile.contactId, client.id), eq(clientProfile.companyId, co.id))).limit(1)
  const stored = (profile?.formulas as any[]).find((f) => f.label === 'Typed in')
  check('N7: …and that is what is STORED, not just what came back', stored?.formula?.[0]?.product === '6N + 20vol', stored)
}

// ── N6 · keeping the same visit twice re-dates, and SAYS so ─────────────────────────────────────
{
  // Put a formula on the visit record so there is something to lift.
  await db.update(serviceRecord)
    .set({ formula: [{ product: '6N', parts: '1' }], developerVolume: '20 vol', notes: 'Half a tube' } as any)
    .where(eq(serviceRecord.id, recordId))

  const first = await api('POST', `/api/clients/${client.id}/formulas`, { fromRecordId: recordId, label: 'Root touch-up' })
  check('N6: the first keep works', first.status === 200, { status: first.status, body: first.json })
  check('N6: …and reports it as added', first.json?.added === true, first.json?.added)

  const before = (first.json?.formulas || []).length

  const second = await api('POST', `/api/clients/${client.id}/formulas`, { fromRecordId: recordId, label: 'Root touch-up' })
  check('N6: keeping the same visit again works', second.status === 200, { status: second.status, body: second.json })
  check('N6: …and reports added FALSE, so the toast says "re-dated" — this is the bug',
    second.json?.added === false, second.json?.added)
  check('N6: …and the card did not grow a second copy', (second.json?.formulas || []).length === before,
    { before, after: (second.json?.formulas || []).length })
  check('N6: …and it is the same row, re-dated',
    second.json?.formula?.id === first.json?.formula?.id, { first: first.json?.formula?.id, second: second.json?.formula?.id })
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
