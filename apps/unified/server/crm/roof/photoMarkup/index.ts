// Drawing on a job's photos, behind the one switch `photo_markup` (not ready): with it off the route does not exist.
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import { createPhotoMarkupRoutes } from './routes.ts'

export function photoMarkupMounts(d: CrmDeps): Mount[] {
  return [{ path: '/api/photo-markup', access: 'user', feature: 'photo_markup', router: createPhotoMarkupRoutes(d) }]
}
