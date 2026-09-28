// crm-store — the loyalty programme, end to end.
//
// Store is the second vertical on the shared rules (src/shared → packages/tenant-backend/src/
// loyalty). The arithmetic is proven in tests/shared/loyalty-engine.test.ts; what is proven HERE is
// the wiring, and store's wiring has two properties nothing else in the fleet has:
//
//   · identity is an EMAIL, because checkout is guest and there is no shopper login
//   · points move when an order is PAID, never at checkout — an abandoned cart must not burn a
//     balance, and a webhook that fires twice must not pay or charge twice
import { eq } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { storeSettings, users, orders, loyaltyMembers, loyaltyTransactions, loyaltyRewards } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

await db.insert(storeSettings).values({
  companyName: 'Loyal Store', currency: 'usd',
  loyalty: { enabled: true, pointsPerDollar: 1, punchCard: { visitsRequired: 3, rewardName: 'Free delivery' } },
} as any)

await db.insert(users).values({
  email: 'owner@loyalstore.test', passwordHash: 'x', name: 'Owner', role: 'owner',
} as any)

const svc = await import('./src/services/loyalty.ts')

/** A paid-shaped order, written the way checkout + finalize would leave it. */
let n = 0
const paidOrder = async (email: string, subtotalCents: number, opts: { rewardId?: string; loyaltyDiscountCents?: number; discountCents?: number } = {}) => {
  n++
  const discountCents = opts.discountCents ?? opts.loyaltyDiscountCents ?? 0
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-${n}`, provider: 'stripe', providerSessionId: `sess_${n}`,
    status: 'paid', customerEmail: email,
    subtotalCents, shippingCents: 500, taxCents: 0,
    discountCents, loyaltyRewardId: opts.rewardId ?? null,
    loyaltyDiscountCents: opts.loyaltyDiscountCents ?? 0,
    totalCents: subtotalCents - discountCents + 500, currency: 'usd',
  } as any).returning()
  return o
}

const member = async (email: string) =>
  (await db.select().from(loyaltyMembers).where(eq(loyaltyMembers.email, email)).limit(1))[0]

// ───────────────────────────────────────────────── earning, keyed to the email
const o1 = await paidOrder('Ada@Example.com', 5000)
const r1 = await svc.settleLoyaltyForPaidOrder(o1.id)
check('earn: a paid order enrols the shopper and pays out', r1.earned === 50, r1)
let m = await member('ada@example.com')
check('earn: the address is stored lowercased, so one shopper is one member', !!m, m)
check('earn: $50 at 1/dollar is 50 points', m.pointsBalance === 50, m)
check('earn: and the order filled one punch', m.qualifyingOrders === 1, m)

// A second order from the SAME person typed with different capitalisation must land on one balance.
const o2 = await paidOrder('ADA@example.com', 3000)
await svc.settleLoyaltyForPaidOrder(o2.id)
m = await member('ada@example.com')
check('earn: ADA@ and Ada@ are the same customer, not two half-balances', m.pointsBalance === 80, m)
const allMembers = await db.select().from(loyaltyMembers)
check('earn: exactly one member row exists for them', allMembers.length === 1, allMembers.length)

// ─────────────────────────────────────── a webhook firing twice must not pay twice
const replay = await svc.settleLoyaltyForPaidOrder(o2.id)
m = await member('ada@example.com')
check('idempotent: settling the same order again earns nothing', replay.earned === 0, replay)
check('idempotent: the balance did not move', m.pointsBalance === 80, m)
check('idempotent: nor did the punch count', m.qualifyingOrders === 2, m)

// ──────────────────────────────────── points are earned on GOODS, not postage
const o3 = await paidOrder('bob@example.com', 10000, { discountCents: 2000 })
const r3 = await svc.settleLoyaltyForPaidOrder(o3.id)
check('earn: a discount reduces what is earned — $100 less $20 is 80 points', r3.earned === 80, r3)
check('earn: shipping is not revenue and earns nothing', (await member('bob@example.com')).pointsBalance === 80)

// ──────────────────────────────────────────────────── quoting what is claimable
const [tenOff] = await db.insert(loyaltyRewards).values({
  name: '$10 off', pointsCost: 60, type: 'fixed', valueCents: 1000, minSubtotalCents: 2000,
} as any).returning()
const [bigSpend] = await db.insert(loyaltyRewards).values({
  name: '$50 off', pointsCost: 60, type: 'fixed', valueCents: 5000, minSubtotalCents: 40000,
} as any).returning()

const quote = await svc.availableRewards('ada@example.com', 5000)
const ten = quote.rewards.find((r) => r.id === tenOff.id)!
const big = quote.rewards.find((r) => r.id === bigSpend.id)!
check('quote: the balance comes back', quote.pointsBalance === 80, quote.pointsBalance)
check('quote: an affordable reward is offered', ten.available === true && ten.discountCents === 1000, ten)
check('quote: one below its minimum spend is not', big.available === false, big)
check('quote: ...and says what the shopper would have to spend', /Spend at least 400/.test(big.reason || ''), big)

const stranger = await svc.availableRewards('nobody@example.com', 5000)
check('quote: an unknown address gets an empty balance, not a 404 that confirms who shops here',
  stranger.pointsBalance === 0 && Array.isArray(stranger.rewards), stranger.pointsBalance)

// ─────────────────────────────────────── spending happens at PAID, not at checkout
const pending = await db.insert(orders).values({
  orderNumber: 'ORD-ABANDON', provider: 'stripe', providerSessionId: 'sess_abandon',
  status: 'pending', customerEmail: 'ada@example.com',
  subtotalCents: 5000, shippingCents: 500, taxCents: 0,
  discountCents: 1000, loyaltyRewardId: tenOff.id, loyaltyDiscountCents: 1000,
  totalCents: 4500, currency: 'usd',
} as any).returning()
m = await member('ada@example.com')
check('abandoned: a checkout that was never paid has spent nothing', m.pointsBalance === 80, m)

const o4 = await paidOrder('ada@example.com', 5000, { rewardId: tenOff.id, loyaltyDiscountCents: 1000 })
const r4 = await svc.settleLoyaltyForPaidOrder(o4.id)
check('spend: paying charges the 60 points', r4.spent === 60, r4)
m = await member('ada@example.com')
// 80 − 60 spent + 40 earned on ($50 − $10)
check('spend: balance is 80 - 60 + 40 = 60', m.pointsBalance === 60, m)

const respend = await svc.settleLoyaltyForPaidOrder(o4.id)
check('spend: the same order cannot be charged twice', respend.spent === 0 && respend.earned === 0, respend)
check('spend: balance unchanged on replay', (await member('ada@example.com')).pointsBalance === 60)

// ─────────────────────────────────── a tampered request gets no discount, not an error
const tampered = await svc.quoteRewardForCheckout('ada@example.com', bigSpend.id, 5000)
check('tamper: a reward below its minimum spend quotes zero', tampered === 0, tampered)
const unknownReward = await svc.quoteRewardForCheckout('ada@example.com', '00000000-0000-0000-0000-000000000000', 5000)
check('tamper: an invented reward id quotes zero rather than throwing mid-payment', unknownReward === 0, unknownReward)

// ──────────────────────────────────────────── the punch card, counted in orders
const card = (await svc.availableRewards('ada@example.com', 5000)).punchCard
check('punch: 3 paid orders completed a card', card.unclaimed === 1, card)

const [freeShip] = await db.insert(loyaltyRewards).values({
  name: 'Free delivery', pointsCost: 0, type: 'fixed', valueCents: 500,
} as any).returning()
const onHouse = (await svc.availableRewards('ada@example.com', 5000)).rewards.find((r) => r.id === freeShip.id)!
check('punch: the card makes the 0-point reward claimable', onHouse.available === true && onHouse.onTheHouse === true, onHouse)

const o5 = await paidOrder('ada@example.com', 5000, { rewardId: freeShip.id, loyaltyDiscountCents: 500 })
await svc.settleLoyaltyForPaidOrder(o5.id)
m = await member('ada@example.com')
check('punch: redeeming a card costs no points', m.pointsBalance === 60 + 45, m)
check('punch: and consumes the card', m.punchRewardsEarned === 1, m)

const after = (await svc.availableRewards('ada@example.com', 5000)).rewards.find((r) => r.id === freeShip.id)!
check('punch: a spent card cannot buy another free one', after.available === false, after)
check('punch: ...and says how many more orders are needed', /more order/.test(after.reason || ''), after)

// ───────────────────────────────────────── the shop's switch actually stops it
await db.update(storeSettings).set({
  loyalty: { enabled: false, pointsPerDollar: 1, punchCard: { visitsRequired: 3 } },
} as any)
const o6 = await paidOrder('carol@example.com', 9000)
const r6 = await svc.settleLoyaltyForPaidOrder(o6.id)
check('switch: a switched-off programme earns nothing', r6.earned === 0 && r6.spent === 0, r6)
check('switch: and enrols nobody', !(await member('carol@example.com')))

const ledger = await db.select().from(loyaltyTransactions)
check('ledger: every movement is recorded', ledger.length > 0, ledger.length)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
