import { Hono } from 'hono'
import { authenticate } from '../middleware/auth'
import { type FactoryAuthVariables } from './factory/shared'
import { registerGenerationRoutes } from './factory/generation'
import { registerDeployRoutes } from './factory/deploy'
import { registerLifecycleRoutes } from './factory/lifecycle'
import { registerBillingRoutes } from './factory/billing'
import { registerIntakeRoutes } from './factory/intake'
import { registerSupportRoutes } from './factory/support'
import { registerStatusRoutes } from './factory/status'
import { registerAdminRoutes } from './factory/admin'
import { registerRoofReviewRoutes } from './factory/roofReview'
import { registerA2pRoutes } from './factory/a2p'
import { registerMessagingRoutes } from './factory/messaging'
import { registerStripeOAuthRoutes } from './factory/stripeOAuth'

const factory = new Hono<{ Variables: FactoryAuthVariables }>()

// ─── Auth on all routes except public ones ────────────────────────────────────
factory.use('*', async (c, next) => {
  const pub = ['/templates', '/health', '/plans']
  // /calendar/* — public OAuth start + Google's redirect-back callback.
  //   The flow is browser-driven (no Authorization header available)
  //   and is protected by signed state tokens inside the handlers.
  // /internal/* — cron + scheduler endpoints. Each handler does its own
  //   x-cron-secret / X-Factory-Key check; gating them again here just
  //   masks the right 401 ("bad secret") with a generic one ("missing
  //   Authorization header") and breaks the in-process scheduler.
  if (
    pub.some(p => c.req.path.endsWith(p))
    // (No */features exception: it opened ANY path ending in /features to the internet, to serve a hand-typed
    // catalogue nothing called — removed with it. A public route belongs under /public/.)
    || c.req.path.includes('/public/')
    || c.req.path.includes('/stripe/webhook')
    // Stripe's Connect endpoint (connected-account events, verified by its own signing secret in billing.ts).
    || c.req.path.endsWith('/stripe/connect-webhook')
    || c.req.path.includes('/internal/')
    || c.req.path.includes('/calendar/')
    // GBP OAuth broker (/gbp/google/auth + /gbp/google/callback): Google redirects
    // the user here with no Supabase JWT, exactly like the calendar flow above.
    // Without this, Connect Google 401'd with "Missing Authorization header".
    || c.req.path.includes('/gbp/google/')
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
    // SendGrid Inbound Parse posts customer mail here. It cannot send a
    // Supabase JWT, so gating it here made every inbound message 401 with
    // "Missing Authorization header" before the handler ran — inbound email
    // could never have worked. The route authenticates itself: a 32-char
    // secret in the path, timing-safe compared against
    // SENDGRID_INBOUND_PARSE_WEBHOOK_SECRET (lifecycle.ts). Same class of bug
    // as /support-tickets and /email-alias-sync below.
    || c.req.path.includes('/inbound-parse/')
    || c.req.path.endsWith('/offboard/status')
    || c.req.path.includes('/email-domain/')
    || c.req.path.endsWith('/email-alias-sync')
    // The CRM's address page: where each address stands (and a reconcile), and a resend of Cloudflare's
    // confirmation email. X-Factory-Key, checked in lifecycle.ts. Exact match on the id segment.
    || (c.req.method === 'GET' && /\/customers\/[0-9a-f-]{36}\/email-alias-status$/i.test(c.req.path))
    || (c.req.method === 'POST' && /\/customers\/[0-9a-f-]{36}\/email-alias-confirmation$/i.test(c.req.path))
    || c.req.path.endsWith('/support-tickets')
    || c.req.path.endsWith('/offboard')
    || c.req.path.endsWith('/reactivate')
    // Read-only billing mirror (PR #43): the tenant CRM pulls its subscription summary and asks for a
    // Stripe portal link with X-Factory-Key (checked in lifecycle.ts). Exact match on the id segment so
    // the admin-only POST /customers/:id/checkout/subscription is NOT let through.
    || /\/customers\/[0-9a-f-]{36}\/(subscription|billing-portal-link)$/i.test(c.req.path)
    // Restart after the subscription ended: the CRM's lock page asks for a checkout with X-Factory-Key (lifecycle.ts).
    || (c.req.method === 'POST' && /\/customers\/[0-9a-f-]{36}\/restart-checkout$/i.test(c.req.path))
    // Twomiah Ads registration after deploy: the tenant CRM calls it with X-Factory-Key (checked in lifecycle.ts).
    || (c.req.method === 'POST' && /\/customers\/[0-9a-f-]{36}\/ads\/register$/i.test(c.req.path))
    // Stripe Connect: the tenant CRM reports its connected account with X-Factory-Key (checked in lifecycle.ts).
    || (c.req.method === 'POST' && /\/customers\/[0-9a-f-]{36}\/stripe-connect$/i.test(c.req.path))
    // Linking an existing Stripe account (factory/stripeOAuth.ts): the tenant's three calls carry X-Factory-Key (checked
    // there), and Stripe's redirect back carries only the signed state, verified in services/stripeConnectOAuth.ts.
    || /\/customers\/[0-9a-f-]{36}\/stripe-oauth(\/start|\/deauthorize)?$/i.test(c.req.path)
    || (c.req.method === 'GET' && c.req.path.endsWith('/stripe/oauth/callback'))
  ) return next()
  return authenticate(c, next)
})

registerGenerationRoutes(factory)
registerDeployRoutes(factory)
registerLifecycleRoutes(factory)
registerBillingRoutes(factory)
registerIntakeRoutes(factory)
registerSupportRoutes(factory)
registerStatusRoutes(factory)
registerAdminRoutes(factory)
registerRoofReviewRoutes(factory)
registerA2pRoutes(factory)
registerMessagingRoutes(factory)
registerStripeOAuthRoutes(factory)

export default factory
