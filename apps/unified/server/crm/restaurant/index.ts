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
import { createEventSettingsRoutes } from './eventSettings.ts'
import { createEventMinimumRoutes } from './eventMinimums.ts'
import { createEventCalendarRoutes, createEventWaitlistRoutes, createEventFeedRoutes } from './eventCalendar.ts'
import { createEventReportRoutes } from './eventReports.ts'
import { createEventProposalRoutes, createProposalLinkRoutes, previewContract } from './eventProposals.ts'
import { createEventContractRoutes } from './eventContracts.ts'
import { createEventPaymentRoutes, createEventPayLinkRoutes, startEventPaymentJobs, runPaymentReminders, runAutopay } from './eventPayments.ts'
import { runGuaranteeReminders } from './eventGuarantee.ts'

export function restaurantMounts(d: CrmDeps): Mount[] {
  Object.assign(d.services.eventJobs, {
    runGuaranteeReminders: (now?: Date) => runGuaranteeReminders(d, now),
    runPaymentReminders: (now?: Date, opts?: { fromHour?: number }) => runPaymentReminders(d, now, opts),
    runAutopay: (now?: Date) => runAutopay(d, now),
  })
  // The reminders and the day's card charges, hourly, started with the CRM's other timed work (never in a test).
  d.services.addJob(() => {
    startEventPaymentJobs(d)
    const guarantee = () => runGuaranteeReminders(d).catch((err: any) => d.logger.error('[events] guarantee reminders failed', { error: err?.message }))
    setTimeout(guarantee, 120_000)
    setInterval(guarantee, 6 * 60 * 60 * 1000)
  })
  return [
    { path: '/api/events', access: 'user', feature: 'event_bookings', router: createEventRoutes(d) },
    { path: '/api/event-spaces', access: 'user', feature: 'event_spaces', router: createEventSpaceRoutes(d) },
    { path: '/api/menu-packages', access: 'user', feature: 'catering_menus', router: createMenuPackageRoutes(d) },
    { path: '/api/import/events', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'events') },
    { path: '/api/import/spaces', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'spaces') },
    { path: '/api/import/menus', access: 'user', feature: 'event_bookings', router: createVenueImportRoutes(d, 'menus') },
    // Depth (docs/parity/restaurant-*.md): each behind its own not-ready feature as well as the events one.
    { path: '/api/event-settings', access: 'user', feature: 'event_bookings', router: createEventSettingsRoutes(d) },
    { path: '/api/event-minimums', access: 'user', feature: 'event_minimums', router: createEventMinimumRoutes(d) },
    { path: '/api/event-calendar', access: 'user', feature: 'event_calendar', router: createEventCalendarRoutes(d) },
    { path: '/api/event-waitlist', access: 'user', feature: 'event_calendar', router: createEventWaitlistRoutes(d) },
    { path: '/api/event-feed', access: 'public', feature: 'event_calendar', router: createEventFeedRoutes(d) },
    { path: '/api/event-reports', access: 'user', feature: 'event_reports', router: createEventReportRoutes(d) },
    { path: '/api/event-proposals', access: 'user', feature: 'event_proposals', router: createEventProposalRoutes(d) },
    { path: '/api/proposal-links', access: 'public', feature: 'event_proposals', router: createProposalLinkRoutes(d) },
    { path: '/api/event-contracts', access: 'user', feature: 'event_contracts', router: createEventContractRoutes(d, (companyId, eventId, body) => previewContract(d.db, companyId, eventId, body)) },
    { path: '/api/event-payments', access: 'user', feature: 'event_payment_automation', router: createEventPaymentRoutes(d) },
    { path: '/api/event-pay', access: 'public', feature: 'event_payment_automation', router: createEventPayLinkRoutes(d) },
  ]
}
