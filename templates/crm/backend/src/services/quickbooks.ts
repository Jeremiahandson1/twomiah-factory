/**
 * QuickBooks Online Integration Service
 *
 * Handles OAuth2 authentication and syncing:
 * - Customers (Contacts)
 * - Invoices
 * - Payments
 * - Items/Services
 */

import { db } from '../../db/index.ts'
import { contact, invoice, invoiceLineItem, payment, company } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, sql, asc } from 'drizzle-orm'

// NOTE: The Drizzle schema does not have a dedicated `quickBooksConnection` table.
// Using raw SQL for QBO connection management.
// Also, contact/invoice tables lack qboCustomerId/qboInvoiceId fields.
// These should be added to the schema, or stored in customFields/json columns.

// QuickBooks API URLs
const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company'

// Environment config
const CLIENT_ID = process.env.QBO_CLIENT_ID
const CLIENT_SECRET = process.env.QBO_CLIENT_SECRET
const REDIRECT_URI = process.env.QBO_REDIRECT_URI
const USE_SANDBOX = process.env.QBO_SANDBOX === 'true'

/**
 * Generate OAuth2 authorization URL
 */
export function getAuthUrl(companyId: string): string {
  const state = Buffer.from(JSON.stringify({ companyId })).toString('base64')

  const params = new URLSearchParams({
    client_id: CLIENT_ID!,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: REDIRECT_URI!,
    state,
  })

  return `${QBO_AUTH_URL}?${params}`
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(code: string) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: REDIRECT_URI!,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token exchange failed: ${error}`)
  }

  return response.json()
}

/**
 * Refresh access token
 */
export async function refreshAccessToken(refreshToken: string) {
  const response = await fetch(QBO_TOKEN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'Authorization': `Basic ${Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Token refresh failed: ${error}`)
  }

  return response.json()
}

/**
 * Save QuickBooks connection
 */
export async function saveConnection(companyId: string, { accessToken, refreshToken, realmId, expiresIn }: { accessToken: string; refreshToken: string; realmId: string; expiresIn: number }) {
  const expiresAt = new Date(Date.now() + expiresIn * 1000)

  // Upsert via raw SQL since quickbooks_connection table not in schema
  const result = await db.execute(sql`
    INSERT INTO quickbooks_connection (company_id, access_token, refresh_token, realm_id, expires_at, is_connected)
    VALUES (${companyId}, ${accessToken}, ${refreshToken}, ${realmId}, ${expiresAt}, true)
    ON CONFLICT (company_id) DO UPDATE SET
      access_token = ${accessToken},
      refresh_token = ${refreshToken},
      realm_id = ${realmId},
      expires_at = ${expiresAt},
      is_connected = true
    RETURNING *
  `)

  return result.rows?.[0] ?? result
}

/**
 * Get valid access token (refresh if needed)
 */
export async function getValidToken(companyId: string): Promise<{ token: string; realmId: string }> {
  const connResult = await db.execute(sql`
    SELECT * FROM quickbooks_connection WHERE company_id = ${companyId}
  `)
  const connection = (connResult.rows?.[0] ?? null) as any

  if (!connection || !connection.is_connected) {
    throw new Error('QuickBooks not connected')
  }

  // Check if token is expired or expiring soon (5 min buffer)
  const buffer = 5 * 60 * 1000
  if (new Date() >= new Date(new Date(connection.expires_at).getTime() - buffer)) {
    // Refresh token
    const tokens = await refreshAccessToken(connection.refresh_token)

    await db.execute(sql`
      UPDATE quickbooks_connection SET
        access_token = ${tokens.access_token},
        refresh_token = ${tokens.refresh_token},
        expires_at = ${new Date(Date.now() + tokens.expires_in * 1000)}
      WHERE company_id = ${companyId}
    `)

    return { token: tokens.access_token, realmId: connection.realm_id }
  }

  return { token: connection.access_token, realmId: connection.realm_id }
}

/**
 * Make authenticated API request
 */
async function apiRequest(companyId: string, method: string, endpoint: string, body: any = null) {
  const { token, realmId } = await getValidToken(companyId)
  const baseUrl = USE_SANDBOX ? QBO_SANDBOX_API_BASE : QBO_API_BASE

  const options: RequestInit = {
    method,
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
  }

  if (body) {
    options.body = JSON.stringify(body)
  }

  const response = await fetch(`${baseUrl}/${realmId}${endpoint}`, options)

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`QBO API error: ${response.status} - ${error}`)
  }

  return response.json()
}

/**
 * Disconnect QuickBooks
 */
export async function disconnect(companyId: string) {
  await db.execute(sql`
    UPDATE quickbooks_connection SET
      is_connected = false,
      access_token = NULL,
      refresh_token = NULL
    WHERE company_id = ${companyId}
  `)
}

/**
 * Get connection status
 */
export async function getConnectionStatus(companyId: string) {
  const connResult = await db.execute(sql`
    SELECT * FROM quickbooks_connection WHERE company_id = ${companyId}
  `)
  const connection = (connResult.rows?.[0] ?? null) as any

  if (!connection) {
    return { connected: false }
  }

  return {
    connected: connection.is_connected,
    realmId: connection.realm_id,
    lastSyncAt: connection.last_sync_at,
    expiresAt: connection.expires_at,
  }
}

// ============================================
// CUSTOMER SYNC
// ============================================

/**
 * Create customer in QuickBooks
 */
export async function createCustomer(companyId: string, contactData: any) {
  const customerData: any = {
    DisplayName: contactData.name,
    CompanyName: contactData.company || undefined,
    PrimaryEmailAddr: contactData.email ? { Address: contactData.email } : undefined,
    PrimaryPhone: contactData.phone ? { FreeFormNumber: contactData.phone } : undefined,
    Mobile: contactData.mobile ? { FreeFormNumber: contactData.mobile } : undefined,
    BillAddr: contactData.address ? {
      Line1: contactData.address,
      City: contactData.city,
      CountrySubDivisionCode: contactData.state,
      PostalCode: contactData.zip,
    } : undefined,
  }

  const result = await apiRequest(companyId, 'POST', '/customer', { Customer: customerData })

  // Save QBO ID to contact's customFields
  const [c] = await db.select().from(contact).where(eq(contact.id, contactData.id))
  if (c) {
    const customFields = (c.customFields as any) || {}
    customFields.qboCustomerId = result.Customer.Id
    await db.update(contact)
      .set({ customFields })
      .where(eq(contact.id, contactData.id))
  }

  return result.Customer
}

/**
 * Update customer in QuickBooks
 */
export async function updateCustomer(companyId: string, contactData: any) {
  const customFields = (contactData.customFields as any) || {}
  if (!customFields.qboCustomerId) {
    return createCustomer(companyId, contactData)
  }

  // Get current customer to get SyncToken
  const current = await apiRequest(companyId, 'GET', `/customer/${customFields.qboCustomerId}`)

  const customerData: any = {
    Id: customFields.qboCustomerId,
    SyncToken: current.Customer.SyncToken,
    DisplayName: contactData.name,
    CompanyName: contactData.company || undefined,
    PrimaryEmailAddr: contactData.email ? { Address: contactData.email } : undefined,
    PrimaryPhone: contactData.phone ? { FreeFormNumber: contactData.phone } : undefined,
    BillAddr: contactData.address ? {
      Line1: contactData.address,
      City: contactData.city,
      CountrySubDivisionCode: contactData.state,
      PostalCode: contactData.zip,
    } : undefined,
  }

  const result = await apiRequest(companyId, 'POST', '/customer', { Customer: customerData })
  return result.Customer
}

/**
 * Sync all contacts to QuickBooks
 */
export async function syncAllCustomers(companyId: string) {
  const contacts = await db.select()
    .from(contact)
    .where(and(eq(contact.companyId, companyId), eq(contact.type, 'client')))

  const results: Array<{ id: string; success: boolean; action?: string; error?: string }> = []

  for (const c of contacts) {
    try {
      const customFields = (c.customFields as any) || {}
      if (customFields.qboCustomerId) {
        await updateCustomer(companyId, c)
        results.push({ id: c.id, success: true, action: 'updated' })
      } else {
        await createCustomer(companyId, c)
        results.push({ id: c.id, success: true, action: 'created' })
      }
    } catch (error: any) {
      results.push({ id: c.id, success: false, error: error.message })
    }
  }

  await db.execute(sql`
    UPDATE quickbooks_connection SET last_sync_at = NOW() WHERE company_id = ${companyId}
  `)

  return results
}

// ============================================
// INVOICE SYNC
// ============================================

/**
 * Create invoice in QuickBooks
 */
export async function createInvoice(companyId: string, invoiceData: any) {
  // Ensure customer exists
  const [c] = await db.select().from(contact).where(eq(contact.id, invoiceData.contactId))
  const customFields = (c?.customFields as any) || {}

  if (!customFields.qboCustomerId) {
    await createCustomer(companyId, c)
  }

  // Re-fetch contact for updated QBO ID
  const [updatedContact] = await db.select().from(contact).where(eq(contact.id, invoiceData.contactId))
  const updatedCustomFields = (updatedContact?.customFields as any) || {}

  const lineItems = (invoiceData.lineItems || []).map((item: any, index: number) => ({
    LineNum: index + 1,
    Amount: Number(item.total),
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: Number(item.quantity),
      UnitPrice: Number(item.unitPrice),
    },
  }))

  const qboInvoiceData: any = {
    CustomerRef: { value: updatedCustomFields.qboCustomerId },
    DocNumber: invoiceData.number,
    TxnDate: invoiceData.issueDate ? new Date(invoiceData.issueDate).toISOString().split('T')[0] : undefined,
    DueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate).toISOString().split('T')[0] : undefined,
    Line: lineItems,
    CustomerMemo: invoiceData.notes ? { value: invoiceData.notes } : undefined,
  }

  const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: qboInvoiceData })

  // Save QBO ID - store in notes since invoice table doesn't have qboInvoiceId
  await db.update(invoice)
    .set({ notes: `${invoiceData.notes || ''}\n[QBO:${result.Invoice.Id}]`.trim() })
    .where(eq(invoice.id, invoiceData.id))

  return result.Invoice
}

/**
 * Update invoice in QuickBooks
 */
export async function updateInvoice(companyId: string, invoiceData: any) {
  // Extract QBO ID from notes
  const qboIdMatch = invoiceData.notes?.match(/\[QBO:(\d+)\]/)
  if (!qboIdMatch) {
    return createInvoice(companyId, invoiceData)
  }
  const qboInvoiceId = qboIdMatch[1]

  const current = await apiRequest(companyId, 'GET', `/invoice/${qboInvoiceId}`)
  const [c] = await db.select().from(contact).where(eq(contact.id, invoiceData.contactId))
  const customFields = (c?.customFields as any) || {}

  const lineItems = (invoiceData.lineItems || []).map((item: any, index: number) => ({
    LineNum: index + 1,
    Amount: Number(item.total),
    DetailType: 'SalesItemLineDetail',
    Description: item.description,
    SalesItemLineDetail: {
      Qty: Number(item.quantity),
      UnitPrice: Number(item.unitPrice),
    },
  }))

  const qboInvoiceData: any = {
    Id: qboInvoiceId,
    SyncToken: current.Invoice.SyncToken,
    CustomerRef: { value: customFields.qboCustomerId },
    DocNumber: invoiceData.number,
    TxnDate: invoiceData.issueDate ? new Date(invoiceData.issueDate).toISOString().split('T')[0] : undefined,
    DueDate: invoiceData.dueDate ? new Date(invoiceData.dueDate).toISOString().split('T')[0] : undefined,
    Line: lineItems,
  }

  const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: qboInvoiceData })
  return result.Invoice
}

/**
 * Sync all invoices to QuickBooks
 */
export async function syncAllInvoices(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
  const conditions = [eq(invoice.companyId, companyId), sql`${invoice.status} != 'draft'`]

  if (startDate) conditions.push(gte(invoice.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(invoice.createdAt, new Date(endDate)))

  const invoices = await db.select()
    .from(invoice)
    .where(and(...conditions))

  const results: Array<{ id: string; number: string; success: boolean; action?: string; error?: string }> = []

  for (const inv of invoices) {
    try {
      // Get line items
      const lineItems = await db.select()
        .from(invoiceLineItem)
        .where(eq(invoiceLineItem.invoiceId, inv.id))
        .orderBy(asc(invoiceLineItem.sortOrder))

      // Get contact
      const [c] = inv.contactId
        ? await db.select().from(contact).where(eq(contact.id, inv.contactId))
        : [null]

      const customFields = (c?.customFields as any) || {}
      if (c && !customFields.qboCustomerId) {
        await createCustomer(companyId, c)
      }

      const invoiceWithItems = { ...inv, lineItems, contact: c }

      const qboIdMatch = inv.notes?.match(/\[QBO:(\d+)\]/)
      if (qboIdMatch) {
        await updateInvoice(companyId, invoiceWithItems)
        results.push({ id: inv.id, number: inv.number, success: true, action: 'updated' })
      } else {
        await createInvoice(companyId, invoiceWithItems)
        results.push({ id: inv.id, number: inv.number, success: true, action: 'created' })
      }
    } catch (error: any) {
      results.push({ id: inv.id, number: inv.number, success: false, error: error.message })
    }
  }

  await db.execute(sql`
    UPDATE quickbooks_connection SET last_sync_at = NOW() WHERE company_id = ${companyId}
  `)

  return results
}

// ============================================
// PAYMENT SYNC
// ============================================

/**
 * Create payment in QuickBooks
 */
export async function createPayment(companyId: string, paymentData: any, invoiceData: any) {
  const [c] = await db.select().from(contact).where(eq(contact.id, invoiceData.contactId))
  const customFields = (c?.customFields as any) || {}
  const qboIdMatch = invoiceData.notes?.match(/\[QBO:(\d+)\]/)

  if (!customFields.qboCustomerId || !qboIdMatch) {
    throw new Error('Customer and invoice must be synced to QuickBooks first')
  }

  const qboPaymentData: any = {
    CustomerRef: { value: customFields.qboCustomerId },
    TotalAmt: Number(paymentData.amount),
    TxnDate: paymentData.paidAt ? new Date(paymentData.paidAt).toISOString().split('T')[0] : undefined,
    Line: [{
      Amount: Number(paymentData.amount),
      LinkedTxn: [{
        TxnId: qboIdMatch[1],
        TxnType: 'Invoice',
      }],
    }],
  }

  const result = await apiRequest(companyId, 'POST', '/payment', { Payment: qboPaymentData })

  // Save QBO payment ID in payment notes
  await db.update(payment)
    .set({ notes: `${paymentData.notes || ''}\n[QBO:${result.Payment.Id}]`.trim() })
    .where(eq(payment.id, paymentData.id))

  return result.Payment
}

// ============================================
// IMPORT FROM QUICKBOOKS
// ============================================

/**
 * Import customers from QuickBooks
 */
export async function importCustomers(companyId: string) {
  const result = await apiRequest(companyId, 'GET', '/query?query=SELECT * FROM Customer MAXRESULTS 1000')
  const customers = result.QueryResponse?.Customer || []

  const imported: Array<{ qboId: string; action: string; id: string }> = []

  for (const customer of customers) {
    // Check if already exists by searching customFields
    const existingContacts = await db.select()
      .from(contact)
      .where(eq(contact.companyId, companyId))

    const existing = existingContacts.find(c => {
      const cf = (c.customFields as any) || {}
      return cf.qboCustomerId === customer.Id
    })

    if (existing) {
      // Update
      await db.update(contact)
        .set({
          name: customer.DisplayName,
          company: customer.CompanyName,
          email: customer.PrimaryEmailAddr?.Address,
          phone: customer.PrimaryPhone?.FreeFormNumber,
          address: customer.BillAddr?.Line1,
          city: customer.BillAddr?.City,
          state: customer.BillAddr?.CountrySubDivisionCode,
          zip: customer.BillAddr?.PostalCode,
        })
        .where(eq(contact.id, existing.id))

      imported.push({ qboId: customer.Id, action: 'updated', id: existing.id })
    } else {
      // Create
      const customFieldsData = { qboCustomerId: customer.Id }
      const [created] = await db.insert(contact).values({
        companyId,
        type: 'client',
        name: customer.DisplayName,
        company: customer.CompanyName,
        email: customer.PrimaryEmailAddr?.Address,
        phone: customer.PrimaryPhone?.FreeFormNumber,
        address: customer.BillAddr?.Line1,
        city: customer.BillAddr?.City,
        state: customer.BillAddr?.CountrySubDivisionCode,
        zip: customer.BillAddr?.PostalCode,
        customFields: customFieldsData,
      }).returning()

      imported.push({ qboId: customer.Id, action: 'created', id: created.id })
    }
  }

  return imported
}

/**
 * Get QuickBooks company info
 */
export async function getCompanyInfo(companyId: string) {
  const { realmId } = await getValidToken(companyId)
  const result = await apiRequest(companyId, 'GET', '/companyinfo/' + realmId)
  return result.CompanyInfo
}

export default {
  getAuthUrl,
  exchangeCodeForTokens,
  saveConnection,
  disconnect,
  getConnectionStatus,
  getCompanyInfo,
  createCustomer,
  updateCustomer,
  syncAllCustomers,
  createInvoice,
  updateInvoice,
  syncAllInvoices,
  createPayment,
  importCustomers,
}
