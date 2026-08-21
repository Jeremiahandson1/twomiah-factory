import { Hono } from 'hono'
import { createOnboardingRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'

const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createOnboardingRoutes({ db, companyTable: company }))
export default app
