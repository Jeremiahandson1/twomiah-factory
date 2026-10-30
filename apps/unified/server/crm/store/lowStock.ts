// The owner's daily low-stock email for the STORE (store_low_stock, 2026-10-30): everything at or under its level, once a
// day, and no email on a day with nothing low. The rules live once, in ../lowStockDigest.ts, shared with the inventory
// module's digest; this is only what is store-specific — its switch, whom it mails (the shop's email), what is low (the
// options with a level) and the store's own email template.
import { lowStockItems, type LowStockItem } from '../../data/storeCatalog.ts'
import type { CrmDeps } from '../deps.ts'
import type { StoreCore } from './core.ts'
import { siteBase } from './checkout/checkoutService.ts'
import { createLowStockDigest as createDigest } from '../lowStockDigest.ts'

export { DIGEST_HOUR, shopClock } from '../lowStockDigest.ts'

export function createLowStockDigest(d: Pick<CrmDeps, 'db' | 'logger' | 'features'>, core: StoreCore) {
  return createDigest<LowStockItem>(d, {
    kind: 'store_low_stock_digest',
    feature: 'store_low_stock',
    items: (companyId) => lowStockItems(d.db, companyId),
    recipients: async (co) => (co.email ? [co.email] : []),
    send: async (to, items) => {
      // core.mail answers false (and never throws) when the email could not go: say so, so the day is given back.
      if (!(await core.mail(to, 'storeLowStockDigest', { items, productsUrl: `${siteBase()}/crm/products?filter=low_stock` }))) throw new Error('the email was not sent')
    },
  })
}
