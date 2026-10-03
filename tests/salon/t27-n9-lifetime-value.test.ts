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

// ══════════════════════════════════════════════════════════════════════════════════════════════════
// T41 — …AND IT IS NOT THE STYLIST'S TO SEE.
//
//   "Stylist sees client Lifetime Value $43.40 while invoice endpoints are 403."
//
// T27 N9 above made this figure correct. T41 asks who gets it. src/middleware/permissions.ts already
// answered in writing when it listed what a stylist is granted and then said "Not here,
// deliberately: ... invoices:* / reports:* (the salon's money)" — and this figure is exactly the
// invoice total that seat is refused, summed.
//
// Both surfaces that emit it are checked, because the report only named one. The other is
// /reminders/lapsed, which sorts a win-back list by it behind contacts:read, which every stylist has.
//
// Roles here are the real ones from the tenant: salon stores the stylist rung as `user`, which
// normalises to `field`. Front Desk is `viewer`, and it is in this test on purpose — it is the lowest
// rung that holds invoices:read, so its 200 proves the gate is a permission and not a rank.
console.log('\n── who may see what a client is worth ──')
{
  const seat = async (role: string, tag: string) => (await db.insert(user).values({
    email: `${tag}@n9.local`, passwordHash: 'x', firstName: tag, lastName: 'S', role, companyId: co.id, isActive: true,
  } as any).returning())[0]
  const stylist = await seat('user', 'stylist')
  const frontDesk = await seat('viewer', 'frontdesk')
  const manager = await seat('manager', 'manager')

  const asUser = (who: any) => async (path: string) => {
    const res = await app.request(path, { method: 'GET', headers: { 'content-type': 'application/json', 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }

  const styl = await asUser(stylist)(`/api/clients/${client.id}`)
  check('the stylist still opens the client chart — the chart is their work', styl.status === 200,
    { status: styl.status, body: styl.text?.slice(0, 160) })
  check('…with no lifetimeValue on it at all', !('lifetimeValue' in (styl.json?.stats || {})),
    styl.json?.stats)
  // Absent, not zero: money(0) renders "$0.00", which tells a stylist their best client has never
  // spent anything. The absent key is what lets the tile disappear instead of lying.
  check('…absent rather than zeroed, and $350 appears nowhere in the payload',
    !/"lifetimeValue"/.test(styl.text || '') && !/350/.test(String(styl.json?.stats ?? '')), styl.json?.stats)
  check('…while the visits, the last visit and the rebook date all survive',
    Number(styl.json?.stats?.visits) === 3 && styl.json?.stats?.lastVisit !== undefined
    && 'dueBackAt' in (styl.json?.stats || {}), styl.json?.stats)
  // The client's own credit is a different fact: a stylist holds loyalty:redeem precisely because
  // they check their own client out, and a credit nobody can see is a credit nobody spends.
  check('…and the client\'s ACCOUNT BALANCE stays, because they ring the client up',
    'accountBalance' in (styl.json?.stats || {}) && 'accountBalanceLabel' in (styl.json?.stats || {}),
    styl.json?.stats)

  const desk = await asUser(frontDesk)(`/api/clients/${client.id}`)
  check('Front Desk (viewer) DOES see it — a permission, not a rank',
    desk.status === 200 && Math.abs(Number(desk.json?.stats?.lifetimeValue) - expected) < 0.01,
    { status: desk.status, lv: desk.json?.stats?.lifetimeValue })
  const mgr = await asUser(manager)(`/api/clients/${client.id}`)
  check('…and so does the manager', Math.abs(Number(mgr.json?.stats?.lifetimeValue) - expected) < 0.01,
    mgr.json?.stats?.lifetimeValue)

  // ── the sibling the report did not name ──
  const reminders = new Hono()
  reminders.route('/api/reminders', (await import('./src/routes/reminders.ts')).default)
  reminders.onError(errorHandler)
  const lapsedAs = (who: any) => async () => {
    const res = await reminders.request('/api/reminders/lapsed?months=6', { method: 'GET', headers: { 'x-test-user': who.id } })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }
  // Two lapsed clients with different spends, so the ORDER is observable and not an accident of
  // insertion: the list must still come back best-first for a stylist who cannot see the figures.
  const old = (days: number) => new Date(Date.now() - days * 86400000)
  const [big] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Lapsed Big', email: 'big@test.local' } as any).returning()
  const [small] = await db.insert(contact).values({ companyId: co.id, type: 'client', name: 'Lapsed Small', email: 'small@test.local' } as any).returning()
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: small.id, serviceId: svc.id, priceCharged: '40', performedAt: old(400) } as any)
  await db.insert(serviceRecord).values({ companyId: co.id, contactId: big.id, serviceId: svc.id, priceCharged: '900', performedAt: old(400) } as any)

  const ownerLapsed = await lapsedAs(owner)()
  const oRows = (ownerLapsed.json?.data || []) as any[]
  check('the owner\'s win-back list carries the figure', ownerLapsed.status === 200 && Number(oRows[0]?.lifetimeValue) === 900,
    { status: ownerLapsed.status, rows: oRows.map((r) => [r.clientName, r.lifetimeValue]) })

  const stylLapsed = await lapsedAs(stylist)()
  const sRows = (stylLapsed.json?.data || []) as any[]
  check('the stylist gets the same list', stylLapsed.status === 200 && sRows.length === oRows.length,
    { status: stylLapsed.status, n: sRows.length })
  check('…with no lifetimeValue on any row', sRows.every((r) => !('lifetimeValue' in r)),
    sRows.map((r) => (('lifetimeValue' in r) ? r.lifetimeValue : '«absent»')))
  check('…and no figure hiding anywhere in the payload', !/900|"lifetimeValue"/.test(stylLapsed.text || ''),
    (stylLapsed.text || '').slice(0, 240))
  // This is the half a "just delete the field" fix loses. The list is a call queue; biggest spender
  // first is what makes it one.
  check('…still ordered biggest spender first, so the work queue survives the redaction',
    sRows[0]?.clientName === 'Lapsed Big' && sRows[1]?.clientName === 'Lapsed Small',
    sRows.map((r) => r.clientName))
  check('…and the rest of each row — who, when, how many visits — is intact',
    sRows.every((r) => r.clientName && r.lastVisit && typeof r.visits === 'number'), sRows[0])
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
