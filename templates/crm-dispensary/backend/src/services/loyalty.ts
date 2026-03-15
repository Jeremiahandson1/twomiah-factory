// Loyalty points engine
export const TIER_THRESHOLDS = {
  bronze: 0,
  silver: 500,
  gold: 1500,
  platinum: 5000,
}

export function calculateTier(lifetimePoints: number): string {
  if (lifetimePoints >= TIER_THRESHOLDS.platinum) return 'platinum'
  if (lifetimePoints >= TIER_THRESHOLDS.gold) return 'gold'
  if (lifetimePoints >= TIER_THRESHOLDS.silver) return 'silver'
  return 'bronze'
}

export function calculatePointsEarned(orderTotal: string, pointsPerDollar: number): number {
  return Math.floor(parseFloat(orderTotal) * pointsPerDollar)
}
