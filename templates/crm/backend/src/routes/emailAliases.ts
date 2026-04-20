// Thin wrapper — real CRUD logic lives in the shared tenant-backend package
// which the factory vendors into ./shared/ at generation time.
import { Hono } from 'hono'
import { createEmailAliasesRoutes, createFactoryApiClient } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { emailAlias } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createEmailAliasesRoutes({
  db,
  emailAliasesTable: emailAlias,
  factoryApiClient: createFactoryApiClient(),
}))
export default app
