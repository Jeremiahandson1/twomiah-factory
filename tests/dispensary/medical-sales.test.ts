// crm-dispensary — an under-21 medical patient's sale is recorded as medical, and taxed as one.
//
// T42 B1 (blocker, compliance): the register's payload has no isMedical field. The server let an
// 18-to-20-year-old with a valid card buy — correctly, they are a patient — but then saved the order
// as adult-use: isMedical false, adult-use excise charged, counted under recreational_orders in the
// compliance report. The age gate had already read the card to allow the sale; it simply never told
// the caller what it had worked out.
//
// T42 H1 (high): a sale flagged medical was charged the 15% excise anyway. Ohio, this tenant's
// state, exempts registered patients.
//
// Four QA rounds (T23, T24, T27, T28) recorded this exact scenario as a PASS, because they asserted
// on the 201 and never read the saved order back. So these tests assert on the stored row.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Medical Dispensary', slug: 'medsale', email: 'medsale@test.local',
  state: 'OH', taxRate: '10', exciseTaxRate: '15',
  settings: {}, enabledFeatures: [],
} as any).returning()

const budtender = (await db.insert(user).values({
  email: 'bud-medsale@test.local', passwordHash: 'x', firstName: 'Bud', lastName: 'U', role: 'user', companyId: co.id,
} as any).returning())[0]

// An eighth of flower: cannabis, weighable, $40 so the sums are easy to read.
const [flower] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-1', category: 'flower', price: '40', weightGrams: '3.5',
  stockQuantity: 500, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()

const yearsAgo = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() - n); return d.toISOString().slice(0, 10) }
const inYears = (n: number) => { const d = new Date(); d.setFullYear(d.getFullYear() + n); return d.toISOString().slice(0, 10) }

const mkContact = (name: string, extra: Record<string, unknown>) =>
  db.insert(contact).values({ type: 'customer', name, companyId: co.id, ...extra } as any).returning().then(r => r[0])

// 19 with a valid card: a patient, and can only lawfully buy medically.
const patient19 = await mkContact('T42 Med19', { dateOfBirth: yearsAgo(19), medicalCardNumber: 'OH-MED-0001', medicalCardExpiry: inYears(1) })
// 30 with a card: may buy either way, so their choice must stand.
const adultWithCard = await mkContact('Adult Patient', { dateOfBirth: yearsAgo(30), medicalCardNumber: 'OH-MED-0002', medicalCardExpiry: inYears(1) })
// 30, no card: ordinary adult-use.
const adultNoCard = await mkContact('Adult Recreational', { dateOfBirth: yearsAgo(30) })
// 19, card expired yesterday: no card at all.
const expiredCard = await mkContact('Expired Card', { dateOfBirth: yearsAgo(19), medicalCardNumber: 'OH-MED-0003', medicalCardExpiry: '2020-01-01' })

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const till = as(budtender)

/** Exactly the payload the real register sends — note there is no isMedical field. */
const posSale = (contactId: string) => ({
  contactId,
  items: [{ productId: flower.id, quantity: 1 }],
  type: 'walk_in',
  paymentMethod: 'cash',
  idVerified: true,
})

/** The stored row, because a 201 proves nothing about what was written. */
const saved = async (orderId: string) => {
  const r: any = await db.execute(sql`
    SELECT is_medical, medical_card_number, excise_tax, sales_tax, total_tax, total, subtotal
    FROM orders WHERE id = ${orderId} LIMIT 1
  `)
  const row = (r.rows || r)?.[0]
  return {
    isMedical: row?.is_medical === true || row?.is_medical === 't',
    card: row?.medical_card_number ?? null,
    excise: Number(row?.excise_tax ?? -1),
    sales: Number(row?.sales_tax ?? -1),
    total: Number(row?.total ?? -1),
    subtotal: Number(row?.subtotal ?? -1),
  }
}

// ───────────────────────────────────── B1: the register's own payload
const med = await till('POST', '/api/orders', posSale(patient19.id))
check('B1: the POS payload is accepted for a 19-year-old patient', med.status === 201, med.json)
const medRow = await saved(med.json?.id)
check('B1: the saved order is MEDICAL, though the till never said so', medRow.isMedical === true, medRow)
check('B1: the card that authorised it is stored on the order', medRow.card === 'OH-MED-0001', medRow)

// ───────────────────────────────────── H1: and a medical sale is excise-exempt
check('H1: no adult-use excise on a medical sale', medRow.excise === 0, medRow)
check('H1: sales tax still applies — $40 at 10%', medRow.sales === 4, medRow)
check('H1: total is $44.00, not the $50.00 T42 measured', medRow.total === 44, medRow)

// ─────────────── T43 N1: asking for medical without a card must achieve nothing
// The first fix honoured the caller's flag for anyone 21+, on the reasoning that an adult may
// lawfully buy either way. True — but it never required them to HOLD a card, so any staff token
// could POST isMedical:true and waive the excise. Every one of these was accepted in run T43.
const claims = [
  ['no card at all', adultNoCard.id, 'OH-FAKE-1'],
  ['an expired card', expiredCard.id, 'OH-MED-0003'],
] as const
for (const [label, contactId, claimedCard] of claims) {
  const r = await till('POST', '/api/orders', { ...posSale(contactId), isMedical: true, medicalCardNumber: claimedCard })
  if (r.status === 201) {
    const row = await saved(r.json?.id)
    check(`N1: claiming medical with ${label} is ignored`, row.isMedical === false, row)
    check(`N1: ...so the excise is still charged (${label})`, row.excise === 6, row)
    check(`N1: ...and no card is recorded (${label})`, row.card === null, row)
  } else {
    // A refusal is an equally good outcome for the expired-card case, which is underage.
    check(`N1: claiming medical with ${label} is refused outright`, r.status === 403, r)
  }
}

