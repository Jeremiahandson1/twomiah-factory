import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { order, orderItem, product, contact, company } from '../../db/schema.ts'
import { eq, and, gte, lte, desc, count, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
import audit from '../services/audit.ts'
import { getApprovalConfig, requireApproval, linkApprovalToOrder, ApprovalRequiredError } from '../services/approvals.ts'
import { escapeHtml } from '../utils/sanitize.ts'
import { isCannabisLine, resolvePurchaseLimitOz, GRAMS_PER_OZ } from '../utils/cannabis.ts'

const app = new Hono()
app.use('*', authenticate)

// Cannabis purchase limit: company.purchase_limit_oz → state default → 2.5 oz (utils/cannabis.ts).
// It used to be a hardcoded 2.5 oz here regardless of Settings or state (go-live QA V-1).
const LOYALTY_POINTS_PER_DOLLAR = 1
// Points-per-dollar from Settings → Loyalty (company.settings.loyalty.pointsPerDollar), else 1.
const pointsRate = (settings: any): number => {
  const r = Number(settings?.loyalty?.pointsPerDollar)
  return Number.isFinite(r) && r >= 0 ? r : LOYALTY_POINTS_PER_DOLLAR
}
// Points accrue on what the customer paid for MERCHANDISE (subtotal − discounts), not on tax.
// Earning on the tax-inclusive total (the old behaviour, QA V-2) paid points for money that
// goes to the state. Reversals use the points recorded on the order, so this is consistent.
const pointsBasis = (o: any): number =>
  Math.max(0, Number(o.subtotal || 0) - Number(o.discountAmount || 0) - Number(o.loyaltyDiscount || 0))
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']

// Thrown inside the completion transaction when an atomic stock decrement finds nothing to take
// (a concurrent sale grabbed the last unit) — caught to return 400 instead of a 500.
class OversellError extends Error {}
const CANNABIS_TAX_RATE = 0.15 // 15% cannabis excise tax (varies by state)
const SALES_TAX_RATE = 0.0875 // state + local sales tax (varies)

// Cannabis classification lives in utils/cannabis.ts (shared with the online menu). (QA F-01)

const round2 = (n: number) => Math.round(n * 100) / 100

// Age from an ISO/YYYY-MM-DD date string; null when unparseable.
function ageFromDob(dob: unknown): number | null {
  if (!dob) return null
  const birth = new Date(String(dob))
  if (Number.isNaN(birth.getTime())) return null
  const today = new Date()
  let age = today.getFullYear() - birth.getFullYear()
  const m = today.getMonth() - birth.getMonth()
  if (m < 0 || (m === 0 && today.getDate() < birth.getDate())) age--
  return age
}

// Server-side age/ID gate (QA F-02). The POS disabled "Complete Sale" until the ID box was
// ticked, but the API completed orders with idVerified=false — including one for a customer
// with a 2010 date of birth. Client-side-only enforcement is not a compliance control, so
// every path that settles a sale with cannabis on it runs this: the order must carry
// idVerified=true and, when a date of birth is known (linked contact or customerDob), the
// customer must be 21+ (18+ for a medical sale with a card on file).
// Returns null when OK, else { status, body } for the caller to return.
async function checkAgeGate(ord: any, items: any[], idVerified: boolean): Promise<{ status: 403; body: any } | null> {
  const hasCannabis = items.some(i => isCannabisLine(i))
  if (!hasCannabis) return null
  let dob: string | null = ord.customerDob || null
  if (!dob && ord.contactId) {
    const [ct] = await db.select({ dob: contact.dateOfBirth }).from(contact).where(eq(contact.id, ord.contactId)).limit(1)
    dob = (ct?.dob as any) || null
  }
  const age = ageFromDob(dob)
  const minAge = ord.isMedical && ord.medicalCardNumber ? 18 : 21
  if (age != null && age < minAge) {
    return { status: 403, body: { error: `Customer is ${age} — cannabis sales require ${minAge}+`, code: 'underage', age, minAge } }
  }
  if (!idVerified) {
    return { status: 403, body: { error: 'ID verification (21+) is required before a cannabis sale can be completed', code: 'id_verification_required' } }
  }
  return null
}

// Hono has no typed 403 helper for our error class — convert to a response.
const approvalDenied = (c: any, err: ApprovalRequiredError) => c.json(err.toJSON(), 403)

// List orders
app.get('/', async (c) => {
  const currentUser = c.get('user') as any
  const status = c.req.query('status')
  const type = c.req.query('type') // walk_in, delivery, online
  const contactId = c.req.query('contactId') || c.req.query('customerId')
  const startDate = c.req.query('startDate')
  const endDate = c.req.query('endDate')
  // Clamp paging (negative page → negative OFFSET → 500; unbounded limit). Invalid values are
  // rejected app-wide by the paging guard in index.ts; this keeps the handler safe regardless.
  const page = Math.max(1, Math.floor(+(c.req.query('page') || '1') || 1))
  const limit = Math.min(500, Math.max(1, Math.floor(+(c.req.query('limit') || '25') || 25)))

  const conditions: any[] = [eq(order.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(order.status, status))
  if (type) conditions.push(eq(order.type, type))
  // PRIVACY: without this the customer order-history panel showed EVERY customer's
  // orders/spend under one patient's name. Scope to the requested contact. (N1)
  if (contactId) conditions.push(eq(order.contactId, contactId))
  if (startDate) conditions.push(gte(order.createdAt, new Date(startDate)))
  if (endDate) conditions.push(lte(order.createdAt, new Date(endDate)))

  const where = and(...conditions)
  const [data, [{ value: total }]] = await Promise.all([
    db.select().from(order).where(where).orderBy(desc(order.createdAt)).offset((page - 1) * limit).limit(limit),
    db.select({ value: count() }).from(order).where(where),
  ])

  // The orders table's "Items" column reads itemCount; the list omitted it, so every
  // row showed 0 even with lines on the order. Attach per-order line counts. (retest#5 N2)
  const counts = await db.execute(sql`SELECT order_id, COALESCE(SUM(quantity), 0)::int as cnt FROM order_items WHERE company_id = ${currentUser.companyId} GROUP BY order_id`)
  const cmap = new Map(((counts as any).rows || counts).map((r: any) => [r.order_id, Number(r.cnt)]))
  for (const o of data as any[]) o.itemCount = cmap.get(o.id) || 0

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
    // A walk-in register has no customer, so the POS sends contactId: null.
    // `.optional()` rejected explicit null → 400 and a silent dead checkout. (B1)
    contactId: z.string().nullish(),
    customerName: z.string().optional(),
    customerId: z.string().optional(), // state ID for compliance
    customerDob: z.string().optional(),
    isMedical: z.boolean().default(false),
    medicalCardNumber: z.string().optional(),
    paymentMethod: z.enum(['cash', 'debit', 'credit', 'check', 'ach', 'split', 'other']).optional(),
    idVerified: z.boolean().default(false),
    items: z.array(z.object({
      productId: z.string(),
      quantity: z.number().min(1),
      priceOverride: z.number().min(0).optional(), // a negative override drove line/subtotal negative
    })).min(1),
    loyaltyPointsRedeemed: z.number().int().min(0).default(0),
    // Redeem a configured reward from Loyalty → Rewards (the server prices it and charges
    // its pointsCost). Without this the POS applied an opaque "$1 per 100 pts" discount that
    // never touched the rewards catalog (go-live QA M-7).
    loyaltyRewardId: z.string().nullish(),
    discountAmount: z.number().min(0).default(0),
    discountReason: z.string().optional(),
    notes: z.string().optional(),
    // Approval credentials for a discount over the threshold / a price override (F-04):
    // a manager's POS PIN, or the id of a request a manager approved on the Approvals page.
    managerPin: z.union([z.string(), z.number()]).optional(),
    approvalRequestId: z.string().optional(),
  })

  const body = await c.req.json()
  const data = orderSchema.parse(body)

  // Fetch all products for the order
  const productIds = data.items.map(i => i.productId)
  const products = await db.select().from(product)
    .where(and(eq(product.companyId, currentUser.companyId)))

  const productMap = new Map(products.filter(p => productIds.includes(p.id)).map(p => [p.id, p]))

  // Validate all products exist and check stock
  let totalWeightGrams = 0
  let subtotal = 0
  const resolvedItems: any[] = []
  // Largest per-unit price override below the catalog price (drives the price-override approval).
  let maxOverrideDelta = 0

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    if (!prod.active) return c.json({ error: `Product is not active: ${prod.name}` }, 400)

    // Check stock
    if (prod.trackInventory && Number(prod.stockQuantity) < item.quantity) {
      return c.json({ error: `Insufficient stock for ${prod.name}: have ${prod.stockQuantity}, need ${item.quantity}` }, 400)
    }

    // Track cannabis weight for the purchase limit. Seeded products store per-unit weight
    // in weight_grams (grams); older rows use weight + weight_unit. Reading only `weight`
    // meant every seeded flower rang up as 0g, so a 3.09oz cart passed the 2.5oz limit and
    // the order stored weight 0 — breaking EOD/Metrc/audit reconstruction. (retest#7)
    const isCannabis = isCannabisLine(prod)
    if (isCannabis) {
      const unitGrams = prod.weightGrams != null && String(prod.weightGrams) !== ''
        ? Number(prod.weightGrams)
        : (prod.weight ? (prod.weightUnit === 'oz' ? Number(prod.weight) * 28.3495 : Number(prod.weight)) : 0)
      if (unitGrams > 0) totalWeightGrams += unitGrams * item.quantity
    }

    const catalogPrice = Number(prod.price)
    const unitPrice = item.priceOverride ?? catalogPrice
    if (item.priceOverride != null && unitPrice < catalogPrice - 0.005) {
      maxOverrideDelta = Math.max(maxOverrideDelta, round2((catalogPrice - unitPrice) * item.quantity))
    }
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
      // total_price is the column the orders UI/exports read for the line extension;
      // it was left null while only line_total was set. (retest#5 N2/line totals)
      totalPrice: String(lineTotal),
      weight: prod.weight,
      weightUnit: prod.weightUnit,
      // Persist the RESOLVED tax category so reports, refunds and the age gate read the same
      // answer the tax math used (seeded products have tax_category NULL).
      taxCategory: isCannabis ? 'cannabis' : 'non_cannabis',
    })
  }

  // Age gate at create time too: a known-underage customer is refused before an order even
  // exists (completion re-checks, since the contact/DOB can change). (F-02)
  {
    const gate = await checkAgeGate(
      { contactId: data.contactId, customerDob: data.customerDob, isMedical: data.isMedical, medicalCardNumber: data.medicalCardNumber },
      resolvedItems,
      true, // idVerified is only required at completion; a pending order may be built before the ID check
    )
    if (gate) return c.json(gate.body, gate.status)
  }

  // Purchase limit validation — the configured/state limit, not a hardcoded 2.5 oz (V-1).
  const [companyRow] = await db.select({
    taxRate: company.taxRate, exciseTaxRate: company.exciseTaxRate,
    purchaseLimitOz: company.purchaseLimitOz, state: company.state, settings: company.settings,
  }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const limitOz = resolvePurchaseLimitOz(companyRow)
  if (totalWeightGrams > limitOz * GRAMS_PER_OZ + 1e-6) {
    return c.json({
      error: `Purchase exceeds limit: ${(totalWeightGrams / GRAMS_PER_OZ).toFixed(2)}oz exceeds the ${limitOz}oz maximum`,
      totalWeightOz: (totalWeightGrams / GRAMS_PER_OZ).toFixed(2),
      limitOz: String(limitOz),
    }, 400)
  }

  // Merchandise split for tax: excise applies to cannabis lines only, sales tax to everything.
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum, i) => sum + Number(i.lineTotal), 0)

  // Sales tax uses the rate configured in Settings (company.taxRate, a percent
  // like "8.5") so the register charges what the operator set — not a hardcoded
  // constant that disagreed with Settings. Excise stays a cannabis-specific rate.
  // (companyRow was loaded above for the purchase-limit check.)
  const configuredSalesRate = companyRow?.taxRate != null && companyRow.taxRate !== ''
    ? Number(companyRow.taxRate) / 100
    : SALES_TAX_RATE
  const salesRate = Number.isFinite(configuredSalesRate) ? configuredSalesRate : SALES_TAX_RATE
  // Excise is a cannabis-specific rate that varies by state — read it from Settings
  // too, falling back to the 15% default only when unconfigured.
  const configuredExciseRate = companyRow?.exciseTaxRate != null && companyRow.exciseTaxRate !== ''
    ? Number(companyRow.exciseTaxRate) / 100
    : CANNABIS_TAX_RATE
  const exciseRate = Number.isFinite(configuredExciseRate) ? configuredExciseRate : CANNABIS_TAX_RATE

  // Reward redemption (M-7): price the chosen catalog reward server-side and charge its
  // pointsCost. fixed → $value; percent → value% of the eligible lines (applicableCategories,
  // else the whole cart); free_item → the reward's product must be in the cart, its unit price
  // comes off. Tier gating and the member's balance are enforced below.
  let rewardId: string | null = null
  let rewardDiscount = 0
  let rewardName: string | null = null
  if (data.loyaltyRewardId) {
    if (!data.contactId) return c.json({ error: 'Select the customer before redeeming a reward.' }, 400)
    const rr = await db.execute(sql`SELECT * FROM loyalty_rewards WHERE id = ${data.loyaltyRewardId} AND company_id = ${currentUser.companyId} LIMIT 1`)
    const reward = ((rr as any).rows || rr)?.[0]
    if (!reward) return c.json({ error: 'Reward not found' }, 404)
    if (reward.active === false) return c.json({ error: `Reward "${reward.name}" is not active` }, 400)
    const memRes = await db.execute(sql`SELECT points_balance, tier FROM loyalty_members WHERE contact_id = ${data.contactId} AND company_id = ${currentUser.companyId} LIMIT 1`)
    const mem = ((memRes as any).rows || memRes)?.[0]
    const bal = Number(mem?.points_balance || 0)
    const cost = Number(reward.points_cost || reward.points_required || 0)
    if (!mem) return c.json({ error: 'Customer is not enrolled in the loyalty program' }, 400)
    if (bal < cost) return c.json({ error: `"${reward.name}" needs ${cost} points — the customer has ${bal}.`, code: 'insufficient_points', pointsCost: cost, pointsBalance: bal }, 400)
    if (reward.min_tier && TIER_ORDER.indexOf(String(mem.tier || 'bronze')) < TIER_ORDER.indexOf(String(reward.min_tier))) {
      return c.json({ error: `"${reward.name}" requires ${reward.min_tier} tier (customer is ${mem.tier || 'bronze'})`, code: 'tier_required' }, 400)
    }
    if (reward.max_redemptions_per_day) {
      const used = await db.execute(sql`SELECT COUNT(*)::int as n FROM orders WHERE company_id = ${currentUser.companyId} AND loyalty_reward_id = ${reward.id} AND created_at >= date_trunc('day', NOW()) AND status <> 'cancelled'`)
      if (Number(((used as any).rows || used)?.[0]?.n || 0) >= Number(reward.max_redemptions_per_day)) {
        return c.json({ error: `"${reward.name}" has reached its daily redemption limit`, code: 'reward_daily_limit' }, 400)
      }
    }
    const val = Number(reward.discount_value || 0)
    const type = String(reward.discount_type || 'fixed')
    if (type === 'percent') {
      let cats: string[] = []
      try { cats = (Array.isArray(reward.applicable_categories) ? reward.applicable_categories : JSON.parse(reward.applicable_categories || '[]')).map((x: any) => String(x).toLowerCase()) } catch { cats = [] }
      const base = cats.length ? resolvedItems.filter(i => cats.includes(String(i.category || '').toLowerCase())).reduce((s, i) => s + Number(i.lineTotal), 0) : subtotal
      if (cats.length && base <= 0) return c.json({ error: `"${reward.name}" applies to ${cats.join('/')} items — none are in the cart`, code: 'reward_not_applicable' }, 400)
      rewardDiscount = base * val / 100
    } else if (type === 'free_item') {
      const line = reward.product_id ? resolvedItems.find(i => i.productId === reward.product_id) : null
      if (!line) return c.json({ error: `Add the reward product to the cart to redeem "${reward.name}"`, code: 'reward_product_missing', productId: reward.product_id }, 400)
      rewardDiscount = Number(line.unitPrice)
    } else {
      rewardDiscount = val
    }
    rewardId = reward.id
    rewardName = reward.name
    data.loyaltyPointsRedeemed = cost
  }

  // Discounts. Cap the combined discount at the merchandise subtotal so a client-supplied
  // discountAmount/loyalty redemption can never exceed the goods' value or drive the total
  // negative. Guard loyalty redemption against the member's actual balance — redeeming points
  // the customer does not have would hand out a discount for free. (quantity/amount sweep)
  if (data.loyaltyPointsRedeemed > 0) {
    if (!data.contactId) return c.json({ error: 'Cannot redeem loyalty points on a walk-in with no customer.' }, 400)
    const memRes = await db.execute(sql`SELECT points_balance FROM loyalty_members WHERE contact_id = ${data.contactId} AND company_id = ${currentUser.companyId} LIMIT 1`)
    const bal = Number(((memRes as any).rows || memRes)?.[0]?.points_balance || 0)
    if (data.loyaltyPointsRedeemed > bal) {
      return c.json({ error: `Cannot redeem ${data.loyaltyPointsRedeemed} points — the customer's balance is ${bal}.` }, 400)
    }
  }

  // Attribute the discount to its source so reporting can tell a points-funded discount from a
  // manager discount (F-32). Loyalty applies first, then the manager discount fills the remaining
  // room up to subtotal; the two are persisted to their own columns and always sum to totalDiscount.
  const loyaltyApplied = rewardId
    ? round2(Math.min(rewardDiscount, subtotal))
    : round2(Math.min(data.loyaltyPointsRedeemed * 0.01, subtotal))
  const managerApplied = round2(Math.min(data.discountAmount, subtotal - loyaltyApplied))
  const totalDiscount = round2(loyaltyApplied + managerApplied)

  // Manager-approval enforcement (F-04). The thresholds on Settings → Approvals were stored but
  // never consulted here, so a $60 discount on a $70 order (threshold $10) sailed through. A
  // discount above the threshold, or a below-catalog price override, now needs an approver:
  // manager+ caller, a manager's PIN, or an approved Approvals request. The approver is recorded.
  const approvalCfg = await getApprovalConfig(currentUser.companyId)
  const approvals: { type: string; approvedBy: string; via: string; requestId?: string }[] = []
  try {
    if (managerApplied > approvalCfg.discountApprovalThreshold + 0.005) {
      const g = await requireApproval({
        companyId: currentUser.companyId, caller: currentUser, type: 'discount',
        amount: managerApplied, threshold: approvalCfg.discountApprovalThreshold, body, reason: data.discountReason,
      })
      approvals.push({ type: 'discount', ...g })
    }
    if (approvalCfg.priceOverrideApprovalRequired && maxOverrideDelta > 0) {
      const g = await requireApproval({
        companyId: currentUser.companyId, caller: currentUser, type: 'price_override',
        amount: maxOverrideDelta, threshold: null, body, reason: data.discountReason || 'Price override at register',
      })
      approvals.push({ type: 'price_override', ...g })
    }
  } catch (err) {
    if (err instanceof ApprovalRequiredError) return approvalDenied(c, err)
    throw err
  }

  // Tax is assessed on the DISCOUNTED price (F-07). Charging tax on the gross made a customer
  // with a 100% discount pay $7 tax on a $0 purchase. The discount is spread across cannabis
  // and non-cannabis merchandise pro rata so excise (cannabis only) and sales tax (everything)
  // each apply to their own net base. Round to cents: raw floats like 2.8000000000000003
  // rendered badly and broke exact-match reconciliation/exports. (retest#5 tax)
  const cannabisShare = subtotal > 0 ? cannabisSubtotal / subtotal : 0
  const taxableCannabis = Math.max(0, cannabisSubtotal - totalDiscount * cannabisShare)
  const taxableAll = Math.max(0, subtotal - totalDiscount)
  const exciseTax = round2(taxableCannabis * exciseRate)
  const salesTax = round2(taxableAll * salesRate)
  const totalTax = round2(exciseTax + salesTax)
  const grandTotal = round2(subtotal + totalTax - totalDiscount)

  // Generate order number
  const orderNumber = `ORD-${Date.now().toString(36).toUpperCase()}`

  // Create order in transaction
  const result = await db.transaction(async (tx) => {
    // Populate the integer order_number column the UI reads (OrdersPage,
    // OrderDetailPage, Dashboard all display order.orderNumber). Sequential
    // per company, starting at 1001. The `number` text column keeps the
    // ORD-xxxx code used on receipts.
    const [{ maxNum }] = await tx
      .select({ maxNum: sql<number>`COALESCE(MAX(${order.orderNumber}), 1000)` })
      .from(order)
      .where(eq(order.companyId, currentUser.companyId))
    const nextOrderNumber = Number(maxNum) + 1

    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      orderNumber: nextOrderNumber,
      type: data.type,
      status: 'pending',
      contactId: data.contactId ?? null,
      customerName: data.customerName,
      customerId: data.customerId,
      customerDob: data.customerDob,
      isMedical: data.isMedical,
      medicalCardNumber: data.medicalCardNumber,
      paymentMethod: data.paymentMethod,
      idVerified: data.idVerified,
      subtotal: String(subtotal),
      exciseTax: String(exciseTax),
      salesTax: String(salesTax),
      totalTax: String(totalTax),
      // The orders list, order detail and every export read tax_amount — it was left
      // at its '0' default while the money went only to sales_tax/total_tax, so tax
      // reports showed $0 collected on days tax was charged. (retest#5 B3/2.2)
      taxAmount: String(totalTax),
      discountAmount: String(managerApplied),
      loyaltyDiscount: String(loyaltyApplied),
      discountReason: approvals.length
        ? `${data.discountReason || ''}${data.discountReason ? ' | ' : ''}Approved by ${approvals.map(a => `${a.approvedBy} (${a.type}, ${a.via})`).join(', ')}`
        : data.discountReason,
      loyaltyPointsRedeemed: data.loyaltyPointsRedeemed,
      loyaltyRewardId: rewardId,
      total: String(grandTotal),
      totalWeightGrams: String(totalWeightGrams),
      // Compliance/EOD read the oz field too; it was left at its '0' default. (retest#7)
      totalCannabisWeightOz: (totalWeightGrams / 28.3495).toFixed(2),
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

  for (const a of approvals) await linkApprovalToOrder(a.requestId, result.id)

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
      exciseTax,
      salesTax,
      discount: totalDiscount,
      ...(approvals.length ? { approvals } : {}),
    },
    req: c.req,
  })

  return c.json({ ...result, items: resolvedItems, ...(approvals.length ? { approvals } : {}), ...(rewardId ? { reward: { id: rewardId, name: rewardName, discount: loyaltyApplied, pointsCost: data.loyaltyPointsRedeemed } } : {}) }, 201)
})

