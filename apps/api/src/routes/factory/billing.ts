import { authenticate, supabase, requireRole } from '../../middleware/auth'
import { findRenderServicesBySlug, wireDomainInfrastructure } from '../../services/deploy'
import factoryStripe from '../../services/factoryStripe'
import { notifyBillingPastDue } from '../../services/email'
import { PRODUCTS, getProductDefaults } from '../../config/pricing'
import { getRegistrar } from '../../services/registrar'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, diffTenantChanges, FRONTEND_URL } from './shared'
import { triggerAutoDeploy } from './deploy'

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
    const { planId, billingCycle, trialDays } = parsedBody.data
    if (billingCycle && !['monthly', 'annual'].includes(billingCycle)) return c.json({ error: 'billingCycle must be "monthly" or "annual"' }, 400)
    if (trialDays !== undefined && (typeof trialDays !== 'number' || trialDays < 0 || !Number.isInteger(trialDays))) return c.json({ error: 'trialDays must be a non-negative integer' }, 400)
    const result = await factoryStripe.createSubscriptionCheckout(
      { id: tenant.id, email: tenant.email, name: tenant.name, phone: tenant.phone, stripeCustomerId: tenant.stripe_customer_id },
      { planId: planId || tenant.plan || 'starter', billingCycle: billingCycle || 'monthly', trialDays }
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
      { planId: planId || tenant.plan || 'pro' }
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
      await supabase.from('tenants').update(result.updates).eq('id', result.factoryCustomerId)
      if (preTenant) {
        const changes = diffTenantChanges(preTenant, result.updates)
        if (Object.keys(changes).length > 0) {
          await logTenantAudit(result.factoryCustomerId, 'billing_change', changes, 'stripe-webhook', `Event: ${event.type}`)
        }
      }
    } else if (result.handled && result.lookupField && result.lookupValue && result.updates) {
      // Lookup tenant id for audit
      const { data: lookedUp } = await supabase.from('tenants').select('*').eq(result.lookupField, result.lookupValue).single()
      await supabase.from('tenants').update(result.updates).eq(result.lookupField, result.lookupValue)
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
async function handleDomainRegistration(opts: {
  tenantId: string
  domain: string
  years: number
  paymentIntent: string
  sessionId: string
}): Promise<void> {
  const { tenantId, domain, years, paymentIntent, sessionId } = opts
  console.log('[Domain] Processing registration:', domain, 'for tenant', tenantId)

  const { data: tenant, error: tErr } = await supabase.from('tenants')
    .select('id, slug, name, email, admin_email, phone, address, city, state, zip, factory_sync_key')
    .eq('id', tenantId).single()
  if (tErr || !tenant) {
    console.error('[Domain] Tenant not found during registration:', tenantId)
    return
  }

  const { getRegistrar } = await import('../../services/registrar/index')
  const registrar = await getRegistrar()
  const ownerName = (tenant.name || 'Admin User').split(/\s+/)
  const firstName = ownerName[0] || 'Admin'
  const lastName = ownerName.slice(1).join(' ') || 'User'
  // Namecheap requires phone for registration — if the tenant didn't
  // provide one we can't proceed. Refund + email.
  if (!tenant.phone) {
    console.warn('[Domain] Tenant has no phone — refunding')
    await refundAndEmail({ tenant, paymentIntent, domain, reason: 'no_phone' })
    return
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
    await refundAndEmail({ tenant, paymentIntent, domain, reason: 'registrar_failed', detail: reg.error })
    return
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
  const services = await findRenderServicesBySlug(tenant.slug)
  const siteServiceId = services.site || services['website-premium'] || services.website
  const backendServiceId = services.backend || services.api
  try {
    const wire = await wireDomainInfrastructure({ domain, siteServiceId, backendServiceId })
    if (wire.cloudflareZoneId) {
      await supabase.from('tenants').update({ cloudflare_zone_id: wire.cloudflareZoneId }).eq('id', tenantId)
    }
    if (wire.sendgridDomainAuthId) {
      await supabase.from('tenants').update({ sendgrid_domain_auth_id: wire.sendgridDomainAuthId }).eq('id', tenantId)
    }
    console.log('[Domain] Wire infra:', wire.success ? 'ok' : 'partial', wire.errors)
  } catch (e: any) {
    console.error('[Domain] Wire infra threw:', e.message)
    // Don't refund — the domain IS registered, just the DNS auto-wire
    // hit a snag. Customer keeps the domain; we surface the issue in
    // support so we can finish manually.
  }
}

async function refundAndEmail(opts: {
  tenant: { id: string; admin_email: string | null; email: string | null; name: string | null }
  paymentIntent: string
  domain: string
  reason: 'no_phone' | 'registrar_failed' | string
  detail?: string
}): Promise<void> {
  try {
    const r = await factoryStripe.refundPaymentIntent(opts.paymentIntent, 'requested_by_customer')
    console.log('[Domain] Refund issued:', r.refundId, r.status)
  } catch (e: any) {
    console.error('[Domain] Refund failed:', e.message)
  }
  const to = opts.tenant.admin_email || opts.tenant.email
  if (!to) return
  const { sendEmail } = await import('../../services/email')
  const reasonText = opts.reason === 'no_phone'
    ? 'we did not have a phone number on file for your account, and the domain registrar requires one'
    : 'the domain registrar rejected the request: ' + (opts.detail || 'unknown error')
  await sendEmail(to,
    'About your ' + opts.domain + ' registration',
    '<p>Hi ' + (opts.tenant.name || 'there') + ',</p>' +
    '<p>We tried to register <strong>' + opts.domain + '</strong> for you and it didn\'t go through — ' + reasonText + '.</p>' +
    '<p>We\'ve fully refunded the charge to your card. It should appear back in your account in 5-10 business days.</p>' +
    '<p>If you want to try again, you can either:</p>' +
    '<ul><li>Go back to your admin → Domain → Buy a new one and try a different name</li>' +
    '<li>Or if you already own a domain elsewhere, use the "I already own a domain" tab instead</li></ul>' +
    '<p>Reply to this email if you want help — a real person reads it.</p>'
  ).catch(e => console.warn('[Domain] Email send failed:', e?.message))
}

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
