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
import { createBookBlockRoutes } from './bookBlocks.ts'
import { createIntakeFormRoutes } from './intakeForms.ts'
import { createSalonCommissions } from './commissions.ts'
import { createServiceRecordRoutes } from './serviceRecords.ts'
import { createMembershipRoutes } from './memberships.ts'
import { createLoyaltyRoutes } from './loyalty.ts'
import { createReminderRoutes } from './reminders.ts'
import { createCardOnFileRoutes } from './cardOnFile.ts'
import { createMemberCardRoutes } from './cardPages.ts'
import { createSalonDashboardRoutes } from './dashboard.ts'
import { company } from '../../db/schema/index.ts'
import { Hono } from 'hono'
import { pricesOnlyForMoneySeats } from './prices.ts'
import { canSeeWith } from '../deps.ts'

// One set of services per app (the routers and the dashboard share it).
const built = new WeakMap<object, SalonServices>()
export const salonServicesFor = (d: CrmDeps): SalonServices => {
  let s = built.get(d.db)
  if (!s) { s = createSalonServices(d); built.set(d.db, s) }
  return s
}

/** One timed pass: every business with Memberships on has its due renewals billed (claimed, once per period). */
export async function settleMembershipsForAll(d: CrmDeps) {
  const s = salonServicesFor(d)
  let billed = 0
  for (const co of await d.db.select({ id: company.id }).from(company)) {
    if (!(await d.features.isFeatureEnabled(co.id, 'salon_memberships'))) continue
    billed += (await s.memberships.settleMembershipBilling(co.id).catch((e: any) => { d.logger.error('[memberships] timed billing failed', { company: co.id, error: e?.message }); return [] })).length
  }
  return billed
}

/** /api/dashboard for a salon (CrmSettings.dashboard 'salon'). */
export const createSalonDashboard = (d: CrmDeps) => createSalonDashboardRoutes(d, salonServicesFor(d))

/**
 * `settings` decides who owns the two shared paths: /api/appointments and /api/reminders are the vet's book and recall
 * where CrmSettings.appointments is 'practice', /api/loyalty is the bar's where CrmSettings.loyalty is 'bar', and
 * /api/clients is home care's where CrmSettings.homecare is on.
 */
export function salonMounts(d: CrmDeps, settings: CrmSettings): Mount[] {
  const s = salonServicesFor(d)
  const salonBook = settings.appointments !== 'practice'
  // Prices go only to a seat that reads invoices (./prices.ts): every salon router that carries one answers through this.
  const priced = (router: Hono<any>): Hono<any> => { const g = new Hono<any>(); g.use('*', pricesOnlyForMoneySeats(canSeeWith(d.permissions))); g.route('/', router); return g }
  // Memberships renew on their own (the help said "renewals are billed as they come due", and they were billed only when
  // someone opened the list or pressed Run billing): every 6 hours, for each business with Memberships on, the same
  // claimed, once-per-period settle the list runs (./membershipBilling.ts). Boot only, never in tests.
  if (salonBook) d.services.addJob(() => {
    const tick = () => settleMembershipsForAll(d)
    setTimeout(() => { void tick() }, 5 * 60_000)
    setInterval(() => { void tick() }, 6 * 3600_000)
  })
  // Stylist commissions: the stylist of a paid visit earns by themselves (not ready: owner tests it first).
  const commissions = createSalonCommissions(d)
  d.services.useCommissionEarner?.({ earn: commissions.earnForInvoice, sweep: commissions.sweep })
  // A client's card saved on Stripe's own page arrives as a connected-account event: the salon's cards claim it.
  d.services.useConnectedEvents?.(s.cards.claim)
  // The card an online booking waited for: saved, so the booking stands (booking/engine.ts cardSaved).
  d.services.bookingCard.cards = s.cards
  s.cards.onSaved(async ({ companyId, metadata }) => { if (metadata.booking_token) await d.services.bookingCard.confirm?.(companyId, metadata.booking_token) })
  return [
    // /api/clients is home care's people in care where CrmSettings.homecare is on (server/crm/homecare/clients).
    ...(settings.homecare ? [] : [{ path: '/api/clients', access: 'user', feature: 'client_profiles', router: priced(createClientRoutes(d, s)) } as Mount]),
    { path: '/api/service-menu', access: 'user', feature: 'service_menu', router: priced(createServiceMenuRoutes(d)) },
    { path: '/api/service-records', access: 'user', feature: ['client_profiles', 'salon_booking'], router: priced(createServiceRecordRoutes(d, s)) },
    { path: '/api/memberships', access: 'user', feature: 'salon_memberships', router: priced(createMembershipRoutes(d, s)) },
    ...(salonBook ? [
      { path: '/api/appointments', access: 'user', feature: 'salon_booking', router: priced(createAppointmentRoutes(d, s)) },
      // Blocked time (lunch, training) in the Book's time grid (not ready: owner tests it first).
      { path: '/api/book-blocks', access: 'user', feature: 'book_grid', router: createBookBlockRoutes(d, s) },
      // Intake and consent forms the salon builds, answered on a booking's page and shown on the client's chart (not ready).
      { path: '/api/intake-forms', access: 'user', feature: 'intake_forms', router: createIntakeFormRoutes(d) },
      { path: '/api/reminders', access: 'user', feature: 'rebooking_reminders', router: priced(createReminderRoutes(d, s)) },
    ] as Mount[] : []),
    // Cards on file and no-show / late-cancel fees (not ready: owner tests it first).
    ...(salonBook ? [{ path: '/api/card-on-file', access: 'user', feature: 'card_on_file', router: priced(createCardOnFileRoutes(d, s.cards, s.book)) } as Mount] : []),
    // The paused member's private card page, linked from the email (404 while Card on file is off).
    ...(salonBook ? [{ path: '/api/member-card', access: 'public', feature: 'card_on_file', router: createMemberCardRoutes(d, s.cards) } as Mount] : []),
    ...(settings.loyalty ? [] : [{ path: '/api/loyalty', access: 'user', feature: 'loyalty_rewards', router: createLoyaltyRoutes(d) } as Mount]),
  ]
}
