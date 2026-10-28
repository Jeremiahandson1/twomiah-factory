import { supabase, requireRole } from '../../middleware/auth'
import { type FactoryApp, UUID_RE, parseJsonBody, logTenantAudit, checkCronSecret, checkFactoryKey } from './shared'
import { encryptJSON, decryptJSON, maskTail } from '../../lib/crypto'
import { provisionA2p, pollA2pStatus, pollAllPendingA2p, resendOwnerConfirmation, a2pDataProblem, e164, type A2pData } from '../../services/a2p'
import { debit } from '../../services/messagingWallet'
import { TWILIO_COSTS, MESSAGING_START_CENTS, hcToCents, smsSegmentHc, smsPriceSummary, walletCentsOf } from '../../config/messagingCosts'

// Each business's own texting registration (A2P 10DLC) — services/a2p.ts has the Twilio flow.
//
// Two doors, one rule:
//   staff (Factory › customer › Texting registration)   /customers/:id/a2p…               owner/admin
//   the business itself (its CRM's Settings › Texting)   /internal/messaging/self/:tenantId/registration…   its Factory key
// Both store the same encrypted details and run the same submit (submitRegistration below).

/** What a business's registration looks like from outside: never the EIN, never the representative's details. */
async function summary(t: any) {
  let d: A2pData | null = null
  if (t.a2p_data) { try { d = decryptJSON<A2pData>(t.a2p_data) } catch { /* unreadable: treated as not collected */ } }
  const stage = t.a2p_status === 'approved' ? 'live'
    : !t.a2p_brand_sid ? (t.a2p_status === 'collected' || t.a2p_status === 'error' ? 'not_submitted' : 'not_started')
      : !t.a2p_campaign_sid ? 'brand' : 'campaign'
  return {
    status: t.a2p_status || 'not_started',
    stage,
    kind: d?.kind ?? null,
    businessName: d ? (d.kind === 'sole_proprietor' ? d.brandName : d.legalName) ?? null : null,
    einTail: d?.ein ? maskTail(d.ein) : '',
    rejectionReason: t.a2p_rejection_reason || null,
    submittedAt: t.a2p_submitted_at || null,
    approvedAt: t.a2p_approved_at || null,
    messagingEnabled: !!t.messaging_enabled,
    walletCents: walletCentsOf(t),
    fees: { brandCents: TWILIO_COSTS.brandRegistrationCents, campaignVettingCents: TWILIO_COSTS.campaignVettingCents, segmentCents: hcToCents(smsSegmentHc()), segmentHc: smsSegmentHc(), startCents: MESSAGING_START_CENTS }, textPrice: smsPriceSummary(),
  }
}

/**
 * Store a business's details and submit them. Texting must be switched on ($10/mo) and the wallet must cover
 * Twilio's one-time fees first; the brand fee is debited when the brand is created, the campaign vetting fee
 * when the campaign is (services/a2p.ts advance) — each once, at Twilio's cost.
 */
async function submitRegistration(tenantId: string, body: any, actor: string): Promise<{ code: number; json: any }> {
  const { data: t, error } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  if (error || !t) return { code: 404, json: { error: 'Tenant not found' } }
  if (['provisioning', 'pending', 'approved'].includes(t.a2p_status)) return { code: 409, json: { error: t.a2p_status === 'approved' ? 'Texting is already registered.' : 'The registration is already with the carriers.' } }
  if (body && Object.keys(body).length) {
    const problem = a2pDataProblem(body)
    if (problem) return { code: 400, json: { error: problem } }
    const d: A2pData = {
      kind: body.kind,
      street: body.street.trim(), city: body.city.trim(), region: body.region.trim().toUpperCase(), postalCode: body.postalCode.trim(),
      repFirstName: body.repFirstName.trim(), repLastName: body.repLastName.trim(), repEmail: body.repEmail.trim(), repPhone: e164(body.repPhone)!,
      repTitle: typeof body.repTitle === 'string' && body.repTitle.trim() ? body.repTitle.trim() : 'Owner',
      ...(body.areaCode ? { areaCode: String(body.areaCode).replace(/\D/g, '').slice(0, 3) } : {}),
      ...(body.kind === 'standard'
        ? { legalName: body.legalName.trim(), ein: body.ein.trim(), businessType: body.businessType, industry: body.industry, repJobPosition: body.repJobPosition || 'Other' }
        : { brandName: body.brandName.trim(), mobilePhone: e164(body.mobilePhone)! }),
    }
    const { error: upErr } = await supabase.from('tenants').update({ a2p_data: encryptJSON(d), a2p_channel: 'a2p', a2p_status: 'collected', a2p_rejection_reason: null }).eq('id', tenantId)
    if (upErr) return { code: 500, json: { error: upErr.message } }
    t.a2p_data = encryptJSON(d)
    await logTenantAudit(tenantId, 'a2p_intake', { a2p_status: { old: t.a2p_status, new: 'collected' } }, actor, 'Texting registration details saved')
  } else if (!t.a2p_data) {
    return { code: 400, json: { error: 'Send the registration details.' } }
  }
  if (!t.messaging_enabled) return { code: 402, json: { error: 'Switch texting on first ($10 a month).', code: 'messaging_disabled' } }
  // To start texting the wallet holds the one-time registration AND something to text with (MESSAGING_START_CENTS,
  // $25 — owner, 2026-10-21). Resuming a registration whose fees are already paid needs only what is still owed.
  const upfront = (t.a2p_brand_sid ? 0 : TWILIO_COSTS.brandRegistrationCents) + (t.a2p_campaign_sid ? 0 : TWILIO_COSTS.campaignVettingCents)
  const needed = t.a2p_brand_sid ? upfront : Math.max(MESSAGING_START_CENTS, upfront)
  if (walletCentsOf(t) < needed) {
    const short = Math.ceil(needed - walletCentsOf(t))
    return { code: 402, json: { error: `Add $${(short / 100).toFixed(2)} to your texting wallet first: $${(needed / 100).toFixed(2)} starts texting — $${(upfront / 100).toFixed(2)} for the one-time carrier registration, the rest for your first texts.`, code: 'insufficient_wallet', requiredCents: needed } }
  }
  const hadBrand = !!t.a2p_brand_sid
  const steps = await provisionA2p(tenantId)
  const brand = steps.find((s) => s.step === 'brand')
  if (!hadBrand && brand?.status === 'ok') {
    await debit(tenantId, TWILIO_COSTS.brandRegistrationCents, 'a2p_brand', { twilioRef: brand.sid }).catch((e: any) => console.error('[A2P] brand fee debit failed for', tenantId, e?.message || e))
  }
  const failed = steps.find((s) => s.status === 'error')
  await logTenantAudit(tenantId, 'a2p_submit', { a2p_status: { old: t.a2p_status, new: failed ? 'error' : 'pending' } }, actor, failed ? `Registration stopped: ${failed.detail}` : 'Texting registration submitted')
  const { data: after } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
  return { code: failed ? 502 : 200, json: { success: !failed, steps: steps.map(({ step, status, detail }) => ({ step, status, detail })), ...(await summary(after)) } }
}

