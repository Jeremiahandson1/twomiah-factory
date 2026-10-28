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
}

// ── Money units ──────────────────────────────────────────────────────────────
// The wallet and its ledger are kept in HUNDREDTHS OF A CENT ("hc"; $1 = 10,000 hc), the finest unit Twilio quotes
// ($0.0083 = 83 hc), as whole integers — so a text costs exactly what it costs and thousands of them add up with no
// rounding. Everything else in the Factory speaks whole cents; HC_PER_CENT converts at the wallet's edge.
export const HC_PER_CENT = 100
export const HC_PER_DOLLAR = 10_000
export const centsToHc = (cents: number): number => Math.round(cents * HC_PER_CENT)
/** Hundredths of a cent → cents, possibly fractional (2499.57 = $24.9957). Exact: hc is an integer. */
export const hcToCents = (hc: number): number => hc / HC_PER_CENT

/** A dollar amount from the environment ("0.0083") → hc. Anything that is not a non-negative number is the fallback. */
const usdHc = (envKey: string, fallbackHc: number): number => {
  const v = parseFloat(process.env[envKey] || '')
  return Number.isFinite(v) && v >= 0 ? Math.round(v * HC_PER_DOLLAR) : fallbackHc
}

/**
 * What one outbound US text segment costs us, from Twilio's US SMS price page (checked 2026-10-27):
 *   Twilio's own price   $0.0083 per segment (every carrier)
 *   + the carrier's fee  AT&T $0.0035 · T-Mobile $0.0045 · Verizon $0.0050
 * Each is env-overridable in DOLLARS, so a price change is a setting, not a deploy:
 *   TWILIO_SMS_SEGMENT_USD, CARRIER_FEE_ATT_USD, CARRIER_FEE_TMOBILE_USD, CARRIER_FEE_VERIZON_USD,
 *   CARRIER_FEE_BLENDED_USD.
 *
 * WHICH carrier a text went through is not something the send tells us: Twilio's Message resource carries no carrier,
 * and a Lookup per text would cost more than the fee it settles. So a usage report that names the carrier is charged
 * that carrier's fee, and one that does not (today: every one) is charged the BLENDED fee — the plain average of the
 * three, $0.0043 (rounded to the hundredth of a cent), unless CARRIER_FEE_BLENDED_USD says otherwise. A blended text
 * is therefore up to 0.07¢ under or over its true cost; over many texts the difference is the carrier mix.
 */
const CARRIER_FEES_DEFAULT_HC = { att: 35, tmobile: 45, verizon: 50 }
export const SMS_PRICING = {
  checked: '2026-10-27',
  twilioSegmentHc: usdHc('TWILIO_SMS_SEGMENT_USD', 83),
  carrierFeeHc: {
    att:     usdHc('CARRIER_FEE_ATT_USD', CARRIER_FEES_DEFAULT_HC.att),
    tmobile: usdHc('CARRIER_FEE_TMOBILE_USD', CARRIER_FEES_DEFAULT_HC.tmobile),
    verizon: usdHc('CARRIER_FEE_VERIZON_USD', CARRIER_FEES_DEFAULT_HC.verizon),
  },
  blendedCarrierFeeHc: 0,
}
SMS_PRICING.blendedCarrierFeeHc = usdHc('CARRIER_FEE_BLENDED_USD',
  Math.round((SMS_PRICING.carrierFeeHc.att + SMS_PRICING.carrierFeeHc.tmobile + SMS_PRICING.carrierFeeHc.verizon) / 3))

export type SmsCarrier = keyof typeof CARRIER_FEES_DEFAULT_HC

/** Carrier names → one of the three the fee table prices (Sprint is T-Mobile now). Unknown → null (blended). */
export function normalizeCarrier(name?: unknown): SmsCarrier | null {
  const n = String(name ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!n) return null
  if (n.startsWith('att') || n.includes('cingular')) return 'att'
  if (n.includes('tmobile') || n.includes('sprint')) return 'tmobile'
  if (n.includes('verizon')) return 'verizon'
  return null
}

/** One segment, in hc: Twilio's price plus the named carrier's fee, or the blended fee when it is not named. */
export function smsSegmentHc(carrier?: unknown): number {
  const c = normalizeCarrier(carrier)
  return SMS_PRICING.twilioSegmentHc + (c ? SMS_PRICING.carrierFeeHc[c] : SMS_PRICING.blendedCarrierFeeHc)
}

/** What the Texting page shows: the blended price per segment and the range over the three carriers, in hc. */
export function smsPriceSummary() {
  const fees = Object.values(SMS_PRICING.carrierFeeHc).map((f) => SMS_PRICING.twilioSegmentHc + f)
  return {
    segmentHc: smsSegmentHc(), minHc: Math.min(...fees), maxHc: Math.max(...fees),
    twilioHc: SMS_PRICING.twilioSegmentHc, carrierFeeHc: SMS_PRICING.blendedCarrierFeeHc, checked: SMS_PRICING.checked,
  }
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

/** The same cost in hundredths of a cent — what the wallet is debited, so a sub-cent call is not rounded to 0 or 1¢. */
export function aiCostHc(inputTokens: number, outputTokens: number, model?: string): number {
  const rate = aiRateForModel(model)
  return Math.round(((Math.max(0, inputTokens) / 1e6) * rate.in + (Math.max(0, outputTokens) / 1e6) * rate.out) * HC_PER_CENT)
}

/** A tenants row wallet in cents (fractional when it holds part of a cent). */
export const walletCentsOf = (t: { messaging_wallet_hc?: unknown } | null | undefined): number => hcToCents(Number(t?.messaging_wallet_hc ?? 0))