const anon = await till('POST', '/api/orders', {
  items: [{ productId: flower.id, quantity: 1 }], type: 'walk_in', paymentMethod: 'cash', idVerified: true, isMedical: true,
})
check('N1: an anonymous walk-in cannot claim medical', anon.status === 201, anon.json)
if (anon.status === 201) {
  const row = await saved(anon.json?.id)
  check('N1: ...it is saved adult-use with excise charged', row.isMedical === false && row.excise === 6, row)
}

const merchOnly = await db.insert(product).values({
  name: 'Branded Tee', sku: 'TEE-1', category: 'accessory', price: '25',
  stockQuantity: 50, trackInventory: true, taxCategory: 'non_cannabis', companyId: co.id,
} as any).returning()
const merchSale = await till('POST', '/api/orders', {
  contactId: patient19.id, items: [{ productId: merchOnly[0].id, quantity: 1 }],
  type: 'walk_in', paymentMethod: 'cash', idVerified: true, isMedical: true,
})
check('N1: a basket with no cannabis is never a medical sale', merchSale.status === 201, merchSale.json)
if (merchSale.status === 201) {
  check('N1: ...so it cannot inflate medical_orders in the compliance report',
    (await saved(merchSale.json?.id)).isMedical === false, await saved(merchSale.json?.id))
}

// ─────────────── T43 H1: the register sends no field, and a 21+ patient must still get the exemption
const registerPatient = await till('POST', '/api/orders', posSale(adultWithCard.id))
check('H1: the register\'s payload is accepted for a 30-year-old patient', registerPatient.status === 201, registerPatient.json)
const regRow = await saved(registerPatient.json?.id)
check('H1: a 21+ card holder is medical by default — the till does not have to ask', regRow.isMedical === true, regRow)
check('H1: ...so they stop paying adult-use excise', regRow.excise === 0, regRow)
check('H1: ...total is $44.00, not the $50.00 T43 measured', regRow.total === 44, regRow)

const optedOut = await till('POST', '/api/orders', { ...posSale(adultWithCard.id), isMedical: false })
check('H1: a patient can still deliberately buy adult-use', optedOut.status === 201, optedOut.json)
const optRow = await saved(optedOut.json?.id)
check('H1: ...keeping their medical allotment for another day', optRow.isMedical === false && optRow.excise === 6, optRow)

const minorOptOut = await till('POST', '/api/orders', { ...posSale(patient19.id), isMedical: false })
check('H1: an 18-to-20-year-old cannot opt out — adult-use is not lawful for them', minorOptOut.status === 201, minorOptOut.json)
check('H1: ...their sale stays medical', (await saved(minorOptOut.json?.id)).isMedical === true, await saved(minorOptOut.json?.id))

// ───────────────────────────────────── the adult-use path is untouched
const rec = await till('POST', '/api/orders', posSale(adultNoCard.id))
check('adult-use: accepted', rec.status === 201, rec.json)
const recRow = await saved(rec.json?.id)
check('adult-use: still recorded as recreational', recRow.isMedical === false, recRow)
check('adult-use: still pays the 15% excise — $6.00', recRow.excise === 6, recRow)
check('adult-use: total is $50.00', recRow.total === 50, recRow)

// A 30-year-old WITH a card is medical by default — see the H1 block above. The original version of
// this file asserted the opposite ("their choice stands"), which is the design T43 N1 broke open:
// honouring the caller's flag without requiring a card is what let anyone waive the excise. The
// choice still exists, but it is now an opt-OUT, and it is exercised above.
const adultMed = await till('POST', '/api/orders', { ...posSale(adultWithCard.id), isMedical: true })
check('21+: a declared medical sale is accepted', adultMed.status === 201, adultMed.json)
const adultMedRow = await saved(adultMed.json?.id)
check('21+: declared medical is recorded as medical', adultMedRow.isMedical === true, adultMedRow)
check('21+: and is excise-exempt', adultMedRow.excise === 0, adultMedRow)
check('21+: the card on the CONTACT is what gets stored, not one sent with the order',
  adultMedRow.card === 'OH-MED-0002', adultMedRow)

// ───────────────────────────────────── the refusals that must keep working
const expired = await till('POST', '/api/orders', posSale(expiredCard.id))
check('refusal: 19 with an EXPIRED card is still refused', expired.status === 403, expired)
check('refusal: ...for being underage', expired.json?.code === 'underage', expired.json)

const minor = await mkContact('T42 Minor', { dateOfBirth: yearsAgo(17), medicalCardNumber: 'OH-MED-0004', medicalCardExpiry: inYears(1) })
const minorSale = await till('POST', '/api/orders', posSale(minor.id))
check('refusal: 17 with a valid card is still refused', minorSale.status === 403, minorSale)

const noId = await till('POST', '/api/orders', { ...posSale(patient19.id), idVerified: false })
check('refusal: create does not require the ID tick (it is checked at completion)', noId.status === 201, noId.json)

// ───────────────────────────────────── a tenant in a state that DOES tax patients
await db.execute(sql`UPDATE company SET settings = ${JSON.stringify({ tax: { medicalExciseExempt: false } })}::json WHERE id = ${co.id}`)
const taxedMed = await till('POST', '/api/orders', posSale(patient19.id))
check('config: accepted with the exemption switched off', taxedMed.status === 201, taxedMed.json)
const taxedMedRow = await saved(taxedMed.json?.id)
check('config: still recorded as medical', taxedMedRow.isMedical === true, taxedMedRow)
check('config: but excise IS charged where the state taxes patients', taxedMedRow.excise === 6, taxedMedRow)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
