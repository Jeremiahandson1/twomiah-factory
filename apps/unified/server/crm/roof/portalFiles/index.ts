// Roofing's photos and documents shown to the homeowner (roofing depth, gap 10): the office's switches here, the
// customer's list in ./portal.ts (handed to the shared portal, modules/crm.ts). Behind `portal_job_files` (not ready).
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createJobFilesRoutes } from './office.ts'

export { roofPortalJobFiles } from './portal.ts'

export function portalFilesMounts(d: CrmDeps): Mount[] {
  return [{ path: '/api/job-files', access: 'user', feature: 'portal_job_files', router: createJobFilesRoutes(d) }]
}
