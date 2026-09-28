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
// Spending points must never cost a customer their tier. That is the entire reason the wallet and
// the tier window are separate ledgers, and it is the over-correction that would be worse than the
// ratchet it replaced. A real 'redeem' row is written, exactly as the register writes one.
await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 2000, reason: 'stock the wallet' })
const beforeRedeem = await counters(memberId)
check('redeem: 2000 earned puts the member on gold', beforeRedeem.tier === 'gold', beforeRedeem)

await db.execute(sql`
  INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
  VALUES (gen_random_uuid(), ${memberId}, 'redeem', -1500, 500, 'Redeemed at the register', ${co.id}, NOW())
`)
await db.execute(sql`UPDATE loyalty_members SET points_balance = GREATEST(0, points_balance - 1500) WHERE id = ${memberId}`)
// Any later point event re-tiers; force one so the assertion reflects a real recompute.
await asManager('POST', `/api/loyalty/members/${memberId}/adjust`, { points: 1, reason: 'trigger a recompute' })
const c5 = await counters(memberId)
check('redeem: spending 1500 does not demote — still gold', c5.tier === 'gold', c5)
check('redeem: only the wallet moved', c5.balance === 501, c5)

// ------------------------------------------------------------- the rolling window itself
// Earning ages out. A member carried entirely by points earned more than twelve months ago is not a
// good customer any more, and a tier that never expires makes everyone platinum eventually.
const LADDER = { silver: 100, gold: 1000, platinum: 5000 }
const setPolicy = (tierWindowMonths: number) => db.execute(sql`
  UPDATE company SET settings = ${JSON.stringify({ loyalty: { tierThresholds: LADDER, tierWindowMonths } })}::json
  WHERE id = ${co.id}
`)
await setPolicy(12)

const [old] = await db.insert(contact).values({ type: 'customer', name: 'Dormant Customer', companyId: co.id } as any).returning()
const oldEnrol = await asManager('POST', '/api/loyalty/members', { contactId: old.id, initialPoints: 0 })
const oldMemberId = oldEnrol.json?.id
check('window: second member enrolled', oldEnrol.status === 201 && !!oldMemberId, oldEnrol.json)

// 3000 points earned 13 months ago — outside the window — plus 120 earned last week.
await db.execute(sql`
  INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
  VALUES (gen_random_uuid(), ${oldMemberId}, 'earn', 3000, 3000, 'Ancient spree', ${co.id}, NOW() - INTERVAL '13 months'),
         (gen_random_uuid(), ${oldMemberId}, 'earn', 120, 3120, 'Recent visit', ${co.id}, NOW() - INTERVAL '7 days')
`)

const { sweepCompanyTiers } = await import('./src/utils/loyaltyTier.ts')
await sweepCompanyTiers(db as any, co.id)
const dormant = await counters(oldMemberId)
// Only the recent 120 counts: silver on a 100/1000/5000 ladder, not the gold 3120 would have bought.
check('window: points earned 13 months ago do not count toward the tier', dormant.tier === 'silver', dormant)

// With the window switched off (0 = never expires) all 3120 counts again.
await setPolicy(0)
await sweepCompanyTiers(db as any, co.id)
const lifetime = await counters(oldMemberId)
check('window: tierWindowMonths 0 counts all time — 3120 is gold', lifetime.tier === 'gold', lifetime)

await db.execute(sql`
  INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, description, company_id, created_at)
  VALUES (gen_random_uuid(), ${oldMemberId}, 'earn', 2000, 5120, 'Big recent order', ${co.id}, NOW())
`)
await sweepCompanyTiers(db as any, co.id)
const lifetime2 = await counters(oldMemberId)
check('window: 5120 all-time reaches platinum when the window is off', lifetime2.tier === 'platinum', lifetime2)

// ...and switching the window back on drops them to gold, because only 2120 of it is inside.
await setPolicy(12)
await sweepCompanyTiers(db as any, co.id)
const windowed = await counters(oldMemberId)
check('sweep: the nightly pass demotes a member whose old points aged out', windowed.tier === 'gold', windowed)

// ------------------------------------------- the tenant's own thresholds are the ones that apply
// Settings → Loyalty stores tierThresholds and hands them back to the screen, but all three copies
// of the ladder hardcoded 500/1500/5000, so a tenant's configured thresholds were saved, echoed and
// never applied. recomputeTier reads them through the same executor it writes with.
// A member of their own, so the assertions read against an empty ledger rather than whatever the
// blocks above happened to leave behind.
await db.execute(sql`
  UPDATE company SET settings = ${JSON.stringify({ loyalty: { tierThresholds: { silver: 100, gold: 200, platinum: 300 }, tierWindowMonths: 12 } })}::json
  WHERE id = ${co.id}
`)
const [freshCust] = await db.insert(contact).values({ type: 'customer', name: 'Ladder Customer', companyId: co.id } as any).returning()
const freshEnrol = await asManager('POST', '/api/loyalty/members', { contactId: freshCust.id, initialPoints: 0 })
const freshId = freshEnrol.json?.id
check('config: third member enrolled', freshEnrol.status === 201 && !!freshId, freshEnrol.json)

const cfg1 = await asManager('POST', `/api/loyalty/members/${freshId}/adjust`, { points: 250, reason: 'configured ladder' })
check('config: +250 accepted', cfg1.status === 200, cfg1.json)
const c6 = await counters(freshId)
check('config: 250 is gold on a 100/200/300 ladder, not silver on the hardcoded one', c6.tier === 'gold', c6)

const cfg2 = await asManager('POST', `/api/loyalty/members/${freshId}/adjust`, { points: 60, reason: 'cross platinum' })
check('config: +60 accepted', cfg2.status === 200, cfg2.json)
const c7 = await counters(freshId)
check('config: 310 reaches the configured platinum at 300', c7.tier === 'platinum', c7)

// An inverted ladder is accepted by PUT /api/company (T29). Sorted, it still means something.
await db.execute(sql`
  UPDATE company SET settings = ${JSON.stringify({ loyalty: { tierThresholds: { silver: 5000, gold: 100, platinum: 1 }, tierWindowMonths: 12 } })}::json
  WHERE id = ${co.id}
`)
const cfg3 = await asManager('POST', `/api/loyalty/members/${freshId}/adjust`, { points: 1, reason: 'inverted ladder' })
check('config: inverted ladder accepted without error', cfg3.status === 200, cfg3.json)
const c8 = await counters(freshId)
check('config: inverted 5000/100/1 sorts to 1/100/5000 — 311 is gold, not platinum', c8.tier === 'gold', c8)

// ------------------------------------------------------------- the nightly pass itself
// sweepCompanyTiers is exercised above; this is the function the scheduler actually calls, which
// walks every company. Worth running for real: it is the one piece that only ever executes on a
// timer in production, so a mistake in it would surface months later as "tiers never expire".
{
  const { sweepLoyaltyTiers } = await import('./src/services/loyaltyTierSweep.ts')
  await db.execute(sql`UPDATE loyalty_members SET tier = 'platinum' WHERE company_id = ${co.id}`)
  const result = await sweepLoyaltyTiers()
  check('nightly: the sweep visits at least this company', result.companies >= 1, result)
  check('nightly: no company failed', result.failed === 0, result)
  const after = await counters(oldMemberId)
  check('nightly: it corrects a tier nothing else would have touched', after.tier === 'gold', after)
}

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
