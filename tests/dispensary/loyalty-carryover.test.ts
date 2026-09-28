// crm-dispensary — the four LY0928 findings that were never only about the salon.
//
// The salon loyalty run reported fourteen defects. Four of them were about code this template
// repeats, so they were never salon bugs:
//
//   B1  Points spent several times over. The salon checked the balance and deducted in two separate
//       statements; here the check is at CREATE and the deduction is at COMPLETE, with nothing
//       reserving in between — so several tickets can be rung up against one balance, every one of
//       them passes, and GREATEST(0, …) at settlement floors the result and hides it. The shop has
//       handed out more discount than the customer could pay for.
//   M2  A reward worth more than the ticket. The discount was clamped to the subtotal and the points
//       were charged in full, so the customer paid full price in points for part of the value.
//   L2  A correction with the programme switched off. Redeeming is already refused when loyalty is
//       off; correcting is not, and it should not be — but the answer has to say so.
//   L3  A floored deduction wiped earned-to-date, which drives the TIER here. A -999,999 correction
//       demoted a genuine gold customer to bronze by erasing points from real sales.
//
// The stock decrement in this same settlement is the model B1 is fixed against: an atomic conditional
// UPDATE, and a completion that cannot be paid for is refused rather than quietly given away.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact, product } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Carryover Dispensary', slug: 'carryover', email: 'carryover@test.local',
  settings: {}, enabledFeatures: ['loyalty_rewards', 'orders', 'products'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-carryover@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const manager = await mkUser('manager', 'manager')

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Ada Customer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()

const [item] = await db.insert(product).values({
  name: 'Blue Dream', sku: 'BD-CO', category: 'flower', price: '50', cost: '10',
  weightGrams: '3.5', stockQuantity: 1000, trackInventory: true, taxCategory: 'cannabis', companyId: co.id,
} as any).returning()

const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)
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
const asManager = as(manager)

const counters = async (memberId: string) => {
  const r: any = await db.execute(sql`
    SELECT points_balance, total_points_earned, lifetime_points, tier
    FROM loyalty_members WHERE id = ${memberId} LIMIT 1
  `)
  const row = (r.rows || r)?.[0]
  return {
    balance: Number(row?.points_balance ?? -1),
    earned: Number(row?.total_points_earned ?? -1),
    lifetime: Number(row?.lifetime_points ?? -1),
    tier: String(row?.tier ?? '?'),
  }
}

const enrolled = await asManager('POST', '/api/loyalty/members', { contactId: cust.id, initialPoints: 0 })
check('setup: the customer is on the programme', enrolled.status === 201, enrolled.json)
const memberId = enrolled.json?.id
if (!memberId) { console.log('\n  cannot continue without a member id'); process.exit(1) }

const ticket = (points: number) => ({
  contactId: cust.id,
  items: [{ productId: item.id, quantity: 1 }],
  loyaltyPointsRedeemed: points,
  type: 'walk_in',
  idVerified: true,
  paymentMethod: 'cash',
})

// ── B1: several tickets cannot each spend the same balance ─────────────────────────────────────
// 400 points is $4 of discount at 100 to the dollar. Four tickets each ask for 200.
await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 400, reason: 'set up the race' })
check('B1: the customer starts on exactly 400 points', (await counters(memberId)).balance === 400)

const tickets = []
for (let i = 0; i < 4; i++) {
  const r = await asManager('POST', '/api/orders', ticket(200))
  tickets.push(r)
}
check('B1: every ticket was rung up — the check at create is a warning, not a reservation',
  tickets.every((r) => r.status === 201), tickets.map((r) => r.status))

const settled = await Promise.all(tickets.map((r) =>
  asManager('POST', `/api/orders/${r.json.id}/complete`, { paymentMethod: 'cash', cashTendered: 100000 })
    .catch(() => ({ status: 500, json: null })),
))
const paid = settled.filter((r: any) => r.status === 200)
const refusedShort = settled.filter((r: any) => r.json?.code === 'loyalty_points_gone')
check('B1: only the two the balance could pay for settled', paid.length === 2,
  { settled: paid.length, statuses: settled.map((r: any) => r.status) })
check('B1: the rest were refused by name, not given away',
  refusedShort.length === 2, settled.map((r: any) => r.json?.code || r.status))
const afterRace = await counters(memberId)
check('B1: the balance never went below zero', afterRace.balance >= 0, afterRace)
const redeemRows: any = await db.execute(sql`SELECT COALESCE(SUM(points), 0) AS spent FROM loyalty_transactions WHERE member_id = ${memberId} AND type = 'redeem'`)
check('B1: exactly the 400 that existed were spent — not 800',
  Number(((redeemRows as any).rows || redeemRows)?.[0]?.spent || 0) === -400,
  ((redeemRows as any).rows || redeemRows)?.[0])
// The two settled sales also earned, so the balance is the 400 spent down to nothing plus that.
const earnRows: any = await db.execute(sql`SELECT COALESCE(SUM(points), 0) AS got FROM loyalty_transactions WHERE member_id = ${memberId} AND type IN ('earn', 'bonus')`)
const earnedByRace = Number(((earnRows as any).rows || earnRows)?.[0]?.got || 0)
check('B1: the balance is exactly 400 spent, plus what those two sales earned',
  afterRace.balance === 400 - 400 + earnedByRace, { balance: afterRace.balance, earned: earnedByRace })

