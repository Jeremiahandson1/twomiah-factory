import { supabase, requireRole } from '../../middleware/auth'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, checkCronSecret, checkFactoryKey, FRONTEND_URL } from './shared'
import factoryStripe from '../../services/factoryStripe'
import { getLedger, debit, chargeMonthlyCampaignFees } from '../../services/messagingWallet'
import { MESSAGING_ENABLE_MONTHLY_CENTS, TWILIO_COSTS, AI_ENABLE_MONTHLY_CENTS, aiCostCents } from '../../config/messagingCosts'

// Messaging (SMS) usage billing: the $10/mo enable line + the prepaid at-cost
// wallet. See services/messagingWallet.ts, config/messagingCosts.ts, and the
// /stripe/webhook side-effects in billing.ts that credit the wallet / mark
// enabled on payment.

const MIN_TOPUP_CENTS = 500      // $5
const MAX_TOPUP_CENTS = 50000    // $500

export function registerMessagingRoutes(factory: FactoryApp) {
  // ─── Status: enabled + wallet balance + recent ledger ────────────────────────
  factory.get('/customers/:id/messaging', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants')
      .select('messaging_enabled, messaging_enabled_at, messaging_wallet_cents, ai_enabled, ai_enabled_at').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    let ledger: any[] = []
    try { ledger = await getLedger(id, 50) } catch { /* table may be empty */ }
    return c.json({
      enabled: !!t.messaging_enabled,
      enabledAt: t.messaging_enabled_at || null,
      walletCents: t.messaging_wallet_cents ?? 0,
      enableMonthlyCents: MESSAGING_ENABLE_MONTHLY_CENTS,
      aiEnabled: !!t.ai_enabled,
      aiEnabledAt: t.ai_enabled_at || null,
      aiEnableMonthlyCents: AI_ENABLE_MONTHLY_CENTS,
      ledger,
    })
  })

  // ─── Enable messaging: $10/mo checkout ───────────────────────────────────────
  factory.post('/customers/:id/messaging/enable', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    if (t.messaging_enabled) return c.json({ error: 'Messaging already enabled' }, 409)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)

    try {
      const result = await factoryStripe.createMessagingEnableCheckout(
        { id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id },
        MESSAGING_ENABLE_MONTHLY_CENTS,
      )
      if (result.stripeCustomerId && !t.stripe_customer_id) {
        await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', id)
      }
      return c.json({ url: result.url })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Disable messaging: cancel the $10/mo line ───────────────────────────────
  factory.post('/customers/:id/messaging/disable', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('messaging_enabled, messaging_sub_id').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    try {
      if (t.messaging_sub_id) {
        await factoryStripe.cancelSubscription(t.messaging_sub_id, { atPeriodEnd: true })
      }
      await supabase.from('tenants').update({ messaging_enabled: false, messaging_sub_id: null }).eq('id', id)
      await logTenantAudit(id, 'messaging_disable', { messaging_enabled: { old: true, new: false } }, c.get('user')?.email, 'Messaging disabled')
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Top up the prepaid wallet (one-time checkout) ───────────────────────────
  factory.post('/customers/:id/messaging/wallet/topup', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const cents = Math.round(Number(parsed.data?.amountCents))
    if (!Number.isFinite(cents) || cents < MIN_TOPUP_CENTS || cents > MAX_TOPUP_CENTS) {
      return c.json({ error: `amountCents must be between ${MIN_TOPUP_CENTS} and ${MAX_TOPUP_CENTS}` }, 400)
    }
    const { data: t, error } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    if (!t.stripe_customer_id) return c.json({ error: 'Tenant has no Stripe customer — enable billing first' }, 400)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)

    try {
      const { url } = await factoryStripe.createOneTimeCheckoutSession({
        customerId: t.stripe_customer_id,
        amountCents: cents,
        productName: 'Messaging wallet top-up',
        description: `$${(cents / 100).toFixed(2)} added to messaging usage wallet (at-cost SMS/A2P)`,
        successUrl: FRONTEND_URL + '/tenants/' + id + '?wallet=topped_up',
        cancelUrl: FRONTEND_URL + '/tenants/' + id + '?wallet=canceled',
        // The webhook credits the wallet on payment (see billing.ts).
        metadata: { addon: 'messaging_wallet_topup', tenant_id: id, topup_cents: String(cents) },
      })
      return c.json({ url })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Enable AI ($10/mo) — same shape as messaging, shares the wallet ─────────
  factory.post('/customers/:id/ai/enable', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    if (t.ai_enabled) return c.json({ error: 'AI already enabled' }, 409)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)
    try {
      const result = await factoryStripe.createAiEnableCheckout(
        { id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id },
        AI_ENABLE_MONTHLY_CENTS,
      )
      if (result.stripeCustomerId && !t.stripe_customer_id) {
        await supabase.from('tenants').update({ stripe_customer_id: result.stripeCustomerId }).eq('id', id)
      }
      return c.json({ url: result.url })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  factory.post('/customers/:id/ai/disable', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('ai_enabled, ai_sub_id').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    try {
      if (t.ai_sub_id) await factoryStripe.cancelSubscription(t.ai_sub_id, { atPeriodEnd: true })
      await supabase.from('tenants').update({ ai_enabled: false, ai_sub_id: null }).eq('id', id)
      await logTenantAudit(id, 'ai_disable', { ai_enabled: { old: true, new: false } }, c.get('user')?.email, 'AI disabled')
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── AI token usage report (CRM → factory), at cost, shared wallet ───────────
  factory.post('/internal/ai/usage/:tenantId', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const inTok = Math.round(Number(parsed.data?.inputTokens) || 0)
    const outTok = Math.round(Number(parsed.data?.outputTokens) || 0)
    if (inTok < 0 || outTok < 0 || (inTok === 0 && outTok === 0)) return c.json({ error: 'inputTokens/outputTokens required' }, 400)
    const model = typeof parsed.data?.model === 'string' ? parsed.data.model : undefined
    const cents = aiCostCents(inTok, outTok, model)
    try {
      if (cents > 0) await debit(tenantId, cents, 'ai_tokens', {
        twilioRef: model,
        allowNegative: true,
      })
      return c.json({ success: true, cents })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Per-message usage report (CRM → factory) ────────────────────────────────
  // The tenant's CRM POSTs each outbound send's segment count here (authed with
  // its FACTORY_SYNC_KEY) and we debit the wallet AT COST. Post-send + allowNegative
  // (the message already went out); a negative balance blocks new A2P actions and
  // surfaces in the UI as "top up". /internal/* → JWT-exempt, key-checked here.
  factory.post('/internal/messaging/usage/:tenantId', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const segments = Math.round(Number(parsed.data?.segments))
    if (!Number.isFinite(segments) || segments <= 0 || segments > 1000) return c.json({ error: 'segments must be 1–1000' }, 400)
    try {
      await debit(tenantId, segments * TWILIO_COSTS.perSegmentCents, 'sms_segment', {
        twilioRef: typeof parsed.data?.twilioSid === 'string' ? parsed.data.twilioSid : undefined,
        allowNegative: true,
      })
      return c.json({ success: true })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Cron: charge the recurring at-cost monthly A2P campaign fee ─────────────
  // Public path (/internal/*); does its own CRON_SECRET check.
  factory.post('/internal/messaging/monthly', async (c) => {
    if (!checkCronSecret(c)) return c.json({ error: 'Invalid cron secret' }, 401)
    try {
      const res = await chargeMonthlyCampaignFees()
      return c.json({ success: true, ...res })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })
}
