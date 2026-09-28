// packages/tenant-backend/src/loyalty — the rules every vertical's programme runs on.
//
// No database: this is the pure half on purpose, because crm-salon and crm-store store their data
// in shapes that agree about almost nothing (multi-tenant contacts and text dollars vs single-tenant
// uuids, no contacts and integer cents). Sharing the arithmetic is what stops the second vertical
// being a copy of the first that quietly drifts.
//
//   bun run tests/shared/loyalty-engine.test.ts
import { loyaltyConfig, loyaltyConfigResponse, DEFAULT_POINTS_PER_DOLLAR } from '../../packages/tenant-backend/src/loyalty/config.ts'
import { pointsForSale, punchCardProgress, visitQualifies, rewardDiscountCents, canRedeem } from '../../packages/tenant-backend/src/loyalty/engine.ts'

let failed = 0, passed = 0
const check = (name: string, ok: boolean, detail?: unknown) => {
  if (ok) { passed++; console.log(`  ok   ${name}`) }
  else { failed++; console.log(`  FAIL ${name}`, detail === undefined ? '' : JSON.stringify(detail)) }
}

const cfgOf = (loyalty: any) => loyaltyConfig({ loyalty })
const on = cfgOf({ pointsPerDollar: 1 })

// ───────────────────────────────────────────────────────────────────── config
check('config: an unconfigured shop earns at the default rate', loyaltyConfig({}).pointsPerDollar === DEFAULT_POINTS_PER_DOLLAR)
check('config: bonuses default to OFF — nothing is given away nobody asked for',
  loyaltyConfig({}).welcomePoints === 0 && loyaltyConfig({}).birthdayBonus === 0)
check('config: enabled unless switched off deliberately', loyaltyConfig({}).enabled === true)
check('config: enabled:false is honoured', cfgOf({ enabled: false }).enabled === false)
check('config: a negative rate falls back rather than paying customers to shop',
  cfgOf({ pointsPerDollar: -5 }).pointsPerDollar === DEFAULT_POINTS_PER_DOLLAR)
check('config: a settings blob stored as a STRING still parses',
  loyaltyConfig(JSON.stringify({ loyalty: { pointsPerDollar: 3 } })).pointsPerDollar === 3)
check('config: what is saved is what reads back', loyaltyConfigResponse({ loyalty: { pointsPerDollar: 2, welcomePoints: 50 } }).loyaltyPointsPerDollar === 2)
check('config: an unconfigured punch card is disabled, not a 0-visit freebie', loyaltyConfig({}).punchCard.visitsRequired === 0)

// ──────────────────────────────────────────────────────────────────── earning
check('earn: $100 at 1/dollar is 100 points', pointsForSale(10000, on) === 100)
check('earn: floored, never rounded up — $1.60 at 1/dollar is 1 point, not 2', pointsForSale(160, on) === 1)
check('earn: a 2x rate doubles it', pointsForSale(10000, cfgOf({ pointsPerDollar: 2 })) === 200)
check('earn: a fractional rate works — 0.5/dollar on $99 is 49', pointsForSale(9900, cfgOf({ pointsPerDollar: 0.5 })) === 49)
check('earn: a switched-off programme earns nothing', pointsForSale(10000, cfgOf({ enabled: false, pointsPerDollar: 1 })) === 0)
check('earn: a zero rate earns nothing', pointsForSale(10000, cfgOf({ pointsPerDollar: 0 })) === 0)
check('earn: a refund-shaped negative never mints points', pointsForSale(-5000, on) === 0)

// ───────────────────────────────────────────────────────────────── punch card
const card = cfgOf({ punchCard: { visitsRequired: 6, rewardName: 'Free cut' } })
check('punch: no card configured means no card', punchCardProgress({ qualifyingVisits: 9, rewardsEarned: 0 }, on).enabled === false)

const p0 = punchCardProgress({ qualifyingVisits: 0, rewardsEarned: 0 }, card)
check('punch: a new customer needs all 6', p0.progress === 0 && p0.remaining === 6 && p0.unclaimed === 0, p0)

