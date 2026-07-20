import { supabase, requireRole } from '../../middleware/auth'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, checkCronSecret } from './shared'
import { encryptJSON, decryptJSON, maskTail } from '../../lib/crypto'
import { provisionA2p, pollA2pStatus, pollAllPendingA2p, type A2pData } from '../../services/a2p'
import { debit } from '../../services/messagingWallet'
import { a2pRegistrationCostCents } from '../../config/messagingCosts'

// Per-tenant A2P 10DLC registration endpoints. Twomiah (ISV) registers each
// tenant's own brand + campaign; see services/a2p.ts for the Twilio flow and
// migrations/2026-07-20_tenants_a2p.sql for the state columns.

const REQUIRED: Array<keyof A2pData> = [
  'legalName', 'businessType', 'ein', 'industry', 'website',
  'street', 'city', 'region', 'postalCode',
  'repFirstName', 'repLastName', 'repEmail', 'repPhone', 'repTitle',
  'campaignDescription',
]

function validateIntake(body: any): { data?: A2pData; error?: string } {
  if (!body || typeof body !== 'object') return { error: 'Body must be an object' }
  for (const f of REQUIRED) {
    if (typeof body[f] !== 'string' || !body[f].trim()) return { error: `Missing required field: ${f}` }
  }
  const samples = body.messageSamples
  if (!Array.isArray(samples) || samples.length < 1 || samples.length > 5 || !samples.every((s: any) => typeof s === 'string' && s.trim())) {
    return { error: 'messageSamples must be 1–5 non-empty strings' }
  }
  return { data: body as A2pData }
}

export function registerA2pRoutes(factory: FactoryApp) {
  // ─── Status (non-sensitive; EIN masked) ─────────────────────────────────────
  factory.get('/customers/:id/a2p', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)

    let einTail = ''
    if (t.a2p_data) { try { einTail = maskTail(decryptJSON<A2pData>(t.a2p_data as string).ein) } catch { /* ignore */ } }

    return c.json({
      status: t.a2p_status || 'not_started',
      collected: !!t.a2p_data,
      einTail,
      brandSid: t.a2p_brand_sid || null,
      campaignSid: t.a2p_campaign_sid || null,
      messagingServiceSid: t.a2p_messaging_service_sid || null,
      phoneNumberSid: t.a2p_phone_number || null,
      rejectionReason: t.a2p_rejection_reason || null,
      submittedAt: t.a2p_submitted_at || null,
      approvedAt: t.a2p_approved_at || null,
    })
  })

  // ─── Collect + encrypt the tenant's EIN/legal/campaign data ──────────────────
  factory.post('/customers/:id/a2p/intake', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('id, a2p_status').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)

    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const v = validateIntake(parsed.data)
    if (v.error) return c.json({ error: v.error }, 400)

    // Don't clobber an in-flight/approved registration by re-collecting data.
    if (['provisioning', 'pending', 'approved'].includes(t.a2p_status || '')) {
      return c.json({ error: `Cannot edit A2P data while status is "${t.a2p_status}"` }, 409)
    }

    const { error: upErr } = await supabase.from('tenants').update({
      a2p_data: encryptJSON(v.data),
      a2p_status: 'collected',
      a2p_rejection_reason: null,
    }).eq('id', id)
    if (upErr) return c.json({ error: upErr.message }, 500)

    await logTenantAudit(id, 'a2p_intake', { a2p_status: { old: t.a2p_status, new: 'collected' } }, c.get('user')?.email, 'A2P registration data collected')
    return c.json({ success: true, status: 'collected' })
  })

  // ─── Submit → provision Twilio resources (resumable) ─────────────────────────
  factory.post('/customers/:id/a2p/submit', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants')
      .select('id, a2p_status, a2p_data, messaging_enabled, messaging_wallet_cents').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    if (!t.a2p_data) return c.json({ error: 'No A2P data collected — run intake first' }, 400)
    if (t.a2p_status === 'approved') return c.json({ error: 'Already approved' }, 409)

    // Billing gate: messaging must be enabled ($10/mo) and the prepaid wallet
    // must cover Twilio's at-cost A2P registration fee before we provision.
    const regCost = a2pRegistrationCostCents()
    if (!t.messaging_enabled) return c.json({ error: 'Enable messaging ($10/mo) before registering', code: 'messaging_disabled' }, 402)
    if ((t.messaging_wallet_cents ?? 0) < regCost) {
      return c.json({ error: `Wallet balance too low for the $${(regCost / 100).toFixed(2)} at-cost A2P registration — top up first`, code: 'insufficient_wallet', requiredCents: regCost }, 402)
    }

    try {
      const results = await provisionA2p(id)
      const failed = results.find(r => r.status === 'error')
      // Debit the at-cost registration fee ONLY when the brand was newly created
      // this run (status 'ok', not 'skipped') — so a resubmit never double-charges.
      const brand = results.find(r => r.step === 'brand')
      if (!failed && brand?.status === 'ok') {
        await debit(id, regCost, 'a2p_registration', { twilioRef: brand.sid }).catch((e: any) =>
          console.error('[A2P] registration debit failed for', id, e?.message || e))
      }
      await logTenantAudit(id, 'a2p_submit', { a2p_status: { old: t.a2p_status, new: failed ? 'error' : 'pending' } }, c.get('user')?.email, failed ? `A2P provisioning error at ${failed.step}` : 'A2P submitted for vetting')
      return c.json({ success: !failed, steps: results }, failed ? 502 : 200)
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Manual re-poll of a single tenant's vetting status ──────────────────────
  factory.post('/customers/:id/a2p/refresh', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id')
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    try {
      const res = await pollA2pStatus(id)
      return c.json({ success: true, ...res })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Cron: advance all mid-vetting tenants ───────────────────────────────────
  // Public path (/internal/*) — does its own CRON_SECRET check.
  factory.post('/internal/a2p/poll', async (c) => {
    if (!checkCronSecret(c)) return c.json({ error: 'Invalid cron secret' }, 401)
    try {
      const res = await pollAllPendingA2p()
      return c.json({ success: true, ...res })
    } catch (e: any) {
      return c.json({ error: e.message }, 500)
    }
  })

  // ─── Twilio status callback ──────────────────────────────────────────────────
  // We never trust the callback payload — it only nudges us to re-poll Twilio
  // (the authoritative source), so no signature validation is required here.
  factory.post('/internal/a2p/twilio-callback', async (c) => {
    pollAllPendingA2p().catch((e: any) => console.error('[A2P] callback poll failed:', e.message))
    return c.json({ received: true })
  })
}
