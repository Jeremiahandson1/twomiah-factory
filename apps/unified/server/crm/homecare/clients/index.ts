// Home care — clients and care: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{clients,carePlans,carePlanTemplates,careTasks,careTypes,medications,adl,clientDocuments,insuranceCards,forms,documents,emergency,serviceCodes,referralSources,prospects,prospectAppointments}.ts.
//
// Every router is a signed-in one ('user'): the template gated none of them on a feature, and they are mounted only for
// the home-care vertical. Each action checks its own permission (care-clients, and care-schedule / evv / care-billing
// where the action is the schedule's, a visit's or a rate's). /api/documents is home care's document store; the CRM's
// shared document module is not mounted for this vertical (server/modules/crm.ts).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createClientAccess } from './shared.ts'
import { createClientRoutes } from './clients.ts'
import { createCarePlanRoutes } from './carePlans.ts'
import { createCarePlanTemplateRoutes } from './carePlanTemplates.ts'
import { createCareTaskRoutes } from './careTasks.ts'
import { createCareTypeRoutes } from './careTypes.ts'
import { createMedicationRoutes } from './medications.ts'
import { createAdlRoutes } from './adl.ts'
import { createClientDocumentRoutes } from './clientDocuments.ts'
import { createInsuranceCardRoutes } from './insuranceCards.ts'
import { createFormRoutes } from './forms.ts'
import { createDocumentRoutes } from './documents.ts'
import { createEmergencyRoutes } from './emergency.ts'
import { createServiceCodeRoutes } from './serviceCodes.ts'
import { createReferralSourceRoutes } from './referralSources.ts'
import { createProspectRoutes, createProspectAppointmentRoutes } from './prospects.ts'

export function clientsMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  const access = createClientAccess(core, d)
  return [
    { path: '/api/clients', access: 'user', router: createClientRoutes(core, d, access) },
    { path: '/api/care-plans', access: 'user', router: createCarePlanRoutes(core, d, access) },
    { path: '/api/care-plan-templates', access: 'user', router: createCarePlanTemplateRoutes(core, d) },
    { path: '/api/care-tasks', access: 'user', router: createCareTaskRoutes(core, d, access) },
    { path: '/api/care-types', access: 'user', router: createCareTypeRoutes(d) },
    { path: '/api/medications', access: 'user', router: createMedicationRoutes(core, d, access) },
    { path: '/api/adl', access: 'user', router: createAdlRoutes(core, d, access) },
    { path: '/api/client-documents', access: 'user', router: createClientDocumentRoutes(core, d, access) },
    { path: '/api/insurance-cards', access: 'user', router: createInsuranceCardRoutes(core, d) },
    { path: '/api/forms', access: 'user', router: createFormRoutes(core, d, access) },
    { path: '/api/documents', access: 'user', feature: 'documents', router: createDocumentRoutes(core, d, access) }, // the Documents switch (Settings › Features): off, the agency's Documents page, its files and caregivers' signing go together
    { path: '/api/emergency', access: 'user', router: createEmergencyRoutes(core, d, access) },
    { path: '/api/service-codes', access: 'user', router: createServiceCodeRoutes(d) },
    { path: '/api/referral-sources', access: 'user', router: createReferralSourceRoutes(d) },
    { path: '/api/prospects', access: 'user', router: createProspectRoutes(core, d) },
    { path: '/api/prospect-appointments', access: 'user', router: createProspectAppointmentRoutes(d) },
  ]
}
