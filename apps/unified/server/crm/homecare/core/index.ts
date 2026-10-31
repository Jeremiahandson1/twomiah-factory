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
import { createCertReminders } from './certReminders.ts'
import { createMedicationReminders } from './medicationReminders.ts'
import { createVisitQuestions } from './visitQuestions.ts'
import { createVisitItems } from './visitItems.ts'
import { createVisitSignature } from './visitSignature.ts'
import { createTaskReport } from './taskReport.ts'
import { createFamilyTexts } from './familyTexts.ts'
import { createRequiredTasks } from './requiredTasks.ts'
import { createSupervisory } from './supervisory.ts'
import { createMargin } from './margin.ts'
import { createCsvImport } from './csvImport.ts'
import { createAutopay } from './autopay.ts'
import { createLtc } from './ltc.ts'
import { createOfflineSaves } from './offlineSaves.ts'
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
  const margin = createMargin(d, { invoices })
  const csvImport = createCsvImport(d, { time })
  const ltc = createLtc(d)

  // Hiring and onboarding.
  const staffEmails = createStaffEmails(d, { profile })
  const eligibility = createEligibilityEngine(d, { profile })
  const onboarding = createOnboardingPackets(d, { profile, staffEmails })
  const applications = createApplicationIntake(d)

  // Background work (started by startJobs, never here).
  const reminders = createShiftReminders(d, { time, notify })
  const overtime = createOvertimeAlerts(d, { time, profile, notify })
  const certReminders = createCertReminders(d, { time, notify })
  const medicationReminders = createMedicationReminders(d, { time, notify })
  const visitQuestions = createVisitQuestions(d, { notify })
  const visitItems = createVisitItems(d)
  const autopay = createAutopay(d, { invoices, time, notify, email })
  const offlineSaves = createOfflineSaves(d, { time, notify })
  const visitSignature = createVisitSignature(d, { offlineSaves })
  const taskReport = createTaskReport(d, { time })
  const familyTexts = createFamilyTexts(d, { time, notify, profile })
  const requiredTasks = createRequiredTasks(d, { time })
  const supervisory = createSupervisory(d, { time })
  const visitJobs = createVisitJobs(d, { reminders, overtime, certReminders, medicationReminders, autopay })
  const worcsPoll = createWorcsPoll(d, { eligibility, staffEmails, profile })

  return {
    time, profile, features, mileage,
    auth, tokens, access, careAudit, portalLock,
    schedules, prefs, notify, medications, vitals,
    email,
    sandata, evvWeekly, autoSubmit, evvVisits, portalClaimDays, visitRecord, careTaskMinutes, carePlanSchedule, incidentPdf,
    invoices, claims, payroll, margin, csvImport, autopay, ltc, offlineSaves,
    staffEmails, eligibility, onboarding, applications,
    reminders, overtime, certReminders, medicationReminders, visitQuestions, visitItems, visitSignature, taskReport, familyTexts, requiredTasks, supervisory, worcsPoll,
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

const built = new WeakMap<object, HomecareCore>()

/**
 * Home care's foundation for this app: built once per app, so every route group shares one set of instances. Keyed by
 * the app's CRM services (one object per app), not the CrmDeps wrapper: the behaviour suite's sandbox builds its own
 * CrmDeps around the same services (tests/unified/harness/runUnifiedSuite.ts crmDeps), and its test seams
 * (__setWorcsSubmitForTests …) must reach the instance the routes use.
 */
export function createHomecareCore(d: CrmDeps): HomecareCore {
  const key: object = d.services ?? d
  let core = built.get(key)
  if (!core) { core = buildHomecareCore(d); built.set(key, core) }
  return core
}
