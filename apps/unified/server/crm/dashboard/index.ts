// The owner's and the crew's home panels (both not ready): what needs the owner today and who is where; "my day" for the crew.
import type { Mount } from '../../http/registry.ts'
import type { CrmDeps } from '../deps.ts'
import { createOwnerDashboardRoutes } from './ownerDashboard.ts'
import { createCrewDashboardRoutes } from './crewDashboard.ts'

export function dashboardPanelMounts(d: CrmDeps): Mount[] {
  return [
    { path: '/api/owner-dashboard', access: 'user', feature: 'owner_dashboard', router: createOwnerDashboardRoutes(d) },
    { path: '/api/crew-dashboard', access: 'user', feature: 'crew_dashboard', router: createCrewDashboardRoutes(d) },
  ]
}