// Update order status
app.put('/:id/status', async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const statusBody = await c.req.json()
  const { status } = z.object({ status: z.enum(['pending', 'processing', 'ready', 'completed', 'cancelled']) }).parse(statusBody)

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)

  // Completing an order from the status flow (order detail page), not just the POS
  // /complete path, must also move inventory and mark it paid — otherwise a sale
  // marked "completed" here left stock untouched and paymentStatus pending (B2/B6).
  // Guard on completedAt so an order already settled via /complete is never
  // decremented twice, which keeps refund restore (also completedAt-gated) balanced.
  const nowCompleting = status === 'completed' && !existing.completedAt

  // Same age/ID gate as /complete — this is the other way a cannabis sale gets settled. (F-02)
  if (nowCompleting) {
    const lines = await db.select().from(orderItem).where(eq(orderItem.orderId, id))
    const gate = await checkAgeGate(existing, lines, !!existing.idVerified)
    if (gate) return c.json(gate.body, gate.status)
  }

  // Voiding a sale needs manager approval when Settings → Approvals says so. (F-04)
  let voidApproval: { approvedBy: string; via: string } | null = null
  if (status === 'cancelled' && existing.status !== 'cancelled') {
    const cfg = await getApprovalConfig(currentUser.companyId)
    if (cfg.voidApprovalRequired) {
      try {
        voidApproval = await requireApproval({
          companyId: currentUser.companyId, caller: currentUser, type: 'void',
          amount: Number(existing.total) || null, orderId: id, body: statusBody, reason: statusBody?.reason || `Void ${existing.number}`,
        })
      } catch (err) {
        if (err instanceof ApprovalRequiredError) return approvalDenied(c, err)
        throw err
      }
    }
  }

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(order)
      .set({ status, updatedAt: new Date(), ...(nowCompleting ? { completedAt: new Date(), paymentStatus: 'paid' } : {}) } as any)
      .where(eq(order.id, id))
      .returning()
    if (nowCompleting) {
      const items = await tx.select().from(orderItem).where(eq(orderItem.orderId, id))
      for (const item of items) {
        await tx.update(product).set({
          stockQuantity: sql`${product.stockQuantity} - ${item.quantity}`,
          updatedAt: new Date(),
        } as any).where(eq(product.id, item.productId))
      }
    }
    return u
  })

  audit.log({
    action: audit.ACTIONS.STATUS_CHANGE,
    entity: 'order',
    entityId: id,
    entityName: existing.number,
    changes: { status: { old: existing.status, new: status } },
    metadata: voidApproval ? { approvedBy: voidApproval.approvedBy, approvalVia: voidApproval.via } : undefined,
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
    // The ID check can happen at the register right before settling — accept it here too.
    idVerified: z.boolean().optional(),
  })
  const data = completeSchema.parse(await c.req.json())

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  if (existing.status === 'completed') return c.json({ error: 'Order already completed' }, 400)
  if (existing.status === 'cancelled') return c.json({ error: 'Cannot complete a cancelled order' }, 400)

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))

  // Age/ID gate — server-side, on every completion (F-02).
  const idVerifiedNow = data.idVerified === true || !!existing.idVerified
  {
    const gate = await checkAgeGate(existing, items, idVerifiedNow)
    if (gate) return c.json(gate.body, gate.status)
  }

  // Re-verify stock at completion. The create-time oversell check can go stale if the same units
  // sold on another register in between; a blind decrement here would drive stock negative. Refuse
  // rather than oversell. (quantity/amount sweep)
  for (const item of items) {
    const [prodRow] = await db.select({ stock: product.stockQuantity, track: product.trackInventory, name: product.name })
      .from(product).where(eq(product.id, item.productId)).limit(1)
    if (prodRow?.track && Number(prodRow.stock) < Number(item.quantity)) {
      return c.json({ error: `Insufficient stock to complete: ${prodRow.name} has ${prodRow.stock}, order needs ${item.quantity}` }, 400)
    }
  }

  // Tender must cover the total (F-08). A $1 tender on a $38.50 order used to complete with
  // changeDue -37.50 — a silent drawer shortage at reconciliation. Reject under-payment for cash
  // and for split tenders; never emit negative change.
  const orderTotal = round2(Number(existing.total) || 0)
  if (data.paymentMethod === 'cash') {
    // No tender given = exact amount (integrations that don't track change). Under-tender is rejected.
    if (data.cashTendered == null) data.cashTendered = orderTotal
    if (round2(data.cashTendered) + 0.005 < orderTotal) {
      return c.json({
        error: `Cash tendered $${data.cashTendered.toFixed(2)} is less than the order total $${orderTotal.toFixed(2)}`,
        code: 'insufficient_tender', total: orderTotal, tendered: data.cashTendered, shortBy: round2(orderTotal - data.cashTendered),
      }, 400)
    }
  } else if (data.paymentMethod === 'split') {
    const paid = round2((data.splitPayments || []).reduce((s, p) => s + p.amount, 0))
    if (paid + 0.005 < orderTotal) {
      return c.json({ error: `Split payments total $${paid.toFixed(2)}, order total is $${orderTotal.toFixed(2)}`, code: 'insufficient_tender', total: orderTotal, tendered: paid }, 400)
    }
  }

  const changeDue = data.paymentMethod === 'cash' && data.cashTendered != null
    ? Math.max(0, round2(data.cashTendered - orderTotal))  // round to cents (retest#6 N6); never negative (F-08)
    : 0

  try {
  await db.transaction(async (tx) => {
    // Mark order completed
    await tx.update(order).set({
      status: 'completed',
      // A completed sale is paid — the record stayed "pending" on paid cash/debit
      // orders, so revenue/AR reporting never saw them as settled. (B6)
      paymentStatus: 'paid',
      idVerified: idVerifiedNow,
      ...(data.idVerified === true && !existing.idVerified ? { idVerifiedBy: currentUser.userId } : {}),
      paymentMethod: data.paymentMethod,
      cashTendered: data.cashTendered != null ? String(data.cashTendered) : null,
      changeDue: String(changeDue),
      tipAmount: String(data.tipAmount),
      tipMethod: data.tipMethod || null,
      completedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(eq(order.id, id))

    // Decrement inventory ATOMICALLY: the WHERE ... stock_quantity >= qty makes the check and the
    // decrement a single statement, so two registers completing the last unit at once can't both
    // succeed (the pre-check above is TOCTOU under concurrency). If no row updates, stock moved out
    // from under us — abort the whole completion. (concurrency hardening)
    for (const item of items) {
      const dec = await tx.execute(sql`
        UPDATE products
        SET stock_quantity = stock_quantity - ${item.quantity}, updated_at = NOW()
        WHERE id = ${item.productId} AND company_id = ${currentUser.companyId}
          AND (track_inventory = false OR stock_quantity >= ${item.quantity})
        RETURNING id
      `)
      const ok = ((dec as any).rows || dec)?.length > 0
      if (!ok) throw new OversellError(`Insufficient stock to complete: ${item.productName || item.productId}`)
    }

    // Award loyalty points if customer is linked. The loyalty_members points/money
    // columns are stored as text on this schema, so bare `col + $n` raised
    // "operator does not exist: text + unknown" and rolled the ENTIRE completion back
    // (no stock decrement, no payment) for any sale with a customer attached. Cast to
    // numeric so the arithmetic works whatever the column type is. (register/M5)
    if (existing.contactId) {
      const [coRow] = await tx.select({ settings: company.settings }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
      const pointsEarned = Math.floor(pointsBasis(existing) * pointsRate(coRow?.settings))
      // A redeemed catalog reward counts a use once the sale actually settles.
      if ((existing as any).loyaltyRewardId) {
        await tx.execute(sql`UPDATE loyalty_rewards SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW() WHERE id = ${(existing as any).loyaltyRewardId} AND company_id = ${currentUser.companyId}`)
      }
      // Auto-enroll the customer on their first completed purchase. The award below is an
      // UPDATE keyed on contact_id; with no membership row it hit 0 rows, so a customer with
      // real spend showed points 0 / tier null and every loyalty counter read zero. Create
      // the row first (no unique constraint to ON CONFLICT on, so guard with NOT EXISTS). (retest#8)
      await tx.execute(sql`
        INSERT INTO loyalty_members (id, company_id, contact_id, points_balance, tier, joined_at, updated_at)
        SELECT gen_random_uuid(), ${currentUser.companyId}, ${existing.contactId}, 0, 'bronze', NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM loyalty_members
          WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
        )
      `)
      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = COALESCE(points_balance::numeric, 0) + ${pointsEarned},
            total_points_earned = COALESCE(total_points_earned::numeric, 0) + ${pointsEarned},
            lifetime_points = COALESCE(lifetime_points, 0) + ${pointsEarned},
            total_visits = COALESCE(total_visits::numeric, 0) + 1,
            total_spent = COALESCE(total_spent::numeric, 0) + ${Number(existing.total)},
            last_activity_at = NOW(),
            updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)

      // Record the earned points on the order itself so the receipt/history isn't 0
      // for a sale that actually awarded points. (retest#9)
      await tx.execute(sql`
        UPDATE orders SET loyalty_points_earned = ${pointsEarned} WHERE id = ${id}
      `)

      // Log loyalty transaction. balance_after is the post-award balance, which the UPDATE
      // above already set — do NOT add pointsEarned again (that double-counted it). (retest#9)
      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'earn', ${pointsEarned}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${'Purchase ' + existing.number}, ${currentUser.companyId}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
      `)

      // Spend the points that were redeemed for this order's discount — previously the discount was
      // applied but the points were never deducted, so redemption was free and the balance only ever
      // grew. Deduct now (balance was validated >= redeemed at create; GREATEST guards races). (sweep)
      const pointsRedeemed = Number(existing.loyaltyPointsRedeemed) || 0
      if (pointsRedeemed > 0) {
        await tx.execute(sql`
          UPDATE loyalty_members
          SET points_balance = GREATEST(0, COALESCE(points_balance::numeric, 0) - ${pointsRedeemed}), updated_at = NOW()
          WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
        `)
        await tx.execute(sql`
          INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
          SELECT gen_random_uuid(), lm.id, 'redeem', ${-pointsRedeemed}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${'Redeemed on ' + existing.number}, ${currentUser.companyId}, NOW()
          FROM loyalty_members lm
          WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
        `)
      }

      // Auto-upgrade loyalty tier based on lifetime points
      await tx.execute(sql`
        UPDATE loyalty_members SET
          tier = CASE
            WHEN COALESCE(total_points_earned::numeric, 0) >= 5000 THEN 'platinum'
            WHEN COALESCE(total_points_earned::numeric, 0) >= 1500 THEN 'gold'
            WHEN COALESCE(total_points_earned::numeric, 0) >= 500 THEN 'silver'
            ELSE 'bronze'
          END,
          updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)
    }
  })
  } catch (e) {
    if (e instanceof OversellError) return c.json({ error: e.message }, 400)
    throw e
  }

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
    // Dollar-amount partial refund (F-06). `amount`/`refundAmount` used to be silently ignored —
    // the schema stripped it and the order was fully refunded. Either name is honoured now.
    amount: z.number().positive().optional(),
    refundAmount: z.number().positive().optional(),
  }).refine(d => !(d.amount != null && d.partialItems?.length), {
    message: 'Send either partialItems (return specific units) or amount (dollar refund), not both',
  })
  const data = refundSchema.parse(await c.req.json())
  const requestedAmount = data.amount ?? data.refundAmount

  const [existing] = await db.select().from(order)
    .where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId)))
    .limit(1)
  if (!existing) return c.json({ error: 'Order not found' }, 404)
  // Refundable while completed or already partially refunded (so the rest of a sale can be
  // returned later). A fully-refunded order has nothing left. (F-33)
  if (!['completed', 'partially_refunded'].includes(existing.status)) {
    return c.json({ error: 'Can only refund completed or partially-refunded orders' }, 400)
  }

  const items = await db.select().from(orderItem).where(eq(orderItem.orderId, id))
  const orderTotal = round2(Number(existing.total) || 0)
  const alreadyRefunded = round2(Number(existing.refundedAmount) || 0)
  const remainingRefundable = round2(Math.max(0, orderTotal - alreadyRefunded))

  // Build the units to refund. A partial refund names lines + quantities; a full refund (no
  // partialItems, no amount) refunds whatever remains un-refunded on every line — so it also
  // finishes a prior partial. Each line is bounded by sold − already-refunded, so repeated
  // partials can never return more than was sold. (F-33 real partial refunds)
  // An AMOUNT refund returns money, not units: no lines are marked returned and no stock is
  // restocked (nothing physical came back); loyalty/spend reverse in proportion to the amount.
  const refundPlan: { line: any; qty: number }[] = []
  let refundFraction: number
  let refundAmount: number
  let fullyRefunded: boolean
  if (requestedAmount != null) {
    if (remainingRefundable <= 0) return c.json({ error: 'Nothing left to refund on this order' }, 400)
    if (requestedAmount > remainingRefundable + 0.005) {
      return c.json({
        error: `Cannot refund $${requestedAmount.toFixed(2)} — only $${remainingRefundable.toFixed(2)} of the $${orderTotal.toFixed(2)} total remains refundable`,
        remainingRefundable, alreadyRefunded, orderTotal,
      }, 400)
    }
    refundAmount = round2(Math.min(requestedAmount, remainingRefundable))
    refundFraction = orderTotal > 0 ? Math.min(1, refundAmount / orderTotal) : 1
    fullyRefunded = round2(alreadyRefunded + refundAmount) + 0.005 >= orderTotal
  } else {
    if (data.partialItems && data.partialItems.length) {
      for (const pi of data.partialItems) {
        const line = items.find(i => i.id === pi.orderItemId)
        if (!line) return c.json({ error: `Refund line ${pi.orderItemId} is not part of this order` }, 400)
        const outstanding = Number(line.quantity) - Number(line.refundedQuantity || 0)
        if (pi.quantity > outstanding) {
          return c.json({ error: `Cannot refund ${pi.quantity} of ${line.productName || 'item'} — only ${outstanding} remain un-refunded (of ${line.quantity} sold).` }, 400)
        }
        if (pi.quantity > 0) refundPlan.push({ line, qty: pi.quantity })
      }
    } else {
      for (const line of items) {
        const remaining = Number(line.quantity) - Number(line.refundedQuantity || 0)
        if (remaining > 0) refundPlan.push({ line, qty: remaining })
      }
    }
    if (refundPlan.length === 0) {
      // Every unit is back but money may still be outstanding after an amount refund — finish it.
      if (remainingRefundable > 0) {
        refundAmount = remainingRefundable; refundFraction = orderTotal > 0 ? refundAmount / orderTotal : 1; fullyRefunded = true
      } else {
        return c.json({ error: 'Nothing left to refund on this order' }, 400)
      }
    } else {
      // Refund the returned units' proportional share of the order total (carries their tax and
      // discount share); loyalty reverses on the same fraction below. Never exceed what is left.
      const orderSubtotal = Number(existing.subtotal) || 0
      const refundMerch = refundPlan.reduce((s, r) => s + Number(r.line.unitPrice) * r.qty, 0)
      refundFraction = orderSubtotal > 0 ? Math.min(1, refundMerch / orderSubtotal) : 1
      refundAmount = round2(Math.min(orderTotal * refundFraction, remainingRefundable))
      const unitsAllBack = items.every(i => {
        const planned = refundPlan.find(r => r.line.id === i.id)?.qty || 0
        return Number(i.refundedQuantity || 0) + planned >= Number(i.quantity)
      })
      fullyRefunded = unitsAllBack || round2(alreadyRefunded + refundAmount) + 0.005 >= orderTotal
    }
  }

  // Refund approval (F-04): the route is already manager+ only, so the caller IS the approver;
  // record who approved in the Approvals history/audit when the control is on.
  const refundCfg = await getApprovalConfig(currentUser.companyId)
  let refundApproval: { approvedBy: string; via: string } | null = null
  if (refundCfg.refundApprovalRequired) {
    try {
      refundApproval = await requireApproval({
        companyId: currentUser.companyId, caller: currentUser, type: 'refund',
        amount: refundAmount, orderId: id, body: data, reason: data.reason,
      })
    } catch (err) {
      if (err instanceof ApprovalRequiredError) return approvalDenied(c, err)
      throw err
    }
  }

  await db.transaction(async (tx) => {
    // Record returned units per line
    for (const r of refundPlan) {
      await tx.update(orderItem)
        .set({ refundedQuantity: sql`COALESCE(refunded_quantity, 0) + ${r.qty}` } as any)
        .where(eq(orderItem.id, r.line.id))
    }

    // Order status follows how much has been returned: fully refunded closes it; a partial keeps
    // the order alive as 'partially_refunded' so the rest still stands. Cumulative $ is tracked.
    await tx.update(order).set({
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      paymentStatus: fullyRefunded ? 'refunded' : 'partially_refunded',
      refundedAmount: sql`(COALESCE(NULLIF(refunded_amount, ''), '0')::numeric + ${refundAmount})::text`,
      refundReason: data.reason,
      refundedBy: currentUser.userId,
      refundedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(eq(order.id, id))

    // Restore inventory for the returned units — only if the sale actually decremented it
    // (completedAt is set only by /complete; a status-flow "completed" never decremented). (F1)
    if (data.restoreInventory && existing.completedAt) {
      for (const r of refundPlan) {
        if (!r.line.productId) continue
        await tx.update(product).set({
          stockQuantity: sql`${product.stockQuantity} + ${r.qty}`,
          updatedAt: new Date(),
        } as any).where(eq(product.id, r.line.productId))
      }
    }

    // Reverse loyalty. Reverse exactly what the sale awarded (recorded on the order); fall back
    // to the computed amount for legacy orders that predate loyalty_points_earned being written,
    // so the reversal can never disagree with the award. (retest#10)
    if (existing.contactId) {
      // Reverse in proportion to what's being refunded — a partial refund reverses partial points,
      // and cumulative partial reversals sum to the whole award once the order is fully refunded.
      // The visit only un-counts when the order becomes fully refunded. (F-33)
      const totalEarned = Number(existing.loyaltyPointsEarned) || Math.floor(pointsBasis(existing) * LOYALTY_POINTS_PER_DOLLAR)
      const pointsToReverse = Math.round(totalEarned * refundFraction)
      const visitDelta = fullyRefunded ? 1 : 0
      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = GREATEST(0, COALESCE(points_balance::numeric, 0) - ${pointsToReverse}),
            total_points_earned = GREATEST(0, COALESCE(total_points_earned::numeric, 0) - ${pointsToReverse}),
            lifetime_points = GREATEST(0, COALESCE(lifetime_points, 0) - ${pointsToReverse}),
            total_visits = GREATEST(0, COALESCE(total_visits::numeric, 0) - ${visitDelta}),
            total_spent = GREATEST(0, COALESCE(total_spent::numeric, 0) - ${refundAmount}),
            updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)

      // Re-evaluate tier against the reduced lifetime points so a refund can demote — otherwise
      // a customer keeps a tier earned entirely from returned goods. (retest#10)
      await tx.execute(sql`
        UPDATE loyalty_members SET tier = CASE
            WHEN COALESCE(total_points_earned::numeric, 0) >= 5000 THEN 'platinum'
            WHEN COALESCE(total_points_earned::numeric, 0) >= 1500 THEN 'gold'
            WHEN COALESCE(total_points_earned::numeric, 0) >= 500 THEN 'silver'
            ELSE 'bronze' END,
          updated_at = NOW()
        WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
      `)

      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'reversal', ${-pointsToReverse}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${'Refund ' + existing.number + ': ' + data.reason}, ${currentUser.companyId}, NOW()
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
    changes: { status: { old: existing.status, new: fullyRefunded ? 'refunded' : 'partially_refunded' } },
    metadata: {
      reason: data.reason,
      total: existing.total,
      refundAmount,
      fullyRefunded,
      restoreInventory: data.restoreInventory,
      mode: requestedAmount != null ? 'amount' : (data.partialItems?.length ? 'items' : 'full'),
      unitsReturned: refundPlan.map(r => ({ orderItemId: r.line.id, productId: r.line.productId, quantity: r.qty })),
      ...(refundApproval ? { approvedBy: refundApproval.approvedBy, approvalVia: refundApproval.via } : {}),
    },
    req: c.req,
  })

  return c.json({
    message: fullyRefunded ? 'Order refunded' : 'Partial refund processed',
    fullyRefunded,
    refundAmount,
    totalRefunded: round2(alreadyRefunded + refundAmount),
    remainingRefundable: round2(Math.max(0, orderTotal - alreadyRefunded - refundAmount)),
    unitsReturned: refundPlan.map(r => ({ orderItemId: r.line.id, quantity: r.qty })),
    status: fullyRefunded ? 'refunded' : 'partially_refunded',
    ...(refundApproval ? { approvedBy: refundApproval.approvedBy } : {}),
  })
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

  // Receipt is server-rendered HTML, not React — escape everything user-controlled. A product
  // named `<img src=x onerror=…>` would otherwise execute on the receipt window. (F-09)
  const itemRows = items.map((item: any) => `
    <tr>
      <td>${escapeHtml(item.productName)}</td>
      <td style="text-align:center">${escapeHtml(item.quantity)}</td>
      <td style="text-align:right">$${Number(item.unitPrice).toFixed(2)}</td>
      <td style="text-align:right">$${Number(item.lineTotal).toFixed(2)}</td>
    </tr>
  `).join('')

  const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Receipt ${escapeHtml(foundOrder.number)}</title>
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
    Order: ${escapeHtml(foundOrder.number)}<br>
    Date: ${new Date(foundOrder.createdAt).toLocaleString()}<br>
    Type: ${escapeHtml(foundOrder.type)}${(foundOrder as any).isMedical ? ' (Medical)' : ''}
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
    Payment: ${escapeHtml((foundOrder as any).paymentMethod || 'N/A')}<br>
    Thank you for your visit!<br>
    This receipt is for your records.
  </div>
</body></html>`

  return c.html(html)
})

export default app
