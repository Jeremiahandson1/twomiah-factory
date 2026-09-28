// crm-dispensary — manual loyalty adjustments (T42 M3).
//
// The dispensary keeps two concepts in three columns: points_balance is the spendable wallet, and
// total_points_earned drives the tier with lifetime_points as its outward alias (migrate.ts keeps
// those two equal). Spending points must never cost a customer their tier — that is the whole point
// of the split, and it is the industry-standard design.
//
// What was wrong: a refund clawed the tier driver back (orders.ts) but a manual deduction did not,
// so total_points_earned only ever ratcheted up. A mistaken +100,000 grant promoted a member to
// Platinum permanently and taking the points away again could not undo it. Separately, a deduction
// is clamped at zero but the ledger recorded the amount *asked for*: a -999,999 adjustment that
// removed 245 points was written to loyalty_transactions as -999,999.
//
// These tests pin both directions, because the danger in fixing the ratchet is over-correcting into
// "spending points demotes you", which would be a worse bug than the one being fixed.
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { setupSchema } from './setup.ts'
import { db } from './db/index.ts'
import { company, user, contact } from './db/schema.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)?.slice(0, 300)) }
}

await setupSchema()

const [co] = await db.insert(company).values({
  name: 'Loyalty Dispensary', slug: 'loyaltyadj', email: 'loyaltyadj@test.local',
  settings: {}, enabledFeatures: ['loyalty_rewards'],
} as any).returning()

const mkUser = async (role: string, tag: string) => (await db.insert(user).values({
  email: `${tag}-loyaltyadj@test.local`, passwordHash: 'x', firstName: tag, lastName: 'U', role, companyId: co.id,
} as any).returning())[0]

const manager = await mkUser('manager', 'manager')
const budtender = await mkUser('user', 'budtender')  // stored `user`, normalised to budtender

const [cust] = await db.insert(contact).values({
  type: 'customer', name: 'Tier Test Customer', companyId: co.id,
} as any).returning()

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
const asManager = as(manager)
const asBudtender = as(budtender)

// The three counters straight from the row, so the assertions do not depend on the serialiser.
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

const lastLedger = async (memberId: string) => {
  const r: any = await db.execute(sql`
    SELECT type, points, balance_after FROM loyalty_transactions
    WHERE member_id = ${memberId} ORDER BY created_at DESC, points ASC LIMIT 1
  `)
  const row = (r.rows || r)?.[0]
  return { type: String(row?.type ?? '?'), points: Number(row?.points ?? NaN), balanceAfter: Number(row?.balance_after ?? NaN) }
}

// ---------------------------------------------------------------- enrol
const enrolled = await asManager('POST', '/api/loyalty/members', { contactId: cust.id, initialPoints: 0 })
check('enrol: a manager can enrol a contact', enrolled.status === 201, enrolled.json)
const memberId = enrolled.json?.id
if (!memberId) { console.log('\n  cannot continue without a member id'); process.exit(1) }

// ---------------------------------------------------------------- the role gate still holds
const denied = await asBudtender('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 50, reason: 'nope' })
check('gate: a budtender cannot adjust points', denied.status === 403, denied)

// ---------------------------------------------------------------- a grant promotes
const up1 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 600, reason: 'goodwill' })
check('grant: +600 accepted', up1.status === 200, up1.json)
let c1 = await counters(memberId)
check('grant: balance 600', c1.balance === 600, c1)
check('grant: tier driver 600', c1.earned === 600, c1)
check('grant: lifetime alias tracks the driver', c1.lifetime === 600, c1)
check('grant: tier is silver at 600', c1.tier === 'silver', c1)

const up2 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 1000, reason: 'promo' })
check('grant: +1000 accepted', up2.status === 200, up2.json)
let c2 = await counters(memberId)
check('grant: balance 1600', c2.balance === 1600, c2)
check('grant: tier is gold at 1600', c2.tier === 'gold', c2)

