// Home care — compliance, incidents, audit, sign-in and the shared modules: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{incidents,compliance,auditLogs,audit,auth,mfa,company,help,platformSupport,onboarding,account,failsafe,webhooks,leads,calltracking,aiReceptionist,ads,adsPublic,gbp,messagingBilling,emailAliases,emailDomain,inboundMessages,inboundParse,saasBilling}.ts.
//
// Mounted here, for the home-care vertical only (no feature: home care gated none of them):
//   /api/incidents          the incident case file                     (incidents.ts)
//   /api/compliance         the compliance dashboard, login activity    (compliance.ts)
//   /api/audit-logs         the clinical audit trail (and audit.ts's list) (auditLogs.ts)
//   /api/auth/users         the View As picker                          (signIn.ts)
//   (View As itself, /api/auth/impersonate, is every vertical's: server/core/viewAs.ts, mounted in server/app.ts.)
// The rest are the app's shared modules, which home care uses as every vertical does: sign-in and MFA (/api/auth,
// /api/auth/mfa-devices — with home care's View As and server-side sign-out wired into the app's authenticate,
// server/app.ts), the company (/api/company — home care's own columns through office/companyFields.ts), billing,
// account, email aliases and domain, leads, call tracking, the AI receptionist, ads, Google Business, inbound email,
// onboarding, messaging billing and Contact Twomiah. Not moved: routes/saasBilling.ts (the Factory's billing,
// modules/company.ts, replaces it), routes/webhooks.ts (the website is the same app; its enquiry goes straight into
// the CRM), routes/help.ts (the knowledge base and AI chat are /api/support's), routes/failsafe.ts (a stub that always
// answered an empty list) and routes/audit.ts (its list is GET /api/audit-logs?tableName=&userId=; /api/audit is the
// app's own audit log).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createIncidentRoutes } from './incidents.ts'
import { createComplianceRoutes } from './compliance.ts'
import { createAuditLogRoutes } from './auditLogs.ts'
import { createStaffPickerRoutes } from './signIn.ts'
import { createCsvImportRoutes } from './csvImport.ts'
import { createMigrationRoutes, createMigrationInternalRoutes } from './migration.ts'
import { asc } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'

export function officeMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  /** One company per tenant database (SPEC §2): the oldest row is the business (the same rule as server/app.ts). */
  const oneCompany = async (): Promise<string | null> => {
    const [row] = await d.db.select({ id: company.id }).from(company).orderBy(asc(company.createdAt)).limit(1)
    return row?.id ?? null
  }
  return [
    { path: '/api/incidents', access: 'user', router: createIncidentRoutes(core, d) },
    { path: '/api/compliance', access: 'user', router: createComplianceRoutes(d) },
    { path: '/api/audit-logs', access: 'user', router: createAuditLogRoutes(d) },
    { path: '/api/auth/users', access: 'user', router: createStaffPickerRoutes(d) },
    // item 1: CSV import of clients, caregivers and recurring shifts (not ready)
    { path: '/api/care-import', access: 'user', feature: 'care_import', router: createCsvImportRoutes(core, d) },
    // row 10: the assisted migration — the agency's door, and the Factory's (its staff run the same importer; the feature is checked inside)
    { path: '/api/care-migration', access: 'user', feature: 'care_migration', router: createMigrationRoutes(core, d) },
    { path: '/api/internal/care-migration', access: 'factory', router: createMigrationInternalRoutes(core, d, oneCompany) },
  ]
}
