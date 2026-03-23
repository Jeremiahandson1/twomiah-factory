import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { order, orderItem, product, contact } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'

const app = new Hono()
app.use('*', authenticate)

// Cannabis purchase limit: 2.5 oz = 70.87g
const PURCHASE_LIMIT_GRAMS = 70.87
const LOYALTY_POINTS_PER_DOLLAR = 1
const CANNABIS_TAX_RATE = 0.15 // 15% cannabis excise tax (varies by state)
const SALES_TAX_RATE = 0.0875 // state + local sales tax (varies)

// List orders
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const type = c.req.query('type') // walk_in, delivery, online
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  const page = +(c.req.query('page') || '1')
  const limit = +(c.req.query('limit') || '25')

  const conditions: any[] = [eq(order.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(order.status, status))
  if (type) conditions.push(eq(order.type, type))
  if (startDate) conditions.push(gte(order.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(order.createdAt, new Date(endDate)))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(order).where(where).orderBy(desc(order.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(order).where(where),
  ])

  return c.json({ data, pagination: { page, limit, total: Number(total), pages: Math.ceil(Number(total) / limit) } })
})

// Get single order with items
app.get('/:id', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundOrder] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundOrder) return c.json({ error: 'Order not found' }, 404)

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))

  // Get customer info if linked
  let customer = null
  if (foundOrder.contactId) {
    const [c] = await db.select().from(contact).where(eq(contact.id, foundOrder.contactId)).limit(1)
    customer = c || null
  }

  return c.json({ ...foundOrder, items, customer })
})

