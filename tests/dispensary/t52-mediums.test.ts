// crm-dispensary — T51/T52 N3 and N4.
//
// N3  A public order-ahead attached itself to an existing customer on the PHONE NUMBER ALONE. An
//     order placed as "T52 Stranger", DOB 1985-05-05, was linked to a customer named "T45 Jeremiah
//     SMS" with DOB 1978-07-01, and the order page then showed that customer's email. Anyone who
//     knows a phone number could order against someone else's record and read their details back.
//
//     A phone number FINDS a record; it does not prove you are the person on it. The match now has
//     to agree on the date of birth — which a cannabis order always carries — or, where the record
//     has none, on the name. A mismatch does not refuse the order: a customer who mistypes a digit
//     would be turned away at checkout and the shop would lose the sale over a typo. It simply does
//     not LINK. A duplicate contact is a tidy-up; attaching a stranger to someone's history is not.
//
// N4  The tax summary's three lines did not add up to its own total: Excise + Sales + Local came to
//     $1,789.92 against $1,784.24. Each figure carries its own GREATEST(0, charged − refunded)
//     clamp, which is right per column and breaks additivity — when a refund returns more of one
//     tax than that tax was charged, the component floors at zero while the order's total tax keeps
//     the whole deduction. `Math.max(0, …)` on the Local line then absorbed the difference in
//     silence. It is now reported, the way the filing already reports its own effective rate.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, product, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 320)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Twomiah Leaf', slug: 'leaf-m52', email: 'm52@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '15.0',
  enabledFeatures: ['products', 'orders', 'contacts', 'order_ahead', 'tax_filing', 'compliance'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-m52@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()
const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '50', stockQuantity: 200,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true, active: true, visible: true, inStock: true,
} as any).returning()

