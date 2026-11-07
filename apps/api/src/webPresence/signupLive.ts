// The signup route's wiring for the $19 plan: the real database, slug rule, composer and Stripe behind webPresenceSignup (signup.ts, which
// the tests drive with stand-ins). Kept out of routes/factory/intake.ts so the shared signup handler stays exactly as it was.
import { supabase } from '../middleware/auth'
import factoryStripe from '../services/factoryStripe'
import { allocateSlug, signupSlugCandidates, liveSlugLookups } from '../services/resourceOwnership'
import { signupComposerInput, signupComposition, composeSignupSite, liveSignupSiteDeps } from '../services/signupSite'
import { signupChoices } from '../config/signupQuestions'
import { WebPresenceOffError, WEB_PRESENCE_PLAN_ID } from './switch'
import { webPresenceSignup, type SignupResult } from './signup'
import type { StaffCreateDeps } from './staffCreate'
import { provisionSite } from './service'
import { liveDeps } from './live'
import { logTenantAudit } from '../routes/factory/shared'

/** Staff setting a customer up (staffCreate.ts): the same slug rule and composer as the signup, the invoice, the site set-up. */
export function liveStaffCreateDeps(): StaffCreateDeps {
  return {
    db: supabase, env: process.env,
    allocateSlug: async (b) => (await allocateSlug(signupSlugCandidates(b), liveSlugLookups(supabase))).slug,
    compose: (b) => signupComposition(signupComposerInput(b, { services: [], goals: signupChoices(b).goals }), { ai: true }),
    composeAi: (id) => { liveSignupSiteDeps().then((deps) => composeSignupSite(id, deps)).catch((e: any) => console.warn('[WebPresence] AI compose could not start:', e?.message)) },
    invoice: (t) => factoryStripe.createInvoicedSubscription({ id: t.id, email: t.admin_email || t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id }, { planId: WEB_PRESENCE_PLAN_ID }),
    provision: async (id) => ({ status: (await provisionSite(liveDeps(), id)).row.status }),
    audit: (id, what, detail) => logTenantAudit(id, what, { web_presence: { old: null, new: detail } }, String(detail.by || 'factory-staff'), 'Web presence customer set up by staff'),
  }
}

/** `services` is the owner's cleaned list of what they do (the signup route's own cleaning). Off (the default): a plain 404. */
export async function liveWebPresenceSignup(body: any, design: string | null, services: string[]): Promise<SignupResult> {
  try {
    return await webPresenceSignup(body, {
      db: supabase, env: process.env, design,
      allocateSlug: async (b) => (await allocateSlug(signupSlugCandidates(b), liveSlugLookups(supabase))).slug,
      compose: (b) => signupComposition(signupComposerInput(b, { services, goals: signupChoices(b).goals }), { ai: true }),
      composeAi: (id) => { liveSignupSiteDeps().then((deps) => composeSignupSite(id, deps)).catch((e: any) => console.warn('[WebPresence] AI compose could not start:', e?.message)) },
      checkout: async (t, urls) => {
        const co = await factoryStripe.createSubscriptionCheckout(
          { id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id },
          { planId: WEB_PRESENCE_PLAN_ID, billingCycle: 'monthly', successUrl: urls.successUrl, cancelUrl: urls.cancelUrl })
        return { url: co.url || null, stripeCustomerId: co.stripeCustomerId }
      },
    })
  } catch (e: any) {
    if (e instanceof WebPresenceOffError) return { status: 404, body: { error: 'Not found' } }
    throw e
  }
}
