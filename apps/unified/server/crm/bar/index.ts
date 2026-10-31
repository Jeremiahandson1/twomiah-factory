// Bar: the modules templates/crm-bar has and the base CRM doesn't, each behind the feature its index.ts
// gated it with (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the features decide who sees them.
//
// The template's index.ts mounted /api/bar, /api/register, /api/grill, /api/gift-cards, /api/loyalty, /api/stock,
// /api/schedule and /api/public/bar with no prefix gate; every action carried its own requireEnabledFeature (kept,
// inside each router). The mounts add the same gates at the door, so a switched-off module is closed at both: /api/bar
// on either of its two features (bar_menu, bar_tonight), the rest on the one each router's actions all ask.
//
// Private parties (crm-bar's routes/events.ts, eventSpaces.ts, menuPackages.ts) are byte-identical to the restaurant's
// and are mounted once by server/crm/restaurant (restaurantMounts), for every vertical with the features.
//
// /api/loyalty is the salon's programme unless the vertical says it is the bar's (CrmSettings.loyalty: 'bar'): one path,
// one router.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createBarServices } from './services.ts'
import { createBarRoutes } from './barRoutes.ts'
import { createBarPublicRoutes } from './barPublicRoutes.ts'
import { createBarRegisterRoutes } from './barRegisterRoutes.ts'
import { createBarGiftCardRoutes } from './barGiftCardRoutes.ts'
import { createBarLoyaltyRoutes } from './barLoyaltyRoutes.ts'
import { createBarStockRoutes } from './barStockRoutes.ts'
import { createBarScheduleRoutes } from './barScheduleRoutes.ts'
import { createBarTipRoutes } from './barTipRoutes.ts'
import { createBarTipSourceRoutes, createBarTipSourceReturnRoutes } from './barTipSourceRoutes.ts'
import { createBarFoodRoutes } from './barFoodRoutes.ts'
import { createBarFoodPublicRoutes } from './barFoodPublicRoutes.ts'

export function barMounts(d: CrmDeps): Mount[] {
  const bar = createBarServices(d)
  // Timed work, hourly like the events module's, started with the CRM's other jobs (never in a test, which calls the passes itself):
  //   · a shift swap or pick-up whose shift is about to start is ended (restaurant-bar parity #10);
  Object.assign(d.services.eventJobs, {
    runShiftExpiry: (now?: Date) => bar.staffRequests.runExpiry(now, (companyId) => d.features.isFeatureEnabled(companyId, 'bar_shift_swaps')),
  })
  d.services.addJob(() => {
    const expiry = () => bar.staffRequests.runExpiry(new Date(), (companyId) => d.features.isFeatureEnabled(companyId, 'bar_shift_swaps')).catch((err: any) => d.logger.error('[schedule] swap expiry failed', { error: err?.message }))
    setTimeout(expiry, 210_000)
    setInterval(expiry, 60 * 60 * 1000)
  })
  //   · tonight's and last night's tips are read from the venue's Toast or Square (restaurant-bar parity #17).
  Object.assign(d.services.eventJobs, {
    runTipImport: (now?: Date) => bar.tipSources.runImports(now ?? new Date(), (companyId) => d.features.isFeatureEnabled(companyId, 'bar_tip_import')),
  })
  d.services.addJob(() => {
    const pass = () => bar.tipSources.runImports(new Date(), (companyId) => d.features.isFeatureEnabled(companyId, 'bar_tip_import')).catch((err: any) => d.logger.error('[tips] import from another register failed', { error: err?.message }))
    setTimeout(pass, 330_000)
    setInterval(pass, 60 * 60 * 1000)
  })
  const { registerRoutes, kitchenRoutes } = createBarRegisterRoutes(d, bar)
  return [
    { path: '/api/bar', access: 'user', feature: ['bar_menu', 'bar_tonight'], router: createBarRoutes(d, bar) },
    { path: '/api/register', access: 'user', feature: 'bar_register', router: registerRoutes },
    { path: '/api/grill', access: 'user', feature: 'bar_register', router: kitchenRoutes },
    { path: '/api/gift-cards', access: 'user', feature: 'gift_cards', router: createBarGiftCardRoutes(d, bar) },
    { path: '/api/stock', access: 'user', feature: 'bar_stock', router: createBarStockRoutes(d, bar) },
    { path: '/api/schedule', access: 'user', feature: 'bar_schedule', router: createBarScheduleRoutes(d, bar) },
    { path: '/api/tips', access: 'user', feature: 'bar_tip_pooling', router: createBarTipRoutes(d, bar) },
    { path: '/api/tip-sources', access: 'user', feature: 'bar_tip_import', router: createBarTipSourceRoutes(d, bar) },
    // No sign-in: Square sends the browser back here after the owner allows it; the signed state proves it is ours.
    { path: '/api/tip-sources-return', access: 'public', feature: 'bar_tip_import', router: createBarTipSourceReturnRoutes(d, bar) },
    ...(d.settings?.loyalty === 'bar' ? [{ path: '/api/loyalty', access: 'user' as const, feature: 'loyalty_rewards', router: createBarLoyaltyRoutes(d, bar) }] : []),
    // No sign-in: public fields only, read by the bar's website server. Each path answers 404 with its feature off.
    { path: '/api/public/bar', access: 'public', router: createBarPublicRoutes(d, bar) },
    // Food service (the restaurant has it too): Register Settings, the card reader, refunds, receipts — and a receipt's
    // own page by its private link.
    { path: '/api/food', access: 'user', feature: ['bar_register', 'card_reader', 'order_kiosk', 'online_ordering'], router: createBarFoodRoutes(d, bar) },
    { path: '/api/public/food', access: 'public', router: createBarFoodPublicRoutes(d, bar) },
  ]
}
