// QuickBooks Online — ONE implementation for every CRM (vendored into each template as ../shared).
// OAuth2 with a SIGNED state (the old base64 {companyId} let anyone attach their QBO company to any tenant
// company id — the code comment claimed an HMAC that was never written), connection storage in the
// qb_integration table + qb_customer_id / qb_invoice_id columns (the crm-family version wrote to a
// quickbooks_connection table that its own boot prune drops every start, and hid ids in customFields and
// invoice notes), customer / invoice / payment sync and customer import.
import { Hono } from 'hono'
import crypto from 'crypto'
import { eq, and, gte, lte, sql, asc } from 'drizzle-orm'

const QBO_AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2'
const QBO_TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const QBO_API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const QBO_SANDBOX_API_BASE = 'https://sandbox-quickbooks.api.intuit.com/v3/company'
const STATE_TTL_MS = 15 * 60 * 1000

export interface QuickBooksTables { contact: any; invoice: any; invoiceLineItem: any; payment: any; company: any; qbIntegration: any }
export interface QuickBooksOptions {
  /** Contact type that syncs as a QBO customer. Default 'client' (rv: 'customer'). */
  customerType?: string
  clientId?: string
  clientSecret?: string
  redirectUri?: string
  sandbox?: boolean
  /** Secret for the OAuth state HMAC; default QBO_STATE_SECRET || JWT_SECRET. */
  stateSecret?: string
}
export interface QuickBooksServiceDeps { db: any; tables: QuickBooksTables; options?: QuickBooksOptions }

