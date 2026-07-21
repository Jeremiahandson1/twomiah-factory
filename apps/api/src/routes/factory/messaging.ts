import { supabase, requireRole } from '../../middleware/auth'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, checkCronSecret, checkFactoryKey, FRONTEND_URL } from './shared'
import factoryStripe from '../../services/factoryStripe'
import { getLedger, debit, chargeMonthlyCampaignFees } from '../../services/messagingWallet'
import { MESSAGING_ENABLE_MONTHLY_CENTS, TWILIO_COSTS, AI_ENABLE_MONTHLY_CENTS, aiCostCents } from '../../config/messagingCosts'
import { verifyPortalToken, portalUrlFor } from '../../lib/portal'
import { notifyMessagingLowBalance } from '../../services/email'

// Messaging (SMS) usage billing: the $10/mo enable line + the prepaid at-cost
// wallet. See services/messagingWallet.ts, config/messagingCosts.ts, and the
// /stripe/webhook side-effects in billing.ts that credit the wallet / mark
// enabled on payment.

const MIN_TOPUP_CENTS = 500      // $5
const MAX_TOPUP_CENTS = 50000    // $500

// Self-contained tenant billing page (no build step, no external assets). Reads
// ?tenant= & ?t= from the URL and calls the token-authed self endpoints.
const SMS_BILLING_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>SMS & AI Billing</title>
<style>
  :root{color-scheme:dark}
  *{box-sizing:border-box}
  body{margin:0;background:#0b0f17;color:#e5e7eb;font:15px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:560px;margin:0 auto;padding:24px 16px}
  h1{font-size:20px;margin:0 0 4px} .sub{color:#9ca3af;font-size:13px;margin:0 0 20px}
  .card{background:#111827;border:1px solid #1f2937;border-radius:14px;padding:20px;margin-bottom:16px}
  .row{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:8px 0}
  .muted{color:#9ca3af} .bal{font-size:26px;font-weight:700} .neg{color:#f87171}
  .badge{font-size:12px;padding:3px 9px;border-radius:999px;border:1px solid}
  .on{color:#34d399;border-color:#065f46;background:#064e3b55}
  .off{color:#9ca3af;border-color:#374151;background:#1f293755}
  button{font:inherit;font-weight:600;border:0;border-radius:10px;padding:9px 14px;cursor:pointer;color:#fff;background:#4f46e5}
  button:hover{background:#6366f1} button:disabled{background:#374151;color:#9ca3af;cursor:default}
  input{font:inherit;width:110px;padding:9px;border-radius:10px;border:1px solid #374151;background:#0b0f17;color:#fff}
  table{width:100%;border-collapse:collapse;font-size:13px;margin-top:8px}
  td,th{text-align:left;padding:6px 4px;border-top:1px solid #1f2937} th{color:#9ca3af;font-weight:500}
  .r{text-align:right} .grn{color:#34d399} .err{color:#f87171;font-size:13px}
</style></head>
<body><div class="wrap">
  <h1>SMS &amp; AI Billing</h1>
  <p class="sub">Manage your text messaging &amp; AI usage. Charges are billed at cost from a prepaid wallet.</p>
  <div id="app" class="muted">Loading…</div>
</div>
<script>
  var q = new URLSearchParams(location.search);
  var tenant = q.get('tenant'), t = q.get('t');
  var API = location.origin + '/api/v1/factory/internal/messaging/self/' + tenant;
  function money(c){ return (c<0?'-$':'$') + (Math.abs(c)/100).toFixed(2); }
  var LABEL = { topup:'Top-up', a2p_registration:'SMS registration', monthly_campaign:'Monthly fee', sms_segment:'SMS segments', ai_tokens:'AI tokens' };
  function el(h){ var d=document.createElement('div'); d.innerHTML=h; return d.firstElementChild; }
  async function api(path, method, body){
    var r = await fetch(API + path + (path.indexOf('?')<0?'?':'&') + 't=' + encodeURIComponent(t), {
      method: method||'GET', headers: body?{'Content-Type':'application/json'}:{}, body: body?JSON.stringify(body):undefined });
    var d = await r.json().catch(function(){return {}}); if(!r.ok) throw new Error(d.error||'Request failed'); return d;
  }
  async function act(path, body){ try{ var d = await api(path, 'POST', body); if(d.url){ location.href=d.url; return; } load(); }catch(e){ alert(e.message); } }
  async function load(){
    var app = document.getElementById('app');
    if(!tenant || !t){ app.innerHTML = '<p class="err">Invalid or missing billing link.</p>'; return; }
    try{
      var s = await api('');
      var enFee = money(s.enableMonthlyCents), aiFee = money(s.aiEnableMonthlyCents), bal = s.walletCents||0;
      var rows = (s.ledger||[]).map(function(l){
        return '<tr><td class="muted">'+ new Date(l.created_at).toLocaleDateString() +'</td><td>'+ (LABEL[l.reason]||l.reason) +'</td><td class="r '+(l.kind==='credit'?'grn':'')+'">'+ (l.kind==='credit'?'+':'-') + money(l.amount_cents).replace('-','') +'</td><td class="r muted">'+ money(l.balance_after_cents) +'</td></tr>';
      }).join('');
      app.innerHTML =
        '<div class="card"><div class="row"><span>SMS / Messaging</span>'+
          (s.enabled ? '<span class="badge on">On · '+enFee+'/mo</span>' : '<button id="enSms">Enable · '+enFee+'/mo</button>') + '</div>'+
          '<div class="row"><span>AI Assistant</span>'+
          (s.aiEnabled ? '<span class="badge on">On · '+aiFee+'/mo</span>' : '<button id="enAi">Enable · '+aiFee+'/mo</button>') + '</div></div>'+
        (s.enabled || s.aiEnabled ?
          '<div class="card"><div class="row"><span class="muted">Wallet balance</span><span class="bal '+(bal<0?'neg':'')+'">'+money(bal)+'</span></div>'+
            (bal<0?'<p class="err">Negative balance — top up to keep sending.</p>':'')+
            '<div class="row"><span class="muted">Add funds (USD)</span><span><input id="amt" type="number" min="5" max="500" value="20"> <button id="topup">Add</button></span></div>'+
            (rows?'<table><thead><tr><th>Date</th><th>Item</th><th class="r">Amount</th><th class="r">Balance</th></tr></thead><tbody>'+rows+'</tbody></table>':'') +
          '</div>'
          : '<p class="muted">Enable a service above to fund your usage wallet.</p>');
      var b;
      if(b=document.getElementById('enSms')) b.onclick=function(){ act('/enable'); };
      if(b=document.getElementById('enAi')) b.onclick=function(){ act('/ai-enable'); };
      if(b=document.getElementById('topup')) b.onclick=function(){ var v=parseFloat(document.getElementById('amt').value); if(v>=5) act('/topup',{amountCents:Math.round(v*100)}); };
    }catch(e){ app.innerHTML = '<p class="err">'+ e.message +'</p>'; }
  }
  load();
</script></body></html>`

export function registerMessagingRoutes(factory: FactoryApp) {
  // ─── Status: enabled + wallet balance + recent ledger ────────────────────────
  // Admin mints a self-serve billing link to hand to a tenant.
  factory.post('/customers/:id/messaging/portal-link', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t } = await supabase.from('tenants').select('id').eq('id', id).single()
    if (!t) return c.json({ error: 'Tenant not found' }, 404)
    return c.json({ url: portalUrlFor(id) })
  })

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
      let balance: number | undefined
      if (cents > 0) balance = await debit(tenantId, cents, 'ai_tokens', {
        twilioRef: model,
        allowNegative: true,
      })
      return c.json({ success: true, cents, balance })
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
      const balance = await debit(tenantId, segments * TWILIO_COSTS.perSegmentCents, 'sms_segment', {
        twilioRef: typeof parsed.data?.twilioSid === 'string' ? parsed.data.twilioSid : undefined,
        allowNegative: true,
      })
      return c.json({ success: true, balance })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Wallet balance (CRM → factory), for the pre-send hard-gate ──────────────
  factory.get('/internal/messaging/balance/:tenantId', async (c) => {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: tenant } = await supabase.from('tenants').select('id, factory_sync_key, messaging_wallet_cents, messaging_enabled').eq('id', tenantId).single()
    if (!tenant || !checkFactoryKey(c, tenant)) return c.json({ error: 'Unauthorized' }, 401)
    return c.json({ walletCents: tenant.messaging_wallet_cents ?? 0, enabled: !!tenant.messaging_enabled })
  })

  // ─── Tenant self-serve billing (CRM → factory, X-Factory-Key) ────────────────
  // The tenant's CRM proxies these so a tenant can enable messaging/AI and fund
  // their own wallet without the platform admin. Same Stripe flows + webhook as
  // the admin routes; auth is the tenant's own factory sync key.
  // Auth = the tenant's factory key (CRM-to-factory) OR a valid portal token
  // (?t=, used by the browser billing page). Either proves tenant scope.
  async function selfTenant(c: any) {
    const tenantId = c.req.param('tenantId')
    if (!UUID_RE.test(tenantId)) return { err: c.json({ error: 'Invalid tenant ID format' }, 400) }
    const { data: t } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (!t) return { err: c.json({ error: 'Unauthorized' }, 401) }
    const okKey = checkFactoryKey(c, t)
    const okToken = verifyPortalToken(c.req.query('t') || '') === tenantId
    if (!okKey && !okToken) return { err: c.json({ error: 'Unauthorized' }, 401) }
    return { t }
  }

  // CRM (factory key) mints a signed link to the hosted billing page.
  factory.post('/internal/messaging/self/:tenantId/portal', async (c) => {
    const { t, err } = await selfTenant(c); if (err) return err
    return c.json({ url: portalUrlFor(t.id) })
  })

  // The hosted billing page (public; its API calls are token-authed).
  factory.get('/public/sms-billing', (c) => c.html(SMS_BILLING_HTML))

  factory.get('/internal/messaging/self/:tenantId', async (c) => {
    const { t, err } = await selfTenant(c); if (err) return err
    let ledger: any[] = []
    try { ledger = await getLedger(t.id, 50) } catch { /* empty */ }
    return c.json({
      enabled: !!t.messaging_enabled, aiEnabled: !!t.ai_enabled,
      walletCents: t.messaging_wallet_cents ?? 0,
      enableMonthlyCents: MESSAGING_ENABLE_MONTHLY_CENTS, aiEnableMonthlyCents: AI_ENABLE_MONTHLY_CENTS,
      ledger,
    })
  })

  factory.post('/internal/messaging/self/:tenantId/enable', async (c) => {
    const { t, err } = await selfTenant(c); if (err) return err
    if (t.messaging_enabled) return c.json({ error: 'Already enabled' }, 409)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)
    const r = await factoryStripe.createMessagingEnableCheckout({ id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id }, MESSAGING_ENABLE_MONTHLY_CENTS)
    if (r.stripeCustomerId && !t.stripe_customer_id) await supabase.from('tenants').update({ stripe_customer_id: r.stripeCustomerId }).eq('id', t.id)
    return c.json({ url: r.url })
  })

  factory.post('/internal/messaging/self/:tenantId/ai-enable', async (c) => {
    const { t, err } = await selfTenant(c); if (err) return err
    if (t.ai_enabled) return c.json({ error: 'Already enabled' }, 409)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)
    const r = await factoryStripe.createAiEnableCheckout({ id: t.id, email: t.email, name: t.name, phone: t.phone, stripeCustomerId: t.stripe_customer_id }, AI_ENABLE_MONTHLY_CENTS)
    if (r.stripeCustomerId && !t.stripe_customer_id) await supabase.from('tenants').update({ stripe_customer_id: r.stripeCustomerId }).eq('id', t.id)
    return c.json({ url: r.url })
  })

  factory.post('/internal/messaging/self/:tenantId/topup', async (c) => {
    const { t, err } = await selfTenant(c); if (err) return err
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const cents = Math.round(Number(parsed.data?.amountCents))
    if (!Number.isFinite(cents) || cents < MIN_TOPUP_CENTS || cents > MAX_TOPUP_CENTS) return c.json({ error: `amountCents must be ${MIN_TOPUP_CENTS}–${MAX_TOPUP_CENTS}` }, 400)
    if (!t.stripe_customer_id) return c.json({ error: 'Enable messaging first' }, 400)
    if (!factoryStripe.isConfigured()) return c.json({ error: 'Stripe not configured' }, 400)
    const { url } = await factoryStripe.createOneTimeCheckoutSession({
      customerId: t.stripe_customer_id, amountCents: cents, productName: 'Messaging wallet top-up',
      description: `$${(cents / 100).toFixed(2)} added to messaging usage wallet`,
      successUrl: FRONTEND_URL + '/tenants/' + t.id + '?wallet=topped_up', cancelUrl: FRONTEND_URL + '/tenants/' + t.id + '?wallet=canceled',
      metadata: { addon: 'messaging_wallet_topup', tenant_id: t.id, topup_cents: String(cents) },
    })
    return c.json({ url })
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

  // ─── Cron: email a top-up nudge to tenants whose wallet is low/negative ───────
  // Fully hands-off: the tenant gets a portal link and self-serves. Debounced to
  // once per 3 days via messaging_nudged_at (cleared on top-up).
  factory.post('/internal/messaging/low-balance-nudge', async (c) => {
    if (!checkCronSecret(c)) return c.json({ error: 'Invalid cron secret' }, 401)
    try {
      const cutoff = new Date(Date.now() - 3 * 86_400_000).toISOString()
      const { data: rows } = await supabase.from('tenants')
        .select('id, name, email, messaging_wallet_cents, messaging_nudged_at')
        .eq('messaging_enabled', true).lt('messaging_wallet_cents', 200)
      let nudged = 0
      for (const t of rows || []) {
        if (!t.email || (t.messaging_nudged_at && t.messaging_nudged_at > cutoff)) continue
        try {
          await notifyMessagingLowBalance({ name: t.name, email: t.email }, portalUrlFor(t.id), t.messaging_wallet_cents ?? 0)
          await supabase.from('tenants').update({ messaging_nudged_at: new Date().toISOString() }).eq('id', t.id)
          nudged++
        } catch (e: any) { console.error('[Messaging] low-balance nudge failed for', t.id, e?.message || e) }
      }
      return c.json({ success: true, checked: (rows || []).length, nudged })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })
}
