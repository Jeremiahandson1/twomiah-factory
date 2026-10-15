import { authenticate, supabase, requireRole } from '../../middleware/auth'
import { findRenderServicesBySlug, wireDomainInfrastructure } from '../../services/deploy'
import factoryStripe from '../../services/factoryStripe'
import { pushSubscriptionToTenant } from '../../services/tenantSubscription'
import { forwardConnectEvent, responseStatusFor } from '../../services/connectWebhook'
import { notifyBillingPastDue, notifyMessagingEnabled, notifyReactivated } from '../../services/email'
import { portalUrlFor } from '../../lib/portal'
import { PRODUCTS, getProductDefaults } from '../../config/pricing'
import { getRegistrar } from '../../services/registrar'
import { type FactoryApp, UUID_RE, DOMAIN_RE, parseJsonBody, logTenantAudit, diffTenantChanges, FRONTEND_URL, checkCronSecret } from './shared'
import { triggerAutoDeploy } from './deploy'
import { finishRestart } from '../../services/subscriptionRestart'
import { ownerFirstName } from '../../services/tenantOwner'
import { registrantGaps, registrantMessage, cleanRegistrant } from '../../services/domainRegistrant'

// Apply a webhook's tenant updates so that activation NEVER depends on an optional attribute.
// PostgREST rejects the whole update when it names a column the table lacks (PGRST204) — that is how
// `billing_cycle` silently dropped stripe_subscription_id / billing_status / status on every
// subscription checkout until 2026-09-11 (see migrations/2026-09-11_tenants_billing_cycle.sql).
// Unknown columns are logged loudly and stripped, then the rest is written; never swallowed.
async function applyTenantUpdates(match: { field: string; value: any }, updates: Record<string, any>): Promise<{ applied: Record<string, any>; dropped: string[] }> {
  const pending = { ...updates }
  const dropped: string[] = []
  for (let attempt = 0; attempt < 8 && Object.keys(pending).length > 0; attempt++) {
    const { error } = await supabase.from('tenants').update(pending).eq(match.field, match.value)
    if (!error) return { applied: pending, dropped }
    const missing = error.code === 'PGRST204' ? error.message.match(/'([A-Za-z0-9_]+)' column/)?.[1] : null
    if (!missing || !(missing in pending)) throw new Error(`tenants update failed (${error.code}): ${error.message}`)
    console.error(`[Stripe] tenants.${missing} does not exist — dropping it from this update. Apply the pending migration in apps/api/migrations.`)
    dropped.push(missing); delete pending[missing]
  }
  return { applied: pending, dropped }
}

// Email the tenant a welcome + billing-portal link when a channel is enabled.
async function emailEnabled(tenantId: string, label: string) {
  try {
    const { data: t } = await supabase.from('tenants').select('name, email').eq('id', tenantId).single()
    if (t?.email) await notifyMessagingEnabled({ name: t.name, email: t.email }, portalUrlFor(tenantId), label)
  } catch (e: any) { console.error('[Messaging] enable email failed:', e?.message || e) }
}

export function registerBillingRoutes(factory: FactoryApp) {
// ─── Stripe Config ───────────────────────────────────────────────────────────
factory.get('/stripe/config', (c) => {
  return c.json({ configured: factoryStripe.isConfigured(), publishableKey: factoryStripe.getPublishableKey() })
})


// ─── Checkout: Subscription ─────────────────────────────────────────────────
factory.post('/customers/:id/checkout/subscription', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId, billingCycle, trialDays, promoCode } = parsedBody.data

    // ─── Secret comp/E2E promo bypass ──────────────────────────────────────────
    // Env-gated: impossible to trigger unless COMP_PROMO_CODE is explicitly set in
    // the environment. When the code matches, skip Stripe entirely, mark the tenant
    // comp + is_test_tenant (disposable), and fire the SAME auto-deploy a real
    // payment would — so the buy→build→site→CRM path is exercised end-to-end with
    // no charge. Tenant stays flagged for one-click cleanup via /test/cleanup-tenant.
    const COMP_CODE = (process.env.COMP_PROMO_CODE || '').trim()
    if (COMP_CODE && typeof promoCode === 'string' && promoCode.trim() === COMP_CODE) {
      const { error: compErr } = await supabase.from('tenants').update({
        billing_type: 'comp',
        billing_status: 'active',
        is_test_tenant: true,
        plan: planId || tenant.plan || 'starter',
      }).eq('id', tenantId)
      if (compErr) return c.json({ error: 'Comp activation failed: ' + compErr.message }, 500)
      console.log('[Comp] E2E promo bypass — provisioning test tenant', tenantId, 'plan', planId || tenant.plan)
      triggerAutoDeploy(tenantId).catch((e: any) => console.error('[Comp] auto-deploy trigger:', e?.message || e))
      return c.json({
        success: true,
        comp: true,
        promoApplied: true,
        tenantId,
        message: 'Comp tenant provisioned — building now (no charge).',
        deployStatusUrl: `/api/v1/factory/customers/${tenantId}/deploy/status`,
      })
    }

    if (billingCycle && !['monthly', 'annual'].includes(billingCycle)) return c.json({ error: 'billingCycle must be "monthly" or "annual"' }, 400)
    if (trialDays !== undefined && (typeof trialDays !== 'number' || trialDays < 0 || !Number.isInteger(trialDays))) return c.json({ error: 'trialDays must be a non-negative integer' }, 400)
    const result = await factoryStripe.createSubscriptionCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id },
      { planId: planId || tenant.plan || 'starter10', billingCycle: billingCycle || 'monthly', trialDays }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] Subscription checkout error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Checkout: License ──────────────────────────────────────────────────────
factory.post('/customers/:id/checkout/license', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { planId } = parsedBody.data
    const result = await factoryStripe.createLicenseCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, stripeCustomerId: tenant.stripe_customer_id },
      { planId: planId || tenant.plan || 'starter10' }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] License checkout error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Checkout: Deploy Service ────────────────────────────────────────────────
