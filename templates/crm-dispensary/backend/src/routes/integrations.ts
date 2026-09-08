import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, order, orderItem, product, contact, loyaltyMember, loyaltyReward } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import Stripe from 'stripe'
import audit from '../services/audit.ts'

const app = new Hono()

const LOYALTY_POINTS_PER_DOLLAR = 1

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null

const QB_CLIENT_ID = process.env.QUICKBOOKS_CLIENT_ID
const QB_CLIENT_SECRET = process.env.QUICKBOOKS_CLIENT_SECRET
const QB_REDIRECT_URI = process.env.QUICKBOOKS_REDIRECT_URI || `${process.env.API_URL}/api/integrations/quickbooks/callback`
const QB_ENVIRONMENT = process.env.QUICKBOOKS_ENVIRONMENT || 'sandbox'

// ─── Auth middleware: verify X-Integration-Key against company.integrationKey ──
// Applied PER-ROUTE to the external-POS endpoints only, so the session-authenticated
// internal settings routes below can coexist in the same /api/integrations router.
async function requireIntegrationKey(c: Context, next: Next) {
  const key = c.req.header('X-Integration-Key')
  if (!key) return c.json({ error: 'Missing X-Integration-Key header' }, 401)

  const [comp] = await db.select().from(company).where(eq(company.integrationKey, key)).limit(1)
  if (!comp) return c.json({ error: 'Invalid integration key' }, 401)

  c.set('company', comp)
  return next()
}

// ─── 1. POST /sale — Receive a completed sale from external POS ──────────────
const saleSchema = z.object({
  items: z.array(z.object({
    name: z.string(),
    sku: z.string().optional(),
    category: z.string().optional(),
    quantity: z.number().int().min(1),
    unitPrice: z.number(),
    totalPrice: z.number(),
    weight: z.string().optional(),
    weightUnit: z.string().optional(),
  })).min(1),
  customerPhone: z.string().optional(),
  customerName: z.string().optional(),
  subtotal: z.number(),
  tax: z.number(),
  total: z.number(),
  paymentMethod: z.string(),
  externalOrderId: z.string(),
  posSystem: z.string(), // 'dutchie' | 'treez' | 'blaze'
  timestamp: z.string().optional(),
})

