// Home care's foundation (docs/UNIFIED_HOMECARE_PLAN.md, "How the code moves", step 1): the helpers, services, jobs and
// middleware of templates/crm-homecare/backend/src that the routes share, each built ONCE here from the app's CrmDeps
// so every route group uses the same instances (the same caches, the same test seams, the same timers).
//
//   const core = createHomecareCore(d)       // in any route group's factory; the same object for the same `d`
//   core.time.today(user.companyId)
//   core.access.requireClientAccess('clientId')
//
// Pure modules (no state, no database) are imported directly from their files (./punchRules.ts, ./biweekly.ts …);
// the SQL fragments the route groups compose are in server/data/homecareCore.ts. Nothing here starts a timer:
// startJobs() does, once, at boot.
import type { CrmDeps } from '../../deps.ts'
import { createAgencyTime } from './agencyTime.ts'
import { createAgencyProfile } from './agencyProfile.ts'
import { createAgencyFeatures } from './agencyFeatures.ts'
import { createMileageRate } from './mileageRate.ts'
import { createCareAudit } from './careAudit.ts'
import { createCaregiverAccess } from './caregiverAccess.ts'
import { createPortalLock } from './portalLock.ts'
import { createHomecareAuth } from './auth.ts'
import { createTokenRevocation } from './tokenRevocation.ts'
import { createScheduleRows } from './scheduleRows.ts'
import { createNotificationPrefs } from './notificationPrefs.ts'
import { createVisitNotify } from './visitNotify.ts'
import { createMedicationsOnFile } from './medicationsOnFile.ts'
import { createVitals } from './vitals.ts'
import { createShiftReminders } from './shiftReminders.ts'
import { createOvertimeAlerts } from './overtimeAlerts.ts'
import { createVisitJobs } from './visitJobs.ts'
import { homecareTemplates, homecareEmail } from './messages.ts'
import { createStaffEmails } from './staffEmails.ts'
import { createEligibilityEngine } from './eligibilityEngine.ts'
import { createOnboardingPackets } from './onboardingPackets.ts'
import { createApplicationIntake } from './applicationIntake.ts'
import { createWorcsPoll } from './worcsPoll.ts'
import { createSandataClient } from './sandataClient.ts'
import { createEvvWeekly } from './evvWeekly.ts'
import { createSandataAutoSubmit } from './sandataAutoSubmit.ts'
import { createEvvVisits } from './evvVisits.ts'
import { createPortalClaimDays } from './portalClaimDays.ts'
import { createVisitRecord } from './visitRecord.ts'
import { createCareTaskMinutes } from './careTaskMinutes.ts'
import { createCarePlanSchedule } from './carePlanSchedule.ts'
import { createInvoiceEngine } from './invoiceEngine.ts'
import { createClaimsEngine } from './claimsEngine.ts'
import { createPayrollPay } from './payrollPay.ts'
import { createIncidentPdf } from './incidentPdf.ts'

// Home care's email messages are registered once per email service (register refuses a name twice).
const registered = new WeakSet<object>()

function buildHomecareCore(d: CrmDeps) {
  const mailer = d.services?.emailService
  if (mailer && !registered.has(mailer)) { mailer.register(homecareTemplates); registered.add(mailer) }
  const email = homecareEmail(mailer)

  // The agency (the signed-in person's company row).
  const time = createAgencyTime(d)
  const profile = createAgencyProfile(d)
  const features = createAgencyFeatures(d)
  const mileage = createMileageRate(d)

  // Sign-in, access and audit.
  const auth = createHomecareAuth(d)
  const tokens = createTokenRevocation(d)
  const access = createCaregiverAccess(d)
  const careAudit = createCareAudit(d)
  const portalLock = createPortalLock(d)

  // Schedules, notices, care records.
  const schedules = createScheduleRows(d)
  const prefs = createNotificationPrefs(d, time)
  const notify = createVisitNotify(d, prefs)
  const medications = createMedicationsOnFile(d)
  const vitals = createVitals(d)

  // Visits, EVV and Sandata.
  const sandata = createSandataClient(d)
  const evvWeekly = createEvvWeekly(d)
  const autoSubmit = createSandataAutoSubmit(d, { sandata })
  const evvVisits = createEvvVisits(d, { sandata, evvWeekly, autoSubmit })
  const portalClaimDays = createPortalClaimDays(d)
  const visitRecord = createVisitRecord(d, { time })
  const careTaskMinutes = createCareTaskMinutes(d, { time })
  const carePlanSchedule = createCarePlanSchedule(d, { time })
  const incidentPdf = createIncidentPdf(d, { time })

  // Billing, claims, payroll.
  const invoices = createInvoiceEngine(d, { time })
  const claims = createClaimsEngine(d)
  const payroll = createPayrollPay(d)

  // Hiring and onboarding.
  const staffEmails = createStaffEmails(d, { profile })
  const eligibility = createEligibilityEngine(d, { profile })
  const onboarding = createOnboardingPackets(d, { profile, staffEmails })
  const applications = createApplicationIntake(d)

  // Background work (started by startJobs, never here).
  const reminders = createShiftReminders(d, { time, notify })
  const overtime = createOvertimeAlerts(d, { time, profile, notify })
  const visitJobs = createVisitJobs(d, { reminders, overtime })
  const worcsPoll = createWorcsPoll(d, { eligibility, staffEmails, profile })

  return {
    time, profile, features, mileage,
    auth, tokens, access, careAudit, portalLock,
    schedules, prefs, notify, medications, vitals,
    email,
    sandata, evvWeekly, autoSubmit, evvVisits, portalClaimDays, visitRecord, careTaskMinutes, carePlanSchedule, incidentPdf,
    invoices, claims, payroll,
    staffEmails, eligibility, onboarding, applications,
    reminders, overtime, worcsPoll,
    /** Live updates (the template's services/socket.ts): the app's realtime. */
    live: { emitToCompany: d.realtime.emitToCompany, emitToUser: d.realtime.emitToUser, EVENTS: d.realtime.EVENTS },
    /** The app's audit log (the template's services/audit.ts): log, diff, ACTIONS, ENTITIES. */
    audit: d.audit,
    /** Home care's timed work, started once at boot (not in tests). */
    startJobs() {
      // Shift reminders + over-visit-length texts, every 5 minutes (off under NODE_ENV=test, VISIT_JOBS_DISABLED=1).
      visitJobs.start()
      // WORCS results, every 30 minutes, only when a company is in Wisconsin (off under NODE_ENV=test, WORCS_POLL_DISABLED=true).
      worcsPoll.start().catch((err: any) => d.logger.error('[worcsPoll] failed to start', { error: err?.message }))
    },
    /** Stops what startJobs started (tests, shutdown). */
    stopJobs() {
      visitJobs.stop()
      worcsPoll.stop()
    },
  }
}

export type HomecareCore = ReturnType<typeof buildHomecareCore>

const built = new WeakMap<CrmDeps, HomecareCore>()

/** Home care's foundation for this app: built once per CrmDeps, so every route group shares one set of instances. */
export function createHomecareCore(d: CrmDeps): HomecareCore {
  let core = built.get(d)
  if (!core) { core = buildHomecareCore(d); built.set(d, core) }
  return core
}