const app = new Hono()
app.route('/api/public/menu', (await import('./src/routes/menu.ts')).default)
app.route('/api/tax-filing', (await import('./src/routes/tax-filing.ts')).default)
app.onError((await import('./src/utils/errors.ts')).errorHandler)
const pub = async (path: string, body: unknown) => {
  const res = await app.request(path, {
    method: 'POST', headers: { 'content-type': 'application/json', host: `${co.slug}.example.com` },
    body: JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = async (path: string) => {
  const res = await app.request(path, { headers: { 'x-test-user': owner.id } })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const rows = async (q: any) => { const r: any = await db.execute(q); return (r.rows || r) as any[] }
/**
 * Which contact an order was attached to, read from the ORDER ROW.
 *
 * The public response deliberately does not return a contactId — it is an unauthenticated endpoint
 * and internal ids are not the customer's business, which is right. So the link has to be read from
 * the database, and that is the better assertion anyway: it checks what was stored rather than what
 * was said.
 */
const contactOf = async (orderNumber: string) => {
  const [o] = await rows(sql`SELECT contact_id FROM orders WHERE company_id = ${co.id} AND number = ${orderNumber} LIMIT 1`)
  return o?.contact_id ?? null
}

// ══════════ N3 · a phone number is not proof of identity ════════════════════════════════════════
const PHONE = '715-864-5052'
const [regular] = await db.insert(contact).values({
  type: 'customer', name: 'Jeremiah Regular', companyId: co.id,
  dateOfBirth: '1978-07-01', phone: PHONE, email: 'jeremiah@test.local',
} as any).returning()

const order = (name: string, dob: string) => pub('/api/public/menu/order', {
  customerName: name, customerPhone: PHONE, dateOfBirth: dob, orderType: 'pickup',
  items: [{ productId: kush.id, quantity: 1 }],
})

{
  // The exact case from the report: a different person, same number.
  const stranger = await order('T52 Stranger', '1985-05-05')
  check('a stranger using that phone number can still place an order', stranger.status === 200 || stranger.status === 201,
    { status: stranger.status, body: stranger.json })
  const strangerContact = await contactOf(stranger.json?.orderNumber)
  check('…but it is NOT attached to the existing customer', strangerContact !== regular.id,
    { linkedTo: strangerContact, existing: regular.id })

  const made = await rows(sql`SELECT id, name, date_of_birth, notes FROM contact WHERE company_id = ${co.id} AND phone = ${PHONE} ORDER BY created_at`)
  check('…a separate record is kept instead', made.length === 2, made.map((m) => m.name))
  const fresh = made.find((m) => m.id !== regular.id)
  check('…under the name that was actually given', String(fresh?.name) === 'T52 Stranger', fresh?.name)
  check('…and it says why, so the counter can sort it out', /did not match/i.test(String(fresh?.notes || '')), fresh?.notes)

  // The real customer, coming back, still gets their own record.
  const returning = await order('Jeremiah Regular', '1978-07-01')
  const returningContact = await contactOf(returning.json?.orderNumber)
  check('the real customer is still recognised by their own date of birth', returningContact === regular.id,
    { linkedTo: returningContact, expected: regular.id })
  const after = await rows(sql`SELECT COUNT(*)::int AS n FROM contact WHERE company_id = ${co.id} AND phone = ${PHONE}`)
  check('…and no third record is created for them', Number(after[0]?.n) === 2, after[0]?.n)

  // A name mismatch on a record that has no date of birth to check against.
  const [noDob] = await db.insert(contact).values({
    type: 'customer', name: 'Pat NoDob', companyId: co.id, phone: '555-9000',
  } as any).returning()
  const asPat = await pub('/api/public/menu/order', {
    customerName: 'Pat NoDob', customerPhone: '555-9000', dateOfBirth: '1990-02-02', orderType: 'pickup',
    items: [{ productId: kush.id, quantity: 1 }],
  })
  const patId = await contactOf(asPat.json?.orderNumber)
  check('a record with no date of birth is matched on the name instead', patId === noDob.id, { linkedTo: patId, expected: noDob.id })
  const [patAfter] = await rows(sql`SELECT date_of_birth FROM contact WHERE id = ${noDob.id}`)
  check('…and the date of birth they gave is recorded on it', !!patAfter?.date_of_birth, patAfter)

  const notPat = await pub('/api/public/menu/order', {
    customerName: 'Someone Else', customerPhone: '555-9000', dateOfBirth: '1991-03-03', orderType: 'pickup',
    items: [{ productId: kush.id, quantity: 1 }],
  })
  const notPatId = await contactOf(notPat.json?.orderNumber)
  check('…and a different name on that number is kept separate too', notPatId !== noDob.id, { linkedTo: notPatId })
}

// ══════════ N4 · the breakdown adds up, or says it does not ═════════════════════════════════════
{
  const s = await asOwner('/api/tax-filing/summary')
  check('the tax summary answers', s.status === 200, { status: s.status, body: s.json })
  const b = (s.json?.breakdown || []) as any[]
  check('…with the three lines', b.length === 3, b.map((r) => r.type))

  const sum = b.reduce((a, r) => a + Number(r.collected || 0), 0)
  check('…whose collected figures add to the reported breakdown total',
    Math.abs(sum - Number(s.json?.breakdownTotal || 0)) < 0.005, { sum, breakdownTotal: s.json?.breakdownTotal })
  check('…and the summary says whether that matches the total collected',
    typeof s.json?.reconciles === 'boolean', s.json?.reconciles)
  check('…on a clean set of books it reconciles', s.json?.reconciles === true,
    { reconciles: s.json?.reconciles, variance: s.json?.breakdownVariance, note: s.json?.breakdownNote })
  check('…and says nothing alarming when it does', s.json?.breakdownNote === null, s.json?.breakdownNote)

  // Now make the books disagree the way a real refund does: return more sales tax than was charged,
  // so that component floors at zero while the order's total tax keeps the whole deduction.
  const [ord] = await rows(sql`
    SELECT id FROM orders WHERE company_id = ${co.id} AND status IN ('completed', 'partially_refunded') LIMIT 1
  `)
  if (ord) {
    await db.execute(sql`
      UPDATE orders SET status = 'partially_refunded',
        refunded_sales_tax = (COALESCE(NULLIF(sales_tax, ''), '0')::numeric + 5.68)::text,
        refunded_tax = '0'
      WHERE id = ${ord.id}
    `)
    const s2 = await asOwner('/api/tax-filing/summary')
    check('a set of books that does not add up is REPORTED, not absorbed into the Local line',
      s2.json?.reconciles === false, { reconciles: s2.json?.reconciles, variance: s2.json?.breakdownVariance })
    check('…with the size of the difference', Math.abs(Number(s2.json?.breakdownVariance || 0)) > 0.005, s2.json?.breakdownVariance)
    check('…and a sentence saying where it comes from', /difference of \$/.test(String(s2.json?.breakdownNote || '')), s2.json?.breakdownNote)
    check('…while the Local line is still never negative',
      Number((s2.json?.breakdown || []).find((r: any) => /local/i.test(r.type))?.collected ?? 0) >= 0, s2.json?.breakdown)
  } else {
    console.log('  --   no settled order to skew; the disagreement branch was not exercised')
  }
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
