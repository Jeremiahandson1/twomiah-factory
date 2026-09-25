// Field Service T28 L7 — a document has to multiply.
//
// A 3-decimal unit price was stored as 12.35 (the column holds two) while the line total was worked out
// from the raw 12.345, so the quote read "3.00 × $12.35 = $37.04". Both numbers were defensible on their
// own; together they were arithmetic nobody could check. The customer sees this one on the portal.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'T28 Money', slug: 't28money', email: 't28money@test.local', settings: { taxRate: 0 }, enabledFeatures: ['quotes', 'invoices', 'contacts'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'owner-t28money@test.local', passwordHash: 'x', firstName: 'Ada', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [cust] = await db.insert(contact).values({ type: 'client', name: 'T28 Money Customer', email: 'money-t28@test.local', companyId: co.id } as any).returning()

const app = new Hono()
app.route('/api/quotes', (await import('./src/routes/quotes.ts')).default)
app.route('/api/invoices', (await import('./src/routes/invoices.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const num = (v: unknown) => Number(v ?? NaN)

console.log('\n── 3 × 12.345, the exact case from the report ──')
{
  const r = await call('POST', '/api/quotes', { contactId: cust.id, name: 'T28 3dp', taxRate: 0, lineItems: [{ description: 'Widget', quantity: 3, unitPrice: 12.345 }] })
  check('the quote is created', r.status === 200 || r.status === 201, r)
  const q = r.json?.data ?? r.json
  const line = (q?.lineItems || [])[0]
  const price = num(line?.unitPrice), total = num(line?.total)
  check('the stored price is to the cent', price === 12.35, { unitPrice: line?.unitPrice })
  check('…and the line total is that price times the quantity', total === 37.05, { total: line?.total, want: 37.05 })
  check('…so the document multiplies: price × qty === total', Math.abs(price * 3 - total) < 0.005, { price, total })
  check('the quote subtotal agrees with its own line', num(q?.subtotal) === total, { subtotal: q?.subtotal, total })
}

console.log('\n── and the same on an invoice ──')
{
  const r = await call('POST', '/api/invoices', { contactId: cust.id, taxRate: 0, lineItems: [{ description: 'Widget', quantity: 3, unitPrice: 12.345 }] })
  const inv = r.json?.data ?? r.json
  const line = (inv?.lineItems || [])[0]
  const price = num(line?.unitPrice), total = num(line?.total)
  check('price × qty === total on the invoice too', Math.abs(price * 3 - total) < 0.005, { price, total })
}

console.log('\n── ordinary prices are untouched ──')
{
  const r = await call('POST', '/api/quotes', { contactId: cust.id, name: 'T28 plain', taxRate: 0, lineItems: [{ description: 'Callout', quantity: 2, unitPrice: 99.99 }] })
  const q = r.json?.data ?? r.json
  const line = (q?.lineItems || [])[0]
  check('99.99 × 2 is still 199.98', num(line?.unitPrice) === 99.99 && num(line?.total) === 199.98, { unitPrice: line?.unitPrice, total: line?.total })
}

console.log(`\nfs-t28-money: ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
