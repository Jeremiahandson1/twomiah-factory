// Settings → Integrations backend — shared implementation (packages/tenant-backend/src/integrations/integrations.ts), vendored into
// this tenant as ../shared at generation. This file only wires the template's tables and services in.
import Stripe from 'stripe'
import { createIntegrationsRoutes } from '../shared/index.ts'
import { db } from '../../db/index.ts'
import { company, emailLog } from '../../db/schema.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import quickbooks from '../services/quickbooks.ts'

const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

export default createIntegrationsRoutes({ db, tables: { company, emailLog }, authenticate, requireAdmin, quickbooks, stripe })
