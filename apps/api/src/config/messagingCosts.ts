// Messaging economics (v2 pricing model).
//
//   ENABLE  = flat $10/mo — carries the margin (number + integration). Billed on
//             a separate Stripe subscription line, NOT drawn from the wallet.
//   AT COST = A2P registration, monthly campaign fee, and per-message segments —
//             all pass-through, debited from the prepaid wallet at Twilio's real
//             cost, no markup.
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
  brandRegistrationCents: int('TWILIO_A2P_BRAND_CENTS', 400),      // ~$4 one-time
  campaignVettingCents:   int('TWILIO_A2P_CAMPAIGN_VET_CENTS', 1500), // ~$15 one-time
  // Recurring monthly campaign fee (Low-Volume Mixed is cheaper than Standard).
  monthlyCampaignCents:   int('TWILIO_A2P_CAMPAIGN_MONTHLY_CENTS', 200), // ~$2/mo
  // Per outbound SMS segment: Twilio message price + carrier pass-through fee.
  perSegmentCents:        int('TWILIO_SMS_SEGMENT_CENTS', 1),      // ~$0.01/segment
}

// Total one-time A2P registration cost debited from the wallet at submit time.
export function a2pRegistrationCostCents(): number {
  return TWILIO_COSTS.brandRegistrationCents + TWILIO_COSTS.campaignVettingCents
}
