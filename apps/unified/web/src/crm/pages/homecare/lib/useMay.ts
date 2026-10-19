// What this person may do in one home-care area, by the permissions the server checks (server/crm/homecare/**:
// requirePermission('care-billing:create') and so on). A screen shows a control only to someone the server will let
// use it — the template had two kinds of people (office, caregiver), so its screens never asked, and a seat that may
// read an area but not change it (the office manager on billing; any seat an owner grants read-only) was offered
// buttons that answered 403 (found in the browser, 2026-10-19).
import { usePermissions } from '../../../../shared'

export type CareArea = 'care-clients' | 'care-schedule' | 'evv' | 'care-billing' | 'care-payroll' | 'care-hr' | 'care-portal' | 'care-compliance'

export interface May { read: boolean; create: boolean; update: boolean; delete: boolean }

export function useMay(area: CareArea): May {
  const { can } = usePermissions()
  return { read: can(`${area}:read`), create: can(`${area}:create`), update: can(`${area}:update`), delete: can(`${area}:delete`) }
}
