// Private events (restaurants, venues, bars): the modules templates/crm-restaurant has and the base CRM doesn't, each
// behind the feature its screen is gated by (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the
// features decide who sees them.
//
// templates/crm-bar carries byte-identical copies of the same files (routes/events.ts, eventSpaces.ts, menuPackages.ts,
// dashboard.ts, services/eventBooking.ts, eventLedger.ts, the venue import) and the same features (event_bookings,
// event_spaces, catering_menus — the registry offers them to crm-restaurant and crm-bar). These mounts are the bar's
// too: a vertical gets them by having the features, and the events dashboard and hooks by CrmSettings
// (`dashboard: 'events'`, `events: true`). Nothing here should be mounted a second time.
//
// The template's index.ts mounted /api/events, /api/event-spaces and /api/menu-packages with no feature gate (each in a
// try/catch that only logged a mount failure); its sidebar gates each screen by its feature (shellConfig.ts), so the
// API is gated the same: both sides. The venue import was ungated too (admin/owner by role); its Settings › Import
// types are gated by event_bookings, so its three paths are.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createEventRoutes } from './events.ts'
import { createEventSpaceRoutes } from './eventSpaces.ts'
import { createMenuPackageRoutes } from './menuPackages.ts'
import { createVenueImportRoutes } from './eventImport.ts'

export function restaurantMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/events', access: 'user', feature: 'event_bookings', router: createEventRoutes(d) },
    { path: '/api/event-spaces', access: 'user', feature: 'event_spaces', router: createEventSpaceRoutes(d) },
    { path: '/api/menu-packages', access: 'user', feature: 'catering_menus', router: createMenuPackageRoutes(d) },
    { path: '/api/import/events', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'events') },
    { path: '/api/import/spaces', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'spaces') },
    { path: '/api/import/menus', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'menus') },
  ]
}