const p5 = punchCardProgress({ qualifyingVisits: 5, rewardsEarned: 0 }, card)
check('punch: 5 of 6 — one to go, nothing owed yet', p5.progress === 5 && p5.remaining === 1 && p5.unclaimed === 0, p5)

const p6 = punchCardProgress({ qualifyingVisits: 6, rewardsEarned: 0 }, card)
check('punch: the 6th visit completes a card and owes one free', p6.unclaimed === 1 && p6.progress === 0 && p6.remaining === 6, p6)

const p7 = punchCardProgress({ qualifyingVisits: 7, rewardsEarned: 1 }, card)
check('punch: once granted it is not owed twice — the 7th starts a fresh card', p7.unclaimed === 0 && p7.progress === 1, p7)

const p13 = punchCardProgress({ qualifyingVisits: 13, rewardsEarned: 1 }, card)
check('punch: a backdated run can owe a second card rather than swallowing it', p13.unclaimed === 1, p13)
check('punch: never owes a negative when more was granted than earned',
  punchCardProgress({ qualifyingVisits: 3, rewardsEarned: 5 }, card).unclaimed === 0)

check('punch: with no qualifying list, any service fills the card', visitQualifies('svc-anything', card) === true)
const cuts = cfgOf({ punchCard: { visitsRequired: 6, qualifyingServiceIds: ['svc-cut'] } })
check('punch: "6 cuts, 7th free" does not count a fringe trim', visitQualifies('svc-trim', cuts) === false)
check('punch: ...and does count a cut', visitQualifies('svc-cut', cuts) === true)

// ────────────────────────────────────────────────────────────────── redeeming
const basket = [{ itemId: 'svc-cut', lineTotalCents: 4500 }, { itemId: 'svc-colour', lineTotalCents: 9000 }]

check('redeem: $10 off takes 1000 cents', rewardDiscountCents({ pointsCost: 100, type: 'fixed', value: 1000 }, basket) === 1000)
check('redeem: money off never exceeds the basket',
  rewardDiscountCents({ pointsCost: 100, type: 'fixed', value: 999999 }, basket) === 13500)
check('redeem: 10% of $135 is $13.50', rewardDiscountCents({ pointsCost: 100, type: 'percent', value: 10 }, basket) === 1350)
check('redeem: a percent over 100 is capped at the basket',
  rewardDiscountCents({ pointsCost: 100, type: 'percent', value: 500 }, basket) === 13500)
check('redeem: a free service comes off at THIS basket\'s price',
  rewardDiscountCents({ pointsCost: 0, type: 'free_item', itemId: 'svc-cut' }, basket) === 4500)
check('redeem: a free service not in the basket takes nothing off',
  rewardDiscountCents({ pointsCost: 0, type: 'free_item', itemId: 'svc-facial' }, basket) === 0)
check('redeem: an empty basket gives nothing back', rewardDiscountCents({ pointsCost: 0, type: 'percent', value: 100 }, []) === 0)

check('gate: enough points passes', canRedeem({ pointsCost: 100, type: 'fixed', value: 1000 }, 250, basket).ok === true)
const short = canRedeem({ pointsCost: 500, type: 'fixed', value: 1000 }, 250, basket)
check('gate: too few points is refused', short.ok === false)
check('gate: ...and the refusal says both numbers', /500 points/.test(short.reason || '') && /has 250/.test(short.reason || ''), short)
check('gate: an inactive reward is refused',
  canRedeem({ pointsCost: 0, type: 'fixed', value: 500, active: false }, 999, basket).ok === false)
const missing = canRedeem({ pointsCost: 0, type: 'free_item', itemId: 'svc-facial', name: 'Free facial' }, 999, basket)
check('gate: a free item missing from the order says to add it', missing.ok === false && /Add Free facial/.test(missing.reason || ''), missing)
check('gate: a punch-card reward costs 0 points — the visits were the price',
  canRedeem({ pointsCost: 0, type: 'free_item', itemId: 'svc-cut' }, 0, basket).ok === true)

console.log(`\n  ${passed} passed, ${failed} failed`)
process.exit(failed ? 1 : 0)
