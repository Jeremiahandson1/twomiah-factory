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

/**
 * A member tier — "Silver at 500 points, Gold at 1,500". A member is in the highest tier whose threshold their LIFETIME
 * points have reached (earned to date, never spent down, so redeeming a reward never drops anyone a tier). Below the
 * first threshold a member is simply a member. Each tier earns at a multiple of the programme's rate and may carry a
 * perk, which is words the front desk honours (shown on the client and at checkout) — the till applies only the
 * multiplier. None by default: a programme with no tiers earns exactly as it always did.
 */
export interface LoyaltyTier {
  name: string
  /** Lifetime points at which a member reaches this tier. */
  minPoints: number
  /** Points earned per dollar are multiplied by this (1 = the programme's own rate). */
  multiplier: number
  /** What the tier gets besides the multiplier, in the business's words ('' for none). */
  perk: string
}
export const MAX_TIERS = 5
export const MAX_TIER_MULTIPLIER = 5

export interface LoyaltyConfig {
  /** The shop's own switch, distinct from whether the plan sells the feature at all. */
  enabled: boolean
  pointsPerDollar: number
  welcomePoints: number
  birthdayBonus: number
  punchCard: PunchCardConfig
  /** Ascending by minPoints, thresholds distinct; [] = no tiers. */
  tiers: LoyaltyTier[]
}

const nonNegative = (v: any, fallback: number): number => {
  const n = Number(v)
  return Number.isFinite(n) && n >= 0 ? n : fallback
}

const cleanIds = (v: any): string[] =>
  Array.isArray(v) ? v.filter((x) => typeof x === 'string' && x.trim()).map((x) => x.trim()) : []

/** The tiers as the engine uses them: named, a whole positive threshold, a multiplier 1–5, ascending, one per threshold. */
export function cleanTiers(v: any): LoyaltyTier[] {
  if (!Array.isArray(v)) return []
  const seen = new Set<number>()
  const out: LoyaltyTier[] = []
  for (const t of v) {
    const name = typeof t?.name === 'string' ? t.name.trim().slice(0, 40) : ''
    const minPoints = Math.floor(Number(t?.minPoints))
    const m = Number(t?.multiplier)
    if (!name || !Number.isFinite(minPoints) || minPoints < 1 || seen.has(minPoints)) continue
    seen.add(minPoints)
    out.push({
      name, minPoints,
      multiplier: Number.isFinite(m) && m >= 1 ? Math.min(MAX_TIER_MULTIPLIER, Math.round(m * 100) / 100) : 1,
      perk: typeof t?.perk === 'string' ? t.perk.trim().slice(0, 120) : '',
    })
  }
  return out.sort((a, b) => a.minPoints - b.minPoints).slice(0, MAX_TIERS)
}

/**
 * Read the programme config off a settings blob, filling anything absent with the default the
 * engine would actually use. A screen that shows a number the engine ignores is worse than a screen
 * that shows nothing: it is a promise the till does not keep.
 */
/**
 * What a programme reads when the shop has not named its own reward. A service business rewards a visit; a shop
 * selling goods does not sell a "service" (Store QA T1, L1: 'Default punch card reward name is service-business
 * wording on a product store'). The vertical passes its own word; everyone else keeps this one.
 */
export interface LoyaltyDefaults { rewardName?: string }
export const DEFAULT_REWARD_NAME = 'Free service'

export function loyaltyConfig(settings: any, defaults: LoyaltyDefaults = {}): LoyaltyConfig {
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
      rewardName: typeof p.rewardName === 'string' && p.rewardName.trim() ? p.rewardName.trim() : (defaults.rewardName || DEFAULT_REWARD_NAME),
      qualifyingServiceIds: cleanIds(p.qualifyingServiceIds),
    },
    tiers: cleanTiers(l.tiers),
  }
}

/** The shape a settings screen reads back, so what was saved is what reappears. */
export function loyaltyConfigResponse(settings: any, defaults: LoyaltyDefaults = {}) {
  const cfg = loyaltyConfig(settings, defaults)
  return {
    loyaltyEnabled: cfg.enabled,
    loyaltyPointsPerDollar: cfg.pointsPerDollar,
    loyaltyWelcomePoints: cfg.welcomePoints,
    loyaltyBirthdayBonus: cfg.birthdayBonus,
    loyaltyPunchCard: cfg.punchCard,
    loyaltyTiers: cfg.tiers,
  }
}

/** The keys an update endpoint accepts, mapped into settings.loyalty. */
export const LOYALTY_SETTING_KEYS = {
  loyaltyEnabled: 'enabled',
  loyaltyPointsPerDollar: 'pointsPerDollar',
  loyaltyWelcomePoints: 'welcomePoints',
  loyaltyBirthdayBonus: 'birthdayBonus',
  loyaltyPunchCard: 'punchCard',
  loyaltyTiers: 'tiers',
} as const
