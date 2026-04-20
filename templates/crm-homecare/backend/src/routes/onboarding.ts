import { Hono } from 'hono'
import { createOnboardingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { agencies } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

// Homecare uses "agencies" as the tenant table rather than "company",
// and the user context uses agencyId. Pass a custom resolver.
const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createOnboardingRoutes({
  db,
  companyTable: agencies,
  getCompanyId: (user: any) => user?.agencyId || user?.companyId,
}))
export default app