export function registerA2pRoutes(factory: FactoryApp) {
  // ─── Staff ────────────────────────────────────────────────────────────────
  factory.get('/customers/:id/a2p', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id') || ''
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const { data: t, error } = await supabase.from('tenants').select('*').eq('id', id).single()
    if (error || !t) return c.json({ error: error?.message || 'Tenant not found' }, error && error.code !== 'PGRST116' ? 500 : 404)
    return c.json({ ...(await summary(t)), brandSid: t.a2p_brand_sid || null, campaignSid: t.a2p_campaign_sid || null, messagingServiceSid: t.a2p_messaging_service_sid || null, phoneNumberSid: t.a2p_phone_number || null })
  })

  // Save and submit in one (an empty body re-submits what is saved — resumes a stopped registration).
  factory.post('/customers/:id/a2p/submit', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id') || ''
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const r = await submitRegistration(id, parsed.data || {}, c.get('user')?.email || 'staff')
    return c.json(r.json, r.code as any)
  })

  factory.post('/customers/:id/a2p/refresh', requireRole('owner', 'admin'), async (c) => {
    const id = c.req.param('id') || ''
    if (!UUID_RE.test(id)) return c.json({ error: 'Invalid tenant ID format' }, 400)
    try { return c.json({ success: true, ...(await pollA2pStatus(id)) }) } catch (e: any) { return c.json({ error: e.message }, 500) }
  })

  // ─── The business itself (its CRM, with its own Factory key) ─────────────
  const self = async (c: any) => {
    const tenantId = c.req.param('tenantId') || ''
    if (!UUID_RE.test(tenantId)) return { err: c.json({ error: 'Invalid tenant ID format' }, 400) }
    const { data: t } = await supabase.from('tenants').select('*').eq('id', tenantId).single()
    if (!t || !checkFactoryKey(c, t)) return { err: c.json({ error: 'Unauthorized' }, 401) }
    return { t }
  }

  factory.get('/internal/messaging/self/:tenantId/registration', async (c) => {
    const { t, err } = await self(c); if (err) return err
    return c.json(await summary(t))
  })

  factory.post('/internal/messaging/self/:tenantId/registration', async (c) => {
    const { t, err } = await self(c); if (err) return err
    const parsed = await parseJsonBody(c)
    if (parsed.error) return parsed.error
    const r = await submitRegistration(t.id, parsed.data || {}, 'business owner (CRM)')
    return c.json(r.json, r.code as any)
  })

  // Where it stands now, after asking Twilio (the page's "Check now").
  factory.post('/internal/messaging/self/:tenantId/registration/refresh', async (c) => {
    const { t, err } = await self(c); if (err) return err
    try { await pollA2pStatus(t.id) } catch (e: any) { console.error('[A2P] refresh failed', t.id, e.message) }
    const { data: after } = await supabase.from('tenants').select('*').eq('id', t.id).single()
    return c.json(await summary(after))
  })

  factory.post('/internal/messaging/self/:tenantId/registration/resend', async (c) => {
    const { t, err } = await self(c); if (err) return err
    try { await resendOwnerConfirmation(t.id); return c.json({ success: true }) } catch (e: any) { return c.json({ error: e.message }, 400) }
  })

  // ─── Cron and Twilio's nudges ─────────────────────────────────────────────
  factory.post('/internal/a2p/poll', async (c) => {
    if (!checkCronSecret(c)) return c.json({ error: 'Invalid cron secret' }, 401)
    try { return c.json({ success: true, ...(await pollAllPendingA2p()) }) } catch (e: any) { return c.json({ error: e.message }, 500) }
  })

  // The payload is never trusted — it only nudges a poll of Twilio, the authoritative source.
  factory.post('/internal/a2p/twilio-callback', async (c) => {
    pollAllPendingA2p().catch((e: any) => console.error('[A2P] callback poll failed:', e.message))
    return c.json({ received: true })
  })
}
