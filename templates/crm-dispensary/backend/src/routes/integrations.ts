import { Hono } from 'hono'
import type { Context, Next } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { company, order, orderItem, product, contact, loyaltyMember, loyaltyReward } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'
import audit from '../services/audit.ts'

const app = new Hono()

const LOYALTY_POINTS_PER_DOLLAR = 1

// ─── Auth middleware: verify X-Integration-Key against company.integrationKey ──
async function requireIntegrationKey(c: Context, next: Next) {
  const key = c.req.header('X-Integration-Key')
  if (!key) return c.json({ error: 'Missing X-Integration-Key header' }, 401)

  const [comp] = await db.select().from(company).where(eq(company.integrationKey, key)).limit(1)
  if (!comp) return c.json({ error: 'Invalid integration key' }, 401)

  c.set('company', comp)
  return next()
}

app.use('*', requireIntegrationKey)

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

app.post('/sale', async (c) => {
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

app.post('/inventory-sync', async (c) => {
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
app.get('/products', async (c) => {
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

app.post('/customer', async (c) => {
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
app.get('/loyalty/:phone', async (c) => {
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

export default app
