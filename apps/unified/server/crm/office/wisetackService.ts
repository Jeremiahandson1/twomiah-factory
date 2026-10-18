// Wisetack consumer financing: loan applications, their status, the lender's webhook, and connecting a company's
// merchant account. Moved from templates/crm/backend/src/services/wisetack.ts. API docs: https://docs.wisetack.com
//
// Not connected anywhere yet: there is no Wisetack partner account, so WISETACK_API_KEY / WISETACK_PARTNER_ID are unset
// and the router (wisetack.ts) answers 503 before anything here runs. The settings are read when used, not at load.
import crypto from 'node:crypto'
import { eq, and, desc } from 'drizzle-orm'
import { company, contact, financingApplication, oauthState } from '../../db/schema/index.ts'
import { notFound } from '../../http/errors.ts'
import type { CrmDeps } from '../deps.ts'

const env = () => ({
  apiUrl: process.env.WISETACK_API_URL || 'https://api.wisetack.com/v1',
  partnerId: process.env.WISETACK_PARTNER_ID,
  apiKey: process.env.WISETACK_API_KEY,
  webhookSecret: process.env.WISETACK_WEBHOOK_SECRET,
})

/** An error that becomes a reply with this status (server/http/errors.ts). */
const withStatus = (message: string, status: number) => Object.assign(new Error(message), { status })

/** Estimated monthly payment. */
export function calculateMonthlyPayment(amount: number, apr: number = 9.99, termMonths: number = 36): number {
  const monthlyRate = apr / 100 / 12
  if (monthlyRate === 0) return Math.round((amount / termMonths) * 100) / 100
  const payment = (amount * monthlyRate * Math.pow(1 + monthlyRate, termMonths)) /
                  (Math.pow(1 + monthlyRate, termMonths) - 1)
  return Math.round(payment * 100) / 100
}

/** The financing options shown before anyone applies. */
export function getFinancingOptions(amount: number) {
  return [
    { termMonths: 12, apr: 0, monthlyPayment: calculateMonthlyPayment(amount, 0, 12), totalCost: amount, label: '12 months @ 0% APR' },
    { termMonths: 24, apr: 4.99, monthlyPayment: calculateMonthlyPayment(amount, 4.99, 24), totalCost: calculateMonthlyPayment(amount, 4.99, 24) * 24, label: '24 months @ 4.99% APR' },
    { termMonths: 36, apr: 7.99, monthlyPayment: calculateMonthlyPayment(amount, 7.99, 36), totalCost: calculateMonthlyPayment(amount, 7.99, 36) * 36, label: '36 months @ 7.99% APR' },
    { termMonths: 60, apr: 9.99, monthlyPayment: calculateMonthlyPayment(amount, 9.99, 60), totalCost: calculateMonthlyPayment(amount, 9.99, 60) * 60, label: '60 months @ 9.99% APR' },
  ]
}

