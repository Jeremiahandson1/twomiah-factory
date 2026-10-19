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

export function barMounts(d: CrmDeps): Mount[] {
  const bar = createBarServices(d)
  const { registerRoutes, kitchenRoutes } = createBarRegisterRoutes(d, bar)
  return [
    { path: '/api/bar', access: 'user', feature: ['bar_menu', 'bar_tonight'], router: createBarRoutes(d, bar) },
    { path: '/api/register', access: 'user', feature: 'bar_register', router: registerRoutes },
    { path: '/api/grill', access: 'user', feature: 'bar_register', router: kitchenRoutes },
    { path: '/api/gift-cards', access: 'user', feature: 'gift_cards', router: createBarGiftCardRoutes(d, bar) },
    { path: '/api/stock', access: 'user', feature: 'bar_stock', router: createBarStockRoutes(d, bar) },
    { path: '/api/schedule', access: 'user', feature: 'bar_schedule', router: createBarScheduleRoutes(d, bar) },
    ...(d.settings?.loyalty === 'bar' ? [{ path: '/api/loyalty', access: 'user' as const, feature: 'loyalty_rewards', router: createBarLoyaltyRoutes(d, bar) }] : []),
    // No sign-in: public fields only, read by the bar's website server. Each path answers 404 with its feature off.
    { path: '/api/public/bar', access: 'public', router: createBarPublicRoutes(d, bar) },
  ]
}
