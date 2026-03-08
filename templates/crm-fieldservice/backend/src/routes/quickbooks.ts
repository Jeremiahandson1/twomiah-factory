import { Hono } from 'hono'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import quickbooks from '../services/quickbooks.ts'
import audit from '../services/audit.ts'
import { db } from '../../db/index.ts'
import { contact, invoice, invoiceLineItem, payment } from '../../db/schema.ts'
import { eq, and, asc } from 'drizzle-orm'

const app = new Hono()

// OAuth callback doesn't need auth (comes from QuickBooks)
app.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const realmId = c.req.query('realmId')
  const error = c.req.query('error')

  if (error) {
    return c.redirect(`${process.env.FRONTEND_URL}/settings/integrations?error=${error}`)
  }

  // Decode state to get companyId
  const { companyId } = JSON.parse(Buffer.from(state!, 'base64').toString())

  // Exchange code for tokens
  const tokens = await quickbooks.exchangeCodeForTokens(code)

  // Save connection
  await quickbooks.saveConnection(companyId, {
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    realmId,
    expiresIn: tokens.expires_in,
  })

  return c.redirect(`${process.env.FRONTEND_URL}/settings/integrations?qbo=connected`)
})

// All other routes require authentication
app.use('*', authenticate)

// Get connection status
app.get('/status', async (c) => {
  const user = c.get('user') as any
  const status = await quickbooks.getConnectionStatus(user.companyId)
  return c.json(status)
})

// Get auth URL to start OAuth flow
app.get('/auth-url', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const url = quickbooks.getAuthUrl(user.companyId)
  return c.json({ url })
})

// Disconnect QuickBooks
app.post('/disconnect', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  await quickbooks.disconnect(user.companyId)

  audit.log({
    action: 'INTEGRATION_DISCONNECT',
    entity: 'quickbooks',
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({ success: true })
})

// Get QuickBooks company info
app.get('/company-info', async (c) => {
  const user = c.get('user') as any
  const info = await quickbooks.getCompanyInfo(user.companyId)
  return c.json(info)
})

// ============================================
// SYNC OPERATIONS
// ============================================

// Sync single customer
app.post('/sync/customer/:contactId', async (c) => {
  const user = c.get('user') as any
  const contactId = c.req.param('contactId')

  const [foundContact] = await db.select().from(contact)
    .where(and(eq(contact.id, contactId), eq(contact.companyId, user.companyId)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Contact not found' }, 404)
  }

  let result
  if ((foundContact as any).qboCustomerId) {
    result = await quickbooks.updateCustomer(user.companyId, foundContact)
  } else {
    result = await quickbooks.createCustomer(user.companyId, foundContact)
  }

  return c.json({ success: true, qboCustomerId: result.Id })
})

// Sync all customers
app.post('/sync/customers', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const results = await quickbooks.syncAllCustomers(user.companyId)

  audit.log({
    action: 'SYNC',
    entity: 'quickbooks_customers',
    metadata: {
      total: results.length,
      successful: results.filter((r: any) => r.success).length,
    },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({
    total: results.length,
    successful: results.filter((r: any) => r.success).length,
    failed: results.filter((r: any) => !r.success).length,
    results,
  })
})

// Sync single invoice
app.post('/sync/invoice/:invoiceId', async (c) => {
  const user = c.get('user') as any
  const invoiceId = c.req.param('invoiceId')

  const [foundInvoice] = await db.select().from(invoice)
    .where(and(eq(invoice.id, invoiceId), eq(invoice.companyId, user.companyId)))
    .limit(1)

  if (!foundInvoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  // Fetch line items and contact separately
  const lineItems = await db.select().from(invoiceLineItem)
    .where(eq(invoiceLineItem.invoiceId, invoiceId))
    .orderBy(asc(invoiceLineItem.sortOrder))

  const [invoiceContact] = foundInvoice.contactId
    ? await db.select().from(contact).where(eq(contact.id, foundInvoice.contactId)).limit(1)
    : [null]

  const invoiceWithRelations = { ...foundInvoice, lineItems, contact: invoiceContact }

  let result
  if ((foundInvoice as any).qboInvoiceId) {
    result = await quickbooks.updateInvoice(user.companyId, invoiceWithRelations)
  } else {
    result = await quickbooks.createInvoice(user.companyId, invoiceWithRelations)
  }

  return c.json({ success: true, qboInvoiceId: result.Id })
})

// Sync all invoices
app.post('/sync/invoices', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const { startDate, endDate } = await c.req.json()
  const results = await quickbooks.syncAllInvoices(user.companyId, { startDate, endDate })

  audit.log({
    action: 'SYNC',
    entity: 'quickbooks_invoices',
    metadata: {
      total: results.length,
      successful: results.filter((r: any) => r.success).length,
    },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({
    total: results.length,
    successful: results.filter((r: any) => r.success).length,
    failed: results.filter((r: any) => !r.success).length,
    results,
  })
})

// Sync payment
app.post('/sync/payment/:paymentId', async (c) => {
  const user = c.get('user') as any
  const paymentId = c.req.param('paymentId')

  const [foundPayment] = await db.select().from(payment)
    .where(eq(payment.id, paymentId))
    .limit(1)

  if (!foundPayment) {
    return c.json({ error: 'Payment not found' }, 404)
  }

  // Verify invoice belongs to user's company
  const [foundInvoice] = await db.select().from(invoice)
    .where(and(eq(invoice.id, foundPayment.invoiceId), eq(invoice.companyId, user.companyId)))
    .limit(1)

  if (!foundInvoice) {
    return c.json({ error: 'Invoice not found' }, 404)
  }

  const result = await quickbooks.createPayment(user.companyId, foundPayment, foundInvoice)
  return c.json({ success: true, qboPaymentId: result.Id })
})

// ============================================
// IMPORT OPERATIONS
// ============================================

// Import customers from QuickBooks
app.post('/import/customers', requireRole('admin'), async (c) => {
  const user = c.get('user') as any
  const results = await quickbooks.importCustomers(user.companyId)

  audit.log({
    action: 'IMPORT',
    entity: 'quickbooks_customers',
    metadata: { count: results.length },
    userId: user.userId,
    companyId: user.companyId,
  })

  return c.json({
    total: results.length,
    created: results.filter((r: any) => r.action === 'created').length,
    updated: results.filter((r: any) => r.action === 'updated').length,
    results,
  })
})

export default app
