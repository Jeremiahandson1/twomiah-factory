// Landscaping: the modules templates/crm-landscaping has and the base CRM doesn't, each behind the feature its index.ts
// gated it with (docs/UNIFIED_MOVE_GUIDE.md, step 3e). Served to every vertical; the features decide who sees them (the
// registry offers recurring_routes, area_pricing and snow_billing to landscaping only).
//
// /api/sites was ungated in the template. Its only screens are the property pickers on Snow Billing, Area Pricing and
// the Route Board, each gated by its feature, so the API is gated on any of the three (gate both sides).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createRecurringRouteRoutes } from './recurringRoutes.ts'
import { createRouteBillingRoutes } from './routeBilling.ts'
import { createRainDayRoutes } from './rainDay.ts'
import { createAreaPricingRoutes } from './areaPricing.ts'
import { createMeasurePrintRoutes, MEASURE_PRINT_FEATURE } from './measurePrint.ts'
import { photoMarkupMounts } from '../roof/photoMarkup/index.ts'
import { createCrewDayRoutes } from './crewDay.ts'
import { autoStartFromForecast } from '../../data/snowForecast.ts'
import { landscapingSetting } from '../../db/schema/index.ts'
import { createSnowBillingRoutes } from './snowBilling.ts'
import { createSnowStormRoutes } from './snowStorm.ts'
import { createVisitReportRoutes } from './visitReports.ts'
import { createVisitFeedbackRoutes } from './visitFeedback.ts'
import { createSiteRoutes } from './sites.ts'
import { topUpRouteVisits } from '../../data/routeVisits.ts'

export function landscapingMounts(d: CrmDeps): Mount[] {
  // Route visits keep themselves four weeks ahead: a minute after boot, then every 6 hours, for each company with the Route Board on.
  // Timed work: started with the CRM's at boot, never in tests (data/routeVisits.ts topUpRouteVisits).
  d.services.addJob(() => {
    const tick = () => topUpRouteVisits(d.db, { enabled: (companyId) => d.features.isFeatureEnabled(companyId, 'recurring_routes') })
      .then((r) => { if (r.length) d.logger.info('[routes] visits topped up', { routes: r.length, visits: r.reduce((n, x) => n + x.made, 0) }) })
      .catch((err: any) => d.logger.error('[routes] visit top-up failed', { error: err?.message }))
    setTimeout(() => { void tick() }, 60_000)
    // Row 30: a storm started on its own from the forecast — only for a business that turned it on (and has snow_tools), every three hours.
    const snowTick = async () => {
      try {
        const { eq } = await import('drizzle-orm')
        const { companyTimeZone, storeDayRange } = await import('@twomiah/tenant-backend')
        const on: any[] = await d.db.select({ companyId: landscapingSetting.companyId }).from(landscapingSetting).where(eq(landscapingSetting.snowAutoStart, true))
        for (const r of on) {
          if (!(await d.features.isFeatureEnabled(r.companyId, 'snow_tools')) || !(await d.features.isFeatureEnabled(r.companyId, 'snow_billing'))) continue
          const tz = await companyTimeZone(d.db, r.companyId)
          const out = await autoStartFromForecast(d.db, r.companyId, tz, storeDayRange(tz).date)
          if (out.started) d.logger.info('[snow] storm started from the forecast', { companyId: r.companyId, stormId: out.started.id, made: (out as any).made })
        }
      } catch (err: any) { d.logger.error('[snow] forecast check failed', { error: err?.message }) }
    }
    setInterval(() => { void snowTick() }, 3 * 3600_000)
    setInterval(() => { void tick() }, 6 * 3600_000)
  })
  return [
    // Billing the route's visits (preview, the monthly run and its undo, one visit). Mounted BEFORE the board's own router, so
    // /api/recurring-routes/billing/... is never read as a route id.
    { path: '/api/recurring-routes/billing', access: 'user', feature: 'recurring_routes', router: createRouteBillingRoutes(d) },
    // Rain day: push a day's jobs forward and text the customers. Before the board's router for the same reason.
    { path: '/api/recurring-routes/rain-day', access: 'user', feature: 'recurring_routes', router: createRainDayRoutes(d) },
    { path: '/api/recurring-routes', access: 'user', feature: 'recurring_routes', router: createRecurringRouteRoutes(d) },
    { path: '/api/area-pricing', access: 'user', feature: 'area_pricing', router: createAreaPricingRoutes(d) },
    { path: '/api/measure-print', access: 'user', feature: MEASURE_PRINT_FEATURE, router: createMeasurePrintRoutes(d) },
    // Storm mode, before the snow router so /api/snow/storms is never read as an id.
    { path: '/api/snow/storms', access: 'user', feature: 'snow_billing', router: createSnowStormRoutes(d) },
    { path: '/api/snow', access: 'user', feature: 'snow_billing', router: createSnowBillingRoutes(d) },
    // The visit-done message: the crew's note and after-photos, and what the customer was sent. NOT READY (hidden feature).
    { path: '/api/visit-reports', access: 'user', feature: 'visit_reports', router: createVisitReportRoutes(d) },
    // Row 31: the customer's rating from the message's link — PUBLIC (the signed link is the key); visit_survey is read per link.
    { path: '/api/visit-feedback', access: 'public', router: createVisitFeedbackRoutes(d) },
    // The crew's day on the phone and the office's side of it (parity rows 11–15): each route asks its own not-ready switch too.
    { path: '/api/crew-day', access: 'user', feature: 'recurring_routes', router: createCrewDayRoutes(d) },
    // Drawing on a visit's photos from the phone (landscaping parity row 9; roofing's photo_markup, not ready). Roofing mounts the same
    // route itself (crm/roof/index.ts), so it is mounted here only where roofing's add-on is not.
    ...(d.settings?.roof ? [] : photoMarkupMounts(d)),
    { path: '/api/sites', access: 'user', feature: ['snow_billing', 'area_pricing', 'recurring_routes'], router: createSiteRoutes(d) },
  ]
}