// ------------------------------------------------- THE FIX: a deduction demotes symmetrically
const down1 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: -1000, reason: 'granted in error' })
check('deduct: -1000 accepted', down1.status === 200, down1.json)
let c3 = await counters(memberId)
check('deduct: balance back to 600', c3.balance === 600, c3)
check('deduct: tier driver clawed back to 600', c3.earned === 600, c3)
check('deduct: lifetime alias clawed back to 600', c3.lifetime === 600, c3)
check('deduct: tier demoted gold -> silver (T42 M3)', c3.tier === 'silver', c3)
check('deduct: response reports what was applied', down1.json?.adjustment === -1000, down1.json)

// ------------------------------------------- clamping: report what happened, not what was asked
const over = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: -999999, reason: 'typo' })
check('clamp: over-deduction accepted', over.status === 200, over.json)
let c4 = await counters(memberId)
check('clamp: balance floors at 0, never negative', c4.balance === 0, c4)
check('clamp: tier driver floors at 0', c4.earned === 0, c4)
check('clamp: tier falls to bronze', c4.tier === 'bronze', c4)
check('clamp: response.adjustment is the applied -600', over.json?.adjustment === -600, over.json)
check('clamp: response.requested preserves the -999999 asked for', over.json?.requested === -999999, over.json)

const led = await lastLedger(memberId)
check('ledger: records the applied -600, not the requested -999999 (T42 M3)', led.points === -600, led)
check('ledger: balance_after agrees with the row', led.balanceAfter === 0, led)
check('ledger: typed as a subtraction', led.type === 'adjustment_subtract', led)

// ------------------------------------------------------- the invariant that must NOT regress
// Redemption spends the wallet only. This is asserted at the column level because the register path
// (orders.ts) deliberately decrements points_balance alone — if a future change ever routes a
// redemption through the adjust handler, tier would start falling when customers spend, which is
// the over-correction this whole design exists to avoid.
await db.execute(sql`UPDATE loyalty_members SET points_balance = 2000, total_points_earned = 2000, lifetime_points = 2000, tier = 'gold' WHERE id = ${memberId}`)
await db.execute(sql`UPDATE loyalty_members SET points_balance = GREATEST(0, points_balance - 1500) WHERE id = ${memberId}`)
const c5 = await counters(memberId)
check('redeem: spending 1500 leaves the tier driver untouched', c5.earned === 2000, c5)
check('redeem: spending points does not demote (gold kept)', c5.tier === 'gold', c5)
check('redeem: only the wallet moved', c5.balance === 500, c5)

// ------------------------------------------- the tenant's own thresholds are the ones that apply
// Settings → Loyalty stores tierThresholds and hands them back to the screen, but all three copies
// of the ladder hardcoded 500/1500/5000, so a tenant's configured thresholds were saved, echoed and
// never applied. recomputeTier reads them through the same executor it writes with.
await db.execute(sql`
  UPDATE company SET settings = ${JSON.stringify({ loyalty: { tierThresholds: { silver: 100, gold: 200, platinum: 300 } } })}::json
  WHERE id = ${co.id}
`)
await db.execute(sql`UPDATE loyalty_members SET points_balance = 0, total_points_earned = 0, lifetime_points = 0, tier = 'bronze' WHERE id = ${memberId}`)

const cfg1 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 250, reason: 'configured ladder' })
check('config: +250 accepted', cfg1.status === 200, cfg1.json)
const c6 = await counters(memberId)
check('config: 250 is gold on a 100/200/300 ladder, not silver on the hardcoded one', c6.tier === 'gold', c6)

const cfg2 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 60, reason: 'cross platinum' })
check('config: +60 accepted', cfg2.status === 200, cfg2.json)
const c7 = await counters(memberId)
check('config: 310 reaches the configured platinum at 300', c7.tier === 'platinum', c7)

// An inverted ladder is accepted by PUT /api/company (T29). Sorted, it still means something.
await db.execute(sql`
  UPDATE company SET settings = ${JSON.stringify({ loyalty: { tierThresholds: { silver: 5000, gold: 100, platinum: 1 } } })}::json
  WHERE id = ${co.id}
`)
const cfg3 = await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 1, reason: 'inverted ladder' })
check('config: inverted ladder accepted without error', cfg3.status === 200, cfg3.json)
const c8 = await counters(memberId)
check('config: inverted 5000/100/1 sorts to 1/100/5000 — 311 is gold, not platinum', c8.tier === 'gold', c8)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
