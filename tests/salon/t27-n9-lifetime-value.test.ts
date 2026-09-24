// Salon T27 N9 — "Lifetime value" counted prices typed on visits, not money the client paid.
//
// The profile read $20 for a client Reports showed as having paid $351.70 across ten invoices. It
// summed serviceRecord.priceCharged: a price somebody wrote on a visit card. That is a quote — often
// blank, and never revisited when the invoice was discounted, part-paid or refunded.
//
// Lifetime value is money, so it is money paid net of refunds — the definition serviceRecords.ts
// already uses. This proves the two agree on a client whose typed prices and actual payments differ in
// every way they can.
import { Hono } from 'hono'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, invoice, serviceMenu, serviceRecord } from './db/schema.ts'
import { errorHandler } from './src/utils/errors.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => { if (ok) { passed++; console.log(`  ok   ${name}`) } else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) } }

await setupSchema()
const [co] = await db.insert(company).values({ name: 'Shears', slug: 'shears-n9', email: 'n9@test.local', settings: { timezone: 'UTC' }, enabledFeatures: ['salon'] } as any).returning()
const [owner] = await db.insert(user).values({ email: 'n9@test.local', passwordHash: 'x', firstName: 'Ola', lastName: 'Owner', role: 'owner', companyId: co.id } as any).returning()
const [client] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Money Client', email: 'money@test.local' } as any).returning()

const app = new Hono()
app.route('/api/clients', (await import('./src/routes/clients.ts')).default)
app.onError(errorHandler)
const call = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id, 'x-test-company': co.id, 'x-test-role': 'owner' }, body: body === undefined ? undefined : JSON.stringify(body) })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// Invoices: what the client ACTUALLY paid. Deliberately unlike the typed prices below.
let n = 0
const mkInvoice = (total: string, paid: string, refunded: string, status: string) =>
  db.insert(invoice).values({ companyId: co.id, contactId: client.id, number: `INV-${++n}`, status, total, amountPaid: paid, amountRefunded: refunded } as any)
await mkInvoice('200', '200', '0', 'paid')        // paid in full
await mkInvoice('150', '100', '0', 'partial')     // part paid
await mkInvoice('80', '80', '30', 'paid')         // paid, then partly handed back
await mkInvoice('500', '0', '0', 'draft')         // a draft is not money
await mkInvoice('90', '90', '90', 'refunded')     // taken and returned in full
const expected = 200 + 100 + (80 - 30)            // 350.00

// Visits carrying prices that do NOT match the money: one blank, one wildly optimistic.
const [svc] = await db.insert(serviceMenu).values({ companyId: co.id, name: 'Cut', durationMin: 30, price: '20' } as any).returning()
for (const priceCharged of ['20', null, '9999']) {
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: client.id, serviceId: svc.id, priceCharged, performedAt: new Date() } as any)
}
const typedTotal = 20 + 9999

console.log('\n── lifetime value is money paid, not prices typed ──')
{
  const r = await call('GET', `/api/clients/${client.id}`)
  check('the profile loads', r.status === 200, { status: r.status, body: r.json })
  const lv = Number(r.json?.stats?.lifetimeValue)
  check(`it reads $${expected.toFixed(2)} — what was actually taken`, Math.abs(lv - expected) < 0.01, { lifetimeValue: lv, expected })
  check(`…not the sum of the typed prices ($${typedTotal})`, Math.abs(lv - typedTotal) > 0.01, { lifetimeValue: lv, typedTotal })
  check('…a DRAFT invoice is not money', lv < expected + 1, { lifetimeValue: lv })
  check('…and an invoice taken and returned in full contributes nothing', Math.abs(lv - expected) < 0.01, { lifetimeValue: lv })
  check('the visit COUNT is still the number of visits', Number(r.json?.stats?.visits) === 3, r.json?.stats?.visits)
}

console.log('\n── a client who has paid nothing reads zero ──')
{
  const [fresh] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'New Client', email: 'new@test.local' } as any).returning()
  const r = await call('GET', `/api/clients/${fresh.id}`)
  check('the profile loads', r.status === 200, { status: r.status })
  check('lifetime value is 0, not null or blank', Number(r.json?.stats?.lifetimeValue) === 0, r.json?.stats?.lifetimeValue)
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
