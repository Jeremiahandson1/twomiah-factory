// The home-care helpers and services the home-care tests import by the template's paths (src/services/*.ts,
// src/helpers/*.ts), each backed by the unified module that holds it now (server/crm/homecare/core), for the suite
// (homecare.ts) and its adapted copies (adapted.ts). `@app/` is apps/unified. Each route group adds the files its tests
// import, under its own comment.
export const HOMECARE_SANDBOX: Record<string, string> = {
  // billing group (billing.test.ts, r3-billing.test.ts): the invoice and claims engines' pure rules as they are; the
  // invoice engine's database calls in the template's shape — (db, …) with no company: the database's one company. The
  // rows they return are the unified engine's (camelCase).
  'src/services/invoiceEngine.ts': `
export * from '@app/server/crm/homecare/core/invoiceEngine.ts'
import { core, theCompany } from './hrCore.ts'
export const loadBillingClient = async (_db: unknown, clientId: string) => core.invoices.loadBillingClient(await theCompany(), clientId)
export const insertLineItems = async (_db: unknown, invoiceId: string, items: any[]) => core.invoices.insertLineItems(await theCompany(), invoiceId, items)
`,
  'src/services/claimsEngine.ts': `
export * from '@app/server/crm/homecare/core/claimsEngine.ts'
`,
  'src/services/authUnits.ts': `
export * from '@app/server/crm/homecare/core/authUnits.ts'
`,
  // The agency's clock: the pure date helpers as they are; agencyToday() and the rest are the database's one company's.
  'src/services/agencyTime.ts': `
export * from '@app/server/crm/homecare/core/agencyTime.ts'
import { core, theCompany } from './hrCore.ts'
export const agencyTimezone = async () => core.time.timezone(await theCompany())
export const agencyToday = async (tz?: string) => core.time.today(await theCompany(), tz)
export const agencyWeekStart = async () => core.time.weekStart(await theCompany())
`,
  // The scheduling group's authorization advice (server/crm/homecare/scheduling/shared.ts); r3-billing reads it.
  'src/helpers/authorizationCheck.ts': `
import { crmDeps } from '../services/crmDeps.ts'
import { theCompany } from '../services/hrCore.ts'
import { createSchedulingShared } from '@app/server/crm/homecare/scheduling/shared.ts'
const shared = createSchedulingShared(crmDeps)
export const checkAuthorizationBalance = async (clientId: string, shiftHours: number) => shared.checkAuthorizationBalance(await theCompany(), clientId, shiftHours)
`,
  // payroll group (r3pay.test.ts): the pay rules and the punch rules, pure.
  'src/services/payrollPay.ts': `
export * from '@app/server/crm/homecare/core/payrollPay.ts'
`,
  'src/helpers/punchRules.ts': `
export * from '@app/server/crm/homecare/core/punchRules.ts'
`,
  // hr group (staff.test.ts): the app's own home-care core — the SAME instance the routes use (createHomecareCore is
  // keyed by the app's CRM services, which crmDeps shares), so a test seam set here reaches the routes.
  'src/services/hrCore.ts': `
import { asc } from 'drizzle-orm'
import { crmDeps } from './crmDeps.ts'
import { createHomecareCore } from '@app/server/crm/homecare/core/index.ts'
import { company } from '@app/server/db/schema/index.ts'
export const core = createHomecareCore(crmDeps)
/** The database's one company (the template's one agency). */
export const theCompany = async (): Promise<string> =>
  (await crmDeps.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1))[0]?.id
`,
  'src/services/onboardingPackets.ts': `
export * from '@app/server/crm/homecare/core/onboardingPackets.ts'
import { core } from './hrCore.ts'
export const { __setWorcsSubmitForTests, awaitLastWorcsSubmission } = core.onboarding
`,
  'src/jobs/worcsPoll.ts': `
import { core } from '../services/hrCore.ts'
/** The template's runPollCycle() polls every agency's pending checks; so does the core's with no company. */
export const { runPollCycle, __setWorcsClientForTests } = core.worcsPoll
`,
  'src/services/eligibilityEngine.ts': `
import { core, theCompany } from './hrCore.ts'
/** The template's (worcs, state): the bar list is the one company's. */
export const evaluateWorcsResult = async (worcs: any, state?: string | null) => core.eligibility.evaluateWorcsResult(await theCompany(), worcs, state)
export const runEligibilityForCaregiver = async (caregiverId: string) => core.eligibility.runEligibilityForCaregiver(await theCompany(), caregiverId)
`,
  'src/services/tokenRevocation.ts': `
import { core } from './hrCore.ts'
export const { isStaffTokenRevoked, markUserLoggedOut, clearRevocationCache } = core.tokens
`,
  // staff.test.ts also reads the payroll group's payday rules from the route file, as the template exported them: the
  // router still forwards to the app; the rules are server/crm/homecare/payroll/payrollVerification.ts's, the pending
  // period the database's one company's.
  'src/routes/payrollVerification.ts': `
import { forward } from '../unified.ts'
import { crmDeps } from '../services/crmDeps.ts'
import { theCompany } from '../services/hrCore.ts'
import { createPaydayVerification } from '@app/server/crm/homecare/payroll/payrollVerification.ts'
export { todayIn, getCurrentPayPeriod } from '@app/server/crm/homecare/payroll/payrollVerification.ts'
export default forward()
const payday = createPaydayVerification(crmDeps)
export const pendingVerificationFor = async (caregiverId: string, today: string) => payday.pendingVerificationFor(await theCompany(), caregiverId, today)
`,
  // visits group (evv.test.ts, visits.test.ts): EVV, Sandata, the schedule engine, visit notices and the two scans —
  // the app's own core instance (hrCore.ts), each function in the template's shape: no company argument (the
  // database's one company), and the rows the template's callers pass in snake_case read as the camelCase rows the
  // unified modules take (camelInput).
  'src/services/visitsCore.ts': `
/** A template caller's row (snake_case keys) as the unified modules read it (camelCase). Values unchanged. */
export const camelInput = (o: any): any => o && typeof o === 'object' && !Array.isArray(o) && !(o instanceof Date)
  ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/_([a-z0-9])/g, (_m, ch) => ch.toUpperCase()), v]))
  : o
`,
  'src/services/sandataPayload.ts': `
import * as p from '@app/server/crm/homecare/core/sandataPayload.ts'
import { camelInput } from './visitsCore.ts'
export * from '@app/server/crm/homecare/core/sandataPayload.ts'
const bundle = (b: any) => ({ ...b, changes: Array.isArray(b?.changes) ? b.changes.map(camelInput) : b?.changes })
export const buildVisitPayload = (b: any) => p.buildVisitPayload(bundle(b))
export const validateVisitBundle = (b: any) => p.validateVisitBundle(bundle(b))
export const buildClientPayload = (c: any, opts: any) => p.buildClientPayload(camelInput(c), opts)
`,
  'src/services/sandataClient.ts': `
export * from '@app/server/crm/homecare/core/sandataClient.ts'
import { core, theCompany } from './hrCore.ts'
export const getConfig = async () => core.sandata.getConfig(await theCompany())
`,
  'src/services/evvWeekly.ts': `
import * as w from '@app/server/crm/homecare/core/evvWeekly.ts'
import { core, theCompany } from './hrCore.ts'
import { camelInput } from './visitsCore.ts'
export * from '@app/server/crm/homecare/core/evvWeekly.ts'
export const clientInSandata = (c: any) => w.clientInSandata(camelInput(c))
export const decideSandataRequired = async (clientId: string, atIso: string | null, opts: any) => core.evvWeekly.decideSandataRequired(await theCompany(), clientId, atIso, opts)
export const evvWeekUsage = async (clientId: string, atIso: string | null, opts: any) => core.evvWeekly.evvWeekUsage(await theCompany(), clientId, atIso, opts)
`,
  'src/services/evvVisits.ts': `
export * from '@app/server/crm/homecare/core/evvVisits.ts'
import { core, theCompany } from './hrCore.ts'
export const createEVVFromTimeEntry = async (timeEntryId: string) => core.evvVisits.createEVVFromTimeEntry(await theCompany(), timeEntryId)
export const recordVisitTimeChange = async (input: any) => core.evvVisits.recordVisitTimeChange(await theCompany(), input)
export const recordSandataDecision = async (entryId: string, clientId: string, atIso: string | null) => core.evvVisits.recordSandataDecision(await theCompany(), entryId, clientId, atIso)
`,
  'src/services/sandataAutoSubmit.ts': `
export * from '@app/server/crm/homecare/core/sandataAutoSubmit.ts'
import { core, theCompany } from './hrCore.ts'
const q = core.autoSubmit
export const fetchBundle = async (id: string) => q.fetchBundle(await theCompany(), id)
export const enqueueVisit = async (id: string) => q.enqueueVisit(await theCompany(), id)
export const pollPendingStatuses = async () => q.pollPendingStatuses(await theCompany())
export const requeueChangedVisit = async (id: string) => q.requeueChangedVisit(await theCompany(), id)
export const getQueueStatus = async () => q.getQueueStatus(await theCompany())
export const retrySubmission = async (id: string) => q.retrySubmission(await theCompany(), id)
export const { processQueue, processQueueAsync } = q
`,
  // The schedule engine: the template's occurrencesCte(from, to) expands the one agency's schedules — the database's
  // one company, named in SQL (runUnifiedSuite's sandbox_one_company()) because the CTE is built synchronously.
  'src/services/scheduleOccurrences.ts': `
import { sql } from 'drizzle-orm'
import { occurrencesCte as cte } from '@app/server/data/homecareCore.ts'
export * from '@app/server/crm/homecare/core/scheduleOccurrences.ts'
export { schedTime, wallClock } from '@app/server/data/homecareCore.ts'
export const occurrencesCte = (from: string, to: string, name = 'occ') => cte(sql\`sandbox_one_company()\` as any, from, to, name)
`,
  'src/services/visitNotify.ts': `
import { core } from './hrCore.ts'
export const { _setSmsSender, _setPushSender, _setExpoTransport, toE164, isExpoToken, OFFICE_ROLES, EXPO_PUSH_URL } = core.notify
// office group (integration.test.ts): the one door for caregiver alerts, and a push.
export const { sendCaregiverAlert, sendPush } = core.notify
`,
  'src/jobs/shiftReminders.ts': `
import { core } from '../services/hrCore.ts'
/** Every company's visits an hour away (the template's one agency). */
export const { scanShiftReminders } = core.reminders
`,
  'src/jobs/overtimeAlerts.ts': `
import { core } from '../services/hrCore.ts'
export const { scanOvertimeAlerts } = core.overtime
`,
  // office group (incidents.test.ts, fixes.test.ts): the incident packet's facts, and View As.
  'src/services/incidentPdf.ts': `
export * from '@app/server/crm/homecare/core/incidentPdf.ts'
import { core, theCompany } from './hrCore.ts'
/** The template's loadIncidentCase(db, id): the database's one company. */
export const loadIncidentCase = async (_db: unknown, id: string) => core.incidentPdf.loadIncidentCase(await theCompany(), id)
`,
  'src/middleware/viewAsReadOnly.ts': `
export * from '@app/server/crm/homecare/core/viewAsReadOnly.ts'
`,
  // office group (ai-receptionist.test.ts, integration.test.ts): the one feature writer, the agency's clock and
  // profile, and the care plan's visit text — each the database's one company.
  'src/services/agencyFeatures.ts': `
import { core } from './hrCore.ts'
export const { setAgencyFeatures } = core.features
`,
  // (src/services/agencyTime.ts is above, once: an object literal's second key replaced the first.)
  'src/services/agencyProfile.ts': `
import { core, theCompany } from './hrCore.ts'
export const getAgencyProfile = async () => core.profile.getAgencyProfile(await theCompany())
`,
  'src/services/carePlanSchedule.ts': `
import { core, theCompany } from './hrCore.ts'
export const getClientVisitSchedule = async (clientId: string) => core.carePlanSchedule.getClientVisitSchedule(await theCompany(), clientId)
`,
  // portals group (portal.test.ts, portal-visit-changes.test.ts): the send-side preference gate — the app's own
  // instance, so a save through the API invalidates the cache the test then reads — and "who serves this client now",
  // which the template exported from its routes/portal.ts (the router still forwards to the app). The rows come back
  // in the template's snake_case shape (caregiver_id …); the unified function answers camelCase.
  'src/services/notificationPrefs.ts': `
import { core } from './hrCore.ts'
export { inQuietHours, minutesOfDay, EVENT_COLUMN, CHANNEL_COLUMN } from '@app/server/crm/homecare/core/notificationPrefs.ts'
export const { shouldNotify, invalidate, getPrefs } = core.prefs
`,
  'src/routes/portal.ts': `
import { forward } from '../unified.ts'
import { crmDeps } from '../services/crmDeps.ts'
import { core, theCompany } from '../services/hrCore.ts'
import * as p from '@app/server/data/homecarePortals.ts'
export default forward()
const snake = (o: any) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k.replace(/[A-Z]/g, (ch) => '_' + ch.toLowerCase()), v]))
export const SERVING_WINDOW_DAYS = p.SERVING_WINDOW_DAYS
export const servesClient = async (caregiverId: string, clientId: string) => {
  const companyId = await theCompany()
  return p.servesClient(crmDeps.db, companyId, caregiverId, clientId, await core.time.today(companyId))
}
export const caregiversServingClient = async (clientId: string, withPhone: boolean) => {
  const companyId = await theCompany()
  return (await p.caregiversServingClient(crmDeps.db, companyId, clientId, await core.time.today(companyId), withPhone)).map(snake)
}
`,
  // r5-agency-clock.test.ts: the call volume report. Home care's copy of the service is the shared one
  // (server/crm/comms/calltrackingService.ts), switched by CrmSettings.callers ('clients': callers are clients, the
  // report on the agency's clock) — built here with the homecare vertical's switches, as server/modules/crm.ts does.
  'src/services/calltracking.ts': `
import { crmDeps } from './crmDeps.ts'
import { loadVertical } from '@app/server/core/vertical.ts'
import { createCalltrackingService } from '@app/server/crm/comms/calltrackingService.ts'
const svc: any = createCalltrackingService({ ...crmDeps, settings: (await loadVertical('homecare')).crm })
export const { createTrackingNumber, getTrackingNumbers, updateTrackingNumber, logCall, getCalls, getCall, updateCall, tagCallAsLead, handleCallRailWebhook, handleTwilioWebhook, getAttributionReport, getCallVolumeReport } = svc
export default svc
`,
  // popup-forms.test.ts reads the Payers form's field list and types from the payers route, as the template exported
  // them: the billing group's server/crm/homecare/billing/payers.ts (the router still forwards to the app).
  'src/routes/payers.ts': `
import { forward } from '../unified.ts'
export { PAYER_FIELDS, PAYER_TYPES } from '@app/server/crm/homecare/billing/payers.ts'
export default forward()
`,
}
