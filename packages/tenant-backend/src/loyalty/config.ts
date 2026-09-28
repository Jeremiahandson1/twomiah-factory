// What a shop's loyalty programme is set to — one definition, for every vertical that runs one.
//
// This exists because crm-dispensary's loyalty is template-local, and the moment a second vertical
// wanted one the obvious move was to copy the folder. Copies drift: dispensary FORKS the permission
// matrix, a grant was added to the shared one, dispensary never got it, and CI stayed green on a
// shipped regression until a purpose-built guard caught it. So the second vertical does not get a
// copy — the logic moves here and the verticals adopt it.
//
// Storage deliberately lives outside this file. The two shapes disagree about almost everything a
// table cares about: crm-salon is multi-tenant with a `company` and `contact` and money in text
// dollars; crm-store is single-tenant with no contacts, uuid keys and money in integer cents. What
// they genuinely share is the ARITHMETIC and the RULES, which is what lives here and in engine.ts.
//
// Money is in CENTS throughout. Points-per-dollar on a float dollar amount is how a rounding
// argument starts, and this codebase has had enough of those.

/** Nothing is given away that nobody asked for: every bonus defaults to off. */
export const DEFAULT_POINTS_PER_DOLLAR = 1
export const DEFAULT_WELCOME_POINTS = 0
export const DEFAULT_BIRTHDAY_BONUS = 0
/** A punch card nobody configured is not a punch card. */
export const DEFAULT_PUNCH_VISITS = 0

export interface PunchCardConfig {
  /** Completed visits needed for one free reward. 0 disables the card entirely. */
  visitsRequired: number
  /** What they get — shown on the card and on the reward when it is granted. */
  rewardName: string
  /**
   * Which services count toward the card. Empty means everything counts, which is what a shop
   * wanting "any 6 appointments" expects. A shop running "6 CUTS, 7th free" names the services, so
   * a $15 fringe trim does not fill the same card as a $90 colour.
   */
  qualifyingServiceIds: string[]
}

export interface LoyaltyConfig {
  /** The shop's own switch, distinct from whether the plan sells the feature at all. */
  enabled: boolean
  pointsPerDollar: number
  welcomePoints: number
  birthdayBonus: number
  punchCard: PunchCardConfig
}

const nonNegative = (v: any, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const cleanIds = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []

/**
 * Read the programme config off a settings blob, filling anything absent with the default the
 * engine would actually use. A screen that shows a number the engine ignores is worse than a screen
 * that shows nothing: it is a promise the till does not keep.
 */
export function loyaltyConfig(settings: any): LoyaltyConfig {
  let s = settings
  if (typeof s === 'string') { try { s = JSON.parse(s) } catch { s = null } }
  const l = s?.loyalty || {}
  const p = l.punchCard || {}

  return {
    // Off only when it has been switched off deliberately.
    enabled: l.enabled !== false,
    pointsPerDollar: nonNegative(l.pointsPerDollar, DEFAULT_POINTS_PER_DOLLAR),
    welcomePoints: Math.floor(nonNegative(l.welcomePoints, DEFAULT_WELCOME_POINTS)),
    birthdayBonus: Math.floor(nonNegative(l.birthdayBonus, DEFAULT_BIRTHDAY_BONUS)),
    punchCard: {
      visitsRequired: Math.floor(nonNegative(p.visitsRequired, DEFAULT_PUNCH_VISITS)),
      rewardName: typeof p.rewardName === 'string' && p.rewardName.trim() ? p.rewardName.trim() : 'Free service',
      qualifyingServiceIds: cleanIds(p.qualifyingServiceIds),
    },
  }
}

/** The shape a settings screen reads back, so what was saved is what reappears. */
export function loyaltyConfigResponse(settings: any) {
  const cfg = loyaltyConfig(settings)
  return {
    loyaltyEnabled: cfg.enabled,
    loyaltyPointsPerDollar: cfg.pointsPerDollar,
    loyaltyWelcomePoints: cfg.welcomePoints,
    loyaltyBirthdayBonus: cfg.birthdayBonus,
    loyaltyPunchCard: cfg.punchCard,
  }
}

/** The keys an update endpoint accepts, mapped into settings.loyalty. */
export const LOYALTY_SETTING_KEYS = {
  loyaltyEnabled: 'enabled',
  loyaltyPointsPerDollar: 'pointsPerDollar',
  loyaltyWelcomePoints: 'welcomePoints',
  loyaltyBirthdayBonus: 'birthdayBonus',
  loyaltyPunchCard: 'punchCard',
} as const
