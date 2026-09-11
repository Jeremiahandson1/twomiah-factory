import { Hono } from 'hono'
import { createBillingRoutes, createFactoryApiClient } from '../shared/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { db } from '../../db/index.ts'
import { company, user } from '../../db/schema.ts'

// Billing is READ-ONLY in a tenant. Plans are sold, changed and cancelled by the Twomiah Factory
// (Stripe lives there); this CRM mirrors the Factory's subscription summary and links to the
// Factory's billing portal. The old in-app checkout quoted prices the Factory no longer sells and
// overwrote the feature list with its own SKU ids — it is gone on purpose.
const app = new Hono()
app.use('*', authenticate, requireAdmin)
app.route('/', createBillingRoutes({
  db, companyTable: company, userTable: user,
  factoryApiClient: createFactoryApiClient(),
  seatLimitEnv: process.env.SEAT_LIMIT,
}))
export default app
