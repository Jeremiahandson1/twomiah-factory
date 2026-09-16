// Settings → Integrations backend (/api/integrations) — ONE implementation for every CRM.
// Status of QuickBooks / Stripe Connect / texting / email / Twilio, the QuickBooks connect-disconnect-sync
// buttons (delegating to the ONE QuickBooks service — the old file ran a second OAuth flow that stored
// tokens in company.integrations, which the sync endpoints never read, so "Connected" could never sync),
// Stripe Connect onboarding, the SMS/email toggles, and the company's own Twilio account (which the SMS
// service now actually uses).
import { Hono } from 'hono'
import { eq, and, gte, count, sql } from 'drizzle-orm'
import type { QuickBooksService } from './quickbooks'
import { twilioConfigFor, formatPhoneE164 } from './twilio'

export interface IntegrationsRoutesDeps {
  db: any
  tables: { company: any; emailLog?: any }
  authenticate: any
  requireAdmin: any
  quickbooks: QuickBooksService
  /** Stripe SDK instance (null when STRIPE_SECRET_KEY is unset). */
  stripe?: any
  /**
   * Tells the Factory which connected Stripe account this business collects on, so connected-account
   * webhooks can be forwarded to this tenant (Factory → /api/stripe/factory-event). Null clears it.
   */
  factoryApiClient?: { registerStripeAccount(accountId: string | null): Promise<unknown> }
  frontendUrl?: string
}

