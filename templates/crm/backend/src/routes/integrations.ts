/**
 * Integrations Routes
 *
 * Handles customer-facing integrations:
 * - QuickBooks (OAuth - customer connects their account)
 * - Stripe Connect (OAuth - customer connects their account)
 * - SMS (platform toggle - uses our Twilio)
 * - Email (platform toggle - uses our SendGrid)
 */

import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { company, emailLog } from '../../db/schema.ts'
import { eq, and, gte, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import Stripe from 'stripe'

const app = new Hono()

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

const QB_CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID
const QB_CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET
const QB_REDIRECT_URI = process.env.QUICKBOOKS_REDIRECT_URI || `${process.env.API_URL}/api/integrations/quickbooks/callback`
const QB_ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'

// ============================================
// GET INTEGRATION STATUS
// ============================================

app.get('/status', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({
    settings: company.settings,
    integrations: company.integrations,
  }).from(company).where(eq(company.id, user.companyId)).limit(1)

  const integrations = (comp?.integrations || {}) as any
  const settings = (comp?.settings || {}) as any

  const startOfMonth = new Date()
  startOfMonth.setDate(1)
  startOfMonth.setHours(0, 0, 0, 0)

  // smsMessage doesn't have companyId directly - join through smsConversation
  const smsCountResult = await db.execute(sql`
    SELECT COUNT(*)::int as value FROM sms_message sm
    JOIN sms_conversation sc ON sm.conversation_id = sc.id
    WHERE sc.company_id = ${user.companyId} AND sm.created_at >= ${startOfMonth}
  `)
  const smsCount = (smsCountResult as any).rows?.[0]?.value || 0

  const [{ value: emailCount }] = await db.select({ value: count() }).from(emailLog)
    .where(and(eq(emailLog.companyId, user.companyId), gte(emailLog.createdAt, startOfMonth)))

  let stripeStatus: any = { connected: false, accountId: null, chargesEnabled: false }
  if (integrations.stripeAccountId) {
    try {
      const account = await stripe!.accounts.retrieve(integrations.stripeAccountId)
      stripeStatus = { connected: true, accountId: account.id, chargesEnabled: account.charges_enabled }
    } catch (err) {
      stripeStatus = { connected: false, accountId: null, chargesEnabled: false }
    }
  }

  return c.json({
    quickbooks: {
      connected: !!integrations.quickbooksRealmId,
      companyName: integrations.quickbooksCompanyName || null,
      lastSync: integrations.quickbooksLastSync || null,
    },
    stripe: stripeStatus,
    sms: { enabled: settings.smsEnabled || false, usage: smsCount },
    email: { enabled: settings.emailEnabled !== false, usage: emailCount },
    twilio: {
      configured: !!(integrations.twilioAccountSid && integrations.twilioAuthToken),
      phoneNumber: integrations.twilioPhoneNumber || null,
    },
  })
})

// ============================================
// QUICKBOOKS OAUTH
// ============================================

app.get('/quickbooks/auth-url', authenticate, async (c) => {
  const user = c.get('user') as any

  if (!QB_CLIENT_ID) return c.json({ error: 'QuickBooks not configured' }, 500)

  const state = Buffer.from(JSON.stringify({
    companyId: user.companyId,
    userId: user.id,
  })).toString('base64')

  const baseUrl = 'https://appcenter.intuit.com/connect/oauth2'
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QB_REDIRECT_URI,
    state,
  })

  return c.json({ authUrl: `${baseUrl}?${params}` })
})

app.get('/quickbooks/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const realmId = c.req.query('realmId')
  const qbError = c.req.query('error')

  if (qbError) {
    return c.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=quickbooks_denied`)
  }

  const { companyId, userId } = JSON.parse(Buffer.from(state!, 'base64').toString())

  const tokenResponse = await fetch('https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${QB_CLIENT_ID}:${QB_CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code: code!,
      redirect_uri: QB_REDIRECT_URI,
    }),
  })

  const tokens = await tokenResponse.json() as any

  if (!tokenResponse.ok) {
    console.error('QuickBooks token error:', tokens)
    return c.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=quickbooks_failed`)
  }

  const baseUrl = QB_ENVIRONMENT === 'production'
    ? 'https://quickbooks.api.intuit.com'
    : 'https://sandbox-quickbooks.api.intuit.com'

  const companyInfoResponse = await fetch(
    `${baseUrl}/v3/company/${realmId}/companyinfo/${realmId}`,
    {
      headers: {
        'Authorization': `Bearer ${tokens.access_token}`,
        'Accept': 'application/json',
      },
    }
  )

  let qbCompanyName = 'QuickBooks Company'
  if (companyInfoResponse.ok) {
    const companyInfo = await companyInfoResponse.json() as any
    qbCompanyName = companyInfo.CompanyInfo?.CompanyName || qbCompanyName
  }

  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, companyId)).limit(1)

  await db.update(company).set({
    integrations: {
      ...(comp?.integrations as any || {}),
      quickbooksRealmId: realmId,
      quickbooksAccessToken: tokens.access_token,
      quickbooksRefreshToken: tokens.refresh_token,
      quickbooksTokenExpiry: new Date(Date.now() + tokens.expires_in * 1000),
      quickbooksCompanyName: qbCompanyName,
      quickbooksConnectedAt: new Date(),
    },
    updatedAt: new Date(),
  }).where(eq(company.id, companyId))

  return c.redirect(`${process.env.FRONTEND_URL}/settings/integrations?success=quickbooks`)
})

