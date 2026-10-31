// Field work: takeoffs, selections, job costing, routing, maps, geofencing, weather, payroll.
//
// Feature gates: takeoffs, selections and job costing carry the gate the template's index.ts put on them. Routing,
// maps and weather were ungated in the template and no screen in any copy, web or mobile, calls them: each is gated
// on its feature (RULEBOOK §6), so a business without it — a salon, a vet, a website — cannot reach it. Geofencing is
// gps_tracking's (the mobile app posts /api/geofencing/location). Payroll was ungated in the template, but its only
// screen (the Pay run panel) is on the Time screen, which the sidebar gates on time_tracking, so the API is gated the same.
//
// The customer portal needs the selections service the template exported: createSelectionsService (./selectionsService.ts).
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createTakeoffsRoutes } from './takeoffs.ts'
import { createSelectionsRoutes } from './selections.ts'
import { createJobCostingRoutes } from './jobCosting.ts'
import { createReceivablesRoutes, createWipRoutes } from './reportsDepth.ts'
import { createRoutingRoutes } from './routing.ts'
import { createDayRouteRoutes } from './dayRoute.ts'
import { createMapsRoutes, createMapCenterRoutes } from './maps.ts'
import { createGeofencingRoutes } from './geofencing.ts'
import { createWeatherRoutes } from './weather.ts'
import { createPayrollRoutes } from './payroll.ts'
import { createJobReminderRoutes } from './jobReminderRoutes.ts'
import { createTeamRevenueRoutes } from './teamReportRoutes.ts'
import { createPlanReports } from './planReportRoutes.ts'
import { createAvailabilityRoutes } from './availabilityRoutes.ts'
import { createChecklistRoutes } from './checklistRoutes.ts'
import { createClockExtras } from './clockExtras.ts'
import { createJobConfirm } from './jobConfirm.ts'

export { createSelectionsService, type SelectionsService } from './selectionsService.ts'

export function fieldMounts(d: CrmDeps): Mount[] {
  // The clock, finished (clockExtras.ts): its settings, overtime alerts, automatic timekeeping from the job's moments, the kiosk.
  const clockExtras = createClockExtras(d)
  d.services.onJobMoment(clockExtras.automaticStep)
  d.services.eventJobs.overtimePass = async (now?: Date) => (await clockExtras.overtimePass(now)).alerts
  d.services.addJob(() => { setTimeout(() => { void clockExtras.overtimePass() }, 90_000); setInterval(() => { void clockExtras.overtimePass() }, 5 * 60_000) })
  // A customer confirms a visit: by the link in a reminder, in the portal, or by texting Y / C back (jobConfirm.ts).
  // Plan Reports, finished: the tabs, filters, chosen columns and CSV, and saved reports that email themselves on a schedule.
  const planReports = createPlanReports(d)
  d.services.eventJobs.savedReportsPass = async (now?: Date) => planReports.saved.pass(now)
  d.services.addJob(() => { setTimeout(() => { void planReports.saved.pass() }, 120_000); setInterval(() => { void planReports.saved.pass() }, 15 * 60_000) })
  const jobConfirm = createJobConfirm(d)
  d.services.useSmsReply((m) => jobConfirm.onReply(m))
  return [
    { path: '/api/takeoffs', access: 'user', feature: 'takeoff_tools', router: createTakeoffsRoutes(d) },
    { path: '/api/selections', access: 'user', feature: 'selections', router: createSelectionsRoutes(d) },
    { path: '/api/job-costing', access: 'user', feature: 'job_costing', router: createJobCostingRoutes(d) },
    // Reports a builder buys on (reportsDepth.ts): who owes what and how late, and where each open piece of work stands.
    { path: '/api/receivables', access: 'user', feature: 'ar_aging', router: createReceivablesRoutes(d) },
    { path: '/api/wip', access: 'user', feature: 'wip_report', router: createWipRoutes(d) },
    { path: '/api/routing', access: 'user', feature: 'route_optimization', router: createRoutingRoutes(d) },
    // One person's day in the best order, for the Schedule's lanes and the Dispatch Board: every vertical with jobs
    // (dayRoute.ts), gated as the jobs are.
    { path: '/api/day-route', access: 'user', feature: 'jobs', router: createDayRouteRoutes(d) },
    { path: '/api/maps', access: 'user', feature: 'map_view', router: createMapsRoutes(d) },
    // Where a new map opens (the business's address or service area): every map screen's, so no one map's feature.
    { path: '/api/map-center', access: 'user', router: createMapCenterRoutes(d) },
    { path: '/api/geofencing', access: 'user', feature: 'gps_tracking', router: createGeofencingRoutes(d) },
    // Time Clock settings, overtime, the kiosk (crm/field/clockExtras.ts): part of Time Tracking.
    { path: '/api/time-clock', access: 'user', feature: 'time_tracking', router: clockExtras.routes },
    // The forecast for a job or a project, and the weather filled into a daily log.
    { path: '/api/weather', access: 'user', feature: ['jobs', 'projects', 'daily_logs'], router: createWeatherRoutes(d) },
    // The reminder before a job the office booked: its settings (crm/field/jobReminders.ts runs the timed pass). Not ready.
    // The link in a reminder: public, the token is the key and opens one visit. It checks the Job Reminders feature itself.
    { path: '/api/visit-confirm', access: 'public', router: jobConfirm.routes },
    { path: '/api/job-reminders', access: 'user', feature: 'job_reminders', router: createJobReminderRoutes(d) },
    // Revenue and quote conversion by person, and the service-plan reports (server/data/teamReports.ts). Not ready.
    { path: '/api/team-revenue', access: 'user', feature: 'team_revenue_reports', router: createTeamRevenueRoutes(d) },
    { path: '/api/plan-reports/saved', access: 'user', feature: 'plan_reports', router: planReports.savedRoutes },
    { path: '/api/plan-reports', access: 'user', feature: 'plan_reports', router: planReports.routes },
    // When each tech works and is away (crm/field/availabilityRoutes.ts); jobs.ts warns when a job is given outside it. Not ready.
    { path: '/api/availability', access: 'user', feature: 'tech_availability', router: createAvailabilityRoutes(d) },
    // The checklists a business builds per job type, filled in on the phone and signed on site (crm/field/checklistRoutes.ts). Not ready.
    { path: '/api/checklists', access: 'user', feature: 'job_checklists', router: createChecklistRoutes(d) },
    // Home care's /api/payroll is its own pay run (server/crm/homecare/payroll/payroll.ts), so this one stands aside there.
    ...(d.settings?.homecare ? [] : [{ path: '/api/payroll', access: 'user' as const, feature: 'time_tracking', router: createPayrollRoutes(d) }]),
  ]
}