factory.post('/customers/:id/checkout/deploy-service', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)

    const parsedBody = await parseJsonBody(c)
    if (parsedBody.error) return parsedBody.error
    const { serviceId } = parsedBody.data
    if (!serviceId || !['basic', 'full', 'white-glove', 'white_glove'].includes(serviceId)) {
      return c.json({ error: 'serviceId must be "basic", "full", or "white-glove"' }, 400)
    }
    const result = await factoryStripe.createDeployCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, stripeCustomerId: tenant.stripe_customer_id },
      { serviceId }
    )

    if (result.stripeCustomerId && !tenant.stripe_customer_id) {
      await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', tenantId)
    }

    return c.json({ url: result.url, sessionId: result.sessionId })
  } catch (err: any) {
    console.error('[Stripe] Deploy service checkout error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Stripe Connect Webhook ─────────────────────────────────────────────────
// Events on tenants' connected accounts (a business that clicked "Connect Stripe" collects on its own
// account). Verified with the Connect endpoint's own secret, then forwarded to the owning tenant —
// see services/connectWebhook.ts for the routing and the retry semantics of each response code.
factory.post('/stripe/connect-webhook', async (c) => {
  let event: any
  try {
    const body = await c.req.text()
    const sig = c.req.header('stripe-signature')
    if (!sig) return c.json({ error: 'Missing signature' }, 400)
    event = await factoryStripe.verifyConnectWebhookSignature(body, sig)
  } catch (err: any) {
    console.error('[StripeConnect] Webhook signature verification failed:', err.message)
    return c.json({ error: 'Signature verification failed' }, 400)
  }
  const result = await forwardConnectEvent(event, {
    findTenantByAccount: async (accountId) => {
      const { data } = await supabase.from('tenants').select('id, slug, render_backend_url, factory_sync_key').eq('stripe_connect_account_id', accountId).limit(1).maybeSingle()
      return data || null
    },
  })
  if (result.status !== 'forwarded') console.warn('[StripeConnect]', event.type, event.account, result)
  return c.json({ received: true, ...result }, responseStatusFor(result) as any)
})

// ─── Stripe Webhook ─────────────────────────────────────────────────────────
factory.post('/stripe/webhook', async (c) => {
  let event: any
  try {
    const body = await c.req.text()
    const sig = c.req.header('stripe-signature')
    if (!sig) return c.json({ error: 'Missing signature' }, 400)
    event = await factoryStripe.verifyWebhookSignature(body, sig)
  } catch (err: any) {
    console.error('[Stripe] Webhook signature verification failed:', err.message)
    return c.json({ error: 'Signature verification failed' }, 400)
  }

  try {
    const result = await factoryStripe.handleFactoryWebhook(event)

    if (result.handled && result.factoryCustomerId && result.updates) {
      // Fetch old values for audit diff
      const { data: preTenant } = await supabase.from('tenants').select('*').eq('id', result.factoryCustomerId).single()
      await applyTenantUpdates({ field: 'id', value: result.factoryCustomerId }, result.updates)
      // The tenant CRM mirrors this state (Settings → Billing, trial gate) — push it, never block on it.
      pushSubscriptionToTenant(result.factoryCustomerId).catch(() => {})
      // A subscription paid by a company that was offboarding is a RESTART (the lock page's checkout): stop the
      // offboard timer and put the domain lock back. A sign-up has no offboard and is left alone. (10/14)
      if (event.type === 'checkout.session.completed' && result.updates.billing_type === 'subscription' && preTenant?.offboard_started_at) {
        const done = await finishRestart(preTenant, {
          clearOffboard: async (id) => supabase.from('tenants').update({ offboard_started_at: null, offboard_grace_ends_at: null, epp_code_sent_at: null }).eq('id', id),
          relockDomain: async (domain) => (await getRegistrar()).lock(domain),
          audit: async (id, changes) => { await logTenantAudit(id, 'offboard_reactivate', changes, 'stripe-webhook', 'Restarted — the subscription was paid again') },
          notifyReactivated: async (t) => notifyReactivated(t as any, await ownerFirstName(t.id)),
        })
        console.log('[Restart]', result.factoryCustomerId, JSON.stringify(done))
      }
      if (preTenant) {
        const changes = diffTenantChanges(preTenant, result.updates)
        if (Object.keys(changes).length > 0) {
          await logTenantAudit(result.factoryCustomerId, 'billing_change', changes, 'stripe-webhook', `Event: ${event.type}`)
        }
      }
    } else if (result.handled && result.lookupField && result.lookupValue && result.updates) {
      // Lookup tenant id for audit
      const { data: lookedUp } = await supabase.from('tenants').select('*').eq(result.lookupField, result.lookupValue).single()
      await applyTenantUpdates({ field: result.lookupField, value: result.lookupValue }, result.updates)
      if (lookedUp?.id) pushSubscriptionToTenant(lookedUp.id).catch(() => {})
      if (lookedUp) {
        const changes = diffTenantChanges(lookedUp, result.updates)
        if (Object.keys(changes).length > 0) {
          await logTenantAudit(lookedUp.id, 'billing_change', changes, 'stripe-webhook', `Event: ${event.type}`)
        }
      }
    }

    // CRM add-on paid → auto-provision in the background. Stripe needs a fast
    // 2xx ack (it retries on timeout), and the provision flow includes a
    // Render deploy + possible redeploy, so it must run out-of-band. Failures
    // alert staff with the manual-script fallback.
    if (result.crmAddonTenantId && event.type === 'checkout.session.completed') {
      const addonTenantId = result.crmAddonTenantId
      import('../../services/crmAddonProvision').then(({ provisionCrmAddonForTenant }) =>
        provisionCrmAddonForTenant(addonTenantId)
      ).catch(err => console.error('[CrmAddon] Auto-provision trigger error:', err?.message || err))
    }

    // Auto-deploy on checkout.session.completed (subscription or one_time payment)
    if (result.handled && result.factoryCustomerId && event.type === 'checkout.session.completed' &&
        result.updates?.billing_type && result.updates.billing_type !== 'deploy_service') {
      // Fire-and-forget: trigger deploy pipeline if tenant has a build and isn't already deploying
      triggerAutoDeploy(result.factoryCustomerId).catch(err =>
        console.error('[Stripe] Auto-deploy trigger error:', err.message)
      )
    }

    // Domain registration: customer paid for a new domain via /admin/domain
    // → register at Namecheap → wire DNS infrastructure. If Namecheap fails,
    // we refund the customer so they're never paying for nothing.
    if (event.type === 'checkout.session.completed' && event.data?.object?.metadata?.purpose === 'domain_registration') {
      const session = event.data.object
      const meta = session.metadata || {}
      const tenantId = meta.tenant_id
      const domain = meta.domain
      const years = parseInt(meta.years || '1', 10) || 1
      const paymentIntent = session.payment_intent
      if (tenantId && domain) {
        handleDomainRegistration({ tenantId, domain, years, paymentIntent, sessionId: session.id })
          .catch(err => console.error('[Domain] Post-payment registration failed:', err.message))
      } else {
        console.warn('[Domain] Webhook missing required metadata:', JSON.stringify(meta))
      }
    }

    // Domain renewal paid (services/domainRenewal.ts): renew it at Namecheap now, exactly once per invoice.
    // Awaited — the renewal is one Namecheap call, and Stripe retries on an error, which the claim makes safe.
    if (event.type === 'invoice.paid' && event.data?.object?.metadata?.purpose === 'domain_renewal') {
      const { completePaidDomainRenewal } = await import('../../services/domainRenewal')
      const { notifyStaff } = await import('../../services/email')
      const done = await completePaidDomainRenewal(event.data.object, {
        supabase,
        renew: async (domain, years) => (await getRegistrar()).renew(domain, years),
        alertStaff: notifyStaff,
        // the free WHOIS privacy, renewed beside the domain (its Namecheap auto-renew would turn the domain's on)
        keepPrivacy: async (domain, until) => (await getRegistrar()).keepPrivacyThrough(domain, until),
      })
      console.log('[Domain] renewal invoice', event.data.object.id, JSON.stringify(done))
    }

    // Messaging billing: wallet top-up paid → credit the wallet AT COST; the
    // $10/mo enable subscription checkout → mark the tenant messaging-enabled.
    if (event.type === 'checkout.session.completed') {
      const session = event.data?.object || {}
      const meta = session.metadata || {}
      if (meta.addon === 'messaging_wallet_topup' && meta.tenant_id && meta.topup_cents) {
        const cents = parseInt(meta.topup_cents, 10)
        if (Number.isFinite(cents) && cents > 0) {
          import('../../services/messagingWallet').then(({ credit }) =>
            credit(meta.tenant_id, cents, 'topup', { stripeRef: String(session.payment_intent || session.id) })
          ).catch(err => console.error('[Wallet] Top-up credit failed:', err?.message || err))
          // Wallet recovered → clear the low-balance nudge so a future dip re-nudges.
          supabase.from('tenants').update({ messaging_nudged_at: null }).eq('id', meta.tenant_id).then(() => {}, () => {})
        }
      } else if (meta.addon === 'messaging_enable' && meta.tenant_id) {
        supabase.from('tenants').update({
          messaging_enabled: true,
          messaging_enabled_at: new Date().toISOString(),
          messaging_sub_id: session.subscription || null,
        }).eq('id', meta.tenant_id).then(
          () => { logTenantAudit(meta.tenant_id, 'messaging_enable', { messaging_enabled: { old: false, new: true } }, 'stripe-webhook', 'Messaging enabled'); emailEnabled(meta.tenant_id, 'SMS / Messaging') },
          (err: any) => console.error('[Messaging] Enable mark failed:', err?.message || err),
        )
      } else if (meta.addon === 'ai_enable' && meta.tenant_id) {
        supabase.from('tenants').update({
          ai_enabled: true,
          ai_enabled_at: new Date().toISOString(),
          ai_sub_id: session.subscription || null,
        }).eq('id', meta.tenant_id).then(
          () => { logTenantAudit(meta.tenant_id, 'ai_enable', { ai_enabled: { old: false, new: true } }, 'stripe-webhook', 'AI enabled'); emailEnabled(meta.tenant_id, 'AI Assistant') },
          (err: any) => console.error('[AI] Enable mark failed:', err?.message || err),
        )
      }
    }

    // Messaging/AI ENABLE subscription lifecycle: if the $10/mo line is canceled
    // or goes unpaid at Stripe, disable that channel so the tenant can't keep
    // using it for free. These subs carry {addon, tenant_id} metadata (not
    // factory_customer_id), so handleFactoryWebhook ignores them — handle here.
    if (event.type === 'customer.subscription.deleted' || event.type === 'customer.subscription.updated') {
      const sub = event.data?.object || {}
      const addon = sub.metadata?.addon
      const tenantId = sub.metadata?.tenant_id
      const dead = event.type === 'customer.subscription.deleted' || ['canceled', 'unpaid', 'incomplete_expired'].includes(String(sub.status))
      if (tenantId && dead && (addon === 'messaging_enable' || addon === 'ai_enable')) {
        const patch = addon === 'messaging_enable'
          ? { messaging_enabled: false, messaging_sub_id: null }
          : { ai_enabled: false, ai_sub_id: null }
        const field = addon === 'messaging_enable' ? 'messaging_enabled' : 'ai_enabled'
        supabase.from('tenants').update(patch).eq('id', tenantId).then(
          () => logTenantAudit(tenantId, `${addon}_lapsed`, { [field]: { old: true, new: false } }, 'stripe-webhook', `${addon} subscription ${sub.status || 'deleted'} → disabled`),
          (err: any) => console.error(`[${addon}] Auto-disable failed:`, err?.message || err),
        )
      }
    }

    // Send email notification for past-due billing
    if (result.handled && result.updates?.billing_status === 'past_due') {
      const lookupQuery = result.factoryCustomerId
        ? supabase.from('tenants').select('name, email, stripe_subscription_id').eq('id', result.factoryCustomerId).single()
        : result.lookupField && result.lookupValue
          ? supabase.from('tenants').select('name, email, stripe_subscription_id').eq(result.lookupField, result.lookupValue).single()
          : null
      if (lookupQuery) {
        const { data: pastDueTenant } = await lookupQuery
        if (pastDueTenant) {
          notifyBillingPastDue(pastDueTenant).catch(e => console.warn('[Email] Billing past-due notification failed:', e.message))
        }
      }
    }

    return c.json({ received: true })
  } catch (err: any) {
    console.error('[Stripe] Webhook handler error:', err.message)
    return c.json({ error: 'Webhook processing failed' }, 500)
  }
})


/**
 * Customer paid via Stripe → register at Namecheap → wire DNS. Called
 * fire-and-forget from the webhook handler; logs everything but never
 * re-throws because the webhook must always 200 back to Stripe.
 *
 * Failure handling: if Namecheap rejects the registration (insufficient
 * funds, IP not whitelisted, domain became unavailable in the 30 seconds
 * since the customer clicked Register), we refund the Stripe charge so
 * the customer isn't out money for a domain they don't have. Then email
 * them apologizing and pointing at BYOD as an alternative.
 */
// `paymentIntent` is absent for an operator registration at cost (no charge was taken,
// so a failure has nothing to refund); the result is returned so that caller can report it.
async function handleDomainRegistration(opts: {
  tenantId: string
  domain: string
  years: number
  paymentIntent?: string
  sessionId?: string
}): Promise<{ ok: boolean; error?: string; nameserversSet?: boolean }> {
  const { tenantId, domain, years, paymentIntent } = opts
  console.log('[Domain] Processing registration:', domain, 'for tenant', tenantId, paymentIntent ? '(paid)' : '(operator, at cost)')

  const { data: tenant, error: tErr } = await supabase.from('tenants')
    .select('id, slug, name, email, admin_email, phone, address, city, state, zip, factory_sync_key, website_url, render_backend_url, cloudflare_zone_id')
    .eq('id', tenantId).single()
  if (tErr || !tenant) {
    console.error('[Domain] Tenant not found during registration:', tenantId)
    return { ok: false, error: 'Tenant not found' }
  }

  const { getRegistrar } = await import('../../services/registrar/index')
  const registrar = await getRegistrar()
  const ownerName = (tenant.name || 'Admin User').split(/\s+/)
  const firstName = ownerName[0] || 'Admin'
  const lastName = ownerName.slice(1).join(' ') || 'User'
  // The registrar requires the registrant's full address AND a phone. This checked the phone only, so a store with no
  // address was charged, then refused ("Parameter RegistrantAddress1 is Missing") and refunded. The checkout routes now
  // refuse before charging (services/domainRegistrant.ts); this is the backstop for anything already paid. (E2E Run 2)
  const gaps = registrantGaps(tenant)
  if (gaps.length) {
    console.warn('[Domain] Registrant incomplete (' + gaps.join(', ') + ')' + (paymentIntent ? ' — refunding' : ''))
    if (paymentIntent) await refundAndEmail({ tenant, paymentIntent, domain, reason: 'no_registrant' })
    return { ok: false, error: registrantMessage(gaps) }
  }
  const reg = await registrar.register(domain, {
    years,
    whoisPrivacy: true,
    autoRenew: true,
    registrantContact: {
      firstName, lastName,
      email: tenant.admin_email || tenant.email,
      phone: tenant.phone,
      address1: tenant.address || '',
      city: tenant.city || '',
      stateProvince: tenant.state || '',
      postalCode: tenant.zip || '',
      country: 'US',
      organization: tenant.name,
    },
  })
  if (!reg.success) {
    console.error('[Domain] Namecheap register failed:', reg.error)
    if (paymentIntent) await refundAndEmail({ tenant, paymentIntent, domain, reason: 'registrar_failed', detail: reg.error })
    return { ok: false, error: 'Registrar: ' + (reg.error || 'registration did not complete') }
  }
  console.log('[Domain] Namecheap register OK for', domain, 'expires', reg.expiresAt)

  // Persist the domain on the tenant row + record registrar metadata.
  await supabase.from('tenants').update({
    domain,
    domain_registrar: 'namecheap',
    domain_expires_at: reg.expiresAt || null,
  }).eq('id', tenantId)

  // Wire Cloudflare + Resend + Render custom-domain attachment.
  const { findRenderServicesBySlug, wireDomainInfrastructure } = await import('../../services/deploy')
  const services = await findRenderServicesBySlug(tenant.slug, { backendUrl: tenant.render_backend_url })
  const siteServiceId = services.site || services['website-premium'] || services.website
  const backendServiceId = services.backend || services.api
  let nameserversSet = false
  // wireDomainInfrastructure writes the @ / www / app CNAMEs only when it is told the
  // Render hosts to point them at — without them the zone gets mail records and no
  // record for the site at all. Read them from the tenant row (the deployed URLs),
  // never compose them: tenant hosts carry a vertical suffix (…-wrench-api).
  const renderSlug = (url?: string | null) => {
    const host = (url || '').replace(/^https?:\/\//, '').split('/')[0]
    return host.endsWith('.onrender.com') ? host.slice(0, -'.onrender.com'.length) : undefined
  }
  try {
    const wire = await wireDomainInfrastructure({
      domain, siteServiceId, backendServiceId,
      siteSlug: renderSlug(tenant.website_url),
      backendSlug: renderSlug(tenant.render_backend_url),
      adminEmailForDmarc: tenant.admin_email || tenant.email || undefined,
      existingCloudflareZoneId: tenant.cloudflare_zone_id || undefined,
    })
    if (wire.cloudflareZoneId) {
      await supabase.from('tenants').update({ cloudflare_zone_id: wire.cloudflareZoneId }).eq('id', tenantId)
    }
    if (wire.sendgridDomainAuthId) {
      await supabase.from('tenants').update({ sendgrid_domain_auth_id: wire.sendgridDomainAuthId }).eq('id', tenantId)
    }
    // Hand the registrar Cloudflare's nameservers. Only for domains WE bought:
    // a customer's own domain stays at their registrar and they point it
    // themselves. Without this the zone above is built and never used.
    if (wire.cloudflareNameServers && wire.cloudflareNameServers.length >= 2) {
      const ns = await registrar.setNameservers(domain, wire.cloudflareNameServers)
      if (ns.success) {
        nameserversSet = true
        console.log('[Domain] Nameservers pointed at Cloudflare for', domain)
      } else {
        // Not a refund: the domain is registered and the zone exists. But it
        // will not resolve until this is done, so it must be loud and it must
        // be recorded — a silent failure here looks like a working purchase
        // and is discovered by the customer.
        console.error('[Domain] SETTING NAMESERVERS FAILED for', domain, '-', ns.error)
        await supabase.from('tenants').update({
          domain_status: 'nameservers_failed',
        }).eq('id', tenantId)
      }
    } else {
      console.error('[Domain] No Cloudflare nameservers returned for', domain, '- registrar left on its own DNS')
    }

    console.log('[Domain] Wire infra:', wire.success ? 'ok' : 'partial', wire.errors)
  } catch (e: any) {
    console.error('[Domain] Wire infra threw:', e.message)
    // Don't refund — the domain IS registered, just the DNS auto-wire
    // hit a snag. Customer keeps the domain; we surface the issue in
    // support so we can finish manually.
    return { ok: true, nameserversSet, error: 'Registered, but DNS wiring threw: ' + e.message }
  }
  return { ok: true, nameserversSet }
}

async function refundAndEmail(opts: {
  tenant: { id: string; admin_email: string | null; email: string | null; name: string | null }
  paymentIntent: string
  domain: string
  reason: 'no_registrant' | 'registrar_failed' | string
  detail?: string
}): Promise<void> {
  // Logged here rather than left to the caller: this is the one place every
  // refund path passes through, and the detail is about to be kept out of the
  // customer's email on purpose.
  console.error('[Domain] Refunding', opts.domain, '- reason:', opts.reason, '- detail:', opts.detail || '(none)')
  try {
    const r = await factoryStripe.refundPaymentIntent(opts.paymentIntent, 'requested_by_customer')
    console.log('[Domain] Refund issued:', r.refundId, r.status)
  } catch (e: any) {
    console.error('[Domain] Refund failed:', e.message)
  }
  const to = opts.tenant.admin_email || opts.tenant.email
  if (!to) return
  const { sendEmail } = await import('../../services/email')
  // Never the registrar's raw error. It is frequently a fault on our side —
  // an outbound IP missing from an allowlist, an expired key — which means
  // nothing to the customer and reads as though they were at fault. The detail
  // is in the log above; the reference below is what connects them.
  const reasonText = opts.reason === 'no_registrant'
    ? 'we did not have your full business address and phone number on file, and the domain registrar requires them'
    : 'something went wrong on the registrar\'s end. It was not your card, and nothing is wrong with your account'
  // Last segment of the payment intent — enough for us to find the charge, the
  // refund and the log line, without printing the whole id.
  const reference = opts.paymentIntent.slice(-8)
  await sendEmail(to,
    'About your ' + opts.domain + ' registration',
    '<p>Hi ' + (opts.tenant.name || 'there') + ',</p>' +
    '<p>We tried to register <strong>' + opts.domain + '</strong> for you and it didn\'t go through — ' + reasonText + '.</p>' +
    '<p>We\'ve fully refunded the charge to your card. It should appear back in your account in 5-10 business days.</p>' +
    // The retry steps used to name an admin "Domain" page and an "I already own a domain" tab — screens only the
    // premium website has. A store or CRM owner had nowhere to go. Every customer can reply. (E2E Run 2, 10/15)
    '<p>To try again, just reply to this email' + (opts.reason === 'no_registrant' ? ' with your business street address, city, state, ZIP and phone number' : '') + ' and we will register it for you. If you already own a domain somewhere else, tell us that instead and we will connect it.</p>' +
    '<p>A real person reads every reply.</p>' +
    '<p style="color:#888;font-size:12px">Reference: ' + reference + '</p>'
  ).catch(e => console.warn('[Domain] Email send failed:', e?.message))
}

// ─── Operator: register a domain at cost ────────────────────────────────────
// The paid path above registers only after the tenant's Stripe checkout for
// the retail price completes. For an account we provision and bill ourselves
// (family, comped, internal), staff register on the Namecheap balance at cost
// and the SAME handler wires Cloudflare, email auth, Render custom domains
// and nameservers. Guarded by CRON_SECRET (operator-only): a tenant's own
// X-Factory-Key must never be able to buy domains on our account.
factory.post('/internal/domain/register-at-cost/:tenantId', async (c) => {
  if (!checkCronSecret(c)) return c.json({ error: 'Unauthorized' }, 401)
  try {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant id' }, 400)
    const body = await c.req.json().catch(() => ({})) as { domain?: string; years?: number }
    const domain = (body.domain || '').trim().toLowerCase()
    const years = Math.max(1, Math.min(10, Math.floor(body.years || 1) || 1))
    if (!domain || !DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format' }, 400)

    const { data: tenant } = await supabase.from('tenants').select('id, slug, domain').eq('id', tenantId).single()
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (tenant.domain) return c.json({ error: 'This tenant already has a domain attached.' }, 409)

    const { isRegistrarConfigured } = await import('../../services/registrar')
    if (!isRegistrarConfigured()) return c.json({ error: 'Registrar is not configured on this environment' }, 503)
    const avail = await (await getRegistrar()).checkAvailability(domain)
    if (!avail.available) return c.json({ error: 'That domain is not available.' }, 409)
    if (avail.premium) return c.json({ error: 'Premium-priced domain — not registered automatically.' }, 422)

    const result = await handleDomainRegistration({ tenantId, domain, years })
    // Renewals are billed at cost plus the Stripe fee for every customer (services/domainRenewal.ts), so an at-cost
    // registration needs nothing recorded for its renewals.
    await logTenantAudit(tenantId, 'domain_registered_at_cost', { domain: { old: null, new: result.ok ? domain : null } }, 'operator', result.error || 'registered on registrar balance')
    return c.json({ domain, ...result }, result.ok ? 200 : 502)
  } catch (e: any) {
    console.error('[Domain] register-at-cost failed:', e)
    return c.json({ error: e.message || 'Registration failed' }, 500)
  }
})

// ─── Factory: a company's domain — what renewing costs, its renewal status, and buying one ──────────────────
// The company page's Domain renewal panel (platform DomainBilling). Staff only — owner/admin. (10/14)
//   GET  …/domain/billing          what we know: expiry, Namecheap's live renewal price and what we would charge,
//                                   the open renewal invoice, any problem waiting for staff
//   POST …/domain/billing/sync     read the expiry from Namecheap — how a domain registered by hand joins billing,
//                                   and how we learn it is not on our account at all
//   PATCH …/domain/billing         clear a renewal problem once handled; set or remove a hand-set renewal price
//   POST …/domain/register         buy one: { billing: 'customer' } → a Stripe checkout link for the customer (the paid
//                                   webhook registers it); { billing: 'ours' } → registered now on our account (the
//                                   at-cost path, for accounts we bill ourselves)
const DOMAIN_BILLING_COLUMNS = 'id, name, slug, domain, domain_registrar, domain_expires_at, stripe_customer_id, domain_renewal_price_cents, domain_renewal_invoice_id, domain_renewal_paid_invoice_id, domain_renewal_error, phone, address, city, state, zip'

factory.get('/customers/:id/domain/billing', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id') || ''
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant id' }, 400)
  const { data: t, error } = await supabase.from('tenants').select(DOMAIN_BILLING_COLUMNS).eq('id', id).single()
  if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error?.message?.includes('does not exist') ? 503 : 404)
  const { checkTld, renewalChargeCents } = await import('../../config/domainPricing')
  const tld = t.domain ? checkTld(t.domain) : null
  const ours = t.domain_registrar === 'namecheap'
  const liveRenewalCostCents = ours && tld?.ok ? await (await getRegistrar()).getCostCents(tld.tld, 'RENEW') : null
  const coveredByUs = t.domain_renewal_price_cents === 0
  const chargeCents = coveredByUs ? 0 : t.domain_renewal_price_cents && t.domain_renewal_price_cents > 0 ? t.domain_renewal_price_cents : renewalChargeCents(liveRenewalCostCents)
  // Namecheap's own switches, read live, so staff see when one is wrong instead of finding out at expiry (10/14):
  // a domain we BILL needs Namecheap auto-renew OFF (we renew once paid); one we COVER needs it ON (nobody else will).
  const info = ours && t.domain ? await (await getRegistrar()).getDomain(t.domain).catch(() => null) : null
  const namecheapAutoRenew = info ? info.autoRenew : null
  return c.json({
    domain: t.domain, registeredByUs: ours, registrar: t.domain_registrar, expiresAt: t.domain_expires_at,
    hasStripeCustomer: !!t.stripe_customer_id, supportedTld: tld ? tld.ok : null,
    liveRenewalCostCents, renewalChargeCents: chargeCents, priceSetByHand: !!(t.domain_renewal_price_cents && t.domain_renewal_price_cents > 0), coveredByUs,
    openInvoiceId: t.domain_renewal_invoice_id, renewalError: t.domain_renewal_error,
    namecheapAutoRenew,
    namecheapAutoRenewWanted: ours ? coveredByUs : null,
    privacy: info?.privacy ? { state: info.privacy.state, expiresAt: info.privacy.expiresAt ? info.privacy.expiresAt.toISOString() : null } : null,
    // Who a new domain would be registered to — the panel pre-fills it and asks for what is missing. (E2E Run 2)
    registrant: { phone: t.phone || '', address: t.address || '', city: t.city || '', state: t.state || '', zip: t.zip || '' },
    registrantMissing: registrantGaps(t),
  })
})

factory.post('/customers/:id/domain/billing/sync', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id') || ''
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant id' }, 400)
  const { data: t } = await supabase.from('tenants').select('id, domain, domain_registrar, domain_expires_at').eq('id', id).single()
  if (!t?.domain) return c.json({ error: 'This company has no domain on record.' }, 404)
  const info = await (await getRegistrar()).getDomain(t.domain)
  if (!info?.expiresAt || isNaN(info.expiresAt.getTime())) {
    return c.json({ error: 'Namecheap does not show ' + t.domain + ' on our account. If the customer registered it themselves, it is theirs to renew — it is not billed.' }, 404)
  }
  const { error } = await supabase.from('tenants').update({ domain_registrar: 'namecheap', domain_expires_at: info.expiresAt.toISOString() }).eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  await logTenantAudit(id, 'domain_synced', { domain_expires_at: { old: t.domain_expires_at, new: info.expiresAt.toISOString() }, domain_registrar: { old: t.domain_registrar, new: 'namecheap' } }, c.get('user')?.email || 'staff')
  return c.json({ success: true, expiresAt: info.expiresAt.toISOString() })
})

factory.patch('/customers/:id/domain/billing', requireRole('owner', 'admin'), async (c) => {
  const id = c.req.param('id') || ''
  if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant id' }, 400)
  const parsed = await parseJsonBody(c)
  if (parsed.error) return parsed.error
  const body = parsed.data || {}
  const patch: Record<string, any> = {}
  if (body.clearError === true) Object.assign(patch, { domain_renewal_error: null, domain_renewal_invoice_id: null, domain_renewal_paid_invoice_id: null })
  if ('priceCents' in body) {
    // 0 = we cover it (free); null = at cost + card fee; otherwise a hand-set price.
    if (body.priceCents === null) patch.domain_renewal_price_cents = null
    else if (body.priceCents === 0) Object.assign(patch, { domain_renewal_price_cents: 0, domain_renewal_error: null })
    else if (Number.isInteger(body.priceCents) && body.priceCents >= 50 && body.priceCents <= 50_000) patch.domain_renewal_price_cents = body.priceCents
    else return c.json({ error: 'priceCents must be 0 (we cover it), whole cents between 50 and 50000, or null' }, 400)
  }
  if (!Object.keys(patch).length) return c.json({ error: 'Nothing to change' }, 400)
  const { data: before } = await supabase.from('tenants').select(DOMAIN_BILLING_COLUMNS).eq('id', id).single()
  if (!before) return c.json({ error: 'Tenant not found' }, 404)
  const { error } = await supabase.from('tenants').update(patch).eq('id', id)
  if (error) return c.json({ error: error.message }, 500)
  await logTenantAudit(id, 'domain_billing_changed', diffTenantChanges(before, patch), c.get('user')?.email || 'staff')
  return c.json({ success: true })
})

factory.post('/customers/:id/domain/register', requireRole('owner', 'admin'), async (c) => {
  try {
    const id = c.req.param('id') || ''
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant id' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const body = parsed.data || {}
    const domain = String(body.domain || '').trim().toLowerCase()
    const years = Math.max(1, Math.min(10, Math.floor(Number(body.years) || 1)))
    if (!domain || !DOMAIN_RE.test(domain)) return c.json({ error: 'Invalid domain format' }, 400)
    if (body.billing !== 'customer' && body.billing !== 'ours') return c.json({ error: 'billing must be "customer" or "ours"' }, 400)

    const { data: tenant } = await supabase.from('tenants').select('id, domain, stripe_customer_id, phone, address, city, state, zip').eq('id', id).single()
    if (!tenant) return c.json({ error: 'Tenant not found' }, 404)
    if (tenant.domain) return c.json({ error: 'This company already has a domain attached.' }, 409)
    // Who it is registered TO, before anyone is charged (services/domainRegistrant.ts). The panel sends what it
    // collected; it is saved on the company, then the whole contact is checked. (E2E Run 2: charged, then refused.)
    const cleaned = cleanRegistrant(body.registrant)
    if (!cleaned.ok) return c.json({ error: cleaned.error, code: 'registrant_invalid' }, 400)
    if (Object.keys(cleaned.patch).length) {
      const changes = Object.fromEntries(Object.entries(cleaned.patch).filter(([k, v]) => (tenant as any)[k] !== v).map(([k, v]) => [k, { old: (tenant as any)[k] ?? null, new: v }]))
      if (Object.keys(changes).length) {
        const { error: upErr } = await supabase.from('tenants').update(cleaned.patch).eq('id', id)
        if (upErr) return c.json({ error: 'Could not save the address: ' + upErr.message }, 500)
        Object.assign(tenant, cleaned.patch)
        await logTenantAudit(id, 'registrant_updated', changes, c.get('user')?.email || 'staff', 'Domain registrant contact, from Domain billing')
      }
    }
    const gaps = registrantGaps(tenant)
    if (gaps.length) return c.json({ error: registrantMessage(gaps), code: 'registrant_incomplete', missing: gaps }, 422)

    const { isRegistrarConfigured } = await import('../../services/registrar')
    if (!isRegistrarConfigured()) return c.json({ error: 'Registrar is not configured on this environment' }, 503)
    const registrar = await getRegistrar()
    const avail = await registrar.checkAvailability(domain)
    if (!avail.available) return c.json({ error: 'That domain is not available.' }, 409)
    if (avail.premium) return c.json({ error: 'Premium-priced domain — not registered automatically.' }, 422)
    const { checkTld, purchaseChargeCents, domainChargeDescription } = await import('../../config/domainPricing')
    const tld = checkTld(domain)
    if (!tld.ok) return c.json({ error: tld.reason === 'unsupported_tld' ? 'We do not sell .' + tld.tld + ' yet. We sell: ' + tld.supportedTlds.join(', ') : 'Malformed domain' }, 422)

    if (body.billing === 'ours') {
      const result = await handleDomainRegistration({ tenantId: id, domain, years })
      await logTenantAudit(id, 'domain_registered_at_cost', { domain: { old: null, new: result.ok ? domain : null } }, c.get('user')?.email || 'staff', result.error || 'registered on our Namecheap account from the Factory')
      return c.json({ domain, ...result }, result.ok ? 200 : 502)
    }

    if (!tenant.stripe_customer_id) return c.json({ error: 'This company has no Stripe customer yet — they need to have paid for their plan first.' }, 409)
    const charge = purchaseChargeCents(await registrar.getCostCents(tld.tld, 'REGISTER'), years > 1 ? await registrar.getCostCents(tld.tld, 'RENEW') : null, years)
    if (!charge.ok) return c.json({ error: 'Namecheap did not give us a current price for .' + tld.tld + ' — try again in a few minutes.' }, 503)
    const back = FRONTEND_URL.replace(/\/+$/, '') + '/tenants/' + id
    const session = await factoryStripe.createOneTimeCheckoutSession({
      customerId: tenant.stripe_customer_id,
      amountCents: charge.cents,
      productName: 'Domain registration — ' + domain,
      description: domainChargeDescription(domain, years),
      successUrl: back + '?domain=paid',
      cancelUrl: back + '?domain=cancelled',
      metadata: { purpose: 'domain_registration', tenant_id: id, domain, years: String(years) },
    })
    await logTenantAudit(id, 'domain_checkout_created', { domain: { old: null, new: domain } }, c.get('user')?.email || 'staff', '$' + (charge.cents / 100).toFixed(2) + ' checkout for ' + years + ' year(s)')
    return c.json({ url: session.url, amountCents: charge.cents })
  } catch (e: any) {
    console.error('[Domain] factory register failed:', e)
    return c.json({ error: e.message || 'Registration failed' }, 500)
  }
})

// ─── Billing Portal ─────────────────────────────────────────────────────────
factory.post('/customers/:id/billing-portal', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, tenantErr && tenantErr.code !== 'PGRST116' ? 500 : 404)
    if (!tenant.stripe_customer_id) return c.json({ error: 'Customer has no Stripe account. Create a checkout first.' }, 400)

    const returnUrl = tenant.render_frontend_url || (FRONTEND_URL + '/tenants/' + tenantId)
    const result = await factoryStripe.createBillingPortalSession(tenant.stripe_customer_id, returnUrl)
    return c.json({ url: result.url })
  } catch (err: any) {
    console.error('[Stripe] Billing portal error:', err)
    return c.json({ error: err.message }, 500)
  }
})


