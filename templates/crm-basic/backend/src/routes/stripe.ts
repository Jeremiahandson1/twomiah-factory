// Stripe routes — shared implementation (packages/tenant-backend/src/payments/stripe.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables, service and
// middleware in; behaviour lives in one place for every CRM.
import { createStripeRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { invoice, contact, payment, company } from '../../db/schema.ts'
import { authenticate } from '../middleware/auth.ts'
import { requirePermission } from '../middleware/permissions.ts'
import stripeService from '../services/stripe.ts'
import audit from '../services/audit.ts'

export default createStripeRoutes({
  db,
  tables: { invoice, contact, payment, company },
  stripeService,
  authenticate,
  requirePermission,
  audit,
})
