// crm-store — the two loyalty defects the salon run found, in the store's own wiring.
//
// Run LY0928 was a salon report, but four of its fourteen findings were about code the store shares
// or repeats. Three of them land here:
//
//   B1  Points spent several times over by simultaneous settlements. The salon read the balance,
//       checked it, then wrote the new one; the store read the balance, worked out the spend, and
//       wrote an ABSOLUTE new balance from that stale read. Two orders paid at the same instant both
//       read 400, both spent 200, and both wrote 200 back — 400 points of discount for 200 points.
//   B2  One full punch card paying out twice. Worse here than in the salon: both settlements wrote
//       `punchRewardsEarned + 1` from the same stale read, so two free rewards went out and the
//       counter only moved once, leaving the card looking unspent.
//   H3  The reward list writable by any signed-in staff member. The salon at least asked for a
//       permission; these routes carried no gate beyond `authenticate`, so a staff account could
//       make a $50-off reward cost 1 point and then spend it.
//
// Two orders paid at the same moment is not exotic for a shop: it is a webhook and a return-URL
// finalize racing each other, which is exactly how the store is built.
import { Hono } from 'hono'
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
  companyName: 'Racing Store', currency: 'usd',
  loyalty: { enabled: true, pointsPerDollar: 1, punchCard: { visitsRequired: 3, rewardName: 'Free delivery' } },
} as any)

const owner = (await db.insert(users).values({
  email: 'owner@racingstore.test', passwordHash: 'x', name: 'Owner', role: 'owner',
} as any).returning())[0]
const staff = (await db.insert(users).values({
  email: 'staff@racingstore.test', passwordHash: 'x', name: 'Staff', role: 'staff',
} as any).returning())[0]

const svc = await import('./src/services/loyalty.ts')

