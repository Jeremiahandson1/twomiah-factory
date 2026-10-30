// Roofing's inspection report (roofing depth, gap 6): the office's routes and the private link's, both behind the one
// switch `inspection_reports` (not ready), so with it off neither exists — the link answers 404 like any other path.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createInspectionReportRoutes, createInspectionViewRoutes } from './routes.ts'

export function inspectionMounts(d: CrmDeps): Mount[] {
  const office = createInspectionReportRoutes(d)
  return [
    { path: '/api/inspection-reports', access: 'user', feature: 'inspection_reports', router: office.app },
    // Public: the homeowner or adjuster has no sign-in; the token in the address is the only key, and the switch still gates it.
    { path: '/api/inspection-report-view', access: 'public', feature: 'inspection_reports', router: createInspectionViewRoutes(d, office) },
  ]
}
