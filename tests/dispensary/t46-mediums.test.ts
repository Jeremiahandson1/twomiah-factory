// crm-dispensary — T46 N4 and N23: screens reading fields the API never sends.
//
// N4 (high, second half)  /portal opened the staff hub with "Revenue Today $0" and "0 orders" on a
//                         day the dashboard beside it read $225.75 and 12. It read `revenueToday`
//                         and then `revenue.today`; the endpoint returns `today.revenue`. Both
//                         lookups missed and fell through to the zero at the end of the chain.
// N23 (medium)            Referral settings saved, and the screen never showed what was saved: the
//                         config came back as the raw snake_case row once one existed, and a
//                         hand-written camelCase object when none did. A 250-point reward read back
//                         as "Discount (%)" with no value, and Min Purchase stayed 0 however often
//                         it was set.
//
// Both are the same mistake, and it is the third time in this one report — N12 was a third. So this
// file pins the SHAPE each endpoint promises, and then pins that the screen reads that shape.
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
  name: 'Twomiah Leaf', slug: 'leaf-m', email: 'm@test.local', state: 'OH',
  taxRate: '8.0', exciseTaxRate: '10.0',
  enabledFeatures: ['products', 'orders', 'referrals', 'dashboard', 'loyalty'],
} as any).returning()
const [owner] = await db.insert(user).values({
  email: 'owner-t46m@test.local', passwordHash: 'x', firstName: 'O', lastName: 'U', role: 'owner', companyId: co.id,
} as any).returning()

const [kush] = await db.insert(product).values({
  name: 'OG Kush', companyId: co.id, category: 'flower', price: '45', stockQuantity: 50,
  weightGrams: '3.5', taxCategory: 'cannabis', trackInventory: true,
} as any).returning()
const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1985-04-02',
} as any).returning()

const app = new Hono()
app.route('/api/dashboard', (await import('./src/routes/dashboard.ts')).default)
app.route('/api/orders', (await import('./src/routes/orders.ts')).default)
app.route('/api/referrals', (await import('./src/routes/referrals.ts')).default)

const api = async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': owner.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}

// ── N4: the hub's tiles read the shape the endpoint sends ──────────────────────────────────────
{
  // A real sale, so "today" is not zero for an honest reason.
  const created = await api('POST', '/api/orders', {
    type: 'walk_in', contactId: cust.id, idVerified: true, paymentMethod: 'cash',
    items: [{ productId: kush.id, quantity: 1 }],
  })
  check('N4: a sale is rung up', created.status === 201, { status: created.status, body: created.json })
  const done = await api('POST', `/api/orders/${created.json.id}/complete`, { paymentMethod: 'cash' })
  check('N4: …and completed', done.status === 200, { status: done.status, body: done.json })

  const stats = await api('GET', '/api/dashboard/stats')
  check('N4: the dashboard reports today under `today`', stats.json?.today !== undefined, Object.keys(stats.json || {}))
  check('N4: …with revenue on it', Number(stats.json?.today?.revenue) > 0, stats.json?.today)
  check('N4: …and an order count', Number(stats.json?.today?.orderCount) === 1, stats.json?.today)
  check('N4: …and the open drawers under `openCashSessions`', Array.isArray(stats.json?.openCashSessions), Object.keys(stats.json || {}))

  // The shapes the hub used to look for are not there, and never were — which is the whole finding.
  check('N4: the endpoint does NOT send revenueToday', stats.json?.revenueToday === undefined, stats.json?.revenueToday)
  check('N4: …nor ordersToday', stats.json?.ordersToday === undefined, stats.json?.ordersToday)

  // The screen half is pinned by scripts/check-dashboard-stats-shape.ts — the sandbox holds the
  // backend only, so a frontend file cannot be read from here.
}

// ── N23: referral settings read back as they were saved ────────────────────────────────────────
{
  const before = await api('GET', '/api/referrals/config')
  check('N23: an unset config answers in camelCase', before.json?.referrerRewardType === 'points' && before.json?.minPurchaseAmount === 0, before.json)

  const saved = await api('PUT', '/api/referrals/config', {
    enabled: true,
    referrerRewardType: 'points', referrerRewardValue: 250,
    referredRewardType: 'points', referredRewardValue: 100,
    minPurchaseAmount: 25, expirationDays: 60, maxReferralsPerCustomer: 5,
  })
  check('N23: the settings save', saved.status === 200, { status: saved.status, body: saved.json })
  check('N23: …and the save answers in the same shape the screen sent',
    saved.json?.referrerRewardType === 'points' && Number(saved.json?.referrerRewardValue) === 250, saved.json)
  check('N23: …with no snake_case left to confuse it', saved.json?.referrer_reward_type === undefined, Object.keys(saved.json || {}))

  const after = await api('GET', '/api/referrals/config')
  check('N23: reading it back shows what was saved — this is what used to come back blank',
    after.json?.enabled === true
    && after.json?.referrerRewardType === 'points'
    && Number(after.json?.referrerRewardValue) === 250
    && Number(after.json?.referredRewardValue) === 100,
    after.json)
  check('N23: …including Min Purchase, which sat at 0 however often it was set',
    Number(after.json?.minPurchaseAmount) === 25, { minPurchaseAmount: after.json?.minPurchaseAmount })
  check('N23: …and the expiry and the cap', Number(after.json?.expirationDays) === 60 && Number(after.json?.maxReferralsPerCustomer) === 5, after.json)
  check('N23: …as numbers, not the text the column holds',
    typeof after.json?.referrerRewardValue === 'number' && typeof after.json?.minPurchaseAmount === 'number', {
      reward: typeof after.json?.referrerRewardValue, min: typeof after.json?.minPurchaseAmount,
    })

  // A second save must not lose anything either.
  await api('PUT', '/api/referrals/config', { referrerRewardValue: 300 })
  const third = await api('GET', '/api/referrals/config')
  check('N23: changing one field leaves the others alone',
    Number(third.json?.referrerRewardValue) === 300 && Number(third.json?.minPurchaseAmount) === 25 && third.json?.enabled === true,
    third.json)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
