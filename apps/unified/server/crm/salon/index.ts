// Salon: the modules templates/crm-salon has and the base CRM doesn't, each behind the feature its index.ts gated it
// with (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the features decide who sees them.
//
// Gates: memberships and loyalty carry the template's index.ts gates (salon_memberships, loyalty_rewards). The template
// mounted clients, the service menu, the book, service records and reminders ungated; each screen is gated in its menu
// (shellConfig.ts), so each API is gated the same: client_profiles, service_menu, salon_booking, rebooking_reminders.
// Service records have no screen of their own — they are written from the client chart and the book — so either of
// those features opens them.
//
// The salon's dashboard is /api/dashboard's answer for a salon (CrmSettings.dashboard 'salon', wired in
// modules/crm.ts), and its appointment reminders start at boot from crm/services.ts.
import type { Mount } from '../../http/registry.ts'
import type { CrmSettings } from '../../core/vertical.ts'
import type { CrmDeps } from '../deps.ts'
import { createSalonServices, type SalonServices } from './services.ts'
import { createClientRoutes } from './clients.ts'
import { createServiceMenuRoutes } from './serviceMenu.ts'
import { createAppointmentRoutes } from './appointments.ts'
import { createServiceRecordRoutes } from './serviceRecords.ts'
import { createMembershipRoutes } from './memberships.ts'
import { createLoyaltyRoutes } from './loyalty.ts'
import { createReminderRoutes } from './reminders.ts'
import { createSalonDashboardRoutes } from './dashboard.ts'

// One set of services per app (the routers and the dashboard share it).
const built = new WeakMap<object, SalonServices>()
export const salonServicesFor = (d: CrmDeps): SalonServices => {
  let s = built.get(d.db)
  if (!s) { s = createSalonServices(d); built.set(d.db, s) }
  return s
}

/** /api/dashboard for a salon (CrmSettings.dashboard 'salon'). */
export const createSalonDashboard = (d: CrmDeps) => createSalonDashboardRoutes(d, salonServicesFor(d))

/**
 * `settings` decides who owns the two shared paths: /api/appointments and /api/reminders are the vet's book and recall
 * where CrmSettings.appointments is 'practice', and /api/loyalty is the bar's where CrmSettings.loyalty is 'bar'.
 */
export function salonMounts(d: CrmDeps, settings: CrmSettings): Mount[] {
  const s = salonServicesFor(d)
  const salonBook = settings.appointments !== 'practice'
  return [
    { path: '/api/clients', access: 'user', feature: 'client_profiles', router: createClientRoutes(d, s) },
    { path: '/api/service-menu', access: 'user', feature: 'service_menu', router: createServiceMenuRoutes(d) },
    { path: '/api/service-records', access: 'user', feature: ['client_profiles', 'salon_booking'], router: createServiceRecordRoutes(d, s) },
    { path: '/api/memberships', access: 'user', feature: 'salon_memberships', router: createMembershipRoutes(d, s) },
    ...(salonBook ? [
      { path: '/api/appointments', access: 'user', feature: 'salon_booking', router: createAppointmentRoutes(d, s) },
      { path: '/api/reminders', access: 'user', feature: 'rebooking_reminders', router: createReminderRoutes(d, s) },
    ] as Mount[] : []),
    ...(settings.loyalty ? [] : [{ path: '/api/loyalty', access: 'user', feature: 'loyalty_rewards', router: createLoyaltyRoutes(d) } as Mount]),
  ]
}
