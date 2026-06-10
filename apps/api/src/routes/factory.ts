import { Hono } from 'hono'
import { authenticate } from '../middleware/auth'
import { type FactoryAuthVariables } from './factory/shared'
import { registerGenerationRoutes } from './factory/generation'
import { registerDeployRoutes } from './factory/deploy'
import { registerLifecycleRoutes } from './factory/lifecycle'
import { registerBillingRoutes } from './factory/billing'
import { registerIntakeRoutes } from './factory/intake'
import { registerSupportRoutes } from './factory/support'
import { registerAdminRoutes } from './factory/admin'
import { registerRoofReviewRoutes } from './factory/roofReview'

const factory = new Hono<{ Variables: FactoryAuthVariables }>()

// ─── Auth on all routes except public ones ────────────────────────────────────
factory.use('*', async (c, next) => {
  const pub = ['/templates', '/health', '/plans']
  const isPublicFeatures = c.req.path.endsWith('/features') && !c.req.path.includes('/customers/')
  // /calendar/* — public OAuth start + Google's redirect-back callback.
  //   The flow is browser-driven (no Authorization header available)
  //   and is protected by signed state tokens inside the handlers.
  // /internal/* — cron + scheduler endpoints. Each handler does its own
  //   x-cron-secret / X-Factory-Key check; gating them again here just
  //   masks the right 401 ("bad secret") with a generic one ("missing
  //   Authorization header") and breaks the in-process scheduler.
  if (
    pub.some(p => c.req.path.endsWith(p)) || isPublicFeatures
    || c.req.path.includes('/public/')
    || c.req.path.includes('/stripe/webhook')
    || c.req.path.includes('/internal/')
    || c.req.path.includes('/calendar/')
    || c.req.path.includes('/download/')
    || c.req.path.includes('/deploy/stream')
    || c.req.path.endsWith('/cleanup')
    || c.req.path.includes('/website-themes')
    || (c.req.method === 'GET' && c.req.path.includes('/support/kb'))
    || c.req.path.includes('/integrations/qbo/callback')
    // Tenant self-service endpoints under /customers/:id/* — the tenant's
    // CRM authenticates with X-Factory-Key (validated in each handler or by
    // factoryKeyOrRole), not a Supabase JWT. Gating them here returned
    // "Missing Authorization header" to every tenant call since launch.
    || c.req.path.endsWith('/offboard/status')
    || c.req.path.includes('/email-domain/')
    || c.req.path.endsWith('/email-alias-sync')
    || c.req.path.endsWith('/offboard')
    || c.req.path.endsWith('/reactivate')
  ) return next()
  return authenticate(c, next)
})

registerGenerationRoutes(factory)
registerDeployRoutes(factory)
registerLifecycleRoutes(factory)
registerBillingRoutes(factory)
registerIntakeRoutes(factory)
registerSupportRoutes(factory)
registerAdminRoutes(factory)
registerRoofReviewRoutes(factory)

export default factory