// ─── Reset Stripe Customer ──────────────────────────────────────────────────
// Creates a new Stripe customer (or verifies existing), updates the tenant record.
// Use when stripe_customer_id is stale/invalid (e.g., test mode ID in live mode).
factory.post('/customers/:id/reset-stripe', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant, error: tenantErr } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (tenantErr || !tenant) return c.json({ error: tenantErr?.message || 'Tenant not found' }, 404)

    const newCustomer = await factoryStripe.createCustomer({
      email: tenant.email, name: tenant.name, phone: tenant.phone,
      metadata: { tenantId: tenant.id, slug: tenant.slug },
    })

    await supabase.from('tenants').update({
      stripe_customer_id: newCustomer.id,
    }).eq('id', tenantId)

    return c.json({ success: true, stripeCustomerId: newCustomer.id, message: 'Stripe customer created/reset' })
  } catch (err: any) {
    console.error('[Stripe] Reset customer error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ─── Switch Billing Mode ────────────────────────────────────────────────────
// Quick-switch between subscription, owned (one-time), and free
factory.post('/customers/:id/switch-billing', requireRole('owner', 'admin'), async (c) => {
  try {
    const tenantId = c.req.param('id')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { mode, amount, plan } = await c.req.json()
    if (!['subscription', 'one_time', 'free'].includes(mode)) return c.json({ error: 'mode must be subscription, one_time, or free' }, 400)

    const updates: Record<string, any> = { billing_type: mode }

    if (mode === 'one_time') {
      updates.billing_status = 'active'
      updates.one_time_amount = amount || null
      updates.paid_at = new Date().toISOString()
      updates.monthly_amount = null
      // Cancel Stripe subscription if exists
      const { data: tenant } = await supabase.from('tenants').select('stripe_subscription_id').eq('id', tenantId).single()
      if (tenant?.stripe_subscription_id) {
        try { await factoryStripe.cancelSubscription(tenant.stripe_subscription_id) } catch (e: any) { console.warn('[Stripe] Cancel sub failed:', e.message) }
        updates.stripe_subscription_id = null
      }
    } else if (mode === 'subscription') {
      updates.billing_status = 'pending'
      updates.monthly_amount = amount || null
      updates.one_time_amount = null
      updates.paid_at = null
    } else if (mode === 'free') {
      updates.billing_status = 'active'
      updates.monthly_amount = null
      updates.one_time_amount = null
    }

    if (plan) updates.plan = plan

    const { error } = await supabase.from('tenants').update(updates).eq('id', tenantId)
    if (error) return c.json({ error: error.message }, 500)

    return c.json({ success: true, mode, message: `Billing switched to ${mode}` })
  } catch (err: any) {
    console.error('[Billing] Switch error:', err)
    return c.json({ error: err.message }, 500)
  }
})

// ─── Billing Summary ────────────────────────────────────────────────────────
factory.get('/billing/summary', async (c) => {
  try {
    // Single query instead of 3 sequential queries (fixes 23s response times)
    const { data: tenants } = await supabase.from('tenants')
      .select('name, monthly_amount, one_time_amount, paid_at, plan, email, billing_type, billing_status')
      .or('billing_status.eq.active,billing_status.eq.past_due,billing_type.eq.one_time')

    const all = tenants || []
    const subscriptions = all.filter((t: any) => t.billing_type === 'subscription' && t.billing_status === 'active')
      .map((t: any) => ({ name: t.name, monthly_amount: t.monthly_amount, plan: t.plan }))
    const oneTime = all.filter((t: any) => t.billing_type === 'one_time')
      .map((t: any) => ({ name: t.name, one_time_amount: t.one_time_amount, paid_at: t.paid_at }))
    const pastDue = all.filter((t: any) => t.billing_status === 'past_due')
      .map((t: any) => ({ name: t.name, monthly_amount: t.monthly_amount, email: t.email }))

    const mrr = subscriptions.reduce((sum: number, t: any) => sum + (parseFloat(t.monthly_amount) || 0), 0)
    const totalOneTime = oneTime.reduce((sum: number, t: any) => sum + (parseFloat(t.one_time_amount) || 0), 0)

    return c.json({
      mrr,
      arr: mrr * 12,
      totalOneTimeRevenue: totalOneTime,
      activeSubscriptions: subscriptions.length,
      pastDueCount: pastDue.length,
      pastDueCustomers: pastDue,
      subscriptions,
      oneTimeCustomers: oneTime,
    })
  } catch (err: any) {
    console.error('[Billing] Summary error:', err)
    return c.json({ mrr: 0, arr: 0, totalOneTimeRevenue: 0, activeSubscriptions: 0, pastDueCount: 0 })
  }
})


// ─── Analytics ──────────────────────────────────────────────────────────────
factory.get('/analytics', async (c) => {
  try {
    const from = c.req.query('from')
    const to = c.req.query('to')

    // Parallel queries instead of sequential (fixes slow response times)
    let tenantsQ = supabase.from('tenants').select('id, created_at, plan, monthly_amount, features, products, status')
    let jobsQ = supabase.from('factory_jobs').select('status, created_at')
    let ticketsQ = supabase.from('support_tickets').select('status, resolved_at, created_at, rating')

    if (from) {
      tenantsQ = tenantsQ.gte('created_at', from)
      jobsQ = jobsQ.gte('created_at', from)
      ticketsQ = ticketsQ.gte('created_at', from)
    }
    if (to) {
      // Use end of day for the 'to' date so records on that day are included
      const toEnd = to.length === 10 ? to + 'T23:59:59.999Z' : to
      tenantsQ = tenantsQ.lte('created_at', toEnd)
      jobsQ = jobsQ.lte('created_at', toEnd)
      ticketsQ = ticketsQ.lte('created_at', toEnd)
    }

    const [tenantsRes, jobsRes, ticketsRes] = await Promise.all([tenantsQ, jobsQ, ticketsQ])

    const all = tenantsRes.data || []

    // Revenue by month
    const revByMonth: Record<string, { mrr: number; count: number }> = {}
    for (const t of all) {
      if (!t.created_at) continue
      const m = t.created_at.slice(0, 7)
      if (!revByMonth[m]) revByMonth[m] = { mrr: 0, count: 0 }
      revByMonth[m].mrr += parseFloat(t.monthly_amount) || 0
      revByMonth[m].count += 1
    }
    const revenueByMonth = Object.entries(revByMonth)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, v]) => ({ month, mrr: Math.round(v.mrr * 100) / 100, count: v.count }))

    // Customer growth
    const growthByMonth: Record<string, number> = {}
    for (const t of all) {
      if (!t.created_at) continue
      const m = t.created_at.slice(0, 7)
      growthByMonth[m] = (growthByMonth[m] || 0) + 1
    }
    const sortedMonths = Object.keys(growthByMonth).sort()
    let cumulative = 0
    const customerGrowth = sortedMonths.map(month => {
      const newCount = growthByMonth[month]
      cumulative += newCount
      return { month, total: cumulative, new: newCount }
    })

    // Plan distribution
    const planCounts: Record<string, number> = {}
    for (const t of all) {
      const p = t.plan || 'unknown'
      planCounts[p] = (planCounts[p] || 0) + 1
    }
    const planDistribution = Object.entries(planCounts).map(([plan, count]) => ({ plan, count }))

    // Deploy metrics from factory_jobs
    const allJobs = jobsRes.data || []
    const deployMetrics = {
      total: allJobs.length,
      successful: allJobs.filter((j: any) => j.status === 'deployed' || j.status === 'complete').length,
      failed: allJobs.filter((j: any) => j.status === 'failed').length,
    }

    // Ticket metrics
    const allTickets = ticketsRes.data || []
    const openTickets = allTickets.filter((t: any) => t.status === 'open' || t.status === 'in_progress').length
    const resolved = allTickets.filter((t: any) => t.resolved_at && t.created_at)
    let avgResolutionHours = 0
    if (resolved.length > 0) {
      const totalHours = resolved.reduce((sum: number, t: any) => {
        return sum + (new Date(t.resolved_at).getTime() - new Date(t.created_at).getTime()) / 3600000
      }, 0)
      avgResolutionHours = Math.round((totalHours / resolved.length) * 10) / 10
    }
    const rated = allTickets.filter((t: any) => t.rating != null)
    const avgRating = rated.length > 0
      ? Math.round((rated.reduce((s: number, t: any) => s + t.rating, 0) / rated.length) * 10) / 10
      : 0

    const ticketMetrics = { open: openTickets, avgResolutionHours, avgRating }

    // Feature adoption from tenants.features JSON
    const featureCounts: Record<string, number> = {}
    for (const t of all) {
      const feats = Array.isArray(t.features) ? t.features : []
      for (const f of feats) {
        if (typeof f === 'string') featureCounts[f] = (featureCounts[f] || 0) + 1
      }
    }
    const featureAdoption = Object.entries(featureCounts)
      .map(([feature, count]) => ({ feature, count }))
      .sort((a, b) => b.count - a.count)

    // Top products from tenants.products
    const productCounts: Record<string, number> = {}
    for (const t of all) {
      const prods = Array.isArray(t.products) ? t.products : []
      for (const p of prods) {
        if (typeof p === 'string') productCounts[p] = (productCounts[p] || 0) + 1
      }
    }
    const topProducts = Object.entries(productCounts)
      .map(([product, count]) => ({ product, count }))
      .sort((a, b) => b.count - a.count)

    return c.json({
      revenueByMonth,
      customerGrowth,
      planDistribution,
      deployMetrics,
      ticketMetrics,
      featureAdoption,
      topProducts,
    })
  } catch (err: any) {
    console.error('[Analytics] Error:', err)
    return c.json({ error: 'Failed to load analytics' }, 500)
  }
})


