// One definition of "what tier is this member on", for every path that moves points.
//
// There were three copies of the ladder (loyalty.ts, orders.ts twice) and all three hardcoded
// 500 / 1500 / 5000 — while Settings → Loyalty offers editable tier thresholds that loyaltyConfig.ts
// stores, validates and hands back to the screen. A tenant could set their own thresholds, see them
// saved, see them reappear, and never have a single one applied. Same shape as the points-per-dollar
// bug loyaltyConfig.ts was written to fix.
//
// Three more paths moved points and never re-evaluated the tier at all — referrals, the gamified
// challenge rewards, and the POS-integration sale hook — so a customer could cross platinum through
// a referral bonus and stay bronze until their next in-store sale happened to recompute it.
//
// The executor is passed in rather than importing `db`, because the order paths recompute inside
// db.transaction: a helper that reached for the outer connection instead of the caller's `tx` would
// deadlock PGlite and hang the suite with no output.
import { sql } from 'drizzle-orm'
import { DEFAULT_TIER_THRESHOLDS } from './loyaltyConfig.ts'

/** `db` or a drizzle transaction — anything that can run a statement. */
export interface SqlExecutor {
  execute: (query: any) => Promise<any>
}

const nonNegative = (v: any, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

/**
 * The tenant's ladder, read through `exec` so a transaction sees its own uncommitted settings.
 *
 * The three values are sorted before use. PUT /api/company accepts any numbers, including an
 * inverted ladder (silver 5000 / gold 100 / platinum 1 was accepted in T29), and an unsorted CASE
 * would then award platinum to everyone with a single point. Sorting makes the cheapest threshold
 * silver and the dearest platinum, which is the only reading of such a config that means anything.
 */
export async function tierThresholdsFor(exec: SqlExecutor, companyId: string) {
  const res: any = await exec.execute(sql`SELECT settings FROM company WHERE id = ${companyId} LIMIT 1`)
  const row = (res?.rows || res)?.[0]

  let settings: any = row?.settings
  if (typeof settings === 'string') { try { settings = JSON.parse(settings) } catch { settings = {} } }

  const configured = settings?.loyalty?.tierThresholds
  const raw = configured && typeof configured === 'object' && !Array.isArray(configured) ? configured : {}

  const [silver, gold, platinum] = [
    nonNegative(raw.silver, DEFAULT_TIER_THRESHOLDS.silver),
    nonNegative(raw.gold, DEFAULT_TIER_THRESHOLDS.gold),
    nonNegative(raw.platinum, DEFAULT_TIER_THRESHOLDS.platinum),
  ].sort((a, b) => a - b)

  return { silver, gold, platinum }
}

/**
 * Re-evaluate one member's tier from total_points_earned — the tier driver, which redemption never
 * touches, so spending points can never cost a customer their standing.
 *
 * Addressed by member id or by contact id, because the order paths only hold the contact.
 */
export async function recomputeTier(
  exec: SqlExecutor,
  companyId: string,
  where: { memberId?: string; contactId?: string },
): Promise<void> {
  if (!where.memberId && !where.contactId) return
  const t = await tierThresholdsFor(exec, companyId)
  const scope = where.memberId
    ? sql`id = ${where.memberId}`
    : sql`contact_id = ${where.contactId}`

  await exec.execute(sql`
    UPDATE loyalty_members SET tier = CASE
        WHEN COALESCE(total_points_earned::numeric, 0) >= ${t.platinum} THEN 'platinum'
        WHEN COALESCE(total_points_earned::numeric, 0) >= ${t.gold} THEN 'gold'
        WHEN COALESCE(total_points_earned::numeric, 0) >= ${t.silver} THEN 'silver'
        ELSE 'bronze' END,
      updated_at = NOW()
    WHERE ${scope} AND company_id = ${companyId}
  `)
}
