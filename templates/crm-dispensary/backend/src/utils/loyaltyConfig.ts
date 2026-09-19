// One definition of the loyalty settings, for the engine that spends them and the API that shows them.
//
// Settings → Loyalty offered Points per Dollar, Welcome Points, a Birthday Bonus, tier thresholds and an
// on/off switch. None of them were ever stored: PUT /api/company's schema had no loyalty fields at all, so
// zod stripped every one and the screen toasted "Loyalty settings saved" over a write that saved nothing.
// The award engine, meanwhile, read company.settings.loyalty.pointsPerDollar — a place the screen never
// wrote to — while the GET handed back the legacy loyalty_points_per_dollar column. Three parties, three
// ideas of where the number lived, which is why a configured welcome bonus could never be granted. (T21 M7)
//
// The stored home is company.settings.loyalty. The legacy column still seeds points-per-dollar so a tenant
// that never opens the screen keeps the rate it has been earning at.

export const DEFAULT_POINTS_PER_DOLLAR = 1
// Nothing is given away that nobody asked for: a bonus is granted only once it has been configured.
export const DEFAULT_WELCOME_POINTS = 0
export const DEFAULT_BIRTHDAY_BONUS = 0
export const DEFAULT_TIER_THRESHOLDS = { silver: 500, gold: 1500, platinum: 5000 }

export interface LoyaltyConfig {
  pointsPerDollar: number
  welcomePoints: number
  birthdayBonus: number
  enabled: boolean
  tierThresholds: Record<string, number>
}

const nonNegative = (v: any, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

export function loyaltyConfig(co: any): LoyaltyConfig {
  const l = (co?.settings as any)?.loyalty || {}
  const thresholds = l.tierThresholds && typeof l.tierThresholds === 'object' && !Array.isArray(l.tierThresholds)
    ? l.tierThresholds
    : DEFAULT_TIER_THRESHOLDS
  return {
    pointsPerDollar: nonNegative(l.pointsPerDollar, nonNegative(co?.loyaltyPointsPerDollar, DEFAULT_POINTS_PER_DOLLAR)),
    welcomePoints: Math.floor(nonNegative(l.welcomePoints, DEFAULT_WELCOME_POINTS)),
    birthdayBonus: Math.floor(nonNegative(l.birthdayBonus, DEFAULT_BIRTHDAY_BONUS)),
    // Off only when it has been switched off deliberately.
    enabled: l.enabled !== false,
    tierThresholds: thresholds,
  }
}

// The shape Settings → Loyalty reads back, so what was saved is what reappears.
export function loyaltyConfigResponse(co: any) {
  const cfg = loyaltyConfig(co)
  return {
    loyaltyPointsPerDollar: cfg.pointsPerDollar,
    loyaltyWelcomePoints: cfg.welcomePoints,
    loyaltyBirthdayBonus: cfg.birthdayBonus,
    loyaltyEnabled: cfg.enabled,
    loyaltyTierThresholds: cfg.tierThresholds,
  }
}

// The keys PUT /api/company accepts, mapped into settings.loyalty.
export const LOYALTY_SETTING_KEYS = {
  loyaltyPointsPerDollar: 'pointsPerDollar',
  loyaltyWelcomePoints: 'welcomePoints',
  loyaltyBirthdayBonus: 'birthdayBonus',
  loyaltyEnabled: 'enabled',
  loyaltyTierThresholds: 'tierThresholds',
} as const

// A birthday reward nobody can reach is not a reward: a customer rarely shops on the day itself, so the
// bonus is granted on their first settled sale in their BIRTHDAY MONTH, once per calendar year.
export function inBirthdayMonth(dob: any, now: Date = new Date()): boolean {
  if (!dob) return false
  const d = dob instanceof Date ? dob : new Date(dob)
  if (Number.isNaN(d.getTime())) return false
  // A date-only column comes back as midnight UTC; read the month in UTC so a customer born on the 1st
  // is not pushed into the previous month by a negative local offset.
  return d.getUTCMonth() === now.getMonth()
}
