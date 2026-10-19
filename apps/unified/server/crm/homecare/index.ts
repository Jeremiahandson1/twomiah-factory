// Home care: the add-on (docs/UNIFIED_HOMECARE_PLAN.md) — its route groups register here, each behind the registry's
// home-care features; ./core holds the helpers and services they share.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createHomecareCore } from './core/index.ts'
import { clientsMounts } from './clients/index.ts'
import { schedulingMounts } from './scheduling/index.ts'
import { planningMounts } from './planning/index.ts'
import { visitsMounts } from './visits/index.ts'
import { billingMounts } from './billing/index.ts'
import { payrollMounts } from './payroll/index.ts'
import { hrMounts } from './hr/index.ts'
import { portalsMounts } from './portals/index.ts'
import { officeMounts } from './office/index.ts'

/**
 * The home-care add-on's mounts, for a vertical that has it (CrmSettings.homecare). Its timed work — shift reminders
 * and over-visit texts every 5 minutes, the WORCS poll every 30 for Wisconsin agencies — is registered here and
 * started with the CRM's (services.startJobs, at boot, never in tests).
 */
export function homecareMounts(d: CrmDeps): Mount[] {
  if (!d.settings?.homecare) return []
  const core = createHomecareCore(d)
  d.services.addJob(() => core.startJobs())
  // Each group's routes, from its own folder (one owner per folder while they move).
  return [
    ...clientsMounts(core, d),
    ...schedulingMounts(core, d),
    ...planningMounts(core, d),
    ...visitsMounts(core, d),
    ...billingMounts(core, d),
    ...payrollMounts(core, d),
    ...hrMounts(core, d),
    ...portalsMounts(core, d),
    ...officeMounts(core, d),
  ]
}
