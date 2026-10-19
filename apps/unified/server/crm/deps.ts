// What every CRM module is built with: the app's database, sign-in, permissions, feature gates, audit, email, live
// updates and the CRM's shared services. One object, so a module's factory signature never grows a parameter list.
import type { Logger } from '../core/logger.ts'
import type { Realtime } from '../core/realtime.ts'
import type { CrmServices } from './services.ts'
import type { CrmSettings } from '../core/vertical.ts'

export interface CrmDeps {
  db: any
  audit: any
  logger: Logger
  /** The sign-in check. A 'user' mount already has it applied by the registry; a public mount with private paths uses it. */
  authenticate: any
  /** requirePermission, requireAnyPermission, hasPermission, getExtraPermissions, roleLabel… (shared auth/permissions). */
  permissions: any
  features: { requireEnabledFeature: (f: string | string[]) => any; isFeatureEnabled: (companyId: string, f: string | string[]) => Promise<boolean>; enabledFeaturesFor: (companyId: string) => Promise<string[]> }
  realtime: Realtime
  services: CrmServices
  /** The vertical's switches (VerticalSettings.crm), for a module whose words or behaviour differ by vertical. */
  settings?: CrmSettings
}

/** May this person see `permission`, counting the grants the owner gave them by name? */
export const canSeeWith = (permissions: any) => async (role: string, permission: string, userId?: string) =>
  permissions.hasPermission(role, permission, await permissions.getExtraPermissions(userId))
