// Nightly re-tiering, for the one customer an event-driven recompute can never reach.
//
// Tiers are earned over a rolling window (utils/loyaltyTier.ts). Every point event already
// recomputes the member's tier on the spot — a sale, a refund, a manual adjustment, a referral, a
// challenge reward — so anyone still shopping is always correct the instant it matters, and the
// register never shows a stale tier at the moment a discount is applied.
//
// The gap is the customer who STOPS. Their window slides past their last purchase and nothing
// happens, because nothing happened. Without this pass, a tier could only ever expire for people
// who are still active — precisely backwards. Once a day is the right cadence: the window is twelve
// months, so a tier that is one day late to expire costs nothing.
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { sweepCompanyTiers } from '../utils/loyaltyTier.ts'

const INTERVAL_MS = 24 * 60 * 60 * 1000
// Not on the boot itself: a deploy restarts the process, and a tenant that redeploys often should
// not pay for a full sweep every time. Five minutes in, the app is serving and the pass is free.
const FIRST_RUN_DELAY_MS = 5 * 60 * 1000

export async function sweepLoyaltyTiers(): Promise<{ companies: number; failed: number }> {
  const companies = await db.select({ id: company.id }).from(company)
  let failed = 0
  for (const co of companies) {
    // One tenant's bad settings must not stop the rest of the sweep.
    try {
      await sweepCompanyTiers(db, co.id)
    } catch (err: any) {
      failed++
      console.warn('[loyalty] tier sweep failed for company', co.id, '-', err?.message || err)
    }
  }
  return { companies: companies.length, failed }
}

export function startLoyaltyTierSweep(): void {
  const tick = () => sweepLoyaltyTiers()
    .then(({ companies, failed }) => {
      if (companies) console.log(`[loyalty] tier sweep: ${companies - failed}/${companies} companies re-tiered`)
    })
    .catch((e) => console.warn('[loyalty] tier sweep pass failed:', e?.message || e))

  setTimeout(tick, FIRST_RUN_DELAY_MS)
  setInterval(tick, INTERVAL_MS)
}
