/**
 * lib/crm/loyalty.ts — The Regulars, as arithmetic. Pure.
 *
 * Points per whole dollar of food and drink (tax and tips don't earn). A
 * reward is worth a fixed amount off a check once a guest has enough points.
 * The numbers are the owner's call; these defaults are a starting point.
 */
export interface LoyaltyConfig { enabled: boolean; pointsPerDollar: number; rewardPoints: number; rewardCents: number }
export const DEFAULT_LOYALTY: LoyaltyConfig = { enabled: true, pointsPerDollar: 1, rewardPoints: 100, rewardCents: 1000 }

export function loyaltyConfig(raw: unknown): LoyaltyConfig {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const num = (v: unknown, d: number, min: number, max: number) => { const n = Number(v); return Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d }
  return {
    enabled: r.enabled === undefined ? DEFAULT_LOYALTY.enabled : r.enabled === true,
    pointsPerDollar: num(r.pointsPerDollar, DEFAULT_LOYALTY.pointsPerDollar, 0, 100),
    rewardPoints: num(r.rewardPoints, DEFAULT_LOYALTY.rewardPoints, 1, 100000),
    rewardCents: num(r.rewardCents, DEFAULT_LOYALTY.rewardCents, 1, 100000),
  }
}

/** Points a paid check earns: whole dollars of its subtotal × the rate. Rewards on the check don't earn. */
export function pointsFor(subtotalCents: number, cfg: LoyaltyConfig): number {
  if (!cfg.enabled || subtotalCents <= 0) return 0
  return Math.floor(subtotalCents / 100) * cfg.pointsPerDollar
}

/** How much a reward takes off a check: never more than the food and drink on it. */
export function rewardAmount(subtotalBeforeRewardCents: number, cfg: LoyaltyConfig): number {
  return Math.max(0, Math.min(cfg.rewardCents, subtotalBeforeRewardCents))
}

/** Is a birthday within the next `days` (or today)? Month/day only; year-end wraps. */
export function birthdaySoon(month: number | null, day: number | null, today: { month: number; day: number; year: number }, days = 7): boolean {
  if (!month || !day) return false
  const base = Date.UTC(today.year, today.month - 1, today.day)
  for (const y of [today.year, today.year + 1]) {
    const b = Date.UTC(y, month - 1, day)
    const diff = (b - base) / 86400000
    if (diff >= 0 && diff <= days) return true
  }
  return false
}
