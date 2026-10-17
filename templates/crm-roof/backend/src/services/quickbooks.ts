import { db } from '../../db/index.ts'
import { qbIntegration, contact, invoice, company } from '../../db/schema.ts'
import { eq, and } from 'drizzle-orm'
import logger from './logger.ts'
import { notFound } from '../utils/errors.ts'
import { signQboState, verifyQboState } from '../shared/index.ts'

const QB_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QB_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QB_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'

// The Factory injects the Intuit app as QBO_* (apps/api/src/services/quickbooksEnv.ts), the same names every other CRM
// reads. This template read only QB_*, which nothing sets, so Connect QuickBooks sent Intuit an empty client id on every
// roof tenant. QB_* still wins when someone has set it by hand.
//
// redirectUri is the ONE URI registered with Intuit: the Factory's QuickBooks callback (QBO_REDIRECT_URI), which relays
// the browser to returnUrl — this backend's /api/quickbooks/callback (QBO_RETURN_URL) — carried in the signed state.
// Without QBO_RETURN_URL (env from before the relay), or with QB_REDIRECT_URI set by hand, there is no return URL and
// Intuit redirects straight to redirectUri, as before.
function getQBEnv() {
  const handSet = process.env.QB_REDIRECT_URI || ''
  const returnUrl = !handSet && process.env.QBO_REDIRECT_URI && process.env.QBO_RETURN_URL ? process.env.QBO_RETURN_URL : undefined
  return {
    clientId: process.env.QB_CLIENT_ID || process.env.QBO_CLIENT_ID || '',
    clientSecret: process.env.QB_CLIENT_SECRET || process.env.QBO_CLIENT_SECRET || '',
    redirectUri: handSet || process.env.QBO_REDIRECT_URI || '',
    returnUrl,
  }
}

// The state is SIGNED (shared integrations/quickbooksState.ts). It was base64 of { companyId } and the callback trusted
// it, so anyone could finish an Intuit consent with a hand-made state naming another company and attach their books to it.
const stateSecret = () => process.env.QBO_STATE_SECRET || process.env.JWT_SECRET || ''

export function isConfigured() {
  const { clientId, clientSecret, redirectUri } = getQBEnv()
  return !!(clientId && clientSecret && redirectUri && stateSecret())
}

export function getAuthUrl(companyId: string) {
  const { clientId, redirectUri, returnUrl } = getQBEnv()
  const state = signQboState(returnUrl ? { companyId, returnUrl } : { companyId }, stateSecret())
  return `${QB_AUTH_URL}?client_id=${encodeURIComponent(clientId)}&response_type=code&scope=com.intuit.quickbooks.accounting&redirect_uri=${encodeURIComponent(redirectUri)}&state=${encodeURIComponent(state)}`
}

/** companyId when the state is one this server signed (unexpired, return URL untouched); null otherwise. */
export function verifyState(state: string | undefined | null): string | null {
  return verifyQboState(state, stateSecret())?.companyId ?? null
}

export async function handleCallback(code: string, companyId: string) {
  const { clientId, clientSecret, redirectUri } = getQBEnv()
  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')

  // The same redirect_uri the authorize step sent (the relay, when there is one) — Intuit refuses the exchange otherwise.
  const res = await fetch(QB_TOKEN_URL, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=authorization_code&code=${encodeURIComponent(code)}&redirect_uri=${encodeURIComponent(redirectUri)}`,
  })
  if (!res.ok) throw new Error('Failed to exchange token')
  const data = await res.json()

  // Parse realmId from the callback URL query params (passed separately)
  const tokenExpiresAt = new Date(Date.now() + data.expires_in * 1000)

  // Upsert integration
  const [existing] = await db.select().from(qbIntegration)
    .where(eq(qbIntegration.companyId, companyId)).limit(1)

  if (existing) {
    await db.update(qbIntegration).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt,
      syncEnabled: true,
      updatedAt: new Date(),
    }).where(eq(qbIntegration.id, existing.id))
  } else {
    await db.insert(qbIntegration).values({
      companyId,
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      realmId: data.realmId || '',
      tokenExpiresAt,
      syncEnabled: true,
    })
  }

  return data
}

async function getClient(companyId: string) {
  const [integration] = await db.select().from(qbIntegration)
    .where(eq(qbIntegration.companyId, companyId)).limit(1)
  if (!integration) throw new Error('QuickBooks not connected')

  // Refresh token if expired
  if (new Date() >= integration.tokenExpiresAt) {
    const { clientId, clientSecret } = getQBEnv()
    const auth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
    const res = await fetch(QB_TOKEN_URL, {
      method: 'POST',
      headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${integration.refreshToken}`,
    })
    if (!res.ok) throw new Error('Failed to refresh QuickBooks token')
    const data = await res.json()
    await db.update(qbIntegration).set({
      accessToken: data.access_token,
      refreshToken: data.refresh_token,
      tokenExpiresAt: new Date(Date.now() + data.expires_in * 1000),
      updatedAt: new Date(),
    }).where(eq(qbIntegration.id, integration.id))
    integration.accessToken = data.access_token
  }

  return {
    realmId: integration.realmId,
    accessToken: integration.accessToken,
    async request(method: string, path: string, body?: any) {
      const url = `${QB_BASE}/${integration.realmId}/${path}`
      const opts: RequestInit = {
        method,
        headers: {
          Authorization: `Bearer ${integration.accessToken}`,
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
      }
      if (body) opts.body = JSON.stringify(body)
      const res = await fetch(url, opts)
      if (!res.ok) {
        const errText = await res.text()
        throw new Error(`QB API error: ${res.status} ${errText}`)
      }
      return res.json()
    },
  }
}

