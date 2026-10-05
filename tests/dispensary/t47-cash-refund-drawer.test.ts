// crm-dispensary — a cash refund left the till with no drawer to count it against. (T42 medium)
//
//   "A cash refund goes through with no drawer open, so the money isn't tied to any drawer session."
//
// The SALE path has required an open drawer since T29 M9 and has been NARROWED TWICE since, and both
// narrowings are the interesting part — they are why this file tests three shops and not one:
//
//   · a shop that has never opened a drawer is not running its cash that way, and refusing its cash
//     to teach it a workflow it never asked for would be the worse bug (T29 M9);
//   · a shop that has switched Cash Management OFF has withdrawn consent, and must not be locked out
//     of cash by a drawer it just said it does not use (T32 M1).
//
// So "refuse when no drawer is open" is only correct for a shop that still runs drawers. A test that
// checked the refusal alone would pass while the till was broken for the other two.
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

const app = new Hono()
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)

/** One shop, set up to a named cash posture. */
const makeShop = async (tag: string, features: string[]) => {
  const [co] = await db.insert(company).values({
    name: `Leaf ${tag}`, slug: `leaf-${tag}`, email: `${tag}@test.local`, state: 'OH',
    taxRate: '8.0', exciseTaxRate: '10.0',
    enabledFeatures: ['products', 'orders', 'dashboard', ...features],
  } as any).returning()
  const [owner] = await db.insert(user).values({
    email: `owner-${tag}@test.local`, passwordHash: 'x', firstName: 'O', lastName: 'U',
    role: 'owner', companyId: co.id,
  } as any).returning()
  const [prod] = await db.insert(product).values({
    name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 500,
    weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
  } as any).returning()
  const [cust] = await db.insert(contact).values({
    type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
  } as any).returning()

  const api = async (method: string, path: string, body?: unknown) => {
    const res = await app.request(path, {
      method, headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
    return { status: res.status, json: j, text: t }
  }
  const openDrawer = async () => {
    const id = `cs-${tag}-${Math.random().toString(36).slice(2, 8)}`
    await db.execute(sql`
      INSERT INTO cash_sessions (id, company_id, user_id, opened_at, status)
      VALUES (${id}, ${co.id}, ${owner.id}, now(), 'open')
    `)
    return id
  }
  const closeAllDrawers = async () => {
    await db.execute(sql`UPDATE cash_sessions SET status = 'closed', closed_at = now() WHERE company_id = ${co.id}`)
  }
  /**
   * A sale is TWO steps here: POST /api/orders raises it, POST /:id/complete settles it with the
   * payment method. The drawer rule lives on the settlement, which is the correct place for it — and
   * paying at creation time is why the first version of this file saw every refund refused for
   * "can only refund completed orders" rather than for the drawer.
   */
  const sell = async (method: string, opts: { withDrawer?: boolean } = {}) => {
    const cs = opts.withDrawer === false ? null : await openDrawer()
    const made = await api('POST', '/api/orders', { contactId: cust.id, items: [{ productId: prod.id, quantity: 1 }] })
    const id = made.json?.id ?? made.json?.order?.id
    const done = await api('POST', `/api/orders/${id}/complete`, {
      paymentMethod: method, ...(method === 'cash' ? { cashTendered: 500 } : {}), idVerified: true,
    })
    return { id, made, done, cashSessionId: cs }
  }
  return { co, owner, prod, cust, api, openDrawer, closeAllDrawers, sell }
}

// ══════════ a shop that runs drawers ════════════════════════════════════════════════════════════
console.log('\n══════════ a shop that runs drawers ══════════')
{
  const shop = await makeShop('runs', ['cash_management'])
  const sale = await shop.sell('cash')
  check('a cash sale completes with a drawer open', sale.done.status === 200 || sale.done.status === 201,
    { status: sale.done.status, body: sale.done.text?.slice(0, 200) })
  const orderId = sale.id

  // close the till, then try to give the money back
  await shop.closeAllDrawers()
  const refused = await shop.api('POST', `/api/orders/${orderId}/refund`, { reason: 'customer changed their mind' })
  check('T42: a CASH refund with no drawer open is refused',
    refused.status === 409 && refused.json?.code === 'no_open_cash_drawer',
    { status: refused.status, body: refused.json })
  check('…and the message says what to do about it',
    /open a drawer/i.test(String(refused.json?.error)), refused.json?.error)

  const rows = ((await db.execute(sql`SELECT refunded_amount FROM orders WHERE id = ${orderId}`)) as any).rows
  check('…and nothing was refunded', Number(rows?.[0]?.refunded_amount || 0) === 0, rows?.[0])

  // open one and it goes through, tied to THAT drawer
  const cs = await shop.openDrawer()
  const ok = await shop.api('POST', `/api/orders/${orderId}/refund`, { reason: 'customer changed their mind' })
  check('…with a drawer open it goes through', ok.status === 200 || ok.status === 201,
    { status: ok.status, body: ok.text?.slice(0, 200) })
  const after = ((await db.execute(sql`SELECT refunded_amount, refund_cash_session_id FROM orders WHERE id = ${orderId}`)) as any).rows?.[0]
  check('T42: …and the refund records WHICH drawer the money left — the half the finding was about',
    String(after?.refund_cash_session_id) === cs, { recorded: after?.refund_cash_session_id, expected: cs })
  check('…and the money actually came back', Number(after?.refunded_amount || 0) > 0, after)
}

// ══════════ a shop that has never opened a drawer ═══════════════════════════════════════════════
console.log('\n══════════ a shop that has never opened a drawer (T29 M9) ══════════')
{
  const shop = await makeShop('never', ['cash_management'])
  // a cash sale with NO drawer ever — allowed, because this shop does not run its cash that way
  const sale = await shop.sell('cash', { withDrawer: false })
  check('its cash sale is allowed without a drawer', sale.done.status === 200 || sale.done.status === 201,
    { status: sale.done.status, body: sale.done.text?.slice(0, 180) })
  const orderId = sale.id
  const refund = await shop.api('POST', `/api/orders/${orderId}/refund`, { reason: 'wrong strain' })
  check('…and so is its cash REFUND — the till must not teach a workflow nobody asked for',
    refund.status === 200 || refund.status === 201, { status: refund.status, body: refund.text?.slice(0, 180) })
}

// ══════════ a shop that used drawers and switched Cash Management off ═══════════════════════════
console.log('\n══════════ a shop that switched Cash Management OFF (T32 M1) ══════════')
{
  const shop = await makeShop('offnow', ['cash_management'])
  const sale = await shop.sell('cash')
  const orderId = sale.id
  await shop.closeAllDrawers()
  // Withdraw consent: the module goes off. The feature gate CACHES per company, so the cache has to
  // be dropped as well — updating the row alone left the first version of this test seeing the
  // module still on and reading the 409 as a failure of the rule rather than of the test.
  await db.execute(sql`UPDATE company SET enabled_features = ${JSON.stringify(['products', 'orders', 'dashboard'])}::json WHERE id = ${shop.co.id}`)
  const { forgetFeatures } = await import('./src/middleware/enabledFeature.ts')
  forgetFeatures(shop.co.id)
  const refund = await shop.api('POST', `/api/orders/${orderId}/refund`, { reason: 'switched the module off' })
  check('with Cash Management off, a cash refund is NOT held hostage by a drawer it no longer uses',
    refund.status === 200 || refund.status === 201, { status: refund.status, body: refund.text?.slice(0, 200) })
}

// ══════════ and a card refund never wanted a drawer in the first place ══════════════════════════
console.log('\n══════════ a card refund ══════════')
{
  const shop = await makeShop('card', ['cash_management'])
  const sale = await shop.sell('debit') // opens a drawer, so the shop counts as running them
  const orderId = sale.id
  await shop.closeAllDrawers()
  const refund = await shop.api('POST', `/api/orders/${orderId}/refund`, { reason: 'card refund with the till shut' })
  check('a DEBIT refund goes through with the till shut — it goes back the way it came',
    refund.status === 200 || refund.status === 201, { status: refund.status, body: refund.text?.slice(0, 200) })
  const after = ((await db.execute(sql`SELECT refund_cash_session_id FROM orders WHERE id = ${orderId}`)) as any).rows?.[0]
  check('…and no drawer is recorded against it', !after?.refund_cash_session_id, after)
}

console.log(`\n${passed} passed, ${failed} failed`)
if (failed > 0) process.exit(1)