// ─── Plans (public) ─────────────────────────────────────────────────────────
// Reads pricing from factory_pricing table per product. Falls back to defaults.
// Usage: /plans?product=crm-fieldservice (defaults to 'crm')
factory.get('/plans', async (c) => {
  const product = (c.req.query('product') || 'crm').toLowerCase()
  const defaults = getProductDefaults(product)
  try {
    const { data } = await supabase.from('factory_pricing').select('*').eq('product', product).single()
    if (data) {
      return c.json({
        product,
        plans: data.saas_tiers,
        selfHosted: data.self_hosted,
        selfHostedAddons: data.self_hosted_addons,
        deployServices: data.deploy_services,
        addons: data.feature_bundles,
      })
    }
  } catch {}
  // Auto-seed this product on first request
  try {
    await supabase.from('factory_pricing').upsert({ product, ...defaults })
  } catch {}
  return c.json({
    product,
    plans: defaults.saas_tiers,
    selfHosted: defaults.self_hosted,
    selfHostedAddons: defaults.self_hosted_addons,
    deployServices: defaults.deploy_services,
    addons: defaults.feature_bundles,
  })
})

// ─── Pricing Admin (authenticated) ──────────────────────────────────────────
// GET /pricing — returns all products' pricing
factory.get('/pricing', authenticate, requireRole('owner', 'admin'), async (c) => {
  const { data, error: selectErr } = await supabase.from('factory_pricing').select('*').order('product')
  if (selectErr) {
    console.error('[Pricing] Failed to read factory_pricing:', selectErr.message)
    return c.json({ error: 'Failed to load pricing: ' + selectErr.message }, 500)
  }
  // Auto-seed any missing products with their specific defaults
  const existingProducts = new Set((data || []).map((r: any) => r.product))
  const toSeed = PRODUCTS.filter(p => !existingProducts.has(p.id))
  if (toSeed.length > 0) {
    const rows = toSeed.map(p => ({ product: p.id, ...getProductDefaults(p.id) }))
    const { error: seedErr } = await supabase.from('factory_pricing').upsert(rows)
    if (seedErr) console.error('[Pricing] Failed to seed defaults:', seedErr.message)
  }
  // Return all products
  if (toSeed.length > 0 || !data?.length) {
    const { data: all, error: reloadErr } = await supabase.from('factory_pricing').select('*').order('product')
    if (reloadErr) console.error('[Pricing] Reload failed:', reloadErr.message)
    return c.json({ products: PRODUCTS, pricing: all || [] })
  }
  return c.json({ products: PRODUCTS, pricing: data })
})

// PUT /pricing — saves pricing for a specific product
factory.put('/pricing', authenticate, requireRole('owner', 'admin'), async (c) => {
  const body = await c.req.json()
  if (!body.product) return c.json({ error: 'product is required' }, 400)
  const { error } = await supabase.from('factory_pricing').upsert({
    product: body.product,
    updated_at: new Date().toISOString(),
    updated_by: (c as any).get?.('userEmail') || 'admin',
    saas_tiers: body.saas_tiers,
    self_hosted: body.self_hosted,
    self_hosted_addons: body.self_hosted_addons,
    deploy_services: body.deploy_services,
    feature_bundles: body.feature_bundles,
  })
  if (error) return c.json({ error: error.message }, 500)
  return c.json({ success: true })
})

}
