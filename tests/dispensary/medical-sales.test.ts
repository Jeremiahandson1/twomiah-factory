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

// ───────────────────────────────────── the adult-use path is untouched
const rec = await till('POST', '/api/orders', posSale(adultNoCard.id))
check('adult-use: accepted', rec.status === 201, rec.json)
const recRow = await saved(rec.json?.id)
check('adult-use: still recorded as recreational', recRow.isMedical === false, recRow)
check('adult-use: still pays the 15% excise — $6.00', recRow.excise === 6, recRow)
check('adult-use: total is $50.00', recRow.total === 50, recRow)

// A 30-year-old with a card may buy either way; the till's choice stands rather than being overridden.
const adultChoice = await till('POST', '/api/orders', posSale(adultWithCard.id))
check('21+: accepted', adultChoice.status === 201, adultChoice.json)
const adultRow = await saved(adultChoice.json?.id)
check('21+: a card holder over 21 is NOT forced to medical — their choice stands', adultRow.isMedical === false, adultRow)
check('21+: so they pay adult-use excise', adultRow.excise === 6, adultRow)

// ...and when they do choose medical, it is honoured and exempt.
const adultMed = await till('POST', '/api/orders', { ...posSale(adultWithCard.id), isMedical: true, medicalCardNumber: 'OH-MED-0002' })
check('21+: a declared medical sale is accepted', adultMed.status === 201, adultMed.json)
const adultMedRow = await saved(adultMed.json?.id)
check('21+: declared medical is recorded as medical', adultMedRow.isMedical === true, adultMedRow)
check('21+: and is excise-exempt', adultMedRow.excise === 0, adultMedRow)

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
