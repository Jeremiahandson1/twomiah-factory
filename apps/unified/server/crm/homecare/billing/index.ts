// Home care — billing: authorizations, invoices, claims, EDI, remittance, payments: this group's mounts (docs/UNIFIED_HOMECARE_PLAN.md, step 3).
// Moved from templates/crm-homecare/backend/src/routes/{billing,claims,edi,remittance,payments,payers,authorizations,pricing,stripe}.ts.
//
// The paths are the template's (its src/index.ts). Every mount is the home-care vertical's only, so none needs a
// feature; the template gated none of them. Each action checks its own permission (care-billing, and care-payroll for a
// caregiver's pay rate by care type) — see each router's header.
import { Hono } from 'hono'
import type { Mount } from '../../../http/registry.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { createSubscriptionRoutes } from '../../../modules/company.ts'
import { createVisitInvoiceRoutes } from './invoices.ts'
import { createClaimRoutes } from './claims.ts'
import { createEdiRoutes } from './edi.ts'
import { createRemittanceRoutes } from './remittance.ts'
import { createPayerPaymentRoutes } from './payments.ts'
import { createPayerRoutes } from './payers.ts'
import { createAuthorizationRoutes } from './authorizations.ts'
import { createPricingRoutes } from './pricing.ts'
import { createVisitInvoiceStripeRoutes } from './stripe.ts'

export function billingMounts(core: HomecareCore, d: CrmDeps): Mount[] {
  // /api/billing: the visit invoicing, and at the same root the Factory subscription's three doors — as the template's
  // billing router composed them (modules/company.ts leaves /api/billing to this mount for home care).
  const billing = new Hono()
    .route('/', createVisitInvoiceRoutes(core, d))
    .route('/', createSubscriptionRoutes({ db: d.db, permissions: d.permissions }))
  return [
    { path: '/api/billing', access: 'user', router: billing },
    { path: '/api/claims', access: 'user', router: createClaimRoutes(core, d) },
    { path: '/api/edi', access: 'user', router: createEdiRoutes(core, d) },
    { path: '/api/remittance', access: 'user', router: createRemittanceRoutes(core, d) },
    { path: '/api/authorizations', access: 'user', router: createAuthorizationRoutes(core, d) },
    { path: '/api/payers', access: 'user', router: createPayerRoutes(core, d) },
    { path: '/api/payments', access: 'user', router: createPayerPaymentRoutes(core, d) },
    { path: '/api/pricing', access: 'user', router: createPricingRoutes(core, d) },
    // Public: the family's pay page and Stripe's webhook answer without a session; the router signs people in itself
    // for the rest (modules/crm.ts leaves /api/stripe to this mount for home care).
    { path: '/api/stripe', access: 'public', router: createVisitInvoiceStripeRoutes(core, d) },
  ]
}
