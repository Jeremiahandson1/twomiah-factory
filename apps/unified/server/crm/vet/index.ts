// Veterinary: the modules templates/crm-vet has and the base CRM doesn't, each behind a feature (docs/UNIFIED_MOVE_GUIDE.md,
// step 3e). Served to every vertical; the features decide who sees them. The template's index.ts mounted all eight
// ungated, so each takes its screen's menu gate (templates/crm-vet/frontend/src/shellConfig.ts); visits, vaccinations,
// prescriptions and lab results have no menu item of their own — they live on the patient's chart, 'patient_records'.
//
// /api/appointments and /api/reminders are also the salon's paths (templates/crm-salon), so each is mounted once:
// the practice's where the vertical's CrmSettings.appointments says 'practice', the salon's otherwise.
import type { Mount } from '../../http/registry.ts'
import type { CrmSettings } from '../../core/vertical.ts'
import type { CrmDeps } from '../deps.ts'
import { createPatientRoutes } from './patients.ts'
import { createVetAppointmentRoutes } from './appointments.ts'
import { createVisitRoutes } from './visits.ts'
import { createVaccinationRoutes } from './vaccinations.ts'
import { createPrescriptionRoutes } from './prescriptions.ts'
import { createLabResultRoutes } from './labResults.ts'
import { createWellnessPlanRoutes } from './wellnessPlans.ts'
import { createReminderRoutes } from './reminders.ts'
import { createVaccineReminders } from './vaccineReminders.ts'
import { createWellnessBillingService } from './wellnessBillingService.ts'
import { company } from '../../db/schema/index.ts'

/** One timed pass: every practice with Wellness Plans on has its due renewals billed (claimed, once per period). */
export async function settleWellnessForAll(d: CrmDeps) {
  const wellness = createWellnessBillingService(d.db)
  let billed = 0
  for (const co of await d.db.select({ id: company.id }).from(company)) {
    if (!(await d.features.isFeatureEnabled(co.id, 'wellness_plans'))) continue
    billed += (await wellness.settle(co.id).catch((e: any) => { d.logger.error('[wellness] timed billing failed', { company: co.id, error: e?.message }); return [] })).length
  }
  return billed
}

export function vetMounts(d: CrmDeps, settings: CrmSettings): Mount[] {
  // The practice's automatic vaccine reminders, hourly on each clinic's own switch and clock (./vaccineReminders.ts).
  // Timed work: started with the CRM's at boot, never in tests.
  if (settings.appointments === 'practice') {
    const vaccineReminders = createVaccineReminders({ db: d.db, sms: d.services.sms, logger: d.logger, isFeatureEnabled: d.features.isFeatureEnabled })
    d.services.addJob(() => vaccineReminders.start())
    // Wellness plans renew on their own (they were billed only when the enrolments were read or Run billing pressed):
    // every 6 hours, for each practice with Wellness Plans on, the same claimed, once-per-period settle.
    d.services.addJob(() => {
      const tick = () => settleWellnessForAll(d)
      setTimeout(() => { void tick() }, 6 * 60_000)
      setInterval(() => { void tick() }, 6 * 3600_000)
    })
  }
  return [
    { path: '/api/patients', access: 'user', feature: 'patient_records', router: createPatientRoutes(d) },
    { path: '/api/visits', access: 'user', feature: 'patient_records', router: createVisitRoutes(d) },
    { path: '/api/vaccinations', access: 'user', feature: 'patient_records', router: createVaccinationRoutes(d) },
    // Prescriptions and Lab Results are their own switches (Settings › Features): off, their APIs refuse and the chart's tabs go.
    { path: '/api/prescriptions', access: 'user', feature: 'prescriptions', router: createPrescriptionRoutes(d) },
    { path: '/api/lab-results', access: 'user', feature: 'lab_results', router: createLabResultRoutes(d) },
    { path: '/api/wellness-plans', access: 'user', feature: 'wellness_plans', router: createWellnessPlanRoutes(d) },
    ...(settings.appointments === 'practice' ? [
      { path: '/api/appointments', access: 'user', feature: 'appointment_scheduling', router: createVetAppointmentRoutes(d) },
      { path: '/api/reminders', access: 'user', feature: 'reminders_recall', router: createReminderRoutes(d) },
    ] satisfies Mount[] : []),
  ]
}