app.post('/sale', requireIntegrationKey, async (c) => {
  const comp = c.get('company') as any

  let data: z.infer<typeof saleSchema>
  try {
    data = saleSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Check for duplicate external order
  const [existingOrder] = await db.select({ id: order.id, number: order.number })
    .from(order)
    .where(and(
      eq(order.companyId, comp.id),
      eq(order.notes, `pos:${data.posSystem}:${data.externalOrderId}`),
    ))
    .limit(1)

  if (existingOrder) {
    return c.json({
      error: 'Duplicate sale',
      message: `External order ${data.externalOrderId} already imported`,
      orderNumber: existingOrder.number,
    }, 409)
  }

  // Fetch all products by SKU for matching
  const companyProducts = await db.select().from(product)
    .where(eq(product.companyId, comp.id))
  const skuMap = new Map(companyProducts.filter(p => p.sku).map(p => [p.sku!, p]))

  // Find or create contact if phone provided
  let contactId: string | null = null
  if (data.customerPhone) {
    const phone = data.customerPhone.replace(/\D/g, '').slice(-10) // normalize to last 10 digits
    const [existingContact] = await db.select({ id: contact.id })
      .from(contact)
      .where(and(eq(contact.phone, data.customerPhone), eq(contact.companyId, comp.id)))
      .limit(1)

    if (existingContact) {
      contactId = existingContact.id
    } else {
      const [newContact] = await db.insert(contact).values({
        name: data.customerName || 'POS Customer',
        phone: data.customerPhone,
        type: 'customer',
        source: `pos_${data.posSystem}`,
        companyId: comp.id,
      } as any).returning()
      contactId = newContact.id
    }
  }

  // Generate order number
  const orderNumber = `POS-${data.posSystem.toUpperCase().slice(0, 3)}-${Date.now().toString(36).toUpperCase()}`

  // Build resolved items and track which products matched for inventory
  const resolvedItems: any[] = []
  const inventoryUpdates: { productId: string; quantity: number }[] = []

  for (const item of data.items) {
    const matchedProduct = item.sku ? skuMap.get(item.sku) : null

    resolvedItems.push({
      productId: matchedProduct?.id || null,
      productName: item.name,
      sku: item.sku || null,
      category: item.category || matchedProduct?.category || null,
      quantity: item.quantity,
      unitPrice: String(item.unitPrice),
      lineTotal: String(item.totalPrice),
      weight: item.weight || matchedProduct?.weight || null,
      weightUnit: item.weightUnit || matchedProduct?.weightUnit || null,
      taxCategory: matchedProduct?.taxCategory || null,
    })

    if (matchedProduct && matchedProduct.trackInventory) {
      inventoryUpdates.push({ productId: matchedProduct.id, quantity: item.quantity })
    }
  }

  // Create order + items + decrement inventory in a transaction
  const result = await db.transaction(async (tx) => {
    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      type: 'external_pos' as any,
      status: 'completed',
      contactId,
      customerName: data.customerName || null,
      subtotal: String(data.subtotal),
      totalTax: String(data.tax),
      total: String(data.total),
      paymentMethod: data.paymentMethod,
      completedAt: data.timestamp ? new Date(data.timestamp) : new Date(),
      notes: `pos:${data.posSystem}:${data.externalOrderId}`,
      companyId: comp.id,
    } as any).returning()

    // Insert order items
    for (const item of resolvedItems) {
      await tx.insert(orderItem).values({
        orderId: newOrder.id,
        ...item,
        companyId: comp.id,
      } as any)
    }

    // Decrement inventory for matched products
    for (const upd of inventoryUpdates) {
      await tx.update(product).set({
        stockQuantity: sql`${product.stockQuantity} - ${upd.quantity}`,
        updatedAt: new Date(),
      } as any).where(eq(product.id, upd.productId))
    }

    // Award loyalty points if customer is linked
    if (contactId) {
      const pointsEarned = Math.floor(data.total * LOYALTY_POINTS_PER_DOLLAR)

      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = points_balance + ${pointsEarned},
            total_points_earned = total_points_earned + ${pointsEarned},
            lifetime_points = COALESCE(lifetime_points, 0) + ${pointsEarned},
            total_visits = total_visits + 1,
            total_spent = total_spent + ${data.total},
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE contact_id = ${contactId}
          AND company_id = ${comp.id}
      `)

      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'earn', ${pointsEarned}, lm.points_balance, ${newOrder.id}, ${'POS Purchase ' + orderNumber}, ${comp.id}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${contactId} AND lm.company_id = ${comp.id}
      `)
    }

    return newOrder
  })

  // Audit log (fire-and-forget, non-blocking)
  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'order',
    entityId: result.id,
    entityName: orderNumber,
    metadata: {
      posSystem: data.posSystem,
      externalOrderId: data.externalOrderId,
      total: data.total,
      itemCount: data.items.length,
      matchedProducts: inventoryUpdates.length,
      source: 'pos_integration',
    },
    req: {
      user: { companyId: comp.id },
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({
    success: true,
    orderNumber,
    orderId: result.id,
    itemCount: resolvedItems.length,
    matchedProducts: inventoryUpdates.length,
    unmatchedItems: resolvedItems.filter(i => !i.productId).map(i => i.sku || i.productName),
    loyaltyAwarded: contactId ? Math.floor(data.total * LOYALTY_POINTS_PER_DOLLAR) : 0,
  }, 201)
})

// ─── 2. POST /inventory-sync — Bulk inventory update from external POS ───────
const inventorySyncSchema = z.object({
  items: z.array(z.object({
    sku: z.string(),
    quantity: z.number().int().min(0),
  })).min(1),
})