// Create order (budtender/field+)
app.post('/', async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    type: z.enum(['walk_in', 'delivery', 'online']).default('walk_in'),
    contactId: z.string().optional(),
    customerName: z.string().optional(),
    customerId: z.string().optional(), // state ID for compliance
    customerDob: z.string().optional(),
    isMedical: z.boolean().default(false),
    medicalCardNumber: z.string().optional(),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().min(1),
      priceOverride: z.number().optional(),
    })).min(1),
    loyaltyPointsRedeemed: z.number().int().min(0).default(0),
    discountAmount: z.number().min(0).default(0),
    discountReason: z.string().optional(),
    notes: z.string().optional(),
  })

  const data = orderSchema.parse(await c.req.json())

  // Fetch all products for the order
  const productIds = data.items.map(i => i.productId)
  const products = await db.select().from(product)
    .where(and(eq(product.companyId, currentUser.companyId)))

  const productMap = new Map(products.filter(p => productIds.includes(p.id)).map(p => [p.id, p]))

  // Validate all products exist and check stock
  let totalWeightGrams = 0
  let subtotal = 0
  const resolvedItems: any[] = []

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    if (!prod.active) return c.json({ error: `Product is not active: ${prod.name}` }, 400)

    // Check stock
    if (prod.trackInventory && Number(prod.stockQuantity) < item.quantity) {
      return c.json({ error: `Insufficient stock for ${prod.name}: have ${prod.stockQuantity}, need ${item.quantity}` }, 400)
    }

    // Track cannabis weight for purchase limit
    const isCannabis = ['flower', 'pre_roll', 'edible', 'concentrate', 'vape', 'tincture'].includes(prod.category as string)
    if (isCannabis && prod.weight) {
      const weightInGrams = prod.weightUnit === 'oz' ? Number(prod.weight) * 28.3495 : Number(prod.weight)
      totalWeightGrams += weightInGrams * item.quantity
    }

    const unitPrice = item.priceOverride ?? Number(prod.price)
    const lineTotal = unitPrice * item.quantity
    subtotal += lineTotal

    resolvedItems.push({
      productId: prod.id,
      productName: prod.name,
      sku: prod.sku,
      category: prod.category,
      quantity: item.quantity,
      unitPrice: String(unitPrice),
      lineTotal: String(lineTotal),
      weight: prod.weight,
      weightUnit: prod.weightUnit,
      taxCategory: prod.taxCategory,
    })
  }

  // Purchase limit validation (2.5 oz)
  if (totalWeightGrams > PURCHASE_LIMIT_GRAMS) {
    return c.json({
      error: `Purchase exceeds limit: ${(totalWeightGrams / 28.3495).toFixed(2)}oz exceeds 2.5oz maximum`,
      totalWeightOz: (totalWeightGrams / 28.3495).toFixed(2),
      limitOz: '2.5',
    }, 400)
  }

  // Calculate taxes
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum, i) => sum + Number(i.lineTotal), 0)
  const nonCannabisSubtotal = subtotal - cannabisSubtotal

  const exciseTax = cannabisSubtotal * CANNABIS_TAX_RATE
  const salesTax = subtotal * SALES_TAX_RATE
  const totalTax = exciseTax + salesTax

  // Apply discounts and loyalty
  const loyaltyDiscount = data.loyaltyPointsRedeemed * 0.01 // 1 point = $0.01
  const totalDiscount = data.discountAmount + loyaltyDiscount
  const grandTotal = subtotal + totalTax - totalDiscount

  // Generate order number
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`

  // Create order in transaction
  const result = await db.transaction(async (tx) => {
    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      type: data.type,
      status: 'pending',
      contactId: data.contactId,
      customerName: data.customerName,
      customerId: data.customerId,
      customerDob: data.customerDob,
      isMedical: data.isMedical,
      medicalCardNumber: data.medicalCardNumber,
      subtotal: String(subtotal),
      exciseTax: String(exciseTax),
      salesTax: String(salesTax),
      totalTax: String(totalTax),
      discountAmount: String(totalDiscount),
      discountReason: data.discountReason,
      loyaltyPointsRedeemed: data.loyaltyPointsRedeemed,
      total: String(grandTotal),
      totalWeightGrams: String(totalWeightGrams),
      notes: data.notes,
      budtenderId: currentUser.userId,
      companyId: currentUser.companyId,
    } as any).returning()

    // Insert order items
    for (const item of resolvedItems) {
      await tx.insert(orderItem).values({
        orderId: newOrder.id,
        ...item,
        companyId: currentUser.companyId,
      } as any)
    }

    return newOrder
  })

  audit.log({
    action: audit.ACTIONS.CREATE,
    entity: 'order',
    entityId: result.id,
    entityName: orderNumber,
    metadata: {
      type: data.type,
      itemCount: data.items.length,
      total: grandTotal,
      totalWeightGrams,
    },
    req: c.req,
  })

  return c.json({ ...result, items: resolvedItems }, 201)
})

// Update order status
app.put('/:id/status', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const { status } = z.object({ status: z.enum(['pending', 'processing', 'ready', 'completed', 'cancelled']) }).parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)

  const [updated] = await db.update(order)
    .set({ status, updatedAt: new Date() } as any)
    .where(eq(order.id, id))
    .returning()

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { status: { old: existing.status, new: status } },
    req: c.req,
  })

  return c.json(updated)
})

// Complete order: mark paid, decrement inventory, earn loyalty
app.post('/:id/complete', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const completeSchema = z.object({
    paymentMethod: z.enum(['cash', 'debit', 'credit', 'check', 'ach', 'split', 'other']).default('cash'),
    cashTendered: z.number().optional(),
    tipAmount: z.number().min(0).default(0),
    tipMethod: z.enum(['cash', 'debit', 'split']).optional(),
    // Split payment support
    splitPayments: z.array(z.object({
      method: z.enum(['cash', 'debit', 'ach', 'other']),
      amount: z.number().min(0),
    })).optional(),
    // Send SMS notification to customer
    sendSmsNotification: z.boolean().default(false),
  })
  const data = completeSchema.parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status === 'completed') return c.json({ error: 'Order already completed' }, 400)
  if (existing.status === 'cancelled') return c.json({ error: 'Cannot complete a cancelled order' }, 400)

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))

  const changeDue = data.paymentMethod === 'cash' && data.cashTendered
    ? data.cashTendered - Number(existing.total)
    : 0

  await db.transaction(async (tx) => {
    // Mark order completed
    await tx.update(order).set({
      status: 'completed',
      paymentMethod: data.paymentMethod,
      cashTendered: data.cashTendered != null ? String(data.cashTendered) : null,
      changeDue: String(changeDue),
      tipAmount: String(data.tipAmount),
      tipMethod: data.tipMethod || null,
      completedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(eq(order.id, id))

    // Decrement inventory for each item
    for (const item of items) {
      await tx.update(product).set({
        stockQuantity: sql`${product.stockQuantity} - ${item.quantity}`,
        updatedAt: new Date(),
      } as any).where(eq(product.id, item.productId))
    }

    // Award loyalty points if customer is linked
    if (existing.contactId) {
      const pointsEarned = Math.floor(Number(existing.total) * LOYALTY_POINTS_PER_DOLLAR)
      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = points_balance + ${pointsEarned},
            total_points_earned = total_points_earned + ${pointsEarned},
            total_visits = total_visits + 1,
            total_spent = total_spent + ${Number(existing.total)},
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)

      // Log loyalty transaction
      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'earn', ${pointsEarned}, lm.points_balance + ${pointsEarned}, ${id}, ${'Purchase ' + existing.number}, ${currentUser.companyId}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
      `)

      // Auto-upgrade loyalty tier based on lifetime points
      await tx.execute(sql`
        UPDATE loyalty_members SET
          tier = CASE
            WHEN total_points_earned >= 5000 THEN 'platinum'
            WHEN total_points_earned >= 1500 THEN 'gold'
            WHEN total_points_earned >= 500 THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)
    }
  })

  // Send SMS order notification if requested
  if (data.sendSmsNotification && existing.contactId) {
    try {
      const [customerContact] = await db.select().from(contact).where(eq(contact.id, existing.contactId)).limit(1)
      if (customerContact?.phone) {
        // Fire and forget — don't block the response
        import('../services/sms.ts').then(smsModule => {
          smsModule.default?.send?.({
            to: customerContact.phone,
            body: `Your order ${existing.number} is complete! Total: $${Number(existing.total).toFixed(2)}. Thank you for visiting!`,
            companyId: currentUser.companyId,
          }).catch(() => {})
        }).catch(() => {})
      }
    } catch {}
  }

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { status: { old: existing.status, new: 'completed' } },
    metadata: {
      paymentMethod: data.paymentMethod,
      total: existing.total,
      itemCount: items.length,
    },
    req: c.req,
  })

  return c.json({ message: 'Order completed', changeDue })
})

// Refund order (manager+ only)
app.post('/:id/refund', requireRole('manager'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const refundSchema = z.object({
    reason: z.string().min(1),
    restoreInventory: z.boolean().default(true),
    partialItems: z.array(z.object({
      orderItemId: z.string(),
      quantity: z.number().int().min(1),
    })).optional(), // If empty, full refund
  })
  const data = refundSchema.parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status !== 'completed') return c.json({ error: 'Can only refund completed orders' }, 400)

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))

  await db.transaction(async (tx) => {
    // Mark order refunded
    await tx.update(order).set({
      status: 'refunded',
      refundReason: data.reason,
      refundedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(eq(order.id, id))

    // Restore inventory
    if (data.restoreInventory) {
      const itemsToRestore = data.partialItems
        ? items.filter(i => data.partialItems!.some(pi => pi.orderItemId === i.id))
        : items

      for (const item of itemsToRestore) {
        const qty = data.partialItems
          ? data.partialItems.find(pi => pi.orderItemId === item.id)?.quantity ?? item.quantity
          : item.quantity

        await tx.update(product).set({
          stockQuantity: sql`${product.stockQuantity} + ${qty}`,
          updatedAt: new Date(),
        } as any).where(eq(product.id, item.productId))
      }
    }

    // Reverse loyalty points
    if (existing.contactId) {
      const pointsToReverse = Math.floor(Number(existing.total) * LOYALTY_POINTS_PER_DOLLAR)
      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = GREATEST(0, points_balance - ${pointsToReverse}),
            total_spent = GREATEST(0, total_spent - ${Number(existing.total)}),
            updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)

      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'reversal', ${-pointsToReverse}, GREATEST(0, lm.points_balance - ${pointsToReverse}), ${id}, ${'Refund ' + existing.number + ': ' + data.reason}, ${currentUser.companyId}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
      `)
    }
  })

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { status: { old: 'completed', new: 'refunded' } },
    metadata: {
      reason: data.reason,
      total: existing.total,
      restoreInventory: data.restoreInventory,
    },
    req: c.req,
  })

  return c.json({ message: 'Order refunded' })
})