app.post('/quickbooks/disconnect', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, user.companyId)).limit(1)

  const integrations = { ...(comp?.integrations as any || {}) }

  delete integrations.quickbooksRealmId
  delete integrations.quickbooksAccessToken
  delete integrations.quickbooksRefreshToken
  delete integrations.quickbooksTokenExpiry
  delete integrations.quickbooksCompanyName
  delete integrations.quickbooksConnectedAt
  delete integrations.quickbooksLastSync

  await db.update(company).set({ integrations, updatedAt: new Date() }).where(eq(company.id, user.companyId))

  return c.json({ success: true })
})

app.post('/quickbooks/sync', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, user.companyId)).limit(1)

  if (!(comp?.integrations as any)?.quickbooksRealmId) {
    return c.json({ error: 'QuickBooks not connected' }, 400)
  }

  await db.update(company).set({
    integrations: {
      ...(comp!.integrations as any),
      quickbooksLastSync: new Date(),
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({ success: true, message: 'Sync started' })
})

// ============================================
// STRIPE CONNECT
// ============================================

app.get('/stripe/connect-url', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({
    name: company.name,
    email: company.email,
    integrations: company.integrations,
  }).from(company).where(eq(company.id, user.companyId)).limit(1)

  let accountId = (comp?.integrations as any)?.stripeAccountId

  if (!accountId) {
    const account = await stripe!.accounts.create({
      type: 'standard',
      email: comp?.email!,
      business_profile: { name: comp?.name },
      metadata: { companyId: user.companyId },
    })
    accountId = account.id

    await db.update(company).set({
      integrations: {
        ...(comp?.integrations as any || {}),
        stripeAccountId: accountId,
      },
      updatedAt: new Date(),
    }).where(eq(company.id, user.companyId))
  }

  const accountLink = await stripe!.accountLinks.create({
    account: accountId,
    refresh_url: `${process.env.FRONTEND_URL}/settings/integrations?stripe=refresh`,
    return_url: `${process.env.FRONTEND_URL}/settings/integrations?stripe=success`,
    type: 'account_onboarding',
  })

  return c.json({ connectUrl: accountLink.url })
})

app.post('/stripe/disconnect', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, user.companyId)).limit(1)

  const integrations = { ...(comp?.integrations as any || {}) }
  delete integrations.stripeAccountId

  await db.update(company).set({ integrations, updatedAt: new Date() }).where(eq(company.id, user.companyId))

  return c.json({ success: true })
})

// ============================================
// SMS TOGGLE (Platform Twilio)
// ============================================

app.post('/sms/toggle', authenticate, async (c) => {
  const user = c.get('user') as any
  const { enabled } = await c.req.json()

  const [comp] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, user.companyId)).limit(1)

  await db.update(company).set({
    settings: {
      ...(comp?.settings as any || {}),
      smsEnabled: enabled,
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({ success: true, enabled })
})

// ============================================
// EMAIL TOGGLE (Platform SendGrid)
// ============================================

app.post('/email/toggle', authenticate, async (c) => {
  const user = c.get('user') as any
  const { enabled } = await c.req.json()

  const [comp] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, user.companyId)).limit(1)

  await db.update(company).set({
    settings: {
      ...(comp?.settings as any || {}),
      emailEnabled: enabled,
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({ success: true, enabled })
})

// ============================================
// TWILIO CONFIGURATION
// ============================================

app.post('/twilio/configure', authenticate, async (c) => {
  const user = c.get('user') as any
  const { accountSid, authToken, phoneNumber } = await c.req.json()

  if (!accountSid || !authToken || !phoneNumber) {
    return c.json({ error: 'Account SID, Auth Token, and Phone Number are all required' }, 400)
  }

  // Validate format
  if (!accountSid.startsWith('AC') || accountSid.length < 30) {
    return c.json({ error: 'Invalid Account SID format — should start with AC' }, 400)
  }

  const [comp] = await db.select({ integrations: company.integrations }).from(company).where(eq(company.id, user.companyId)).limit(1)
  if (!comp) return c.json({ error: 'Company not found' }, 404)

  await db.update(company).set({
    integrations: {
      ...(comp.integrations as any || {}),
      twilioAccountSid: accountSid,
      twilioAuthToken: authToken,
      twilioPhoneNumber: phoneNumber,
    },
    updatedAt: new Date(),
  }).where(eq(company.id, user.companyId))

  return c.json({ success: true, phoneNumber })
})

export default app