app.post('/inventory-sync', requireIntegrationKey, async (c) => {
  const comp = c.get('company') as any

  let data: z.infer<typeof inventorySyncSchema>
  try {
    data = inventorySyncSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Fetch all products by SKU
  const companyProducts = await db.select().from(product)
    .where(eq(product.companyId, comp.id))
  const skuMap = new Map(companyProducts.filter(p => p.sku).map(p => [p.sku!, p]))

  const updated: { sku: string; productId: string; name: string; previousQuantity: number; newQuantity: number }[] = []
  const notFound: string[] = []

  for (const item of data.items) {
    const matchedProduct = skuMap.get(item.sku)
    if (!matchedProduct) {
      notFound.push(item.sku)
      continue
    }

    const previousQuantity = matchedProduct.stockQuantity ?? 0

    await db.update(product).set({
      stockQuantity: item.quantity,
      updatedAt: new Date(),
    } as any).where(eq(product.id, matchedProduct.id))

    updated.push({
      sku: item.sku,
      productId: matchedProduct.id,
      name: matchedProduct.name,
      previousQuantity,
      newQuantity: item.quantity,
    })
  }

  audit.log({
    action: audit.ACTIONS.UPDATE,
    entity: 'product',
    entityName: 'inventory_sync',
    metadata: {
      updatedCount: updated.length,
      notFoundCount: notFound.length,
      source: 'pos_integration',
    },
    req: {
      user: { companyId: comp.id },
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({
    success: true,
    updated,
    notFound,
    summary: {
      totalRequested: data.items.length,
      totalUpdated: updated.length,
      totalNotFound: notFound.length,
    },
  })
})

// ─── 3. GET /products — Let external POS pull our product catalog ─────────────
app.get('/products', requireIntegrationKey, async (c) => {
  const comp = c.get('company') as any

  const products = await db.select().from(product)
    .where(and(eq(product.companyId, comp.id), eq(product.active, true)))

  const catalog = products.map(p => ({
    id: p.id,
    name: p.name,
    sku: p.sku,
    barcode: p.barcode,
    category: p.category,
    price: p.price,
    stockQuantity: p.stockQuantity,
    brand: (p as any).brand,
    strainName: (p as any).strainName,
    strainType: (p as any).strainType,
    thcPercent: (p as any).thcPercent,
    cbdPercent: (p as any).cbdPercent,
    weight: p.weight,
    weightUnit: p.weightUnit,
    unitType: (p as any).unitType,
    trackInventory: p.trackInventory,
  }))

  return c.json({
    success: true,
    products: catalog,
    total: catalog.length,
  })
})

// ─── 4. POST /customer — Create or update customer from external POS ──────────
const customerSchema = z.object({
  phone: z.string().min(1),
  name: z.string().optional(),
  email: z.string().email().optional(),
  dob: z.string().optional(),
  medicalCard: z.string().optional(),
})

app.post('/customer', requireIntegrationKey, async (c) => {
  const comp = c.get('company') as any

  let data: z.infer<typeof customerSchema>
  try {
    data = customerSchema.parse(await c.req.json())
  } catch (err) {
    if (err instanceof z.ZodError) {
      return c.json({ error: 'Invalid request', details: err.errors }, 400)
    }
    return c.json({ error: 'Invalid JSON body' }, 400)
  }

  // Find existing contact by phone
  const [existingContact] = await db.select().from(contact)
    .where(and(eq(contact.phone, data.phone), eq(contact.companyId, comp.id)))
    .limit(1)

  let contactRecord: any
  let created = false

  if (existingContact) {
    // Update existing contact with any new fields
    const updates: any = { updatedAt: new Date() }
    if (data.name) updates.name = data.name
    if (data.email) updates.email = data.email

    const [updated] = await db.update(contact).set(updates)
      .where(eq(contact.id, existingContact.id)).returning()
    contactRecord = updated
  } else {
    // Create new contact
    const [newContact] = await db.insert(contact).values({
      name: data.name || 'POS Customer',
      phone: data.phone,
      email: data.email || null,
      type: 'customer',
      source: 'pos_integration',
      companyId: comp.id,
    } as any).returning()
    contactRecord = newContact
    created = true
  }

  // Get loyalty info if enrolled
  const [loyaltyInfo] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.contactId, contactRecord.id), eq(loyaltyMember.companyId, comp.id)))
    .limit(1)

  audit.log({
    action: created ? audit.ACTIONS.CREATE : audit.ACTIONS.UPDATE,
    entity: 'contact',
    entityId: contactRecord.id,
    entityName: contactRecord.name,
    metadata: { source: 'pos_integration' },
    req: {
      user: { companyId: comp.id },
      ip: c.req.header('x-forwarded-for') || undefined,
      headers: { 'user-agent': c.req.header('user-agent') },
    },
  })

  return c.json({
    success: true,
    created,
    contact: {
      id: contactRecord.id,
      name: contactRecord.name,
      phone: contactRecord.phone,
      email: contactRecord.email,
    },
    loyalty: loyaltyInfo ? {
      enrolled: true,
      pointsBalance: loyaltyInfo.pointsBalance,
      tier: loyaltyInfo.tier,
      totalVisits: loyaltyInfo.totalVisits,
      totalSpent: loyaltyInfo.totalSpent,
    } : {
      enrolled: false,
    },
  })
})

// ─── 5. GET /loyalty/:phone — Check customer loyalty status ───────────────────
app.get('/loyalty/:phone', requireIntegrationKey, async (c) => {
  const comp = c.get('company') as any
  const phone = c.req.param('phone')

  // Find contact by phone
  const [foundContact] = await db.select({ id: contact.id, name: contact.name })
    .from(contact)
    .where(and(eq(contact.phone, phone), eq(contact.companyId, comp.id)))
    .limit(1)

  if (!foundContact) {
    return c.json({ error: 'Customer not found', enrolled: false }, 404)
  }

  // Get loyalty membership
  const [member] = await db.select().from(loyaltyMember)
    .where(and(eq(loyaltyMember.contactId, foundContact.id), eq(loyaltyMember.companyId, comp.id)))
    .limit(1)

  if (!member) {
    return c.json({
      customer: { id: foundContact.id, name: foundContact.name },
      enrolled: false,
      message: 'Customer exists but is not enrolled in loyalty program',
    })
  }

  // Get available rewards for their tier
  const rewards = await db.select().from(loyaltyReward)
    .where(and(
      eq(loyaltyReward.companyId, comp.id),
      eq(loyaltyReward.active, true),
    ))

  // Filter rewards: must have enough points and meet tier requirement
  const tierRank: Record<string, number> = { bronze: 1, silver: 2, gold: 3, platinum: 4 }
  const memberTierRank = tierRank[member.tier || 'bronze'] || 1

  const availableRewards = rewards.filter(r => {
    const costMet = (member.pointsBalance ?? 0) >= (r.pointsCost ?? 0)
    const tierMet = !r.minTier || (tierRank[r.minTier] || 1) <= memberTierRank
    return costMet && tierMet
  }).map(r => ({
    id: r.id,
    name: r.name,
    description: r.description,
    pointsCost: r.pointsCost,
    discountType: r.discountType,
    discountValue: r.discountValue,
  }))

  return c.json({
    customer: { id: foundContact.id, name: foundContact.name },
    enrolled: true,
    loyalty: {
      pointsBalance: member.pointsBalance,
      tier: member.tier,
      lifetimePoints: member.lifetimePoints,
      totalVisits: member.totalVisits,
      totalSpent: member.totalSpent,
      lastActivityAt: member.lastActivityAt,
    },
    availableRewards,
  })
})

// ═══════════════════════════════════════════════════════════════════════════
// INTERNAL SETTINGS INTEGRATIONS (session Bearer token via `authenticate`)
//
// These power the Settings → Integrations UI. They live in the SAME router as
// the external-POS API above but are guarded by `authenticate` (session), not
// the X-Integration-Key. QuickBooks / Stripe Connect (OAuth) + SMS/Email toggles.
// ═══════════════════════════════════════════════════════════════════════════

// ─── GET /status — Integration status for the settings page ──────────────────
app.get('/status', authenticate, async (c) => {
  const user = c.get('user') as any

  const [comp] = await db.select({
    settings: company.settings,
    integrations: company.integrations,
  }).from(company).where(eq(company.id, user.companyId)).limit(1)

  const integrations = (comp?.integrations || {}) as any
  const settings = (comp?.settings || {}) as any

  // Dispensary has no sms_message / sms_conversation / email_log tables, so
  // there are no monthly usage counts to report — return 0 for both.
  const smsCount = 0
  const emailCount = 0

  let stripeStatus: any = { connected: false, accountId: null, chargesEnabled: false }
  if (integrations.stripeAccountId && stripe) {
    try {
      const account = await stripe.accounts.retrieve(integrations.stripeAccountId)
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
  })
})

// ─── QUICKBOOKS OAUTH ─────────────────────────────────────────────────────────

app.get('/quickbooks/auth-url', authenticate, async (c) => {
  const user = c.get('user') as any

  // Missing config is a valid state, not a server error — the settings UI shows "not connected".
  if (!QB_CLIENT_ID) return c.json({ configured: false, authUrl: null, message: 'QuickBooks not configured' })

  const state = Buffer.from(JSON.stringify({
    companyId: user.companyId,
    userId: user.userId,
  })).toString('base64')

  const baseUrl = 'https://appcenter.intuit.com/connect/oauth2'
  const params = new URLSearchParams({
    client_id: QB_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: QB_REDIRECT_URI,
    state,
  })

  return c.json({ configured: true, authUrl: `${baseUrl}?${params}` })
})

// OAuth redirect target — NO auth (Intuit calls this, not the browser session)
app.get('/quickbooks/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const realmId = c.req.query('realmId')
  const qbError = c.req.query('error')
  const settingsUrl = `${process.env.FRONTEND_URL}/settings/integrations`

  if (qbError) {
    return c.redirect(`${settingsUrl}?error=quickbooks_denied`)
  }

  // Not configured / malformed callback → redirect with an error rather than 500.
  if (!QB_CLIENT_ID || !QB_CLIENT_SECRET) {
    return c.redirect(`${settingsUrl}?error=quickbooks_not_configured`)
  }
  if (!code || !state || !realmId) {
    return c.redirect(`${settingsUrl}?error=quickbooks_failed`)
  }

  let companyId: string, userId: string
  try {
    ({ companyId, userId } = JSON.parse(Buffer.from(state, 'base64').toString()))
  } catch {
    return c.redirect(`${settingsUrl}?error=quickbooks_failed`)
  }

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

// ─── STRIPE CONNECT ───────────────────────────────────────────────────────────

app.get('/stripe/connect-url', authenticate, async (c) => {
  const user = c.get('user') as any

  // Missing config is a valid state, not a server error.
  if (!stripe) return c.json({ configured: false, connectUrl: null, message: 'Stripe not configured' })

  const [comp] = await db.select({
    name: company.name,
    email: company.email,
    integrations: company.integrations,
  }).from(company).where(eq(company.id, user.companyId)).limit(1)

  let accountId = (comp?.integrations as any)?.stripeAccountId

  if (!accountId) {
    const account = await stripe.accounts.create({
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

  const accountLink = await stripe.accountLinks.create({
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

// ─── SMS TOGGLE (Platform Twilio) ─────────────────────────────────────────────

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

// ─── EMAIL TOGGLE (Platform SendGrid) ─────────────────────────────────────────

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

export default app
