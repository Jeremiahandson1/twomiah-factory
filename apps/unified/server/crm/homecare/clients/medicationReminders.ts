// /api/medication-reminders — the agency's choices for dose reminders (care_medication_reminders, not ready): on/off, how many
// minutes before a dose the caregiver is told, and how long after a visit the office waits before it is told of a dose that
// was never recorded. The dose times themselves are set on each medicine (PUT /api/medications/:id { doseTimes }).
// Gated by the feature in the mount, and by care-clients permissions on each action.
import { Hono } from 'hono'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { GRACE_CHOICES, LEAD_CHOICES } from '../core/medicationReminders.ts'
import { body, who } from './shared.ts'

export function createMedicationReminderRoutes(core: HomecareCore, d: CrmDeps) {
  const app = new Hono<AppEnv>()
  const { requirePermission } = d.permissions
  const choices = { leadChoices: [...LEAD_CHOICES], graceChoices: [...GRACE_CHOICES] }

  app.get('/settings', requirePermission('care-clients:read'), async (c) => one(c, { ...(await core.medicationReminders.settings(who(c).companyId)), ...choices }))

  // PUT /settings { enabled?, leadMinutes?, officeGraceMinutes? }
  app.put('/settings', requirePermission('care-clients:update'), async (c) => {
    const b = await body(c)
    if (b.leadMinutes !== undefined && !(LEAD_CHOICES as readonly number[]).includes(Number(b.leadMinutes))) return fail(c, 400, 'Pick 0, 5, 10, 15 or 30 minutes before the dose.', 'bad_lead', { leadMinutes: 'Pick from the list' })
    if (b.officeGraceMinutes !== undefined && !(GRACE_CHOICES as readonly number[]).includes(Number(b.officeGraceMinutes))) return fail(c, 400, 'Pick 15, 30, 60, 120 or 240 minutes.', 'bad_grace', { officeGraceMinutes: 'Pick from the list' })
    if (b.enabled !== undefined && typeof b.enabled !== 'boolean') return fail(c, 400, 'enabled must be true or false.', 'bad_enabled', { enabled: 'Switch it on or off' })
    const next = await core.medicationReminders.setSettings(who(c).companyId, { enabled: b.enabled, leadMinutes: b.leadMinutes, officeGraceMinutes: b.officeGraceMinutes })
    return one(c, { ...next, ...choices })
  })

  return app
}