// A refused settlement must not have taken the stock with it.
const stock: any = await db.execute(sql`SELECT stock_quantity FROM products WHERE id = ${item.id}`)
check('B1: a refused settlement rolled the stock back too',
  Number(((stock as any).rows || stock)?.[0]?.stock_quantity) === 998,
  ((stock as any).rows || stock)?.[0])

// ── M2: a spend bigger than the ticket costs only what it could use ────────────────────────────
await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 20000, reason: 'top up' })
// One $50 item: the most this ticket can absorb is 5,000 points.
const oversized = await asManager('POST', '/api/orders', ticket(9000))
check('M2: the ticket is accepted', oversized.status === 201, oversized.json)
check('M2: ...charging only the points the ticket could use, not the 9,000 asked for',
  Number(oversized.json?.loyaltyPointsRedeemed) === 5000, {
    charged: oversized.json?.loyaltyPointsRedeemed, discount: oversized.json?.loyaltyDiscount ?? oversized.json?.discountAmount,
  })
const beforeSettle = (await counters(memberId)).balance
await asManager('POST', `/api/orders/${oversized.json.id}/complete`, { paymentMethod: 'cash', cashTendered: 100000 })
check('M2: and only that many left the balance',
  (await counters(memberId)).balance === beforeSettle - 5000,
  { before: beforeSettle, after: (await counters(memberId)).balance })

// ── L3: a floored correction does not erase what purchases earned ──────────────────────────────
const before = await counters(memberId)
// Corrections so far put 20,400 in; everything above that in the lifetime figure came from sales.
const netAdjust: any = await db.execute(sql`SELECT COALESCE(SUM(points), 0) AS n FROM loyalty_transactions WHERE member_id = ${memberId} AND type IN ('adjustment_add','adjustment_subtract')`)
const fromCorrections = Number(((netAdjust as any).rows || netAdjust)?.[0]?.n || 0)
check('L3: setup — corrections have put points in, and sales have too',
  fromCorrections > 0 && before.lifetime > fromCorrections, { fromCorrections, lifetime: before.lifetime })

const wipe = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: -999999, reason: 'typo' })
check('L3: the balance still floors at zero', wipe.json?.pointsBalance === 0, wipe.json)
const after = await counters(memberId)
// A correction can only take out of the wallet what is in it, and only take off the tier driver
// what corrections put there. Whichever of the two is smaller is what earned-to-date loses.
const expectedDrop = Math.min(before.balance, fromCorrections)
check('L3: earned-to-date lost only what corrections had added',
  after.lifetime === before.lifetime - expectedDrop,
  { before: before.lifetime, after: after.lifetime, expected: before.lifetime - expectedDrop, balanceDrop: before.balance, fromCorrections })
check('L3: the tier driver moved with it, and no further',
  after.earned === before.earned - expectedDrop, { before: before.earned, after: after.earned })
check('L3: ...so what the customer actually bought is still on their record', after.lifetime > 0, after)

// The case that matters most, and the one the report actually described: a customer whose balance
// is almost all SALES. A -999,999 here has plenty of wallet to take, and must still leave the tier
// driver alone — this is the assertion that fails if the cap is removed.
const [buyer] = await db.insert(contact).values({
  type: 'customer', name: 'Bea Buyer', companyId: co.id, dateOfBirth: '1980-01-01',
} as any).returning()
const buyerMember = await asManager('POST', '/api/loyalty/members', { contactId: buyer.id, initialPoints: 0 })
const buyerId = buyerMember.json?.id
for (let i = 0; i < 3; i++) {
  const t = await asManager('POST', '/api/orders', { ...ticket(0), contactId: buyer.id })
  await asManager('POST', `/api/orders/${t.json.id}/complete`, { paymentMethod: 'cash', cashTendered: 100000 })
}
await asManager('POST', `/api/loyalty/members/${buyerId}/adjust`, { points: 10, reason: 'a small goodwill correction' })
const buyerBefore = await counters(buyerId)
check('L3: this customer earned their points at the till, with one small correction on top',
  buyerBefore.balance > 100 && buyerBefore.lifetime > 100, buyerBefore)

await asManager('POST', `/api/loyalty/members/${buyerId}/adjust`, { points: -999999, reason: 'typo' })
const buyerAfter = await counters(buyerId)
check('L3: the wallet is emptied', buyerAfter.balance === 0, buyerAfter)
check('L3: but earned-to-date lost only the 10 a correction had added',
  buyerAfter.lifetime === buyerBefore.lifetime - 10,
  { before: buyerBefore.lifetime, after: buyerAfter.lifetime, expected: buyerBefore.lifetime - 10 })
check('L3: ...and the tier driver with it, so a real customer is not demoted by a typo',
  buyerAfter.earned === buyerBefore.earned - 10, { before: buyerBefore.earned, after: buyerAfter.earned })

// ── L2: correcting with the programme switched off works, and says so ──────────────────────────
await db.execute(sql`UPDATE company SET settings = '{"loyalty":{"enabled":false}}'::json WHERE id = ${co.id}`)
const whileOff = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 25, reason: 'correcting an old mistake' })
check('L2: a correction is still possible with the programme off', whileOff.status === 200, whileOff.json)
check('L2: ...and the answer says so, rather than letting the desk think it is still running',
  whileOff.json?.programmeOff === true, whileOff.json)

const offTicket = await asManager('POST', '/api/orders', ticket(10))
check('L2: redeeming, unlike correcting, is still refused while it is off',
  offTicket.status === 403, { status: offTicket.status, error: offTicket.json?.error })

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