export function createWisetackService(d: Pick<CrmDeps, 'db' | 'logger'>) {
  const { db, logger } = d

  async function wisetackRequest(endpoint: string, options: RequestInit = {}) {
    const { apiUrl, apiKey, partnerId } = env()
    const response = await fetch(`${apiUrl}${endpoint}`, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'X-Partner-ID': partnerId || '',
        ...(options.headers as Record<string, string>),
      },
    })
    const data: any = await response.json()
    if (!response.ok) throw new Error(data.message || `Wisetack API error: ${response.status}`)
    return data
  }

  /** Create a loan application (pre-qualification). */
  async function createLoanApplication({ companyId, quoteId, invoiceId, contactId, amount, customerInfo }: {
    companyId: string
    quoteId?: string
    invoiceId?: string
    contactId: string
    amount: number
    customerInfo?: { firstName?: string; lastName?: string; email?: string; phone?: string; address?: string; city?: string; state?: string; zip?: string }
  }) {
    // The company's Wisetack merchant ID, from its settings
    const [companyRow] = await db.select({ settings: company.settings, name: company.name })
      .from(company).where(eq(company.id, companyId)).limit(1)
    const settings = (companyRow?.settings as any) || {}
    if (!settings.wisetackMerchantId) throw new Error('Company not connected to Wisetack')

    const [contactRow] = await db.select().from(contact).where(eq(contact.id, contactId)).limit(1)

    const application = await wisetackRequest('/applications', {
      method: 'POST',
      body: JSON.stringify({
        merchant_id: settings.wisetackMerchantId,
        amount: Math.round(amount * 100), // cents
        customer: {
          first_name: customerInfo?.firstName || contactRow?.name?.split(' ')[0] || '',
          last_name: customerInfo?.lastName || contactRow?.name?.split(' ').slice(1).join(' ') || '',
          email: customerInfo?.email || contactRow?.email,
          phone: customerInfo?.phone || contactRow?.phone,
          address: {
            street: customerInfo?.address || contactRow?.address,
            city: customerInfo?.city || contactRow?.city,
            state: customerInfo?.state || contactRow?.state,
            zip: customerInfo?.zip || contactRow?.zip,
          },
        },
        metadata: { company_id: companyId, quote_id: quoteId, invoice_id: invoiceId, contact_id: contactId },
      }),
    })

    const [savedApp] = await db.insert(financingApplication).values({
      companyId,
      contactId,
      externalId: application.id,
      amount: String(amount),
      status: application.status || 'pending',
      applicationUrl: application.application_url,
    }).returning()

    return {
      id: savedApp.id,
      applicationId: application.id,
      applicationUrl: application.application_url,
      status: application.status,
      expiresAt: application.expires_at,
    }
  }

  /** A loan application's status: Wisetack's latest, or what is on file when Wisetack can't be reached. */
  async function getApplicationStatus(applicationId: string) {
    const [appById] = await db.select().from(financingApplication).where(eq(financingApplication.id, applicationId)).limit(1)
    let appRow = appById
    if (!appRow) {
      const [appByExternal] = await db.select().from(financingApplication).where(eq(financingApplication.externalId, applicationId)).limit(1)
      appRow = appByExternal
    }
    if (!appRow) throw notFound('Application not found')

    try {
      const wisetackApp = await wisetackRequest(`/applications/${appRow.externalId}`)
      await db.update(financingApplication).set({
        status: wisetackApp.status,
        approvedAmount: wisetackApp.approved_amount ? String(wisetackApp.approved_amount / 100) : null,
        term: wisetackApp.term_months || null,
        updatedAt: new Date(),
      }).where(eq(financingApplication.id, appRow.id))

      return {
        id: appRow.id,
        status: wisetackApp.status,
        approvedAmount: wisetackApp.approved_amount ? wisetackApp.approved_amount / 100 : null,
        apr: wisetackApp.apr,
        termMonths: wisetackApp.term_months,
        monthlyPayment: wisetackApp.monthly_payment ? wisetackApp.monthly_payment / 100 : null,
        applicationUrl: appRow.applicationUrl,
      }
    } catch {
      return {
        id: appRow.id,
        status: appRow.status,
        approvedAmount: appRow.approvedAmount ? Number(appRow.approvedAmount) : null,
        termMonths: appRow.term,
        applicationUrl: appRow.applicationUrl,
        cached: true,
      }
    }
  }

  /** The company's applications, newest first, optionally for one contact, each with its contact. */
  async function getApplicationsFor(companyId: string, { contactId }: { quoteId?: string; invoiceId?: string; contactId?: string }) {
    const conditions: any[] = [eq(financingApplication.companyId, companyId)]
    if (contactId) conditions.push(eq(financingApplication.contactId, contactId))

    const apps = await db.select().from(financingApplication).where(and(...conditions)).orderBy(desc(financingApplication.createdAt))

    const result: any[] = []
    for (const app of apps) {
      const [contactRow] = await db.select({ id: contact.id, name: contact.name, email: contact.email })
        .from(contact).where(eq(contact.id, app.contactId)).limit(1)
      result.push({ ...app, contact: contactRow ?? null })
    }
    return result
  }

  /**
   * Wisetack's webhook. Rejected unless signed with the configured secret. The template threw plain errors here, so
   * an unsigned or mis-signed call answered 500; they now carry their status (503 not configured, 401 bad signature).
   */
  async function processWebhook(payload: any, signature: string | undefined) {
    const { webhookSecret } = env()
    if (!webhookSecret) throw withStatus('Webhook secret not configured', 503)
    const expectedSignature = crypto.createHmac('sha256', webhookSecret).update(JSON.stringify(payload)).digest('hex')
    const sigBuf = Buffer.from(String(signature || ''))
    const expBuf = Buffer.from(expectedSignature)
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      throw withStatus('Invalid webhook signature', 401)
    }

    const { event, data } = payload

    const [app] = await db.select().from(financingApplication).where(eq(financingApplication.externalId, data.application_id)).limit(1)
    if (!app) {
      logger.warn('[wisetack] webhook for unknown application', { applicationId: data.application_id })
      return { processed: false, reason: 'Application not found' }
    }

    switch (event) {
      case 'application.approved':
        await db.update(financingApplication).set({
          status: 'approved',
          approvedAmount: data.approved_amount ? String(data.approved_amount / 100) : null,
          term: data.term_months || null,
          updatedAt: new Date(),
        }).where(eq(financingApplication.id, app.id))
        break
      case 'application.declined':
        await db.update(financingApplication).set({ status: 'declined', updatedAt: new Date() }).where(eq(financingApplication.id, app.id))
        break
      case 'application.funded':
        await db.update(financingApplication).set({ status: 'funded', updatedAt: new Date() }).where(eq(financingApplication.id, app.id))
        break
      case 'application.expired':
        await db.update(financingApplication).set({ status: 'expired', updatedAt: new Date() }).where(eq(financingApplication.id, app.id))
        break
      default:
        logger.info('[wisetack] unhandled event', { event })
    }

    return { processed: true, event, applicationId: app.id }
  }

  /** Start connecting the company to Wisetack (OAuth): the URL to send the person to. */
  async function initiateWisetackConnection(companyId: string, returnUrl: string) {
    const { apiUrl, partnerId } = env()
    const state = crypto.randomBytes(32).toString('hex')
    await db.insert(oauthState).values({ state, provider: 'wisetack', companyId, expiresAt: new Date(Date.now() + 10 * 60 * 1000) })

    const authUrl = new URL(`${apiUrl}/oauth/authorize`)
    authUrl.searchParams.set('partner_id', partnerId || '')
    authUrl.searchParams.set('redirect_uri', returnUrl)
    authUrl.searchParams.set('state', state)
    return authUrl.toString()
  }

  /** Finish connecting (OAuth callback): the merchant ID goes into the company's settings. */
  async function completeWisetackConnection(code: string, stateValue: string) {
    const [savedState] = await db.select().from(oauthState)
      .where(and(eq(oauthState.state, stateValue), eq(oauthState.provider, 'wisetack')))
      .limit(1)
    if (!savedState || savedState.expiresAt < new Date()) throw new Error('Invalid or expired state')

    const response = await wisetackRequest('/oauth/token', {
      method: 'POST',
      body: JSON.stringify({ code, partner_id: env().partnerId }),
    })

    if (savedState.companyId) {
      const [companyRow] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, savedState.companyId)).limit(1)
      const settings = (companyRow?.settings as any) || {}
      settings.wisetackMerchantId = response.merchant_id
      settings.wisetackConnectedAt = new Date().toISOString()
      await db.update(company).set({ settings, updatedAt: new Date() }).where(eq(company.id, savedState.companyId))
    }

    await db.delete(oauthState).where(eq(oauthState.id, savedState.id))
    return { connected: true, merchantId: response.merchant_id }
  }

  async function disconnectWisetack(companyId: string) {
    const [companyRow] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings = (companyRow?.settings as any) || {}
    delete settings.wisetackMerchantId
    delete settings.wisetackConnectedAt
    await db.update(company).set({ settings, updatedAt: new Date() }).where(eq(company.id, companyId))
    return { disconnected: true }
  }

  async function getConnectionStatus(companyId: string) {
    const [companyRow] = await db.select({ settings: company.settings }).from(company).where(eq(company.id, companyId)).limit(1)
    const settings = (companyRow?.settings as any) || {}
    return {
      connected: !!settings.wisetackMerchantId,
      merchantId: settings.wisetackMerchantId || null,
      connectedAt: settings.wisetackConnectedAt || null,
    }
  }

  return {
    createLoanApplication,
    getApplicationStatus,
    getApplicationsFor,
    processWebhook,
    initiateWisetackConnection,
    completeWisetackConnection,
    disconnectWisetack,
    getConnectionStatus,
    calculateMonthlyPayment,
    getFinancingOptions,
  }
}

export type WisetackService = ReturnType<typeof createWisetackService>