export function createQuickBooksService(deps: QuickBooksServiceDeps) {
  const { db, tables: t } = deps
  const o = deps.options || {}
  const CLIENT_ID = () => o.clientId ?? process.env.QBO_CLIENT_ID
  const CLIENT_SECRET = () => o.clientSecret ?? process.env.QBO_CLIENT_SECRET
  const REDIRECT_URI = () => o.redirectUri ?? process.env.QBO_REDIRECT_URI
  const USE_SANDBOX = () => o.sandbox ?? process.env.QBO_SANDBOX === 'true'
  const stateSecret = () => o.stateSecret || process.env.QBO_STATE_SECRET || process.env.JWT_SECRET || ''
  const customerType = o.customerType || 'client'
  const configured = () => !!(CLIENT_ID() && CLIENT_SECRET() && REDIRECT_URI())

  // ── OAuth state: base64url({ companyId, ts, sig }) with sig = HMAC-SHA256(secret, companyId.ts); 15-minute window.
  const sign = (companyId: string, ts: number) => crypto.createHmac('sha256', stateSecret()).update(`${companyId}.${ts}`).digest('hex')
  function signState(companyId: string): string {
    const ts = Date.now()
    return Buffer.from(JSON.stringify({ companyId, ts, sig: sign(companyId, ts) })).toString('base64url')
  }
  /** companyId when the state is ours, unexpired and untampered; null otherwise. */
  function verifyState(state: string | undefined | null): string | null {
    if (!state || !stateSecret()) return null
    let parsed: any
    try { parsed = JSON.parse(Buffer.from(String(state), 'base64url').toString('utf8')) } catch { return null }
    const { companyId, ts, sig } = parsed || {}
    if (!companyId || typeof ts !== 'number' || typeof sig !== 'string') return null
    if (Math.abs(Date.now() - ts) > STATE_TTL_MS) return null
    const expected = Buffer.from(sign(companyId, ts))
    const given = Buffer.from(sig)
    return expected.length === given.length && crypto.timingSafeEqual(expected, given) ? String(companyId) : null
  }

  function getAuthUrl(companyId: string): string {
    if (!configured()) throw new Error('QuickBooks is not configured on this server (QBO_CLIENT_ID / QBO_CLIENT_SECRET / QBO_REDIRECT_URI).')
    const params = new URLSearchParams({ client_id: CLIENT_ID()!, response_type: 'code', scope: 'com.intuit.quickbooks.accounting', redirect_uri: REDIRECT_URI()!, state: signState(companyId) })
    return `${QBO_AUTH_URL}?${params}`
  }

  const basicAuth = () => `Basic ${Buffer.from(`${CLIENT_ID()}:${CLIENT_SECRET()}`).toString('base64')}`
  async function exchangeCodeForTokens(code: string) {
    const response = await fetch(QBO_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
      body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT_URI()! }),
    })
    if (!response.ok) throw new Error(`Token exchange failed: ${await response.text()}`)
    return response.json()
  }
  async function refreshAccessToken(refreshToken: string) {
    const response = await fetch(QBO_TOKEN_URL, {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: basicAuth() },
      body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: refreshToken }),
    })
    if (!response.ok) throw new Error(`Token refresh failed: ${await response.text()}`)
    return response.json()
  }

  async function saveConnection(companyId: string, { accessToken, refreshToken, realmId, expiresIn }: { accessToken: string; refreshToken: string; realmId: string; expiresIn: number }) {
    const expiresAt = new Date(Date.now() + Number(expiresIn || 3600) * 1000)
    const [existing] = await db.select().from(t.qbIntegration).where(eq(t.qbIntegration.companyId, companyId)).limit(1)
    if (existing) await db.update(t.qbIntegration).set({ accessToken, refreshToken, realmId, tokenExpiresAt: expiresAt, syncEnabled: true, updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
    else await db.insert(t.qbIntegration).values({ companyId, accessToken, refreshToken, realmId, tokenExpiresAt: expiresAt, syncEnabled: true })
    return { companyId, realmId }
  }

  async function getValidToken(companyId: string): Promise<{ token: string; realmId: string }> {
    const [connection] = await db.select().from(t.qbIntegration).where(eq(t.qbIntegration.companyId, companyId)).limit(1)
    if (!connection || !connection.syncEnabled || !connection.accessToken) throw new Error('QuickBooks not connected')
    const buffer = 5 * 60 * 1000
    if (connection.tokenExpiresAt && new Date() >= new Date(new Date(connection.tokenExpiresAt).getTime() - buffer)) {
      const tokens = await refreshAccessToken(connection.refreshToken!)
      await db.update(t.qbIntegration).set({ accessToken: tokens.access_token, refreshToken: tokens.refresh_token, tokenExpiresAt: new Date(Date.now() + tokens.expires_in * 1000), updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
      return { token: tokens.access_token, realmId: connection.realmId! }
    }
    return { token: connection.accessToken!, realmId: connection.realmId! }
  }

  async function apiRequest(companyId: string, method: string, endpoint: string, body: any = null) {
    const { token, realmId } = await getValidToken(companyId)
    const baseUrl = USE_SANDBOX() ? QBO_SANDBOX_API_BASE : QBO_API_BASE
    const options: RequestInit = { method, headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'application/json' } }
    if (body) options.body = JSON.stringify(body)
    const response = await fetch(`${baseUrl}/${realmId}${endpoint}`, options)
    if (!response.ok) throw new Error(`QBO API error: ${response.status} - ${await response.text()}`)
    return response.json()
  }

  async function disconnect(companyId: string) {
    await db.update(t.qbIntegration).set({ syncEnabled: false, accessToken: null, refreshToken: null, updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
  }
  async function setAutoSync(companyId: string, enabled: boolean) {
    const [connection] = await db.select().from(t.qbIntegration).where(eq(t.qbIntegration.companyId, companyId)).limit(1)
    if (!connection || !connection.accessToken) throw new Error('QuickBooks not connected')
    await db.update(t.qbIntegration).set({ syncEnabled: enabled, updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
    return { syncEnabled: enabled }
  }
  async function getConnectionStatus(companyId: string) {
    const [connection] = await db.select().from(t.qbIntegration).where(eq(t.qbIntegration.companyId, companyId)).limit(1)
    if (!connection || !connection.accessToken) return { connected: false, configured: configured(), syncEnabled: false }
    return { connected: true, configured: configured(), realmId: connection.realmId, lastSyncAt: connection.lastSyncedAt, syncEnabled: !!connection.syncEnabled, expiresAt: connection.tokenExpiresAt }
  }

  // ── Customers
  const customerPayload = (contactData: any) => ({
    DisplayName: contactData.name,
    CompanyName: contactData.company || undefined,
    PrimaryEmailAddr: contactData.email ? { Address: contactData.email } : undefined,
    PrimaryPhone: contactData.phone ? { FreeFormNumber: contactData.phone } : undefined,
    Mobile: contactData.mobile ? { FreeFormNumber: contactData.mobile } : undefined,
    BillAddr: contactData.address ? { Line1: contactData.address, City: contactData.city, CountrySubDivisionCode: contactData.state, PostalCode: contactData.zip } : undefined,
  })
  async function createCustomer(companyId: string, contactData: any) {
    const result = await apiRequest(companyId, 'POST', '/customer', { Customer: customerPayload(contactData) })
    await db.update(t.contact).set({ qbCustomerId: result.Customer.Id } as any).where(eq(t.contact.id, contactData.id))
    return result.Customer
  }
  async function updateCustomer(companyId: string, contactData: any) {
    if (!contactData.qbCustomerId) return createCustomer(companyId, contactData)
    const current = await apiRequest(companyId, 'GET', `/customer/${contactData.qbCustomerId}`)
    const result = await apiRequest(companyId, 'POST', '/customer', { Customer: { Id: contactData.qbCustomerId, SyncToken: current.Customer.SyncToken, ...customerPayload(contactData) } })
    return result.Customer
  }
  async function syncAllCustomers(companyId: string) {
    const contacts = await db.select().from(t.contact).where(and(eq(t.contact.companyId, companyId), eq(t.contact.type, customerType)))
    const results: Array<{ id: string; success: boolean; action?: string; error?: string }> = []
    for (const c of contacts) {
      try {
        if ((c as any).qbCustomerId) { await updateCustomer(companyId, c); results.push({ id: c.id, success: true, action: 'updated' }) }
        else { await createCustomer(companyId, c); results.push({ id: c.id, success: true, action: 'created' }) }
      } catch (error: any) { results.push({ id: c.id, success: false, error: error.message }) }
    }
    await db.update(t.qbIntegration).set({ lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
    return results
  }

  // ── Invoices
  const invoiceLines = (invoiceData: any) => (invoiceData.lineItems || []).map((item: any, index: number) => ({
    LineNum: index + 1, Amount: Number(item.total), DetailType: 'SalesItemLineDetail', Description: item.description,
    SalesItemLineDetail: { Qty: Number(item.quantity), UnitPrice: Number(item.unitPrice) },
  }))
  const day = (d: any) => (d ? new Date(d).toISOString().split('T')[0] : undefined)
  async function createInvoice(companyId: string, invoiceData: any) {
    const [c] = await db.select().from(t.contact).where(eq(t.contact.id, invoiceData.contactId))
    if (!c) throw new Error('Invoice has no customer')
    if (!(c as any).qbCustomerId) await createCustomer(companyId, c)
    const [updatedContact] = await db.select().from(t.contact).where(eq(t.contact.id, invoiceData.contactId))
    const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: {
      CustomerRef: { value: (updatedContact as any)?.qbCustomerId }, DocNumber: invoiceData.number, TxnDate: day(invoiceData.issueDate), DueDate: day(invoiceData.dueDate),
      Line: invoiceLines(invoiceData), CustomerMemo: invoiceData.notes ? { value: invoiceData.notes } : undefined,
    } })
    await db.update(t.invoice).set({ qbInvoiceId: result.Invoice.Id, syncedAt: new Date() } as any).where(eq(t.invoice.id, invoiceData.id))
    return result.Invoice
  }
  async function updateInvoice(companyId: string, invoiceData: any) {
    if (!invoiceData.qbInvoiceId) return createInvoice(companyId, invoiceData)
    const current = await apiRequest(companyId, 'GET', `/invoice/${invoiceData.qbInvoiceId}`)
    const [c] = await db.select().from(t.contact).where(eq(t.contact.id, invoiceData.contactId))
    const result = await apiRequest(companyId, 'POST', '/invoice', { Invoice: {
      Id: invoiceData.qbInvoiceId, SyncToken: current.Invoice.SyncToken, CustomerRef: { value: (c as any)?.qbCustomerId }, DocNumber: invoiceData.number,
      TxnDate: day(invoiceData.issueDate), DueDate: day(invoiceData.dueDate), Line: invoiceLines(invoiceData),
    } })
    await db.update(t.invoice).set({ syncedAt: new Date() } as any).where(eq(t.invoice.id, invoiceData.id))
    return result.Invoice
  }
  async function syncAllInvoices(companyId: string, { startDate, endDate }: { startDate?: string; endDate?: string } = {}) {
    const conditions: any[] = [eq(t.invoice.companyId, companyId), sql`${t.invoice.status} not in ('draft', 'void')`]
    if (startDate) conditions.push(gte(t.invoice.createdAt, new Date(startDate)))
    if (endDate) conditions.push(lte(t.invoice.createdAt, new Date(endDate)))
    const invoices = await db.select().from(t.invoice).where(and(...conditions))
    const results: Array<{ id: string; number: string; success: boolean; action?: string; error?: string }> = []
    for (const inv of invoices) {
      try {
        const lineItems = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, inv.id)).orderBy(asc(t.invoiceLineItem.sortOrder))
        const [c] = inv.contactId ? await db.select().from(t.contact).where(eq(t.contact.id, inv.contactId)) : [null]
        if (c && !(c as any).qbCustomerId) await createCustomer(companyId, c)
        const withItems = { ...inv, lineItems, contact: c }
        if ((inv as any).qbInvoiceId) { await updateInvoice(companyId, withItems); results.push({ id: inv.id, number: inv.number, success: true, action: 'updated' }) }
        else { await createInvoice(companyId, withItems); results.push({ id: inv.id, number: inv.number, success: true, action: 'created' }) }
      } catch (error: any) { results.push({ id: inv.id, number: inv.number, success: false, error: error.message }) }
    }
    await db.update(t.qbIntegration).set({ lastSyncedAt: new Date(), updatedAt: new Date() }).where(eq(t.qbIntegration.companyId, companyId))
    return results
  }

  // ── Payments
  async function createPayment(companyId: string, paymentData: any, invoiceData: any) {
    const [c] = await db.select().from(t.contact).where(eq(t.contact.id, invoiceData.contactId))
    if (!(c as any)?.qbCustomerId || !invoiceData.qbInvoiceId) throw new Error('Customer and invoice must be synced to QuickBooks first')
    const result = await apiRequest(companyId, 'POST', '/payment', { Payment: {
      CustomerRef: { value: (c as any).qbCustomerId }, TotalAmt: Number(paymentData.amount), TxnDate: day(paymentData.paidAt),
      Line: [{ Amount: Number(paymentData.amount), LinkedTxn: [{ TxnId: invoiceData.qbInvoiceId, TxnType: 'Invoice' }] }],
    } })
    await db.update(t.payment).set({ notes: `${paymentData.notes || ''}\n[QBO:${result.Payment.Id}]`.trim() }).where(eq(t.payment.id, paymentData.id))
    return result.Payment
  }

  // ── Import
  async function importCustomers(companyId: string) {
    const result = await apiRequest(companyId, 'GET', '/query?query=SELECT * FROM Customer MAXRESULTS 1000')
    const customers = result.QueryResponse?.Customer || []
    const existingContacts = await db.select().from(t.contact).where(eq(t.contact.companyId, companyId))
    const byQbo = new Map<string, any>(existingContacts.filter((c: any) => c.qbCustomerId).map((c: any) => [String(c.qbCustomerId), c]))
    const imported: Array<{ qboId: string; action: string; id: string }> = []
    for (const customer of customers) {
      const fields = {
        name: customer.DisplayName, company: customer.CompanyName, email: customer.PrimaryEmailAddr?.Address, phone: customer.PrimaryPhone?.FreeFormNumber,
        address: customer.BillAddr?.Line1, city: customer.BillAddr?.City, state: customer.BillAddr?.CountrySubDivisionCode, zip: customer.BillAddr?.PostalCode,
      }
      const existing = byQbo.get(String(customer.Id))
      if (existing) { await db.update(t.contact).set(fields).where(eq(t.contact.id, existing.id)); imported.push({ qboId: customer.Id, action: 'updated', id: existing.id }) }
      else { const [created] = await db.insert(t.contact).values({ companyId, type: customerType, ...fields, qbCustomerId: customer.Id } as any).returning(); imported.push({ qboId: customer.Id, action: 'created', id: created.id }) }
    }
    return imported
  }
  async function getCompanyInfo(companyId: string) {
    const { realmId } = await getValidToken(companyId)
    return (await apiRequest(companyId, 'GET', '/companyinfo/' + realmId)).CompanyInfo
  }

  return {
    configured, getAuthUrl, signState, verifyState, exchangeCodeForTokens, refreshAccessToken, saveConnection, getValidToken, disconnect, setAutoSync, getConnectionStatus, getCompanyInfo,
    createCustomer, updateCustomer, syncAllCustomers, createInvoice, updateInvoice, syncAllInvoices, createPayment, importCustomers,
  }
}
export type QuickBooksService = ReturnType<typeof createQuickBooksService>

export interface QuickBooksRoutesDeps {
  service: QuickBooksService
  db: any
  tables: { contact: any; invoice: any; invoiceLineItem: any; payment: any }
  authenticate: any
  requireRole: (...roles: string[]) => any
  audit?: { log: (input: any) => any }
  frontendUrl?: string
}

export function createQuickBooksRoutes(deps: QuickBooksRoutesDeps) {
  const { service: qb, db, tables: t, authenticate, requireRole } = deps
  const audit = deps.audit || { log: () => {} }
  const app = new Hono()
  const settingsUrl = (q: string) => `${deps.frontendUrl || process.env.FRONTEND_URL || ''}/settings/integrations?${q}`

  // OAuth callback — no session (Intuit redirects the browser here); the signed state is the proof it is ours.
  app.get('/callback', async (c) => {
    const { code, state, realmId, error } = c.req.query()
    if (error) return c.redirect(settingsUrl(`error=${encodeURIComponent(error)}`))
    const companyId = qb.verifyState(state)
    if (!companyId) return c.redirect(settingsUrl('error=invalid_state'))
    if (!code || !realmId) return c.redirect(settingsUrl('error=missing_code'))
    try {
      const tokens = await qb.exchangeCodeForTokens(code)
      await qb.saveConnection(companyId, { accessToken: tokens.access_token, refreshToken: tokens.refresh_token, realmId, expiresIn: tokens.expires_in })
    } catch (e: any) {
      console.error('[quickbooks] token exchange failed:', e?.message)
      return c.redirect(settingsUrl('error=token_exchange_failed'))
    }
    return c.redirect(settingsUrl('qbo=connected'))
  })

  app.use('*', authenticate)
  const user = (c: any) => c.get('user') as any

  app.get('/status', async (c) => c.json(await qb.getConnectionStatus(user(c).companyId)))
  app.get('/auth-url', requireRole('admin', 'owner'), async (c) => {
    try { return c.json({ url: qb.getAuthUrl(user(c).companyId) }) } catch (e: any) { return c.json({ error: e?.message || 'QuickBooks is not configured' }, 503) }
  })
  app.post('/disconnect', requireRole('admin', 'owner'), async (c) => {
    await qb.disconnect(user(c).companyId)
    audit.log({ action: 'INTEGRATION_DISCONNECT', entity: 'quickbooks', entityId: user(c).companyId, req: c.req })
    return c.json({ success: true })
  })
  app.post('/auto-sync', requireRole('admin', 'owner'), async (c) => {
    const body = await c.req.json().catch(() => ({}))
    try { return c.json(await qb.setAutoSync(user(c).companyId, body.enabled !== false)) } catch (e: any) { return c.json({ error: e?.message || 'QuickBooks not connected' }, 400) }
  })
  app.get('/company-info', async (c) => {
    try { return c.json(await qb.getCompanyInfo(user(c).companyId)) } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })

  app.post('/sync/customer/:contactId', async (c) => {
    const u = user(c)
    const [foundContact] = await db.select().from(t.contact).where(and(eq(t.contact.id, c.req.param('contactId')), eq(t.contact.companyId, u.companyId))).limit(1)
    if (!foundContact) return c.json({ error: 'Contact not found' }, 404)
    try {
      const result = (foundContact as any).qbCustomerId ? await qb.updateCustomer(u.companyId, foundContact) : await qb.createCustomer(u.companyId, foundContact)
      return c.json({ success: true, qboCustomerId: result.Id })
    } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })
  const summary = (results: any[]) => ({ total: results.length, successful: results.filter((r) => r.success).length, failed: results.filter((r) => !r.success).length, results })
  app.post('/sync/customers', requireRole('admin', 'owner'), async (c) => {
    const u = user(c)
    try {
      const results = await qb.syncAllCustomers(u.companyId)
      audit.log({ action: 'SYNC', entity: 'quickbooks_customers', metadata: { total: results.length, successful: results.filter((r: any) => r.success).length }, req: c.req })
      return c.json(summary(results))
    } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })
  app.post('/sync/invoice/:invoiceId', async (c) => {
    const u = user(c)
    const [foundInvoice] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, c.req.param('invoiceId')), eq(t.invoice.companyId, u.companyId))).limit(1)
    if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)
    const lineItems = await db.select().from(t.invoiceLineItem).where(eq(t.invoiceLineItem.invoiceId, foundInvoice.id)).orderBy(asc(t.invoiceLineItem.sortOrder))
    const [invoiceContact] = foundInvoice.contactId ? await db.select().from(t.contact).where(eq(t.contact.id, foundInvoice.contactId)).limit(1) : [null]
    const withRelations = { ...foundInvoice, lineItems, contact: invoiceContact }
    try {
      const result = (foundInvoice as any).qbInvoiceId ? await qb.updateInvoice(u.companyId, withRelations) : await qb.createInvoice(u.companyId, withRelations)
      return c.json({ success: true, qboInvoiceId: result.Id })
    } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })
  app.post('/sync/invoices', requireRole('admin', 'owner'), async (c) => {
    const u = user(c)
    const { startDate, endDate } = await c.req.json().catch(() => ({}))
    try {
      const results = await qb.syncAllInvoices(u.companyId, { startDate, endDate })
      audit.log({ action: 'SYNC', entity: 'quickbooks_invoices', metadata: { total: results.length, successful: results.filter((r: any) => r.success).length }, req: c.req })
      return c.json(summary(results))
    } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })
  app.post('/sync/payment/:paymentId', async (c) => {
    const u = user(c)
    const [foundPayment] = await db.select().from(t.payment).where(eq(t.payment.id, c.req.param('paymentId'))).limit(1)
    if (!foundPayment) return c.json({ error: 'Payment not found' }, 404)
    const [foundInvoice] = await db.select().from(t.invoice).where(and(eq(t.invoice.id, foundPayment.invoiceId), eq(t.invoice.companyId, u.companyId))).limit(1)
    if (!foundInvoice) return c.json({ error: 'Invoice not found' }, 404)
    try { const result = await qb.createPayment(u.companyId, foundPayment, foundInvoice); return c.json({ success: true, qboPaymentId: result.Id }) }
    catch (e: any) { return c.json({ error: e?.message }, /not connected|must be synced/i.test(e?.message || '') ? 400 : 502) }
  })
  app.post('/import/customers', requireRole('admin', 'owner'), async (c) => {
    const u = user(c)
    try {
      const results = await qb.importCustomers(u.companyId)
      audit.log({ action: 'IMPORT', entity: 'quickbooks_customers', metadata: { count: results.length }, req: c.req })
      return c.json({ total: results.length, created: results.filter((r) => r.action === 'created').length, updated: results.filter((r) => r.action === 'updated').length, results })
    } catch (e: any) { return c.json({ error: e?.message }, /not connected/i.test(e?.message || '') ? 400 : 502) }
  })

  return app
}
