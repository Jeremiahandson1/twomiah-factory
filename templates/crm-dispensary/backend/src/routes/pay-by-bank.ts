import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()

// Raw db.execute rows are snake_case but the Pay-by-Bank UI reads camelCase
// (accountName, accountMask, customerName, ...). Convert keys before responding.
const camel = (row: any): any => {
  if (!row || typeof row !== 'object') return row
  const out: any = {}
  for (const k of Object.keys(row)) out[k.replace(/_([a-z])/g, (_m, ch) => ch.toUpperCase())] = row[k]
  return out
}
const camelAll = (rows: any[]): any[] => (Array.isArray(rows) ? rows.map(camel) : rows)

// ============================================
// WEBHOOK (no auth — called by Plaid)
// ============================================

app.post('/webhook', async (c) => {
  const body = await c.req.json()

  // Plaid sends TRANSFER_EVENTS webhook
  if (body.webhook_type === 'TRANSFER_EVENTS') {
    const events = body.transfer_events || []

    for (const event of events) {
      const transferId = event.transfer_id
      const eventType = event.event_type // e.g. transferred, settled, failed, returned

      if (eventType === 'settled' || eventType === 'transferred') {
        // ach_transactions has transfer_id + processed_at (no plaid_transfer_id/settled_at/updated_at)
        await db.execute(sql`
          UPDATE ach_transactions
          SET status = 'completed',
              processed_at = NOW()
          WHERE transfer_id = ${transferId}
        `)
      } else if (eventType === 'failed' || eventType === 'returned') {
        const failureReason = event.failure_reason?.description || event.event_type
        await db.execute(sql`
          UPDATE ach_transactions
          SET status = 'failed',
              failure_reason = ${failureReason},
              processed_at = NOW()
          WHERE transfer_id = ${transferId}
        `)
      }
    }
  }

  return c.json({ received: true })
})

// All other routes require authentication
app.use('*', authenticate)

// ============================================
// PLAID CONFIG
// ============================================

// Get Plaid config for company
app.get('/config', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const result = await db.execute(sql`
    SELECT id, plaid_client_id AS client_id, plaid_environment AS environment, enabled, created_at, updated_at
    FROM plaid_config
    WHERE company_id = ${currentUser.companyId}
    LIMIT 1
  `)

  const config = ((result as any).rows || result)?.[0]
  if (!config) return c.json({ configured: false })

  return c.json({ configured: true, ...config })
})

// Update Plaid config
app.put('/config', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any

  const configSchema = z.object({
    clientId: z.string().min(1),
    secret: z.string().min(1),
    environment: z.enum(['sandbox', 'development', 'production']).default('sandbox'),
    enabled: z.boolean().default(true),
  })
  const data = configSchema.parse(await c.req.json())

  const result = await db.execute(sql`
    INSERT INTO plaid_config(id, plaid_client_id, plaid_secret, plaid_environment, enabled, company_id, created_at, updated_at)
    VALUES (gen_random_uuid(), ${data.clientId}, ${data.secret}, ${data.environment}, ${data.enabled}, ${currentUser.companyId}, NOW(), NOW())
    ON CONFLICT (company_id) DO UPDATE SET
      plaid_client_id = ${data.clientId},
      plaid_secret = ${data.secret},
      plaid_environment = ${data.environment},
      enabled = ${data.enabled},
      updated_at = NOW()
    RETURNING id, plaid_client_id AS client_id, plaid_environment AS environment, enabled, created_at, updated_at
  `)

  const config = ((result as any).rows || result)?.[0]

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'plaid_config',
    entityId: config?.id,
    entityName: 'Plaid Configuration',
    metadata: { environment: data.environment, enabled: data.enabled },
    req: c.req,
  })

  return c.json(config)
})

// ============================================
// LINK TOKEN
// ============================================

// Create Plaid link token for a customer
app.post('/link-token', async (c) => {
  const currentUser = c.get('user') as any

  const linkSchema = z.object({
    contactId: z.string().min(1),
  })
  const data = linkSchema.parse(await c.req.json())

  // Get Plaid config
  const configResult = await db.execute(sql`
    SELECT plaid_client_id AS client_id, plaid_secret AS secret, plaid_environment AS environment FROM plaid_config
    WHERE company_id = ${currentUser.companyId} AND enabled = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Pay by Bank is not configured' }, 400)

  const baseUrl = config.environment === 'production'
    ? 'https://production.plaid.com'
    : config.environment === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com'

  const response = await fetch(`${baseUrl}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      secret: config.secret,
      user: { client_user_id: data.contactId },
      client_name: 'Dispensary POS',
      products: ['auth', 'transactions'],
      country_codes: ['US'],
      language: 'en',
    }),
  })

  const result = await response.json() as any

  if (!response.ok) {
    return c.json({ error: result.error_message || 'Failed to create link token' }, 400)
  }

  return c.json({ linkToken: result.link_token, expiration: result.expiration })
})

// ============================================
// TOKEN EXCHANGE & ACCOUNT LINKING
// ============================================

