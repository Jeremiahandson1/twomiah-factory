// Messaging economics (v2 pricing model).
//
//   ENABLE  = flat $10/mo — covers the line's monthly costs (the number's rental
//             + the A2P campaign fee, ~$3/mo) with room to spare. Billed on a
//             separate Stripe subscription line, NOT drawn from the wallet, and
//             those monthly costs are never charged again (owner, 2026-10-26).
//   AT COST = the one-time A2P registration and per-message segments — pass-
//             through, debited from the prepaid wallet at Twilio's real cost.
//
// ⚠️ CONFIRM EXACT 2026 TWILIO FEES before charging real money. These are
// Twilio's published-ballpark A2P numbers; each is env-overridable so you can
// set the precise figures (or the actual amounts Twilio invoices) without a
// code change. The whole point of the wallet is that these are pass-through —
// if Twilio's price moves, update the env, not the margin.

const int = (envKey: string, fallback: number): number => {
  const v = parseInt(process.env[envKey] || '', 10)
  return Number.isFinite(v) && v >= 0 ? v : fallback
}

// Flat monthly enable fee (the margin-bearing line). Dollars → cents.
export const MESSAGING_ENABLE_MONTHLY_CENTS = int('MESSAGING_ENABLE_MONTHLY_CENTS', 1000) // $10.00

// At-cost Twilio A2P / carrier figures, in cents.
export const TWILIO_COSTS = {
  // One-time registration = brand registration + campaign vetting.
  // Low-Volume Standard brand (Twilio's fee table of 2025-08-01: $4.50; services/a2p.ts registers that kind).
  brandRegistrationCents: int('TWILIO_A2P_BRAND_CENTS', 450),
  campaignVettingCents:   int('TWILIO_A2P_CAMPAIGN_VET_CENTS', 1500), // ~$15 one-time
  // Per outbound SMS segment: Twilio message price + carrier pass-through fee.
  perSegmentCents:        int('TWILIO_SMS_SEGMENT_CENTS', 1),      // ~$0.01/segment
}

/**
 * What a business needs in its wallet to start texting (owner, 2026-10-21: "if it costs 19.50 to get set up, then they
 * would need funds to use it too … it should be 25"): the one-time registration plus a little for its first texts.
 */
export const MESSAGING_START_CENTS = int('MESSAGING_START_CENTS', 2500)
/**
 * Auto-reload, the way Twilio bills its own customers: when the wallet can't cover a charge, the business's card on file
 * is charged this much (plus the card fee) and the wallet is credited when Stripe says it was paid — so a wallet does
 * not run up a debt Twomiah has already paid Twilio for.
 */
export const MESSAGING_RELOAD_CENTS = int('MESSAGING_RELOAD_CENTS', 2500)
/** Below this, the daily check reloads (or, with no card, emails the owner). */
export const MESSAGING_LOW_CENTS = int('MESSAGING_LOW_CENTS', 200)

// Total one-time A2P registration cost debited from the wallet at submit time.
export function a2pRegistrationCostCents(): number {
  return TWILIO_COSTS.brandRegistrationCents + TWILIO_COSTS.campaignVettingCents
}

// ── AI usage (same shape as SMS: $10/mo enable + tokens at cost) ──────────────
export const AI_ENABLE_MONTHLY_CENTS = int('AI_ENABLE_MONTHLY_CENTS', 1000) // $10.00

// At-cost Claude token rates, cents per 1,000,000 tokens, keyed by model family
// (verified against claude.com/pricing 2026-07). The CRMs call Haiku 4.5 AND
// Sonnet 4/4.6, so a flat rate would badly undercharge Sonnet — we price each
// call by its actual model (the metering reports the real model per call).
// Metering uses the response's usage.input_tokens/output_tokens, so the newer-
// tokenizer (~30% more tokens on Sonnet 5/Opus 4.7+) is already captured.
type Rate = { in: number; out: number }
const AI_MODEL_RATES: Array<{ match: RegExp; rate: Rate }> = [
  { match: /haiku-?4/,          rate: { in: 100,  out: 500 } },   // Haiku 4.5  $1 / $5
  { match: /haiku-?3/,          rate: { in: 80,   out: 400 } },   // Haiku 3.5  $0.80 / $4
  { match: /sonnet/,            rate: { in: 300,  out: 1500 } },  // Sonnet 4/4.5/4.6/5  $3 / $15
  { match: /opus-?4[.-]?[5-9]/, rate: { in: 500,  out: 2500 } },  // Opus 4.5–4.8  $5 / $25
  { match: /opus/,              rate: { in: 1500, out: 7500 } },  // Opus 4/4.1  $15 / $75
  { match: /fable|mythos/,      rate: { in: 1000, out: 5000 } },  // Fable/Mythos 5  $10 / $50
]
// Unknown/unmatched model → conservative Sonnet-tier default (never undercharge
// a mystery model); overridable via env.
const AI_DEFAULT_RATE: Rate = { in: int('AI_INPUT_PER_MTOK_CENTS', 300), out: int('AI_OUTPUT_PER_MTOK_CENTS', 1500) }

function aiRateForModel(model?: string): Rate {
  const m = (model || '').toLowerCase()
  for (const r of AI_MODEL_RATES) if (r.match.test(m)) return r.rate
  return AI_DEFAULT_RATE
}

// Per-call cost in whole cents, priced by the actual model. Sub-cent calls round
// to nearest (many tiny calls average out). Shares the messaging wallet.
export function aiCostCents(inputTokens: number, outputTokens: number, model?: string): number {
  const rate = aiRateForModel(model)
  const cents = (Math.max(0, inputTokens) / 1e6) * rate.in
    + (Math.max(0, outputTokens) / 1e6) * rate.out
  return Math.round(cents)
}
