// One definition of "what tier is this member on", for every path that moves points.
//
// THE MODEL. Two ledgers, which is how every serious loyalty programme works (airline miles vs
// status miles, Bonvoy points vs elite nights, Starbucks stars vs tier stars):
//
//   points_balance        the spendable wallet. Earning adds, redeeming subtracts.
//   the tier window       what the member EARNED over a rolling period, which redeeming never
//                         touches — so spending points can never cost a customer their standing.
//
// The window is summed from loyalty_transactions rather than a stored lifetime counter. A
// never-resetting counter only ratchets up: every customer eventually reaches platinum, nobody ever
// leaves, and the tier discount becomes a margin cost that can never be clawed back. A trailing
// 12 months is the industry norm and makes a tier mean "a good customer lately".
//
// WHAT COUNTS. Every ledger type except 'redeem'. Spending is the one thing that must not move the
// tier. Everything else is an earn or an un-earn and moves it in the obvious direction:
//   earn / bonus / challenge_reward / adjustment_add / carryover   positive
//   adjustment_subtract / reversal (refund claw-back)              negative
//   redeem                                                         EXCLUDED
//
// The thresholds come from the tenant's own Settings → Loyalty, not from constants. All three
// previous copies of the ladder hardcoded 500/1500/5000 while loyaltyConfig.ts stored, validated and
// echoed back editable thresholds that nothing ever applied.
//
// The executor is passed in rather than importing `db`, because the order paths recompute inside
// db.transaction: a helper that reached for the outer connection instead of the caller's `tx` would
// deadlock PGlite and hang with no output.
import { sql } from 'drizzle-orm'
import { DEFAULT_TIER_THRESHOLDS } from './loyaltyConfig.ts'

/** `db` or a drizzle transaction — anything that can run a statement. */
export interface SqlExecutor {
  execute: (query: any) => Promise<any>
}

/** Trailing months of earning that count toward a tier. 0 means "never expires". */
export const DEFAULT_TIER_WINDOW_MONTHS = 12

/** The one ledger type that must never move a tier. */
const SPEND_TYPE = 'redeem'

const nonNegative = (v: any, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export interface TierPolicy {
  silver: number
  gold: number
  platinum: number
  windowMonths: number
}

/**
 * The tenant's ladder and window, read through `exec` so a transaction sees its own settings.
 *
 * The thresholds are sorted before use. PUT /api/company accepts any numbers, including an inverted
 * ladder (T29 accepted silver 5000 / gold 100 / platinum 1), and an unsorted CASE would then hand
 * platinum to anyone with a single point. Sorting makes the cheapest threshold silver and the
 * dearest platinum, the only reading of such a config that means anything.
 */
export async function tierPolicyFor(exec: SqlExecutor, companyId: string): Promise<TierPolicy> {
  const res: any = await exec.execute(sql`SELECT settings FROM company WHERE id = ${companyId} LIMIT 1`)
  const row = (res?.rows || res)?.[0]

  let settings: any = row?.settings
  if (typeof settings === 'string') { try { settings = JSON.parse(settings) } catch { settings = {} } }

  const loyalty = settings?.loyalty || {}
  const configured = loyalty.tierThresholds
  const raw = configured && typeof configured === 'object' && !Array.isArray(configured) ? configured : {}

  const [silver, gold, platinum] = [
    nonNegative(raw.silver, DEFAULT_TIER_THRESHOLDS.silver),
    nonNegative(raw.gold, DEFAULT_TIER_THRESHOLDS.gold),
    nonNegative(raw.platinum, DEFAULT_TIER_THRESHOLDS.platinum),
  ].sort((a, b) => a - b)

  return {
    silver,
    gold,
    platinum,
    windowMonths: Math.floor(nonNegative(loyalty.tierWindowMonths, DEFAULT_TIER_WINDOW_MONTHS)),
  }
}

/**
 * Re-tier members in one set-based statement: the window sum per member, then the ladder over it.
 * `scope` narrows it to a single member; omitted, it sweeps the whole company.
 */
async function applyTiers(
  exec: SqlExecutor,
  companyId: string,
  policy: TierPolicy,
  scope: { memberId?: string; contactId?: string },
): Promise<void> {
  const windowClause = policy.windowMonths > 0
    ? sql`AND t.created_at >= NOW() - make_interval(months => (${policy.windowMonths})::int)`
    : sql``

  const scopeClause = scope.memberId
    ? sql`AND m.id = ${scope.memberId}`
    : scope.contactId
      ? sql`AND m.contact_id = ${scope.contactId}`
      : sql``

  await exec.execute(sql`
    UPDATE loyalty_members lm
    SET tier = CASE
          WHEN w.pts >= ${policy.platinum} THEN 'platinum'
          WHEN w.pts >= ${policy.gold} THEN 'gold'
          WHEN w.pts >= ${policy.silver} THEN 'silver'
          ELSE 'bronze' END,
        updated_at = NOW()
    FROM (
      SELECT m.id AS mid,
             COALESCE(SUM(t.points) FILTER (WHERE t.type <> ${SPEND_TYPE} ${windowClause}), 0) AS pts
      FROM loyalty_members m
      LEFT JOIN loyalty_transactions t ON t.member_id = m.id
      WHERE m.company_id = ${companyId} ${scopeClause}
      GROUP BY m.id
    ) w
    WHERE lm.id = w.mid AND lm.company_id = ${companyId}
  `)
}

/** Re-evaluate one member's tier. Addressed by member id or contact id — the order paths only hold the contact. */
export async function recomputeTier(
  exec: SqlExecutor,
  companyId: string,
  where: { memberId?: string; contactId?: string },
): Promise<void> {
  if (!where.memberId && !where.contactId) return
  await applyTiers(exec, companyId, await tierPolicyFor(exec, companyId), where)
}

/**
 * Re-evaluate every member of one company — the nightly pass.
 *
 * Every other recompute is triggered by a point event, which covers everyone who is still shopping.
 * The one case an event can never cover is the customer who stops: their window slides past their
 * last purchase with nothing to notice it. Without this pass a tier could only ever expire for
 * people still active, which is backwards.
 */
export async function sweepCompanyTiers(exec: SqlExecutor, companyId: string): Promise<void> {
  await applyTiers(exec, companyId, await tierPolicyFor(exec, companyId), {})
}