// Receipt HTML
app.get('/:id/receipt', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')

  const [foundOrder] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!foundOrder) return c.json({ error: 'Order not found' }, 404)

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))

  const itemRows = items.map((item: any) => `
    <tr>
      <td>${item.productName}</td>
      <td style="text-align:center">${item.quantity}</td>
      <td style="text-align:right">$${Number(item.unitPrice).toFixed(2)}</td>
      <td style="text-align:right">$${Number(item.lineTotal).toFixed(2)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${foundOrder.number}</title>
<style>
  body { font-family: monospace; max-width: 320px; margin: 0 auto; padding: 20px; font-size: 12px; }
  h2 { text-align: center; margin-bottom: 4px; }
  .info { text-align: center; margin-bottom: 16px; color: #666; }
  table { width: 100%; border-collapse: collapse; }
  th, td { padding: 4px 2px; text-align: left; }
  th { border-bottom: 1px dashed #000; }
  .totals { border-top: 1px dashed #000; margin-top: 8px; }
  .totals td { padding: 2px; }
  .grand-total { font-weight: bold; font-size: 14px; border-top: 1px solid #000; }
  .footer { text-align: center; margin-top: 16px; font-size: 10px; color: #999; }
</style></head>
<body>
  <h2>Receipt</h2>
  <div class="info">
    Order: ${foundOrder.number}<br>
    Date: ${new Date(foundOrder.createdAt).toLocaleString()}<br>
    Type: ${foundOrder.type}${(foundOrder as any).isMedical ? ' (Medical)' : ''}
  </div>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">$${Number(foundOrder.subtotal).toFixed(2)}</td></tr>
    <tr><td>Excise Tax</td><td style="text-align:right">$${Number((foundOrder as any).exciseTax || 0).toFixed(2)}</td></tr>
    <tr><td>Sales Tax</td><td style="text-align:right">$${Number((foundOrder as any).salesTax || 0).toFixed(2)}</td></tr>
    ${Number((foundOrder as any).discountAmount) > 0 ? `<tr><td>Discount</td><td style="text-align:right">-$${Number((foundOrder as any).discountAmount).toFixed(2)}</td></tr>` : ''}
    <tr class="grand-total"><td>Total</td><td style="text-align:right">$${Number(foundOrder.total).toFixed(2)}</td></tr>
    ${(foundOrder as any).paymentMethod === 'cash' && (foundOrder as any).cashTendered ? `
    <tr><td>Cash Tendered</td><td style="text-align:right">$${Number((foundOrder as any).cashTendered).toFixed(2)}</td></tr>
    <tr><td>Change Due</td><td style="text-align:right">$${Number((foundOrder as any).changeDue || 0).toFixed(2)}</td></tr>
    ` : ''}
  </table>
  <div class="footer">
    Payment: ${(foundOrder as any).paymentMethod || 'N/A'}<br>
    Thank you for your visit!<br>
    This receipt is for your records.
  </div>
</body></html>`

  return c.html(html)
})

export default app