export function createIntegrationsRoutes(deps: IntegrationsRoutesDeps) {
  const { db, tables: t, authenticate, requireAdmin, quickbooks: qb } = deps
  const app = new Hono()
  // Register the connected account with the Factory, never blocking the request. Once per process per
  // account id: /status re-registers a business that connected before this existed, without spamming.
  const registered = new Set<string>()
  const registerStripeAccount = (accountId: string | null, force = false) => {
    if (!deps.factoryApiClient) return
    const key = accountId || '(none)'
    if (!force && registered.has(key)) return
    registered.add(key)
    deps.factoryApiClient.registerStripeAccount(accountId).catch((e: any) => {
      registered.delete(key)
      console.error('[integrations] Stripe account registration with the Factory failed:', e?.message)
    })
  }
  const frontend = () => deps.frontendUrl || process.env.FRONTEND_URL || ''
  const settingsUrl = (q: string) => `${frontend()}/settings/integrations?${q}`
  const loadCompany = async (companyId: string) => { const [row] = await db.select().from(t.company).where(eq(t.company.id, companyId)).limit(1); return row }
  const patchIntegrations = async (companyId: string, fn: (j: any) => any) => {
    const row = await loadCompany(companyId)
    const next = fn({ ...((row?.integrations as any) || {}) })
    await db.update(t.company).set({ integrations: next, updatedAt: new Date() }).where(eq(t.company.id, companyId))
    return next
  }
  const patchSettings = async (companyId: string, patch: Record<string, unknown>) => {
    const row = await loadCompany(companyId)
    await db.update(t.company).set({ settings: { ...((row?.settings as any) || {}), ...patch }, updatedAt: new Date() }).where(eq(t.company.id, companyId))
  }

  // QuickBooks OAuth callback on the legacy path — same signed-state handler as /api/quickbooks/callback.
  app.get('/quickbooks/callback', async (c) => {
    const { code, state, realmId, error } = c.req.query()
    if (error) return c.redirect(settingsUrl(`error=${encodeURIComponent(error)}`))
    const companyId = qb.verifyState(state)
    if (!companyId) return c.redirect(settingsUrl('error=invalid_state'))
    if (!code || !realmId) return c.redirect(settingsUrl('error=missing_code'))
    try {
      const tokens = await qb.exchangeCodeForTokens(code)
      await qb.saveConnection(companyId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, realmId, expiresIn: tokens.expires_in })
      const info = await qb.getCompanyInfo(companyId).catch(() => null)
      await patchIntegrations(companyId, (j) => ({ ...j, quickbooksCompanyName: info?.CompanyName || j.quickbooksCompanyName || null }))
    } catch (e: any) {
      console.error('[integrations] QuickBooks token exchange failed:', e?.message)
      return c.redirect(settingsUrl('error=token_exchange_failed'))
    }
    return c.redirect(settingsUrl('qbo=connected'))
  })

  app.use('*', authenticate)
  const user = (c: any) => c.get('user') as any

  app.get('/status', async (c) => {
    const u = user(c)
    const row = await loadCompany(u.companyId)
    const integrations = ((row?.integrations as any) || {}) as any
    const settings = ((row?.settings as any) || {}) as any
    const startOfMonth = new Date(); startOfMonth.setDate(1); startOfMonth.setHours(0, 0, 0, 0)

    let smsCount = 0
    try {
      const r = (await db.execute(sql`SELECT COUNT(*)::int AS value FROM sms_message sm JOIN sms_conversation sc ON sm.conversation_id = sc.id WHERE sc.company_id = ${u.companyId} AND sm.created_at >= ${startOfMonth}`)) as any
      const rows = Array.isArray(r) ? r : (r.rows || [])
      smsCount = Number(rows[0]?.value || 0)
    } catch { /* table missing on this vertical */ }
    let emailCount = 0
    if (t.emailLog) {
      try { const [{ value }] = await db.select({ value: count() }).from(t.emailLog).where(and(eq(t.emailLog.companyId, u.companyId), gte(t.emailLog.createdAt, startOfMonth))); emailCount = Number(value || 0) } catch { /* optional */ }
    }

    let stripeStatus: any = { connected: false, accountId: null, chargesEnabled: false, configured: !!deps.stripe }
    if (integrations.stripeAccountId && deps.stripe) {
      try { const account = await deps.stripe.accounts.retrieve(integrations.stripeAccountId); stripeStatus = { connected: true, accountId: account.id, chargesEnabled: !!account.charges_enabled, configured: true } }
      catch { stripeStatus = { connected: false, accountId: null, chargesEnabled: false, configured: true } }
      if (stripeStatus.connected) registerStripeAccount(integrations.stripeAccountId)
    }

    const qbStatus = await qb.getConnectionStatus(u.companyId)
    const twilio = twilioConfigFor(row)
    const ownTwilio = !!(integrations.twilioAccountSid && integrations.twilioAuthToken) || !!(row?.twilioAccountSid && row?.twilioAuthToken)
    return c.json({
      quickbooks: { connected: qbStatus.connected, configured: qbStatus.configured, companyName: integrations.quickbooksCompanyName || null, lastSync: qbStatus.lastSyncAt || null, syncEnabled: qbStatus.syncEnabled, enabled: qbStatus.connected },
      stripe: stripeStatus,
      sms: { enabled: settings.smsEnabled || false, usage: smsCount },
      email: { enabled: settings.emailEnabled !== false, usage: emailCount },
      twilio: { configured: !!(twilio.accountSid && twilio.authToken), ownAccount: ownTwilio, phoneNumber: integrations.twilioPhoneNumber || row?.twilioPhoneNumber || null },
    })
  })

  // ── QuickBooks (the page's buttons)
  app.get('/quickbooks/auth-url', requireAdmin, async (c) => {
    try { const url = qb.getAuthUrl(user(c).companyId); return c.json({ authUrl: url, url }) }
    catch { return c.json({ error: 'QuickBooks sync is not enabled for this CRM yet. Email support@twomiah.com and we will switch it on for your account.' }, 503) }
  })
  app.post('/quickbooks/disconnect', requireAdmin, async (c) => {
    const u = user(c)
    await qb.disconnect(u.companyId)
    await patchIntegrations(u.companyId, (j) => { for (const k of ['quickbooksRealmId', 'quickbooksAccessToken', 'quickbooksRefreshToken', 'quickbooksTokenExpiry', 'quickbooksCompanyName', 'quickbooksConnectedAt', 'quickbooksLastSync']) delete j[k]; return j })
    return c.json({ success: true })
  })
  /** Runs a real customer + invoice sync in the background (the old handler only stamped a date). */
  app.post('/quickbooks/sync', requireAdmin, async (c) => {
    const u = user(c)
    const status = await qb.getConnectionStatus(u.companyId)
    if (!status.connected) return c.json({ error: 'QuickBooks not connected' }, 400)
    Promise.resolve().then(async () => {
      try { await qb.syncAllCustomers(u.companyId); await qb.syncAllInvoices(u.companyId) } catch (e: any) { console.error('[integrations] QuickBooks sync failed:', e?.message) }
    })
    return c.json({ success: true, message: 'Sync started' })
  })

  // ── Stripe Connect (Standard account onboarding)
  app.get('/stripe/connect-url', requireAdmin, async (c) => {
    // No STRIPE_SECRET_KEY on this CRM → used to crash with a 500 "null is not an object". (SALON-C5)
    if (!deps.stripe) return c.json({ error: 'Card payments are not set up for this CRM yet. Twomiah support can connect Stripe for your account — email support@twomiah.com.' }, 503)
    const u = user(c)
    const row = await loadCompany(u.companyId)
    let accountId = (row?.integrations as any)?.stripeAccountId
    try {
      if (!accountId) {
        const account = await deps.stripe.accounts.create({ type: 'standard', email: row?.email || undefined, business_profile: { name: row?.name }, metadata: { companyId: u.companyId } })
        accountId = account.id
        await patchIntegrations(u.companyId, (j) => ({ ...j, stripeAccountId: accountId }))
      }
      registerStripeAccount(accountId, true)
      const accountLink = await deps.stripe.accountLinks.create({ account: accountId, refresh_url: `${frontend()}/crm/settings/integrations?stripe=refresh`, return_url: `${frontend()}/crm/settings/integrations?stripe=success`, type: 'account_onboarding' })
      return c.json({ connectUrl: accountLink.url })
    } catch (e: any) { return c.json({ error: e?.message || 'Stripe could not start onboarding' }, 502) }
  })
  app.post('/stripe/disconnect', requireAdmin, async (c) => {
    await patchIntegrations(user(c).companyId, (j) => { delete j.stripeAccountId; return j })
    registerStripeAccount(null, true)
    return c.json({ success: true })
  })

  // ── Texting / email toggles (company.settings)
  app.post('/sms/toggle', requireAdmin, async (c) => {
    const { enabled } = await c.req.json().catch(() => ({}))
    await patchSettings(user(c).companyId, { smsEnabled: enabled === true })
    return c.json({ success: true, enabled: enabled === true })
  })
  app.post('/email/toggle', requireAdmin, async (c) => {
    const { enabled } = await c.req.json().catch(() => ({}))
    await patchSettings(user(c).companyId, { emailEnabled: enabled !== false })
    return c.json({ success: true, enabled: enabled !== false })
  })

  // ── The company's own Twilio account. Stored in company.integrations; the number is mirrored to the
  //    twilio_phone_number column so inbound webhooks can find the company either way.
  app.post('/twilio/configure', requireAdmin, async (c) => {
    const { accountSid, authToken, phoneNumber } = await c.req.json().catch(() => ({}))
    if (!accountSid || !authToken || !phoneNumber) return c.json({ error: 'Account SID, Auth Token, and Phone Number are all required' }, 400)
    if (!/^AC[0-9a-fA-F]{32}$/.test(String(accountSid))) return c.json({ error: 'Invalid Account SID format — should start with AC and be 34 characters' }, 400)
    if (String(phoneNumber).replace(/\D/g, '').length < 10) return c.json({ error: 'Enter the Twilio phone number in E.164 form, e.g. +15551234567' }, 400)
    const u = user(c)
    const e164 = formatPhoneE164(String(phoneNumber))
    await patchIntegrations(u.companyId, (j) => ({ ...j, twilioAccountSid: String(accountSid), twilioAuthToken: String(authToken), twilioPhoneNumber: e164 }))
    try { await db.update(t.company).set({ twilioPhoneNumber: e164 } as any).where(eq(t.company.id, u.companyId)) } catch { /* column absent on this vertical */ }
    return c.json({ success: true, phoneNumber: e164 })
  })
  app.post('/twilio/disconnect', requireAdmin, async (c) => {
    const u = user(c)
    await patchIntegrations(u.companyId, (j) => { for (const k of ['twilioAccountSid', 'twilioAuthToken', 'twilioPhoneNumber']) delete j[k]; return j })
    return c.json({ success: true })
  })

  return app
}