// Exchange public token for access token and store account details
app.post('/exchange-token', async (c) => {
  const currentUser = c.get('user') as any

  const exchangeSchema = z.object({
    contactId: z.string().min(1),
    publicToken: z.string().min(1),
  })
  const data = exchangeSchema.parse(await c.req.json())

  // Get Plaid config
  const configResult = await db.execute(sql`
    SELECT plaid_client_id AS client_id, plaid_secret AS secret, plaid_environment AS environment FROM plaid_config
    WHERE company_id = ${currentUser.companyId} AND enabled = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Pay by Bank is not configured' }, 400)

  const baseUrl = config.environment === 'production'
    ? 'https://production.plaid.com'
    : config.environment === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com'

  // Exchange public token for access token
  const exchangeResponse = await fetch(`${baseUrl}/item/public_token/exchange`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      secret: config.secret,
      public_token: data.publicToken,
    }),
  })

  const exchangeResult = await exchangeResponse.json() as any

  if (!exchangeResponse.ok) {
    return c.json({ error: exchangeResult.error_message || 'Failed to exchange token' }, 400)
  }

  const accessToken = exchangeResult.access_token
  const itemId = exchangeResult.item_id

  // Get auth/account details
  const authResponse = await fetch(`${baseUrl}/auth/get`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      secret: config.secret,
      access_token: accessToken,
    }),
  })

  const authResult = await authResponse.json() as any

  if (!authResponse.ok) {
    return c.json({ error: authResult.error_message || 'Failed to get account details' }, 400)
  }

  const account = authResult.accounts?.[0]
  const institution = authResult.item?.institution_id || null

  // Store bank account. Schema columns are plaid_access_token, plaid_account_id,
  // institution_name, is_active; there is no item_id or updated_at column
  // (NEEDS SCHEMA to persist the Plaid item_id).
  const result = await db.execute(sql`
    INSERT INTO customer_bank_accounts(id, contact_id, plaid_access_token, plaid_account_id, institution_name, account_name, account_mask, account_type, is_active, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${accessToken}, ${account?.account_id || null}, ${institution}, ${account?.name || null}, ${account?.mask || null}, ${account?.type || 'depository'}, true, ${currentUser.companyId}, NOW())
    RETURNING id, contact_id, institution_name AS institution, account_name, account_mask, account_type, is_active AS active, created_at
  `)

  const bankAccount = camel(((result as any).rows || result)?.[0])

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'customer_bank_account',
    entityId: bankAccount?.id,
    entityName: `Bank account ***${account?.mask || '****'}`,
    metadata: { contactId: data.contactId, institution },
    req: c.req,
  })

  return c.json(bankAccount, 201)
})

// ============================================
// ACCOUNTS
// ============================================

// List customer's linked bank accounts
app.get('/accounts/:contactId', async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  const result = await db.execute(sql`
    SELECT id, contact_id, institution_name AS institution, account_name, account_mask, account_type, is_active AS active, created_at
    FROM customer_bank_accounts
    WHERE contact_id = ${contactId}
      AND company_id = ${currentUser.companyId}
      AND is_active = true
    ORDER BY created_at DESC
  `)

  return c.json(camelAll((result as any).rows || result))
})

// Deactivate a bank account
app.delete('/accounts/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const result = await db.execute(sql`
    UPDATE customer_bank_accounts
    SET is_active = false
    WHERE id = ${id} AND company_id = ${currentUser.companyId}
    RETURNING id, account_mask
  `)

  const account = ((result as any).rows || result)?.[0]
  if (!account) return c.json({ error: 'Bank account not found' }, 404)

  audit.log({
    action: audit.ACTIONS.DELETE,
    entity: 'customer_bank_account',
    entityId: id,
    entityName: `Bank account ***${account.account_mask || '****'}`,
    req: c.req,
  })

  return c.json({ success: true })
})

// ============================================
// CHARGE / ACH TRANSFER
// ============================================

// Initiate Pay by Bank payment
app.post('/charge', async (c) => {
  const currentUser = c.get('user') as any

  const chargeSchema = z.object({
    contactId: z.string().min(1),
    orderId: z.string().min(1),
    bankAccountId: z.string().min(1),
    amount: z.number().positive(),
  })
  const data = chargeSchema.parse(await c.req.json())

  // Get Plaid config
  const configResult = await db.execute(sql`
    SELECT plaid_client_id AS client_id, plaid_secret AS secret, plaid_environment AS environment FROM plaid_config
    WHERE company_id = ${currentUser.companyId} AND enabled = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Pay by Bank is not configured' }, 400)

  // Get bank account details (including access_token)
  const accountResult = await db.execute(sql`
    SELECT plaid_access_token AS access_token, plaid_account_id AS account_id FROM customer_bank_accounts
    WHERE id = ${data.bankAccountId}
      AND contact_id = ${data.contactId}
      AND company_id = ${currentUser.companyId}
      AND is_active = true
    LIMIT 1
  `)
  const bankAccount = ((accountResult as any).rows || accountResult)?.[0]
  if (!bankAccount) return c.json({ error: 'Bank account not found or inactive' }, 404)

  const baseUrl = config.environment === 'production'
    ? 'https://production.plaid.com'
    : config.environment === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com'

  // Create ACH transfer via Plaid
  const transferResponse = await fetch(`${baseUrl}/transfer/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      secret: config.secret,
      access_token: bankAccount.access_token,
      account_id: bankAccount.account_id,
      type: 'debit',
      network: 'ach',
      amount: data.amount.toFixed(2),
      description: `Order ${data.orderId}`,
      ach_class: 'web',
      user: { legal_name: 'Customer' },
    }),
  })

  const transferResult = await transferResponse.json() as any

  if (!transferResponse.ok) {
    return c.json({ error: transferResult.error_message || 'Failed to initiate ACH transfer' }, 400)
  }

  const plaidTransferId = transferResult.transfer?.id

  // Store ACH transaction. Schema column is transfer_id (no plaid_transfer_id/updated_at);
  // amount is a text column.
  const txnResult = await db.execute(sql`
    INSERT INTO ach_transactions(id, contact_id, order_id, bank_account_id, transfer_id, amount, status, company_id, created_at)
    VALUES (gen_random_uuid(), ${data.contactId}, ${data.orderId}, ${data.bankAccountId}, ${plaidTransferId}, ${String(data.amount)}, 'processing', ${currentUser.companyId}, NOW())
    RETURNING *
  `)

  const transaction = ((txnResult as any).rows || txnResult)?.[0]

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'ach_transaction',
    entityId: transaction?.id,
    entityName: `ACH $${data.amount.toFixed(2)} for order ${data.orderId}`,
    metadata: { amount: data.amount, orderId: data.orderId, plaidTransferId },
    req: c.req,
  })

  return c.json({ transactionId: transaction?.id, status: 'processing', plaidTransferId }, 201)
})

// ============================================
// TRANSACTIONS
// ============================================

// List ACH transactions
app.get('/transactions', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')
  const offset = (page - 1) * limit

  let statusFilter = sql``
  if (status) statusFilter = sql`AND at.status = ${status}`

  const dataResult = await db.execute(sql`
    SELECT at.*, c.name as customer_name, c.email as customer_email,
           ba.account_mask, ba.institution_name AS institution
    FROM ach_transactions at
    LEFT JOIN contact c ON c.id = at.contact_id
    LEFT JOIN customer_bank_accounts ba ON ba.id = at.bank_account_id
    WHERE at.company_id = ${currentUser.companyId}
      ${statusFilter}
    ORDER BY at.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `)

  const countResult = await db.execute(sql`
    SELECT COUNT(*)::int as total FROM ach_transactions at
    WHERE at.company_id = ${currentUser.companyId} ${statusFilter}
  `)

  const data = camelAll((dataResult as any).rows || dataResult)
  const total = Number((countResult as any).rows?.[0]?.total || 0)

  return c.json({ data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } })
})

// Stats tiles: transaction count + settled ACH volume.
app.get('/stats', async (c) => {
  const currentUser = c.get('user') as any
  const result = await db.execute(sql`
    SELECT
      COUNT(*)::int as total_transactions,
      COALESCE(SUM(amount::numeric) FILTER (WHERE status = 'completed'), 0) as total_volume,
      COALESCE(AVG(amount::numeric) FILTER (WHERE status = 'completed'), 0) as avg_size
    FROM ach_transactions
    WHERE company_id = ${currentUser.companyId}
  `)
  const row = ((result as any).rows || result)?.[0] || {}
  return c.json({
    totalTransactions: Number(row.total_transactions || 0),
    totalVolume: Number(row.total_volume || 0),
    avgSize: Number(row.avg_size || 0),
  })
})

// Initiate Plaid Link for a specific customer (contactId in the path). Returns a link
// token the frontend hands to Plaid Link. Graceful 400 when Pay-by-Bank isn't configured.
app.post('/link/:contactId', async (c) => {
  const currentUser = c.get('user') as any
  const contactId = c.req.param('contactId')

  const configResult = await db.execute(sql`
    SELECT plaid_client_id AS client_id, plaid_secret AS secret, plaid_environment AS environment FROM plaid_config
    WHERE company_id = ${currentUser.companyId} AND enabled = true
    LIMIT 1
  `)
  const config = ((configResult as any).rows || configResult)?.[0]
  if (!config) return c.json({ error: 'Pay by Bank is not configured' }, 400)

  const baseUrl = config.environment === 'production'
    ? 'https://production.plaid.com'
    : config.environment === 'development'
      ? 'https://development.plaid.com'
      : 'https://sandbox.plaid.com'

  const response = await fetch(`${baseUrl}/link/token/create`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_id: config.client_id,
      secret: config.secret,
      user: { client_user_id: contactId },
      client_name: 'Dispensary POS',
      products: ['auth', 'transactions'],
      country_codes: ['US'],
      language: 'en',
    }),
  })
  const result = await response.json() as any
  if (!response.ok) {
    return c.json({ error: result.error_message || 'Failed to create link token' }, 400)
  }

  return c.json({ linkToken: result.link_token, expiration: result.expiration, contactId })
})

export default app
