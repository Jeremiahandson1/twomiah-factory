// The owner's daily low-stock email (store_low_stock, 2026-10-30): everything at or under its level, once a day, and no
// email on a day with nothing low. Replaces the first design (one email per crossing) at the owner's word.
//
// The sweep runs hourly (./index.ts) and sends from 8am by the SHOP's clock. The day's send is claimed in one statement
// (data/storeCatalog.ts claimLowStockDigest), so two sweeps at once send one email, and a sweep that finds nothing low
// claims nothing — if something runs low later the same day, the next sweep sends it then. Never throws.
import { companyRowTimeZone } from '@twomiah/tenant-backend'
import { eq } from 'drizzle-orm'
import { company } from '../../db/schema/index.ts'
import { claimLowStockDigest, lowStockItems } from '../../data/storeCatalog.ts'
import type { CrmDeps } from '../deps.ts'
import type { StoreCore } from './core.ts'
import { siteBase } from './checkout/checkoutService.ts'

/** The hour of the shop's day the email is first sent. */
export const DIGEST_HOUR = 8

/** The shop-local date (YYYY-MM-DD) and hour for an instant. */
export function shopClock(timeZone: string, now: Date): { day: string; hour: number } {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(now).map((p) => [p.type, p.value]))
  return { day: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) }
}

export function createLowStockDigest(d: Pick<CrmDeps, 'db' | 'logger' | 'features'>, core: StoreCore) {
  /** One pass. 'sent' | 'nothing_low' | 'already_sent' | 'too_early' | 'off' | 'no_owner_email'. */
  async function sweep(now = new Date()): Promise<string> {
    try {
      const co = await core.shop()
      if (!co) return 'off'
      if (!(await d.features.isFeatureEnabled(co.id, 'store_low_stock'))) return 'off'
      if (!co.email) return 'no_owner_email'
      const [row] = await d.db.select().from(company).where(eq(company.id, co.id)).limit(1)
      const { day, hour } = shopClock(companyRowTimeZone(row), now)
      if (hour < DIGEST_HOUR) return 'too_early'
      const items = await lowStockItems(d.db, co.id)
      if (!items.length) return 'nothing_low'
      await core.settings(co.id) // the settings row the claim is stamped on
      if (!(await claimLowStockDigest(d.db, co.id, day))) return 'already_sent'
      void core.mail(co.email, 'storeLowStockDigest', { items, productsUrl: `${siteBase()}/crm/products?filter=low_stock` })
      return 'sent'
    } catch (err: any) {
      d.logger.warn('[store] low-stock email failed', { error: err?.message })
      return 'failed'
    }
  }
  return { sweep }
}