let n = 0
const paidOrder = async (email: string, subtotalCents: number, opts: { rewardId?: string; loyaltyDiscountCents?: number } = {}) => {
  n++
  const discountCents = opts.loyaltyDiscountCents ?? 0
  const [o] = await db.insert(orders).values({
    orderNumber: `ORD-R${n}`, provider: 'stripe', providerSessionId: `sess_r${n}`,
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

// ── B1: several orders settling at once cannot each spend the same balance ─────────────────────
const [tenOff] = await db.insert(loyaltyRewards).values({
  name: '$10 off', pointsCost: 200, type: 'fixed', valueCents: 1000,
} as any).returning()

// Get Ada to exactly 400 points, from orders that carry no reward.
const seed = await paidOrder('ada@example.com', 40000)
await svc.settleLoyaltyForPaidOrder(seed.id)
let ada = await member('ada@example.com')
check('B1: the racing shopper starts on 400 points', ada.pointsBalance === 400, ada)

// Five orders, each claiming the same $10-off reward, all settling at the same instant. The reward
// is worth 200 points, so at most two of them can actually be paid for.
const racers = []
for (let i = 0; i < 5; i++) racers.push(await paidOrder('ada@example.com', 0, { rewardId: tenOff.id, loyaltyDiscountCents: 1000 }))
const settled = await Promise.all(racers.map((o) => svc.settleLoyaltyForPaidOrder(o.id)))
const totalSpent = settled.reduce((s, r) => s + r.spent, 0)
ada = await member('ada@example.com')
check('B1: the balance never went below zero', ada.pointsBalance >= 0, ada)
check('B1: what came off the balance is exactly what was reported spent',
  ada.pointsBalance === 400 - totalSpent, { balance: ada.pointsBalance, spent: totalSpent })
check('B1: and no more than the balance could pay for was spent', totalSpent <= 400, { totalSpent, spends: settled.map((r) => r.spent) })
const redeemRows = (await db.select().from(loyaltyTransactions)).filter((r: any) => r.type === 'redeem')
check('B1: every redeem row adds up to the same figure',
  redeemRows.reduce((s: number, r: any) => s + Math.abs(Number(r.points)), 0) === totalSpent,
  { rows: redeemRows.map((r: any) => r.points), totalSpent })

// ── B2: one full card, one free reward ─────────────────────────────────────────────────────────
const [freeShip] = await db.insert(loyaltyRewards).values({
  name: 'Free delivery', pointsCost: 0, type: 'fixed', valueCents: 500,
} as any).returning()

// Bea's own card: three qualifying orders fill it exactly once.
for (let i = 0; i < 3; i++) await svc.settleLoyaltyForPaidOrder((await paidOrder('bea@example.com', 1000)).id)
let bea = await member('bea@example.com')
check('B2: three orders, one card owed', bea.qualifyingOrders === 3 && bea.punchRewardsEarned === 0, bea)

const cardRacers = []
for (let i = 0; i < 3; i++) cardRacers.push(await paidOrder('bea@example.com', 0, { rewardId: freeShip.id, loyaltyDiscountCents: 500 }))
const cardSettled = await Promise.all(cardRacers.map((o) => svc.settleLoyaltyForPaidOrder(o.id)))
bea = await member('bea@example.com')
const freeRows = (await db.select().from(loyaltyTransactions)).filter((r: any) => r.type === 'punch_reward')
check('B2: the card paid out exactly once', freeRows.length === 1, freeRows.map((r: any) => r.orderId))
check('B2: ...and the counter says so', bea.punchRewardsEarned === 1, bea)
check('B2: the other two were charged in points, or not at all — never free twice',
  cardSettled.filter((r) => r.spent === 0).length >= 1, cardSettled)

// ── H3: the reward list is the owner's ─────────────────────────────────────────────────────────
const app = new Hono()
app.route('/api/loyalty', (await import('./src/routes/loyalty.ts')).default)

const as = (who: any) => async (method: string, path: string, body?: unknown) => {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', 'x-test-user': who.id },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const t = await res.text(); let j: any = t; try { j = JSON.parse(t) } catch {}
  return { status: res.status, json: j }
}
const asOwner = as(owner)
const asStaff = as(staff)

const newReward = { name: 'Nearly free', pointsCost: 1, type: 'fixed', valueCents: 5000, active: true }
const staffCreate = await asStaff('POST', '/api/loyalty/rewards', newReward)
check('H3: staff cannot create a reward', staffCreate.status === 403, staffCreate.json)
const staffEdit = await asStaff('PUT', `/api/loyalty/rewards/${tenOff.id}`, newReward)
check('H3: staff cannot make an existing reward nearly free', staffEdit.status === 403, staffEdit.json)
const staffDelete = await asStaff('DELETE', `/api/loyalty/rewards/${tenOff.id}`)
check('H3: staff cannot delete one', staffDelete.status === 403, staffDelete.json)
const staffRate = await asStaff('PUT', '/api/loyalty/config', { loyaltyPointsPerDollar: 99 })
check('H3: staff cannot change the earn rate', staffRate.status === 403, staffRate.json)

const unchanged = await asOwner('GET', '/api/loyalty/rewards')
check('H3: the reward survived all of that at its real price',
  (unchanged.json?.rewards || []).some((r: any) => r.id === tenOff.id && r.pointsCost === 200), unchanged.json?.rewards)

// ...and staff keep the desk work they need.
check('H3: staff can still look up a shopper', (await asStaff('GET', '/api/loyalty/members')).status === 200)
check('H3: staff can still read the reward list', (await asStaff('GET', '/api/loyalty/rewards')).status === 200)
check('H3: staff can still see what the programme is set to', (await asStaff('GET', '/api/loyalty/config')).status === 200)

const ownerCreate = await asOwner('POST', '/api/loyalty/rewards', { name: '$5 off', pointsCost: 100, type: 'fixed', valueCents: 500, active: true })
check('H3: the owner can still run the programme', ownerCreate.status === 201, ownerCreate.json)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