export async function syncContact(companyId: string, contactId: string) {
  const client = await getClient(companyId)
  const [c] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, companyId)))
    .limit(1)
  if (!c) throw notFound('Contact not found')

  const customerData = {
    DisplayName: `${c.firstName} ${c.lastName}`.trim(),
    GivenName: c.firstName,
    FamilyName: c.lastName,
    PrimaryEmailAddr: c.email ? { Address: c.email } : undefined,
    PrimaryPhone: c.phone ? { FreeFormNumber: c.phone } : undefined,
    BillAddr: c.address ? {
      Line1: c.address,
      City: c.city || '',
      CountrySubDivisionCode: c.state || '',
      PostalCode: c.zip || '',
    } : undefined,
  }

  let qbCustomerId = c.qbCustomerId
  if (qbCustomerId) {
    // Update existing
    const existing = await client.request('GET', `customer/${qbCustomerId}?minorversion=65`)
    const syncToken = existing.Customer?.SyncToken
    await client.request('POST', 'customer?minorversion=65', {
      ...customerData,
      Id: qbCustomerId,
      SyncToken: syncToken,
    })
  } else {
    // Create new
    const result = await client.request('POST', 'customer?minorversion=65', customerData)
    qbCustomerId = result.Customer?.Id
    if (qbCustomerId) {
      await db.update(contact).set({ qbCustomerId, updatedAt: new Date() })
        .where(eq(contact.id, contactId))
    }
  }
  return qbCustomerId
}

export async function syncInvoice(companyId: string, invoiceId: string) {
  const client = await getClient(companyId)
  const [inv] = await db.select().from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, companyId)))
    .limit(1)
  if (!inv) throw notFound('Invoice not found')

  // Sync contact first
  const qbCustomerId = await syncContact(companyId, inv.contactId)

  const lineItems = (inv.lineItems as any[]) || []
  const qbLines = lineItems.map((item: any, i: number) => ({
    DetailType: 'SalesItemLineDetail',
    Amount: item.total || 0,
    Description: item.description || `Line ${i + 1}`,
    SalesItemLineDetail: {
      UnitPrice: item.unitPrice || item.total || 0,
      Qty: item.qty || 1,
    },
  }))

  const invoiceData: any = {
    CustomerRef: { value: qbCustomerId },
    Line: qbLines,
    DueDate: inv.dueDate ? new Date(inv.dueDate).toISOString().slice(0, 10) : undefined,
    DocNumber: inv.invoiceNumber,
  }

  let qbInvoiceId = inv.qbInvoiceId
  if (qbInvoiceId) {
    const existing = await client.request('GET', `invoice/${qbInvoiceId}?minorversion=65`)
    invoiceData.Id = qbInvoiceId
    invoiceData.SyncToken = existing.Invoice?.SyncToken
    await client.request('POST', 'invoice?minorversion=65', invoiceData)
  } else {
    const result = await client.request('POST', 'invoice?minorversion=65', invoiceData)
    qbInvoiceId = result.Invoice?.Id
  }

  if (qbInvoiceId) {
    await db.update(invoice).set({
      qbInvoiceId,
      syncedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(invoice.id, invoiceId))
  }

  return qbInvoiceId
}

export async function fullSync(companyId: string) {
  logger.info('Starting full QuickBooks sync', { companyId })

  // Sync contacts that have invoices
  const invoices = await db.select().from(invoice)
    .where(eq(invoice.companyId, companyId))
  const contactIds = [...new Set(invoices.map(i => i.contactId))]

  for (const cid of contactIds) {
    try { await syncContact(companyId, cid) } catch (err) {
      logger.warn('Failed to sync contact to QB', { contactId: cid, error: (err as Error).message })
    }
  }

  // Sync sent/paid invoices
  const syncableInvoices = invoices.filter(i => ['sent', 'paid', 'overdue'].includes(i.status))
  for (const inv of syncableInvoices) {
    try { await syncInvoice(companyId, inv.id) } catch (err) {
      logger.warn('Failed to sync invoice to QB', { invoiceId: inv.id, error: (err as Error).message })
    }
  }

  // Update last synced
  await db.update(qbIntegration).set({ lastSyncedAt: new Date(), updatedAt: new Date() })
    .where(eq(qbIntegration.companyId, companyId))

  logger.info('Full QuickBooks sync complete', { companyId, invoicesSynced: syncableInvoices.length })
}

export async function disconnect(companyId: string) {
  await db.update(qbIntegration).set({
    syncEnabled: false,
    accessToken: '',
    refreshToken: '',
    updatedAt: new Date(),
  }).where(eq(qbIntegration.companyId, companyId))
}
