// The arithmetic of a loyalty programme, with no database in sight.
//
// Every figure here is in CENTS and every point is an integer. Keeping the money in cents is not
// fussiness: points-per-dollar applied to a float dollar amount is exactly how "$2.8000000000000003"
// and a reconciliation argument start, and this codebase has already paid for that lesson once.
//
// Pure on purpose. The two verticals adopting this store their data in shapes that agree about
// almost nothing — crm-salon is multi-tenant with contacts and text dollars, crm-store is
// single-tenant with uuids, no contacts and integer cents — so the storage layer is theirs and the
// rules are shared. A bug fixed here is fixed for both, which is the entire point of not copying
// the folder.
import type { LoyaltyConfig } from './config.ts'

/** Cents. Keeps a stray float from reaching a money column. */
const cents = (n: any): number => {
  const v = Number(n)
  return Number.isFinite(v) ? Math.round(v) : 0
}

// ─────────────────────────────────────────────────────────────────── earning

/**
 * Points earned on a settled sale.
 *
 * Floored, never rounded up: a shop that advertises "1 point per dollar" and hands out 2 points on
 * $1.60 is running a different programme from the one on its poster.
 */
export function pointsForSale(amountCents: number, cfg: LoyaltyConfig): number {
  if (!cfg.enabled || cfg.pointsPerDollar <= 0) return 0
  const amount = Math.max(0, cents(amountCents))
  return Math.floor((amount / 100) * cfg.pointsPerDollar)
}

// ─────────────────────────────────────────────────────────────── punch cards

export interface PunchCardState {
  /** Visits that count toward the card, all time. */
  qualifyingVisits: number
  /** Rewards this card has already produced (granted, whether or not redeemed). */
  rewardsEarned: number
}

export interface PunchCardProgress {
  enabled: boolean
  visitsRequired: number
  /** Visits on the CURRENT card, 0..visitsRequired-1 once complete cards are taken off. */
  progress: number
  /** How many more visits until the next free one. */
  remaining: number
  /** Whole cards completed that have NOT been granted yet — normally 0 or 1. */
  unclaimed: number
}

/**
 * Where a customer stands on their card.
 *
 * `unclaimed` is a count rather than a boolean because a visit can be backdated or imported, and a
 * card that silently swallows the second completion is a customer complaint. Granting is the
 * caller's job; this only reports what is owed.
 */
export function punchCardProgress(state: PunchCardState, cfg: LoyaltyConfig): PunchCardProgress {
  const required = Math.max(0, Math.floor(cfg.punchCard.visitsRequired))
  if (!cfg.enabled || required <= 0) {
    return { enabled: false, visitsRequired: 0, progress: 0, remaining: 0, unclaimed: 0 }
  }
  const visits = Math.max(0, Math.floor(state.qualifyingVisits));
  const granted = Math.max(0, Math.floor(state.rewardsEarned))
  const completedCards = Math.floor(visits / required)
  const unclaimed = Math.max(0, completedCards - granted)
  const progress = visits % required
  return {
    enabled: true,
    visitsRequired: required,
    progress,
    remaining: required - progress,
    unclaimed,
  }
}

/** Does this visit count toward the card? Empty qualifying list means everything counts. */
export function visitQualifies(serviceId: string | null | undefined, cfg: LoyaltyConfig): boolean {
  const ids = cfg.punchCard.qualifyingServiceIds
  if (!ids.length) return true
  return !!serviceId && ids.includes(serviceId)
}

// ─────────────────────────────────────────────────────────────── redemption

export type RewardType = 'fixed' | 'percent' | 'free_item'

export interface Reward {
  id?: string
  name?: string
  /** What it costs to redeem. A punch-card reward costs 0 points — the visits were the price. */
  pointsCost: number
  type: RewardType
  /** Cents for 'fixed'; whole percent for 'percent'; ignored for 'free_item'. */
  value?: number
  /** For 'free_item': the line this reward pays for. */
  itemId?: string | null
  active?: boolean
}

export interface BasketLine {
  itemId: string
  /** Cents, for the whole line. */
  lineTotalCents: number
}

/**
 * What a reward takes off this basket, in cents.
 *
 * Never more than the basket. A 100%-off reward on a $0 basket handing back money is the same class
 * of bug as charging tax on a fully discounted sale, and it is easier to prevent than to reconcile.
 */
export function rewardDiscountCents(reward: Reward, lines: BasketLine[]): number {
  const subtotal = lines.reduce((sum, l) => sum + Math.max(0, cents(l.lineTotalCents)), 0)
  if (subtotal <= 0) return 0

  switch (reward.type) {
    case 'fixed':
      return Math.min(subtotal, Math.max(0, cents(reward.value)))
    case 'percent': {
      const pct = Math.min(100, Math.max(0, Number(reward.value) || 0))
      return Math.min(subtotal, Math.round((subtotal * pct) / 100))
    }
    case 'free_item': {
      // The named item comes off at what it is actually priced on THIS basket, not at a price
      // remembered when the reward was created — a service whose price went up since would
      // otherwise be discounted by the old, lower figure.
      const line = lines.find((l) => l.itemId && l.itemId === reward.itemId)
      return line ? Math.min(subtotal, Math.max(0, cents(line.lineTotalCents))) : 0
    }
    default:
      return 0
  }
}

export interface RedeemCheck {
  ok: boolean
  /** Why not, in words a budtender or stylist can act on. */
  reason?: string
}

/**
 * May this member redeem this reward right now?
 *
 * Returns a sentence rather than a boolean because every one of these refusals reaches a person
 * standing at a counter with a customer in front of them.
 */
export function canRedeem(reward: Reward, pointsBalance: number, lines: BasketLine[]): RedeemCheck {
  if (reward.active === false) return { ok: false, reason: 'That reward is not currently available.' }

  const cost = Math.max(0, Math.floor(Number(reward.pointsCost) || 0))
  const balance = Math.max(0, Math.floor(Number(pointsBalance) || 0))
  if (cost > balance) {
    return { ok: false, reason: `This reward costs ${cost} points and the customer has ${balance}.` }
  }
  if (reward.type === 'free_item' && !lines.some((l) => l.itemId === reward.itemId)) {
    return { ok: false, reason: `Add ${reward.name || 'the free item'} to the order before redeeming this reward.` }
  }
  if (rewardDiscountCents(reward, lines) <= 0) {
    return { ok: false, reason: 'This reward takes nothing off the current order.' }
  }
  return { ok: true }
}
