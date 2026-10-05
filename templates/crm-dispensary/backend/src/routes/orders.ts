import { Hono } from 'hono'
import { z } from 'zod'
import { db } from '../../db/index.ts'
import { order, orderItem, product, contact, company, user } from '../../db/schema.ts'
import { eq, and, or, gte, lte, desc, count, sql, inArray, isNull } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'
import { requireRole } from '../middleware/permissions.ts'
// DOB and medical card are not part of reading an order. Shared with contacts.ts, which leaks the
// same two facts from the customer record. (T41)
import { canSeeCustomerIdentity, redactCustomerIdentity, redactCustomerIdentityAll } from '../utils/customerIdentity.ts'
import audit from '../services/audit.ts'
import { getApprovalConfig, requireApproval, linkApprovalToOrder, ApprovalRequiredError } from '../services/approvals.ts'
import { escapeHtml } from '../utils/sanitize.ts'
import { isCannabisLine, resolvePurchaseLimitOz, GRAMS_PER_OZ, ageFromDob, minimumAgeFor, ADULT_USE_MIN_AGE, unitGramsOf, overPurchaseLimit, lineFlowerEquivalentGrams, uncountableCannabisLines, unweighedCannabisRefusal, gramsText } from '../utils/cannabis.ts'
import { matchZoneForAddress, zoneTerms } from '../utils/delivery.ts'
import { storeTimeZone, storeDayRange, storeToday, zoneFor } from '../utils/isoTime.ts'
import { loadEquivalencyFactors } from '../services/equivalency.ts'
import { loyaltyConfig, inBirthdayMonth } from '../utils/loyaltyConfig.ts'
import { recomputeTier } from '../utils/loyaltyTier.ts'
import { taxRatesFor, assessTax, cannabisSubtotalOf } from '../utils/tax.ts'
import { isFeatureEnabled } from '../middleware/enabledFeature.ts'
import { checkFilter } from '../shared/index.ts'
// One implementation of "can this be sold", called by every door a sale comes in through. (T49 B1)
import { resolveSellableStock, refusalFor } from '../services/sellableStock.ts'
import { money } from '../shared/invoicing/money.ts'

/** Does this shop have loyalty switched on? The award below is the thing the switch has to reach. */
const loyaltyEnabled = (companyId: string) => isFeatureEnabled(companyId, 'loyalty_rewards')

// Is the loyalty programme actually live for this shop? Two switches have to hold: the plan-level
// `loyalty_rewards` feature, and the shop's own toggle on Settings → Loyalty. The redeem path's
// refusal tells the user to "turn it on in Settings", so it had better be reading the switch that
// Settings actually writes — it was reading only the feature. Callers are outside a transaction.
const loyaltyLive = async (companyId: string): Promise<boolean> => {
  if (!(await isFeatureEnabled(companyId, 'loyalty_rewards'))) return false
  const [co] = await db.select({ settings: company.settings, loyaltyPointsPerDollar: company.loyaltyPointsPerDollar })
    .from(company).where(eq(company.id, companyId)).limit(1)
  return loyaltyConfig(co).enabled
}

const app = new Hono()
app.use('*', authenticate)

// The vocabulary an order's status and type are drawn from, stated once. STATUS_FLOW is what a caller
// may SET through /status; the two refund states are reached by refunding, never by asking. Filtering
// is validated against the whole set, because every one of them is a state an order can be found in.
export const STATUS_FLOW = ['pending', 'processing', 'ready', 'completed', 'cancelled'] as const
export const ORDER_STATUSES = [...STATUS_FLOW, 'refunded', 'partially_refunded'] as const
export const ORDER_TYPES = ['walk_in', 'delivery', 'online'] as const

// Cannabis purchase limit: company.purchase_limit_oz → state default → 2.5 oz (utils/cannabis.ts).
// It used to be a hardcoded 2.5 oz here regardless of Settings or state (go-live QA V-1).
const LOYALTY_POINTS_PER_DOLLAR = 1
// Points-per-dollar, the welcome bonus and the birthday bonus all come from the one reader in
// utils/loyaltyConfig.ts, which is also what the API hands back to Settings → Loyalty. (T21 M7)
// Points accrue on what the customer paid for MERCHANDISE (subtotal − discounts), not on tax.
// Earning on the tax-inclusive total (the old behaviour, QA V-2) paid points for money that
// goes to the state. Reversals use the points recorded on the order, so this is consistent.
const pointsBasis = (o: any): number =>
  Math.max(0, Number(o.subtotal || 0) - Number(o.discountAmount || 0) - Number(o.loyaltyDiscount || 0))
const TIER_ORDER = ['bronze', 'silver', 'gold', 'platinum']

// Thrown inside the completion transaction when an atomic stock decrement finds nothing to take
// (a concurrent sale grabbed the last unit) — caught to return 400 instead of a 500.
class OversellError extends Error {}
// Thrown when the points a ticket's loyalty discount was priced against are no longer on the
// customer's balance — another sale spent them between ringing up and settling. Same shape as
// OversellError above, and for the same reason: the check at create does not reserve anything.
class LoyaltyShortError extends Error {}
// Thrown when this request lost the race to settle an order someone (or some retry) already settled.
class AlreadyCompletedError extends Error {}
const CANNABIS_TAX_RATE = 0.15 // 15% cannabis excise tax (varies by state)
const SALES_TAX_RATE = 0.0875 // state + local sales tax (varies)

// Cannabis classification lives in utils/cannabis.ts (shared with the online menu). (QA F-01)

const round2 = (n: number) => Math.round(n * 100) / 100

// Age and the minimum age now live in utils/cannabis.ts, so the kiosk runs the SAME rule instead of
// trusting a boolean its own screen supplied. (Dispensary T20 B2)

// Server-side age/ID gate (QA F-02). The POS disabled "Complete Sale" until the ID box was
// ticked, but the API completed orders with idVerified=false — including one for a customer
// with a 2010 date of birth. Client-side-only enforcement is not a compliance control, so
// every path that settles a sale with cannabis on it runs this: the order must carry
// idVerified=true and, when a date of birth is known (linked contact or customerDob), the
// customer must be 21+ (18+ for a medical sale with a card on file).
// Returns { refusal } when the sale must be refused, and always returns what it RESOLVED about the
// buyer. That second half matters: the gate already reads the contact's medical card to decide an
// 18-to-20-year-old may buy at all, but the order was still saved with whatever isMedical the till
// sent — which is nothing, because the register's payload has no such field. So every sale to a
// young patient was stored as adult-use, charged adult-use excise, and counted under
// recreational_orders in the compliance report. The gate knows; it just never said. (T42 B1)
type AgeGate = { refusal: { status: 403; body: any } | null; isMedical: boolean; medicalCardNumber: string | null }

async function checkAgeGate(ord: any, items: any[], idVerified: boolean): Promise<AgeGate> {
  const hasCannabis = items.some(i => isCannabisLine(i))
  // A basket with no cannabis in it is not a medical sale, whatever the caller said. There is no
  // excise to exempt, and letting the flag through would still have counted a t-shirt under
  // medical_orders in the compliance report.
  if (!hasCannabis) return { refusal: null, isMedical: false, medicalCardNumber: null }
  let dob: string | null = ord.customerDob || null
  // The medical card lives on the CONTACT, with its expiry — the order only carries one if the till happened
  // to repeat it. So an 18-to-20-year-old patient with a card on file was enrolled happily and then refused
  // at every sale, "cannabis sales require 21+", even with isMedical set on the order. Read the card the
  // same way the date of birth is read. An EXPIRED card is no card. (Dispensary T20 M8)
  let cardOnFile: string | null = null
  if (ord.contactId) {
    const [ct] = await db.select({ dob: contact.dateOfBirth, card: contact.medicalCardNumber, expiry: contact.medicalCardExpiry })
      .from(contact).where(eq(contact.id, ord.contactId)).limit(1)
    if (!dob) dob = (ct?.dob as any) || null
    // A card is good for the whole of its expiry day.
    const endOfExpiryDay = (d: any) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x.getTime() }
    const expired = ct?.expiry ? endOfExpiryDay(ct.expiry) < Date.now() : false
    cardOnFile = ct?.card && !expired ? (ct.card as any) : null
  }
  const age = ageFromDob(dob)
  // The card that counts is the one on the CONTACT RECORD, checked for expiry — never one typed
  // into the request. Falling back to ord.medicalCardNumber meant a caller could supply any string
  // and have it treated as a valid card: it waived the excise (T43 N1) and, worse, it lowered the
  // minimum age, so an 18-year-old with an invented card number could be sold to. An unverifiable
  // card is not a card. A genuine walk-in patient gets a customer record with their card on it.
  // (T20 M8 established reading from the contact; this removes the hole left beside it.)
  const card = cardOnFile
  const minAge = minimumAgeFor({ isMedical: ord.isMedical || !!cardOnFile, medicalCardNumber: cardOnFile })

  // Whether a sale is MEDICAL is the server's answer, never the caller's.
  //
  // The previous version honoured the caller's flag for anyone 21+, reasoning that an adult may
  // lawfully buy either way — true, but it never required them to actually HOLD a card. So any
  // signed-in staff token, script or integration could POST isMedical:true and waive the excise on
  // a sale to a 35-year-old with no card at all. That is tax evasion by API call. (T43 N1)
  //
  // The rule now: a sale is medical when the customer holds a card that is valid on the sale date.
  //   · no valid card         → never medical, whatever was sent
  //   · under 21 with a card  → always medical; adult-use is not lawful for them at all
  //   · 21+ with a card       → medical by default, which is what fixes the register (T43 H1 — it
  //                             sends no field, so every patient over 21 was paying adult-use
  //                             excise). They can still deliberately buy adult-use by sending
  //                             isMedical:false, because a patient may want to keep their medical
  //                             allotment for another day.
  const under21 = age != null && age < ADULT_USE_MIN_AGE
  const optedOutOfMedical = ord.isMedical === false
  const isMedical = !!card && (under21 || !optedOutOfMedical)
  const resolved: AgeGate = {
    refusal: null,
    isMedical,
    // The card that authorised it, stored on the order so an audit can see which one it was.
    medicalCardNumber: isMedical ? card : null,
  }

  if (age != null && age < minAge) {
    return { ...resolved, refusal: { status: 403, body: { error: `Customer is ${age} — cannabis sales require ${minAge}+`, code: 'underage', age, minAge } } }
  }
  if (!idVerified) {
    return { ...resolved, refusal: { status: 403, body: { error: 'ID verification (21+) is required before a cannabis sale can be completed', code: 'id_verification_required' } } }
  }
  return resolved
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

  // A filter naming a status this CRM does not have is a typo, not a result: answering it with an
  // empty list tells the caller, in the ordinary way, that there are no orders. Name what is
  // accepted instead — the same rule the rest of the fleet follows. (T21 M9)
  const badStatus = checkFilter(c, 'status', status, ORDER_STATUSES)
  if (badStatus) return badStatus
  const badType = checkFilter(c, 'type', type, ORDER_TYPES)
  if (badType) return badType

  const conditions: any[] = [eq(order.companyId, currentUser.companyId)]
  if (status) conditions.push(eq(order.status, status))

  // "Online" is not a TYPE of order, it is where the order came FROM.
  //
  // An order placed on the public menu is a pickup or a delivery — that is what the customer chose
  // — and it carries source 'online'. The Orders screen's Online tab sends type=online, which
  // matched nothing, so the tab read "No orders found" with three online orders sitting in the
  // list behind it. (T47 P6, and T46 N21 before it: the source was added and nothing read it.)
  //
  // The filter is translated rather than the screen changed, because type=online is what every
  // caller already sends and an order genuinely placed with type 'online' by an older build should
  // still be found by the same tab.
  if (type === 'online') conditions.push(or(eq(order.source, 'online'), eq(order.type, 'online'))!)
  else if (type) conditions.push(eq(order.type, type))
  // …and asking by source directly, for anyone who would rather be explicit.
  const source = c.req.query('source')
  if (source) conditions.push(eq(order.source, source))
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

  // The Customer column reads customerName, which is only filled in for a walk-in whose name was typed. An
  // order with a real customer ATTACHED left it null, so the one order that knows exactly who bought it
  // showed nothing at all. Resolve the linked contact's name for those rows. (Dispensary T20)
  const linked = [...new Set((data as any[]).filter((o) => o.contactId && !o.customerName).map((o) => o.contactId))]
  if (linked.length) {
    const names = await db.select({ id: contact.id, name: contact.name }).from(contact)
      .where(and(eq(contact.companyId, currentUser.companyId), inArray(contact.id, linked as string[])))
    const nmap = new Map(names.map((n: any) => [n.id, n.name]))
    for (const o of data as any[]) if (o.contactId && !o.customerName) o.customerName = nmap.get(o.contactId) || null
  }

  // The buyer's DOB and medical card, taken at the till and stored on the order, are not part of
  // reading the order list. Same rule and same helper as /api/contacts. (T41)
  if (!(await canSeeCustomerIdentity(currentUser))) redactCustomerIdentityAll(data as any[])

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

  // customer_name is only filled in for a walk-in whose name was typed, so an order linked to a real
  // customer came back with customerName null and the detail page printed nothing — even though the
  // nested customer object was sitting right there. The LIST has resolved this since T20; the single-order
  // read never got the same treatment. Same answer, so the two agree. (Dispensary T28 L-g)
  const customerName = foundOrder.customerName || customer?.name || null

  // Who rang it up. The page asks for `processedBy`, the column is budtender_id, and nothing ever turned
  // one into the other — so every order read "Processed by —". A kiosk order genuinely has no budtender
  // until the register settles it, and that stays null rather than being filled in with a guess.
  let processedBy: string | null = null
  if ((foundOrder as any).budtenderId) {
    const [u] = await db.select({ firstName: user.firstName, lastName: user.lastName, email: user.email })
      .from(user).where(eq(user.id, (foundOrder as any).budtenderId)).limit(1)
    if (u) processedBy = [u.firstName, u.lastName].filter(Boolean).join(' ').trim() || u.email || null
  }

  /**
   * TWO redactions, because this response carries the buyer's identity twice: once on the order
   * itself (customerDob, medicalCardNumber, taken at the till) and once on the nested `customer`,
   * which is a bare `select()` of the whole contact row. (T41)
   *
   * Redacting one and not the other would have left the leak exactly where it was.
   */
  if (!(await canSeeCustomerIdentity(currentUser))) {
    redactCustomerIdentity(foundOrder as any)
    redactCustomerIdentity(customer as any)
  }

  return c.json({ ...foundOrder, customerName, processedBy, items, customer })
})

// Create order (budtender/field+)
app.post('/', requireRole('budtender'), async (c) => {
  const currentUser = c.get('user') as any

  const orderSchema = z.object({
    type: z.enum(ORDER_TYPES).default('walk_in'),
    // A walk-in register has no customer, so the POS sends contactId: null.
    // `.optional()` rejected explicit null → 400 and a silent dead checkout. (B1)
    contactId: z.string().nullish(),
    customerName: z.string().optional(),
    customerId: z.string().optional(), // state ID for compliance
    customerDob: z.string().optional(),
    // Optional, NOT defaulted to false: the server has to tell "the till said nothing" apart from
    // "this patient is deliberately buying adult-use today". Defaulting collapsed the two, so a
    // register that sends no field looked like an opt-out and every 21+ patient paid the excise.
    // (T43 H1)
    isMedical: z.boolean().optional(),
    medicalCardNumber: z.string().optional(),
    paymentMethod: z.enum(['cash', 'debit', 'credit', 'check', 'ach', 'split', 'other']).optional(),
    idVerified: z.boolean().default(false),
    items: z.array(z.object({
      productId: z.string(),
      // order_items.quantity is an INTEGER column and a line is a count of units, never a weight —
      // the weight comes from the product. Without .int() a quantity of 1.5 sailed past validation,
      // hit the column, and came back as the catch-all "One of the values is not in a valid format"
      // from the Postgres 22P02 handler, which names neither the field nor the rule. (T42 L7)
      quantity: z.number().int('Quantity must be a whole number of units').min(1),
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
    // Where a DELIVERY is going, and on whose terms.
    //
    // T45 M10: a staff-created delivery order kept none of this. No address, so nobody could
    // deliver it; no zone, so no fee was charged and the zone's minimum order was not enforced;
    // and the Active list showed raw ids, "Unknown" for the customer and "0 items", because there
    // was nothing to show. The public order-ahead path has always collected these — the staff path
    // simply never named them, so zod stripped them.
    deliveryAddress: z.string().optional(),
    deliveryNotes: z.string().optional(),
    deliveryZoneId: z.string().optional(),
  })

  const body = await c.req.json()
  const data = orderSchema.parse(body)

  // Fetch all products for the order
  const productIds = data.items.map(i => i.productId)
  const products = await db.select().from(product)
    .where(and(eq(product.companyId, currentUser.companyId)))

  const productMap = new Map(products.filter(p => productIds.includes(p.id)).map(p => [p.id, p]))

  // Validate all products exist and check stock
  // The tenant's flower-equivalency rules, read once for the whole basket. (T20 H5)
  const equivalencyFactors = await loadEquivalencyFactors(currentUser.companyId)
  let totalWeightGrams = 0
  let subtotal = 0
  const resolvedItems: any[] = []
  // Largest per-unit price override below the catalog price (drives the price-override approval).
  let maxOverrideDelta = 0

  // ── which batch is each line coming out of ────────────────────────────────────────────────────
  //
  // A recall that does not stop the register is not a recall. T45 BL4 set Blue Dream's batch to
  // "recalled" and then sold Blue Dream, because nothing on the sale path had ever heard of batches.
  //
  // Two rules, and the second one is what keeps this from closing the shop:
  //   · a product whose batches are ALL recalled or quarantined cannot be sold
  //   · a product with NO batch rows sells exactly as before — plenty of shops do not run batches,
  //     and refusing those sales would be a far worse bug than the one being fixed
  //   · …and the third rule, which T47 P4 found missing: stock that sits outside EVERY batch is not
  //     governed by any batch's status either.
  //
  // P4, found on the test shop and far worse in a real one: Gummy Bears had 55 units on hand from
  // before the shop used batches. One batch of 10 was recorded, a failed lab test quarantined it,
  // and the WHOLE product went off the till — "every batch is quarantine" — including the 45 units
  // that had never been in any batch. The first batch a shop records against existing stock would
  // take that product's entire shelf out of service.
  //
  // A recall or a hold is about the units IN that batch. Units that were never in it are no more
  // affected than units of a different product. So the question is not "is any batch sellable" but
  // "are there units to sell" — and untracked units count.
  // T49 B1: this used to be sixty lines of batch arithmetic written out HERE, and only here — so
  // it stopped a sale at the till and at none of the other three doors a sale comes in through.
  // The rule now lives in services/sellableStock.ts and every door calls it. The comments that
  // explain each clause moved with it.
  const { sellableBatch, blockedProducts, untrackedUnits } = await resolveSellableStock(
    db, currentUser.companyId, data.items.map((i: any) => i.productId), productMap as any,
  )

  for (const item of data.items) {
    const prod = productMap.get(item.productId)
    if (!prod) return c.json({ error: `Product not found: ${item.productId}` }, 400)
    if (!prod.active) return c.json({ error: `Product is not active: ${prod.name}` }, 400)

    // Every batch of this product is recalled or held, AND there is no untracked stock behind them.
    // Refusing here, at the till, is the whole point: the alternative is selling recalled product and
    // finding out during the recall. (T45 BL4)
    const blocked = blockedProducts.get(prod.id)
    if (blocked) {
      return c.json({
        error: blocked === 'recalled'
          ? `${prod.name} has been RECALLED and cannot be sold. Remove it from the order.`
          : `${prod.name} has no sellable stock — every batch is ${blocked}. Remove it from the order.`,
        code: 'batch_not_sellable', productId: prod.id, batchStatus: blocked,
      }, 400)
    }

    // …and the same refusal, but only for the units a held batch actually holds. The shop has stock
    // that predates its batches and can sell THAT; it cannot sell more than it has outside the hold.
    const spare = untrackedUnits.get(prod.id)
    if (spare !== undefined && item.quantity > spare) {
      return c.json({
        error: `${prod.name}: only ${spare} ${spare === 1 ? 'unit is' : 'units are'} sellable — the rest is in a batch that is on hold. Reduce the quantity or release the batch.`,
        code: 'batch_not_sellable', productId: prod.id, sellableUnits: spare,
      }, 400)
    }

    // Check stock
    if (prod.trackInventory && Number(prod.stockQuantity) < item.quantity) {
      return c.json({ error: `Insufficient stock for ${prod.name}: have ${prod.stockQuantity}, need ${item.quantity}` }, 400)
    }

    // Track cannabis weight for the purchase limit. Seeded products store per-unit weight
    // in weight_grams (grams); older rows use weight + weight_unit. Reading only `weight`
    // meant every seeded flower rang up as 0g, so a 3.09oz cart passed the 2.5oz limit and
    // the order stored weight 0 — breaking EOD/Metrc/audit reconstruction. (retest#7)
    // …and it is FLOWER EQUIVALENT that the limit is written in, not raw mass: a gram of concentrate is
    // worth 2.5 g of flower, so 25 g of it is 62.5 g against a 1 oz cap. The tenant's own equivalency rules
    // decide that; with none configured this is the product's own weight, exactly as before. (T20 H5)
    const isCannabis = isCannabisLine(prod)
    if (isCannabis) {
      const unitGrams = lineFlowerEquivalentGrams(prod, equivalencyFactors)
      if (unitGrams > 0) totalWeightGrams += unitGrams * item.quantity
    }

    const catalogPrice = Number(prod.price)
    const unitPrice = item.priceOverride ?? catalogPrice
    // A line cannot be worth less than nothing. The register took the catalogue price on trust, so a
    // −$5 product (which CSV import had happily created) cancelled out a $25 T-shirt beside it and
    // the whole sale rang up at $0.00 — no subtotal, no tax, no revenue, and stock gone. Wherever a
    // bad price comes from, the till is the last place it can be caught. (T45 H3)
    if (!Number.isFinite(unitPrice) || unitPrice < 0) {
      return c.json({
        error: `${prod.name} has an invalid price (${prod.price}). Fix it in Products before selling it.`,
        code: 'invalid_price', productId: prod.id, price: prod.price,
      }, 400)
    }
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
      // The line's own weight in grams, resolved the same way the purchase limit resolves it. The column
      // existed and was always null, so a line could not say what it weighed even though the order total
      // could — and a state report or an audit is built from LINES. (Dispensary T20 M11)
      weightGrams: unitGramsOf(prod) > 0 ? String(round2(unitGramsOf(prod) * item.quantity)) : null,
      // Persist the RESOLVED tax category so reports, refunds and the age gate read the same
      // answer the tax math used (seeded products have tax_category NULL).
      taxCategory: isCannabis ? 'cannabis' : 'non_cannabis',
      // The batch this came out of, so a recall can name the customers who bought it. Null when the
      // shop does not run batches, which is a real and supported way to work. (T45 BL4)
      batchId: sellableBatch.get(prod.id)?.id ?? null,
      metrcTag: sellableBatch.get(prod.id)?.metrc_tag ?? null,
    })
  }

  // Age gate at create time too: a known-underage customer is refused before an order even
  // exists (completion re-checks, since the contact/DOB can change). (F-02)
  // Not block-scoped: what the gate resolved about the buyer decides how this order is STORED and
  // taxed, not just whether it is allowed. (T42 B1/H1)
  const saleGate = await checkAgeGate(
    { contactId: data.contactId, customerDob: data.customerDob, isMedical: data.isMedical, medicalCardNumber: data.medicalCardNumber },
    resolvedItems,
    true, // idVerified is only required at completion; a pending order may be built before the ID check
  )
  if (saleGate.refusal) return c.json(saleGate.refusal.body, saleGate.refusal.status)

  // Purchase limit validation — the configured/state limit, not a hardcoded 2.5 oz (V-1).
  const [companyRow] = await db.select({
    taxRate: company.taxRate, exciseTaxRate: company.exciseTaxRate,
    purchaseLimitOz: company.purchaseLimitOz, state: company.state, settings: company.settings,
  }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const limitOz = resolvePurchaseLimitOz(companyRow)
  // A cannabis line nobody can weigh cannot be counted, and a limit that silently counts it as zero is
  // not a limit. Refuse by name before the cap is applied, rather than selling past it. (T29 H3)
  const uncountableNames = uncountableCannabisLines(
    data.items.map(i => ({ product: productMap.get(i.productId), quantity: i.quantity })),
    equivalencyFactors,
  )
  // One of the offending products, so the refusal can name the measurement ITS category is counted
  // in — "Set a weight" for flower, "Set the THC mg" for an edible. Offering both made half of every
  // refusal a wrong instruction. (T34 L4)
  const uncountableSample = data.items.map(i => productMap.get(i.productId)).find((pr: any) => pr && uncountableNames.includes(pr.name))
  const unweighed = unweighedCannabisRefusal(uncountableNames, equivalencyFactors, uncountableSample)
  if (unweighed) return c.json(unweighed, 400)
  // The over-limit answer is shared with the kiosk, so both tills refuse the same basket the same way.
  const overLimit = overPurchaseLimit(totalWeightGrams, limitOz)
  if (overLimit) return c.json(overLimit, 400)

  // Merchandise split for tax: excise applies to cannabis lines only, sales tax to everything.
  const cannabisSubtotal = resolvedItems
    .filter(i => i.taxCategory === 'cannabis')
    .reduce((sum, i) => sum + Number(i.lineTotal), 0)

  // The rates the operator set in Settings, falling back to the state defaults. Shared with the
  // kiosk (utils/tax.ts) so the two tills cannot charge differently. (T29 B2)
  const { salesRate, exciseRate } = taxRatesFor(companyRow, { isMedical: saleGate.isMedical })

  // Spending points is the same module as earning them, so it answers to the same switch. A shop
  // that has switched Loyalty off should not be able to take a reward off a cart either — the whole
  // point of turning a module off is that it stops, not that one half of it does. (Dispensary T31)
  if ((data.loyaltyRewardId || data.loyaltyPointsRedeemed > 0) && !(await loyaltyLive(currentUser.companyId))) {
    return c.json({ error: 'Loyalty is switched off for this shop. Turn it on in Settings to redeem points or rewards.' }, 403)
  }

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
      // "Per day" is per STORE day. `date_trunc('day', NOW())` is the UTC day, so the counter reset
      // at 8pm in Ohio: a reward capped at one redemption a day could be taken twice in the same
      // evening, once before 8 and once after. Half-open range on the store's own day.
      const rewardDay = storeDayRange(await zoneFor(currentUser.companyId))
      const used = await db.execute(sql`SELECT COUNT(*)::int as n FROM orders WHERE company_id = ${currentUser.companyId} AND loyalty_reward_id = ${reward.id} AND created_at >= ${rewardDay.start} AND created_at < ${rewardDay.end} AND status <> 'cancelled'`)
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
  //
  // A reward or a points spend worth more than the basket used to be clamped to the subtotal and
  // charged in full — the customer paid full price in points for part of the value, with no warning.
  // (The salon found the same thing as LY0928 M2.) The two cases want different answers:
  //
  //   a catalogue reward is all-or-nothing, so it is REFUSED with what is actually on the ticket
  //   a raw points spend is divisible, so only the points that could be used are charged
  if (rewardId && rewardDiscount > subtotal + 0.005) {
    return c.json({
      error: `"${rewardName}" takes ${money(round2(rewardDiscount))} off, and there is only ${money(round2(subtotal))} on this ticket. Ring up more, or use a smaller reward.`,
      code: 'reward_larger_than_order',
      rewardValue: round2(rewardDiscount),
      orderSubtotal: round2(subtotal),
    }, 400)
  }
  if (!rewardId && data.loyaltyPointsRedeemed > 0) {
    // 100 points to the dollar, so the most this basket can absorb is subtotal × 100.
    const usable = Math.min(data.loyaltyPointsRedeemed, Math.floor(round2(subtotal) * 100))
    data.loyaltyPointsRedeemed = usable
  }

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
  const { exciseTax, salesTax, totalTax, grandTotal: taxedTotal } = assessTax({
    subtotal, cannabisSubtotal, discount: totalDiscount, rates: { salesRate, exciseRate },
  })

  // ── Delivery: where it goes, what it costs, and whether this zone will take it ──────────────
  //
  // T45 M10. A delivery with no address is not a delivery; a zone with a fee and a minimum has
  // both of them for a reason. The zone is taken as sent, else matched on the address's ZIP —
  // the same zip_codes list the Delivery screen fills in.
  let deliveryAddress: string | null = null
  let deliveryZoneId: string | null = null
  let deliveryFee = 0
  if (data.type === 'delivery') {
    deliveryAddress = (data.deliveryAddress || '').trim() || null
    if (!deliveryAddress && data.contactId) {
      // The customer's own address is the obvious default, and the till should not have to retype it.
      const [known] = await db.select({ address: contact.address, city: contact.city, state: contact.state, zip: contact.zip })
        .from(contact)
        .where(and(eq(contact.id, data.contactId), eq(contact.companyId, currentUser.companyId)))
        .limit(1)
      const parts = [known?.address, known?.city, known?.state, known?.zip].filter(Boolean)
      if (parts.length) deliveryAddress = parts.join(', ')
    }
    if (!deliveryAddress) {
      return c.json({
        error: 'A delivery needs an address — either on the order or on the customer record',
        code: 'delivery_address_required',
      }, 400)
    }

    const zoneResult = data.deliveryZoneId
      ? await db.execute(sql`
          SELECT * FROM delivery_zones
          WHERE id = ${data.deliveryZoneId} AND company_id = ${currentUser.companyId}
          LIMIT 1
        `)
      : await db.execute(sql`
          SELECT * FROM delivery_zones
          WHERE company_id = ${currentUser.companyId} AND COALESCE(active, true) = true
        `)
    const zones = (zoneResult as any).rows || zoneResult

    let zone: any = null
    if (data.deliveryZoneId) {
      zone = zones?.[0]
      if (!zone) return c.json({ error: 'That delivery zone does not exist', code: 'delivery_zone_not_found' }, 400)
      if (zone.active === false) return c.json({ error: `${zone.name} is not currently taking deliveries`, code: 'delivery_zone_inactive' }, 400)
    } else {
      // Match on the ZIP in the address. A shop with no zones set up simply charges no fee, which
      // is the same thing it did before — the point is to stop SILENTLY ignoring a zone that exists.
      // The matching itself lives in utils/delivery.ts, shared with the public order-ahead menu,
      // which had none of it at all. (T46 N3)
      zone = matchZoneForAddress(zones as any[], deliveryAddress)
    }

    if (zone) {
      deliveryZoneId = zone.id
      const terms = zoneTerms(zone)
      deliveryFee = terms.fee
      const minimum = terms.minimum
      if (minimum > 0 && subtotal < minimum) {
        return c.json({
          error: `${zone.name} has a ${money(minimum)} minimum for delivery — this order is ${money(subtotal)}`,
          code: 'below_delivery_minimum',
          minimum,
          subtotal: round2(subtotal),
        }, 400)
      }
    }
  }

  // The fee is charged on top of the taxed total. It is a service charge, not merchandise, so it
  // is deliberately outside the tax base the assessment above computed.
  const grandTotal = round2(taxedTotal + deliveryFee)

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
    // ONE identifier for one order. The register stamped `number` with a base-36 timestamp while the
    // kiosk stamped it 'K-' + the sequence, so the same sale answered to three different names
    // depending on the surface: "K-1075" on the kiosk, "#1075" in the Orders list, "ORD-MU8DGOWY" in
    // the audit log. Both doors now derive the code from the SAME sequence the list shows. (T21 L4)
    const orderNumber = `ORD-${nextOrderNumber}`

    const [newOrder] = await tx.insert(order).values({
      number: orderNumber,
      orderNumber: nextOrderNumber,
      type: data.type,
      status: 'pending',
      // Which door this sale came through. It was left null here while the kiosk and the public menu
      // each set something, so the shop could not tell a till sale from a row predating the column,
      // `?source=pos` on the orders list matched nothing, and the ID-check banner had to guess where
      // a date of birth came from — which is how it ended up telling budtenders "the kiosk recorded"
      // it on sales rung at the register. (T52 N5)
      source: 'pos',
      contactId: data.contactId ?? null,
      customerName: data.customerName,
      customerId: data.customerId,
      customerDob: data.customerDob,
      // Resolved, not as sent: an under-21 patient's sale is medical by law, and the card is stored
      // on the order so the compliance report and an audit can see which sale it authorised. (T42 B1)
      isMedical: saleGate.isMedical,
      medicalCardNumber: saleGate.medicalCardNumber,
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
      totalWeightGrams: gramsText(totalWeightGrams),
      // Compliance/EOD read the oz field too; it was left at its '0' default. (retest#7)
      totalCannabisWeightOz: (totalWeightGrams / 28.3495).toFixed(2),
      notes: data.notes,
      // A delivery keeps where it is going, which zone it belongs to and what the zone charges —
      // none of which a staff-created delivery order held before. (T45 M10)
      deliveryAddress,
      deliveryNotes: data.deliveryNotes || null,
      deliveryZoneId,
      deliveryFee: String(deliveryFee),
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
    // the code the order was actually given, read back off the row (T21 L4)
    entityName: (result as any).number,
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
    req: c,
  })

  return c.json({ ...result, items: resolvedItems, ...(approvals.length ? { approvals } : {}), ...(rewardId ? { reward: { id: rewardId, name: rewardName, discount: loyaltyApplied, pointsCost: data.loyaltyPointsRedeemed } } : {}) }, 201)
})

// Update order status
app.put('/:id/status', requireRole('driver'), async (c) => {
  const currentUser = c.get('user') as any
  const id = c.req.param('id')
  const statusBody = await c.req.json()
  // The reason was being thrown away here. This schema parsed { status } alone, so a caller that
  // sent one — the approvals path already does, and the tester did — had it dropped before anything
  // could store it, and the audit row for a void said only "pending → cancelled". A refund has
  // carried its reason since the first migration; voiding a sale takes the same money and the same
  // stock out of the day. (T52 M5)
  const { status, reason } = z.object({
    status: z.enum(STATUS_FLOW),
    reason: z.string().trim().max(500).optional(),
  }).parse(statusBody)

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
    if (gate.refusal) return c.json(gate.refusal.body, gate.refusal.status)
  }

  // A sale that has been SETTLED cannot be cancelled — it has to be refunded. Cancelling one made the
  // money and the stock both disappear: the order kept payment_status 'paid' and its completed_at, no
  // stock came back, no refund was recorded, and every revenue surface that excludes cancelled orders
  // simply stopped counting it. The takings were short by the value of the sale with nothing anywhere
  // to explain it, and none of the refund rules — manager role, a reason, the refundable cap, the
  // stock restore — were involved. (Dispensary T29 H2)
  //
  // Cancelling stays available for the thing it is for: an order that never took money. The test for
  // that is completed_at, the same "has ever been settled" marker /complete and the refund restore
  // use, plus the payment fields for anything settled by another route.
  // A SETTLED sale cannot be walked backwards to pending/processing/ready either. Cancelling was
  // blocked (T29 H2) and this was the same hole one door along: moving a paid sale back to Pending
  // dropped it out of revenue — every money surface counts settled statuses — until someone happened
  // to set it forward again. The money had been taken, the stock had left, and the report said
  // neither. Refunding is how a settled sale is undone. (Dispensary T30)
  const BACKWARDS = ['pending', 'processing', 'ready']
  if (BACKWARDS.includes(status) && existing.completedAt) {
    return c.json({
      error: `${existing.number || 'This order'} has already been completed and paid. It cannot be moved back to ${status} — refund it instead, or the takings will be short by its value until someone sets it forward again.`,
      code: 'cannot_unsettle_order',
      refundWith: `POST /api/orders/${id}/refund`,
    }, 409)
  }

  if (status === 'cancelled' && existing.status !== 'cancelled') {
    // A void has to say why, the same as a refund does. This is a new refusal on a shape that was
    // being accepted, so it is deliberately narrow: only the cancel transition, and only when the
    // reason is genuinely absent. Every other status change is untouched.
    if (!String(reason || '').trim()) {
      return c.json({
        error: `Say why ${existing.number || 'this order'} is being voided. A void takes the money and the stock back out of the day, and the record has to show who decided that and why.`,
        code: 'cancel_reason_required',
      }, 400)
    }
    const settled = !!existing.completedAt || existing.paymentStatus === 'paid' || Number(existing.refundedAmount || 0) > 0
    if (settled) {
      return c.json({
        error: `${existing.number || 'This order'} has already been paid. Refund it instead — cancelling a settled sale would remove the money from your takings and leave the stock out of the building.`,
        code: 'cancel_requires_refund',
        refundWith: `POST /api/orders/${id}/refund`,
      }, 409)
    }
  }

  // Voiding a sale needs manager approval when Settings → Approvals says so. (F-04)
  let voidApproval: { approvedBy: string; via: string } | null = null
  if (status === 'cancelled' && existing.status !== 'cancelled') {
    const cfg = await getApprovalConfig(currentUser.companyId)
    if (cfg.voidApprovalRequired) {
      try {
        voidApproval = await requireApproval({
          companyId: currentUser.companyId, caller: currentUser, type: 'void',
          amount: Number(existing.total) || null, orderId: id, body: statusBody, reason: reason || `Void ${existing.number}`,
        })
      } catch (err) {
        if (err instanceof ApprovalRequiredError) return approvalDenied(c, err)
        throw err
      }
    }
  }

  const nowCancelling = status === 'cancelled' && existing.status !== 'cancelled'

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(order)
      .set({
        status,
        updatedAt: new Date(),
        ...(nowCompleting ? { completedAt: new Date(), paymentStatus: 'paid' } : {}),
        // On the sale itself, not only in the audit log. The audit log is the trail of who did what;
        // the order is what a manager, an export and a regulator read. A refund writes all three of
        // these and a void wrote none. (T52 M5)
        ...(nowCancelling ? { cancellationReason: reason, cancelledAt: new Date(), cancelledBy: currentUser.userId } : {}),
      } as any)
      .where(eq(order.id, id))
      .returning()
    if (nowCompleting) {
      const items = await tx.select().from(orderItem).where(eq(orderItem.orderId, id))
      for (const item of items) {
        await tx.update(product).set({
          stockQuantity: sql`${product.stockQuantity} - ${item.quantity}`,
          updatedAt: new Date(),
        } as any).where(eq(product.id, item.productId))

        // …and the BATCH, the same as /complete does. (T41)
        //
        // The comment above calls this "the other way a cannabis sale gets settled", and it moved
        // the product but not the lot — so completing a sale from the order detail page left the
        // batch reading what it started at, which is the T46 N14 drift reappearing on the second
        // path. Rule: every way a sale is completed has to move the batch, not just the one the
        // report happened to name.
        if ((item as any).batchId) {
          await tx.execute(sql`
            UPDATE batches
            SET current_quantity = GREATEST(COALESCE(current_quantity, 0) - ${item.quantity}, 0), updated_at = NOW()
            WHERE id = ${(item as any).batchId} AND company_id = ${currentUser.companyId}
          `)
        }
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
    // `reason` sits where the refund audit puts its own, so the Audit Log screen reads one shape for
    // both. Before this the void row carried nothing but "pending → cancelled". (T52 M5)
    metadata: (reason || voidApproval) ? {
      ...(reason ? { reason } : {}),
      ...(voidApproval ? { approvedBy: voidApproval.approvedBy, approvalVia: voidApproval.via } : {}),
    } : undefined,
    req: c,
  })

  return c.json(updated)
})

// Complete order: mark paid, decrement inventory, earn loyalty
app.post('/:id/complete', requireRole('budtender'), async (c) => {
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
    if (gate.refusal) return c.json(gate.refusal.body, gate.refusal.status)

    // The card is checked again HERE, not only when the order was raised. A sale can sit pending
    // across the day its card expires, and settling it then would move regulated product against an
    // authorisation that had lapsed — with the excise already waived at create time. Refuse rather
    // than quietly re-tax it, because the price the customer was quoted is no longer the right one.
    // (T43 N1)
    if ((existing as any).isMedical && !gate.isMedical) {
      return c.json({
        error: 'This order was raised as a medical sale, but the customer no longer has a valid medical card. Check the card, then raise it again.',
        code: 'medical_card_no_longer_valid',
      }, 403)
    }
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

  // …and the batch rule AGAIN, here, at the moment the money and the stock actually move.
  //
  // T49 B1: this was the step that let a recalled product out of the building. An order-ahead was
  // accepted before the check existed on that route, and completing it here returned 200 and took
  // the stock down — because complete() re-checked the QUANTITY and never re-asked whether the
  // product could be sold at all.
  //
  // It has to be re-asked whatever the create path does, because time passes between the two: an
  // order taken this morning and collected this afternoon can be an order for a lot recalled at
  // lunchtime. That is the ordinary case for order-ahead, not an edge one.
  {
    const ids = items.map((i: any) => String(i.productId)).filter(Boolean)
    const prodRows = ids.length
      ? await db.select({ id: product.id, name: product.name, stockQuantity: product.stockQuantity })
          .from(product).where(and(eq(product.companyId, currentUser.companyId), inArray(product.id, ids)))
      : []
    const byId = new Map(prodRows.map((p: any) => [String(p.id), p]))
    const stock = await resolveSellableStock(db, currentUser.companyId, ids, byId)
    for (const item of items) {
      const blocked = stock.blockedProducts.get(String(item.productId))
      const refusal = refusalFor(byId.get(String(item.productId)), blocked)
      if (refusal) {
        return c.json({
          ...refusal,
          error: blocked === 'recalled'
            ? `${byId.get(String(item.productId))?.name || 'A product on this order'} has been RECALLED since this order was taken. It cannot be handed over — void the order and tell the customer.`
            : refusal.error,
        }, 400)
      }
      const spare = stock.untrackedUnits.get(String(item.productId))
      if (spare !== undefined && Number(item.quantity) > spare) {
        return c.json({
          error: `${byId.get(String(item.productId))?.name || 'A product on this order'} only has ${spare} sellable outside a held batch, and this order needs ${item.quantity}.`,
          code: 'batch_not_sellable', productId: item.productId,
        }, 400)
      }
    }
  }

  // Tender must cover the total (F-08). A $1 tender on a $38.50 order used to complete with
  // changeDue -37.50 — a silent drawer shortage at reconciliation. Reject under-payment for cash
  // and for split tenders; never emit negative change.
  const orderTotal = round2(Number(existing.total) || 0)
  // Cash goes into a DRAWER. A $121.25 cash sale completed while the dashboard read "Cash Drawer
  // Closed" belonged to no session, so no close-out would ever expect it and the money surfaced later
  // as an unexplained variance — or not at all. The sale is linked to the open session now, and
  // refused when there is none. (Dispensary T29 M9)
  //
  // Only for shops that actually use drawers. A dispensary that has never opened one is not running
  // its cash that way, and making the till refuse every cash sale to teach it a workflow it never
  // asked for would be a worse bug than the one being fixed. The moment a shop opens its first
  // drawer, it has opted in and the rule applies from then on.
  let cashSessionId: string | null = null
  const takesCash = data.paymentMethod === 'cash' || (data.splitPayments || []).some(p => p.method === 'cash')
  if (takesCash) {
    const openRow = ((await db.execute(sql`
      SELECT id FROM cash_sessions WHERE company_id = ${currentUser.companyId} AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `)) as any).rows?.[0]
    if (openRow) {
      cashSessionId = String(openRow.id)
    } else {
      // …and only while the shop still RUNS drawers. Having used one in the past is not consent to be
      // locked out of cash after switching Cash Management off: with the module off, every cash sale
      // was refused for want of a drawer the operator had just said they do not use. A switch that
      // breaks the till is worse than the gap it closed. (Dispensary T32 M1)
      const stillRunsDrawers = await isFeatureEnabled(currentUser.companyId, 'cash_management')
      const everUsed = stillRunsDrawers && ((await db.execute(sql`
        SELECT 1 FROM cash_sessions WHERE company_id = ${currentUser.companyId} LIMIT 1
      `)) as any).rows?.length > 0
      if (everUsed) {
        return c.json({
          error: 'No cash drawer is open, so this cash has nowhere to be counted. Open a drawer on the Cash page, then take the payment.',
          code: 'no_open_cash_drawer',
        }, 409)
      }
    }
  }
  if (data.paymentMethod === 'cash') {
    // No tender given = exact amount (integrations that don't track change). Under-tender is rejected.
    if (data.cashTendered == null) data.cashTendered = orderTotal
    if (round2(data.cashTendered) + 0.005 < orderTotal) {
      return c.json({
        error: `Cash tendered ${money(data.cashTendered)} is less than the order total ${money(orderTotal)}`,
        code: 'insufficient_tender', total: orderTotal, tendered: data.cashTendered, shortBy: round2(orderTotal - data.cashTendered),
      }, 400)
    }
  } else if (data.paymentMethod === 'split') {
    const paid = round2((data.splitPayments || []).reduce((s, p) => s + p.amount, 0))
    if (paid + 0.005 < orderTotal) {
      return c.json({ error: `Split payments total ${money(paid)}, order total is ${money(orderTotal)}`, code: 'insufficient_tender', total: orderTotal, tendered: paid }, 400)
    }
  }

  const changeDue = data.paymentMethod === 'cash' && data.cashTendered != null
    ? Math.max(0, round2(data.cashTendered - orderTotal))  // round to cents (retest#6 N6); never negative (F-08)
    : 0

  // Read the switch BEFORE the transaction opens. Asking for it inside meant a query on the outer
  // connection pool while the transaction held a connection — on a single-connection database that is
  // a deadlock, and on a pooled one it is a read that is not part of the transaction deciding on it.
  // It is also one lookup per sale either way, and this one is cached. (Dispensary T31)
  const loyaltyOn = await loyaltyEnabled(currentUser.companyId)
  // The store's zone, read out here for the same reason and the same way: the birthday-bonus check
  // inside the transaction needs to know when the shop's YEAR began, and asking for the company row
  // from inside would be a query on the outer pool while the transaction holds a connection.
  const completeZone = await zoneFor(currentUser.companyId)

  try {
  await db.transaction(async (tx) => {
    // CLAIM the order before spending anything. `completed_at IS NULL` in the WHERE makes settling it
    // a single conditional statement, which is what serialises the whole completion: Postgres blocks a
    // second transaction on this row until the first commits, then re-evaluates the condition against
    // the committed row and matches nothing. The loser does no work.
    //
    // The status check above is a read, then a check, then a write, with nothing holding the row — ten
    // copies of the request all read "pending" before any of them wrote, so all ten passed it and all
    // ten took stock and awarded points. Ten one-unit sales removed 27 units; three loyalty sales paid
    // 220 points instead of 60. The atomic stock decrement below only ever protected against
    // overselling, not against settling the SAME order repeatedly, so with stock on hand it waved every
    // duplicate through. (Dispensary T29 B1)
    //
    // Gated on completed_at, not on status, because status can be moved back: setting a completed order
    // to pending and completing it again is the same double-spend by hand, and the report found that
    // too. completed_at is only ever set, never cleared — the PUT status path (nowCompleting) and the
    // refund restore already treat it as "has ever been settled", so this is that same invariant,
    // enforced rather than assumed.
    const claimed = await tx.update(order).set({
      status: 'completed',
      // A completed sale is paid — the record stayed "pending" on paid cash/debit
      // orders, so revenue/AR reporting never saw them as settled. (B6)
      paymentStatus: 'paid',
      idVerified: idVerifiedNow,
      ...(data.idVerified === true && !existing.idVerified ? { idVerifiedBy: currentUser.userId } : {}),
      // Who rang it up. A register sale records this when the order is created; a KIOSK order has no
      // user at that moment, so budtender_id stayed null and Order Detail read "Kiosk (not yet
      // settled)" for ever — including after a budtender had settled it at the counter, which is
      // exactly when the question "who handled this sale?" starts having an answer. COALESCE, not an
      // overwrite: on a register sale the person who rang it up keeps the credit. (Dispensary T31 L5)
      ...((existing as any).budtenderId ? {} : { budtenderId: currentUser.userId }),
      paymentMethod: data.paymentMethod,
      cashTendered: data.cashTendered != null ? String(data.cashTendered) : null,
      changeDue: String(changeDue),
      tipAmount: String(data.tipAmount),
      tipMethod: data.tipMethod || null,
      // so the drawer close-out expects this money (M9)
      cashSessionId,
      completedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(and(eq(order.id, id), eq(order.companyId, currentUser.companyId), isNull(order.completedAt))).returning({ id: order.id })

    // Nothing matched: another request settled this order first. Abort before any stock moves or any
    // points are awarded — the throw rolls the whole transaction back.
    if (!claimed.length) throw new AlreadyCompletedError('This order has already been completed.')

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

      // …and the BATCH the units came out of, when the line names one.
      //
      // T46 N14: a batch stayed at 20 after a sale from it, so the lot's own count only ever went
      // down when someone destroyed something. A recall asks two questions — how much is left and
      // who has the rest — and the first was answered with the number the batch started at.
      // Floored rather than refused: the product count is what governs whether a sale may happen
      // (checked above), and a batch figure that has drifted must not block a customer at the till.
      if ((item as any).batchId) {
        await tx.execute(sql`
          UPDATE batches
          SET current_quantity = GREATEST(COALESCE(current_quantity, 0) - ${item.quantity}, 0), updated_at = NOW()
          WHERE id = ${(item as any).batchId} AND company_id = ${currentUser.companyId}
        `)
      }
    }

    // Award loyalty points if customer is linked. The loyalty_members points/money
    // columns are stored as text on this schema, so bare `col + $n` raised
    // "operator does not exist: text + unknown" and rolled the ENTIRE completion back
    // (no stock decrement, no payment) for any sale with a customer attached. Cast to
    // numeric so the arithmetic works whatever the column type is. (register/M5)
    //
    // …and only when the shop HAS loyalty switched on. Gating /api/loyalty alone would have been
    // another half-fix: the tester turned the module off and points kept accruing on every sale,
    // because the award lives here, on the till, not behind that route. A switch has to reach the
    // thing it switches off, not just the page that displays it. (Dispensary T31)
    // Two switches, and BOTH have to hold. `loyalty_rewards` is the plan-level feature the Factory
    // sets; settings.loyalty.enabled is the shop's own toggle on Settings → Loyalty. Only the
    // welcome and birthday bonuses ever honoured the second one, so a dispensary that switched its
    // own programme off watched points keep accruing on every sale and customers keep being
    // auto-enrolled into a programme it had turned off. Same lesson as T31, one switch further in.
    const [coRow] = loyaltyOn
      ? await tx.select({ settings: company.settings, loyaltyPointsPerDollar: company.loyaltyPointsPerDollar }).from(company).where(eq(company.id, currentUser.companyId)).limit(1)
      : [undefined as any]
    const loyalty = loyaltyConfig(coRow)
    if (existing.contactId && loyaltyOn && loyalty.enabled) {
      // A bonus-multiplier event, if one is running right now.
      //
      // T45 M14: Gamified Loyalty let a manager create a "1000x points" event, listed it happily,
      // and then awarded 1x on every sale — nothing anywhere read bonus_multiplier. An event that
      // does nothing is worse than no event: the shop advertises double points and the customer
      // does not get them. The highest multiplier running wins, and a whole-number result is what
      // a points balance is, so it rounds down the same way the base award does.
      const multiplierRows = await tx.execute(sql`
        SELECT name, bonus_multiplier FROM loyalty_challenges
        WHERE company_id = ${currentUser.companyId}
          AND type = 'bonus_multiplier'
          AND is_active = true
          AND start_date <= NOW()
          AND end_date >= NOW()
        ORDER BY bonus_multiplier DESC
        LIMIT 1
      `)
      const runningEvent = ((multiplierRows as any).rows || multiplierRows)?.[0]
      const rawMultiplier = Number(runningEvent?.bonus_multiplier)
      const multiplier = Number.isFinite(rawMultiplier) && rawMultiplier > 1 ? rawMultiplier : 1
      const pointsEarned = Math.floor(pointsBasis(existing) * loyalty.pointsPerDollar * multiplier)
      // A redeemed catalog reward counts a use once the sale actually settles.
      if ((existing as any).loyaltyRewardId) {
        await tx.execute(sql`UPDATE loyalty_rewards SET usage_count = COALESCE(usage_count, 0) + 1, updated_at = NOW() WHERE id = ${(existing as any).loyaltyRewardId} AND company_id = ${currentUser.companyId}`)
      }
      // Auto-enroll the customer on their first completed purchase. The award below is an
      // UPDATE keyed on contact_id; with no membership row it hit 0 rows, so a customer with
      // real spend showed points 0 / tier null and every loyalty counter read zero. Create
      // the row first (no unique constraint to ON CONFLICT on, so guard with NOT EXISTS). (retest#8)
      const enrolled: any = await tx.execute(sql`
        INSERT INTO loyalty_members (id, company_id, contact_id, points_balance, tier, joined_at, updated_at)
        SELECT gen_random_uuid(), ${currentUser.companyId}, ${existing.contactId}, 0, 'bronze', NOW(), NOW()
        WHERE NOT EXISTS (
          SELECT 1 FROM loyalty_members
          WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
        )
        RETURNING id
      `)
      // A row comes back only when this sale is the one that enrolled them, so the welcome bonus is
      // granted exactly once — on joining, not on every visit. Settings → Loyalty offered it and
      // nothing ever paid it out: a new customer's $80 first purchase ended on exactly 80 points. (T21 M7)
      const justEnrolled = ((enrolled as any).rows || enrolled)?.length > 0
      const welcomeBonus = loyalty.enabled && justEnrolled ? loyalty.welcomePoints : 0

      // The birthday bonus, once per calendar year, on their first settled sale in their birthday
      // month — a reward tied to the day itself would go unclaimed by anyone who did not happen to
      // shop that day.
      let birthdayBonus = 0
      if (loyalty.enabled && loyalty.birthdayBonus > 0) {
        const [ct] = await tx.select({ dob: contact.dateOfBirth }).from(contact).where(eq(contact.id, existing.contactId)).limit(1)
        if (inBirthdayMonth(ct?.dob)) {
          const already: any = await tx.execute(sql`
            SELECT 1 FROM loyalty_transactions lt
            JOIN loyalty_members lm ON lm.id = lt.member_id
            WHERE lm.contact_id = ${existing.contactId} AND lt.company_id = ${currentUser.companyId}
              AND lt.type = 'bonus' AND lt.description LIKE 'Birthday bonus%'
              -- "this year" is the STORE's year. date_trunc('year', NOW()) is the UTC year, so for
              -- the last hours of 31 December a customer who had already had the bonus could be
              -- given it again — the new year had started in UTC but not in the shop.
              AND lt.created_at >= ${storeDayRange(completeZone, `${storeToday(completeZone).slice(0, 4)}-01-01`).start}
            LIMIT 1
          `)
          if (!((already as any).rows || already)?.length) birthdayBonus = loyalty.birthdayBonus
        }
      }
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
        SELECT gen_random_uuid(), lm.id, 'earn', ${pointsEarned}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${multiplier > 1 ? `Purchase ${existing.number} (${multiplier}x ${runningEvent?.name || 'bonus event'})` : 'Purchase ' + existing.number}, ${currentUser.companyId}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
      `)

      // The bonuses land as their own ledger entries, applied after the purchase award so each row's
      // balance_after is the balance at that moment. They are deliberately NOT written to the order's
      // loyalty_points_earned: a refund reverses what the PURCHASE awarded, and a welcome or birthday
      // bonus is not something the customer bought. (T21 M7)
      for (const bonus of [
        { points: welcomeBonus, description: 'Welcome bonus' },
        { points: birthdayBonus, description: `Birthday bonus ${new Date().getFullYear()}` },
      ]) {
        if (bonus.points <= 0) continue
        await tx.execute(sql`
          UPDATE loyalty_members
          SET points_balance = COALESCE(points_balance::numeric, 0) + ${bonus.points},
              total_points_earned = COALESCE(total_points_earned::numeric, 0) + ${bonus.points},
              lifetime_points = COALESCE(lifetime_points, 0) + ${bonus.points},
              last_activity_at = NOW(),
              updated_at = NOW()
          WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
        `)
        await tx.execute(sql`
          INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
          SELECT gen_random_uuid(), lm.id, 'bonus', ${bonus.points}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${bonus.description}, ${currentUser.companyId}, NOW()
          FROM loyalty_members lm
          WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
        `)
      }

      // Spend the points that were redeemed for this order's discount.
      //
      // The check at create is an early warning, not a guard: nothing reserves the points between
      // then and here, so several tickets can be raised against one balance and every one of them
      // passes. GREATEST(0, …) used to floor the result, which stopped the balance going negative
      // and hid the fact that the shop had handed out more discount than the customer could pay
      // for. (The salon run found the same shape as LY0928 B1.)
      //
      // So the balance check IS the WHERE clause, exactly as the stock decrement above does it, and
      // a completion that cannot be paid for is refused rather than quietly given away. Same
      // transaction, so the stock comes back with it.
      const pointsRedeemed = Number(existing.loyaltyPointsRedeemed) || 0
      if (pointsRedeemed > 0) {
        const spend: any = await tx.execute(sql`
          UPDATE loyalty_members
          SET points_balance = COALESCE(points_balance::numeric, 0) - ${pointsRedeemed}, updated_at = NOW()
          WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId}
            AND COALESCE(points_balance::numeric, 0) >= ${pointsRedeemed}
          RETURNING id, points_balance
        `)
        const spentRow = ((spend as any).rows || spend)?.[0]
        if (!spentRow) {
          const balRes: any = await tx.execute(sql`SELECT COALESCE(points_balance::numeric, 0) AS b FROM loyalty_members WHERE contact_id = ${existing.contactId} AND company_id = ${currentUser.companyId} LIMIT 1`)
          const have = Number(((balRes as any).rows || balRes)?.[0]?.b || 0)
          throw new LoyaltyShortError(
            `This sale takes ${pointsRedeemed} points off and the customer now has ${have} — another sale has spent them since this ticket was rung up. Remove the reward and re-price the order.`,
          )
        }
        await tx.execute(sql`
          INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
          VALUES (gen_random_uuid(), ${spentRow.id}, 'redeem', ${-pointsRedeemed}, ${Number(spentRow.points_balance)}, ${id}, ${'Redeemed on ' + existing.number}, ${currentUser.companyId}, NOW())
        `)
      }

      // Auto-upgrade loyalty tier based on lifetime points
      await recomputeTier(tx, currentUser.companyId, { contactId: existing.contactId })
    }
  })
  } catch (e) {
    if (e instanceof OversellError) return c.json({ error: e.message }, 400)
    if (e instanceof LoyaltyShortError) return c.json({ error: e.message, code: 'loyalty_points_gone' }, 400)
    // 409, not 400: the request was well-formed and the caller is not at fault — a retry or a second
    // tap arrived after the sale was already settled. A till can treat this as "it went through".
    if (e instanceof AlreadyCompletedError) return c.json({ error: e.message, code: 'order_already_completed' }, 409)
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
            body: `Your order ${existing.number} is complete! Total: ${money(Number(existing.total))}. Thank you for visiting!`,
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
    req: c,
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

  /**
   * CASH GOING BACK OUT NEEDS A DRAWER TOO. (T42 "a cash refund goes through with no drawer open")
   *
   * The SALE path has required this since T29 M9 and been narrowed twice since; this mirrors it
   * rather than inventing a second rule. A shop that has never opened a drawer, or has switched Cash
   * Management off, is not running its cash that way and is not refused — the till must not teach a
   * workflow nobody asked for. A shop that DOES run drawers gets the refusal, and the refund records
   * which drawer the money left, which is the half the finding was actually about.
   *
   * Cash only: a debit or ACH refund goes back the way it came and never touches the till.
   */
  let refundCashSessionId: string | null = null
  if (existing.paymentMethod === 'cash') {
    const openRow = ((await db.execute(sql`
      SELECT id FROM cash_sessions WHERE company_id = ${currentUser.companyId} AND status = 'open'
      ORDER BY opened_at DESC LIMIT 1
    `)) as any).rows?.[0]
    if (openRow) {
      refundCashSessionId = String(openRow.id)
    } else {
      const stillRunsDrawers = await isFeatureEnabled(currentUser.companyId, 'cash_management')
      const everUsed = stillRunsDrawers && ((await db.execute(sql`
        SELECT 1 FROM cash_sessions WHERE company_id = ${currentUser.companyId} LIMIT 1
      `)) as any).rows?.length > 0
      if (everUsed) {
        return c.json({
          error: 'No cash drawer is open, so this refund has nowhere to be counted from. Open a drawer on the Cash page, then give the refund.',
          code: 'no_open_cash_drawer',
        }, 409)
      }
    }
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
  // The rates this company charges, for taxing the units that are coming back (M2).
  // settings comes along because the medical excise exemption lives there: a refund has to reverse
  // exactly what was charged, and a tenant that taxes patients must not be handed back an exemption.
  const [refundCompanyRow] = await db.select({ taxRate: company.taxRate, exciseTaxRate: company.exciseTaxRate, settings: company.settings })
    .from(company).where(eq(company.id, currentUser.companyId)).limit(1)

  const refundPlan: { line: any; qty: number }[] = []
  let refundFraction: number
  let refundAmount: number
  let fullyRefunded: boolean
  // How much of this refund is tax, so the tax surfaces can net it. (M4)
  let refundedTaxThisTime = 0
  let refundedExciseThisTime = 0
  let refundedSalesThisTime = 0
  // What this order has left to give back, per component. Nothing below may exceed these. (T56 S2)
  const outstandingOf = (charged: unknown, refunded: unknown) =>
    Math.max(0, round2((Number(charged) || 0) - (Number(refunded) || 0)))
  const outstandingTax = outstandingOf(existing.taxAmount, existing.refundedTax)
  const outstandingExcise = outstandingOf(existing.exciseTax, (existing as any).refundedExciseTax)
  const outstandingSales = outstandingOf(existing.salesTax, (existing as any).refundedSalesTax)
  if (requestedAmount != null) {
    if (remainingRefundable <= 0) return c.json({ error: 'Nothing left to refund on this order' }, 400)
    if (requestedAmount > remainingRefundable + 0.005) {
      return c.json({
        error: `Cannot refund ${money(requestedAmount)} — only ${money(remainingRefundable)} of the ${money(orderTotal)} total remains refundable`,
        remainingRefundable, alreadyRefunded, orderTotal,
      }, 400)
    }
    refundAmount = round2(Math.min(requestedAmount, remainingRefundable))
    refundFraction = orderTotal > 0 ? Math.min(1, refundAmount / orderTotal) : 1
    fullyRefunded = round2(alreadyRefunded + refundAmount) + 0.005 >= orderTotal
    // A dollar refund returns money against no particular line, so its tax share is the order's own
    // tax at the same fraction — there is nothing more specific to go on. (M4)
    //
    // Of what is STILL OUTSTANDING, not of the original. (T56 S2) On the first refund these are the
    // same number; on a second one they are not, and taking the fraction of the original excise
    // again handed back tax that had already been handed back — ORD-1494 recorded $6.18 of sales tax
    // refunded on an order that only ever charged $6.00.
    const remainingFraction = remainingRefundable > 0 ? Math.min(1, refundAmount / remainingRefundable) : 1
    refundedTaxThisTime = round2(outstandingTax * remainingFraction)
    refundedExciseThisTime = round2(outstandingExcise * remainingFraction)
    refundedSalesThisTime = round2(outstandingSales * remainingFraction)
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
        refundAmount = remainingRefundable; refundFraction = orderTotal > 0 ? refundAmount / orderTotal : 1; fullyRefunded = true; refundedTaxThisTime = outstandingTax; refundedExciseThisTime = outstandingExcise; refundedSalesThisTime = outstandingSales
      } else {
        return c.json({ error: 'Nothing left to refund on this order' }, 400)
      }
    } else {
      // Refund the returned units' proportional share of the order total (carries their tax and
      // discount share); loyalty reverses on the same fraction below. Never exceed what is left.
      const orderSubtotal = Number(existing.subtotal) || 0
      const refundMerch = refundPlan.reduce((s, r) => s + Number(r.line.unitPrice) * r.qty, 0)
      refundFraction = orderSubtotal > 0 ? Math.min(1, refundMerch / orderSubtotal) : 1
      // Tax the units actually coming back, with the same arithmetic that charged them — NOT the
      // order's tax spread pro rata by value. Excise is cannabis-only, so a share of the whole
      // basket's tax is wrong in both directions: returning $40 of shatter from a $35 + $40 + $25
      // basket refunded $48.50 (40% of all tax) instead of $50.00, short-changing the customer on a
      // cannabis return — and returning the t-shirt would have handed back excise that was never
      // charged on it. (Dispensary T29 M2)
      //
      // The discount travels with the lines pro rata, which is how it was applied in the first place.
      const refundCannabisSubtotal = cannabisSubtotalOf(
        refundPlan.map(r => ({ taxCategory: r.line.taxCategory, lineTotal: Number(r.line.unitPrice) * r.qty })),
      )
      const orderDiscount = round2((Number(existing.discountAmount) || 0) + (Number(existing.loyaltyDiscount) || 0))
      const refundDiscountShare = orderSubtotal > 0 ? round2(orderDiscount * (refundMerch / orderSubtotal)) : 0
      const refundTaxed = assessTax({
        subtotal: refundMerch,
        cannabisSubtotal: refundCannabisSubtotal,
        discount: refundDiscountShare,
        rates: taxRatesFor(refundCompanyRow, { isMedical: (existing as any).isMedical }),
      })
      refundAmount = round2(Math.min(refundTaxed.grandTotal, remainingRefundable))
      refundedTaxThisTime = round2(Math.min(refundTaxed.totalTax, refundAmount))
      refundedExciseThisTime = refundTaxed.exciseTax
      refundedSalesThisTime = refundTaxed.salesTax
      const unitsAllBack = items.every(i => {
        const planned = refundPlan.find(r => r.line.id === i.id)?.qty || 0
        return Number(i.refundedQuantity || 0) + planned >= Number(i.quantity)
      })
      fullyRefunded = unitsAllBack || round2(alreadyRefunded + refundAmount) + 0.005 >= orderTotal
    }
  }

  /**
   * The parts add up to the whole, and neither part exceeds what was charged. (T56 S2)
   *
   * ORD-1494 took $5.25 excise and $6.00 sales. An itemised refund followed by a refund by amount
   * left the order recording $3.22 excise and $6.18 sales returned — more sales tax back than it
   * ever charged — against a refundedTax of $9.41 that matched neither figure. The three numbers
   * were written independently by two code paths and nothing made them agree.
   *
   * Every summary and every filing stayed correct because those recompute from the line items. What
   * was wrong is the ORDER's own record of what it gave back, and that is what a receipt, a customer
   * dispute and a chargeback are read from.
   */
  refundedExciseThisTime = Math.min(round2(refundedExciseThisTime), outstandingExcise)
  refundedSalesThisTime = Math.min(round2(refundedSalesThisTime), outstandingSales)
  {
    // Tax cannot exceed the money actually being returned, nor the tax still outstanding. When the
    // cap bites, both components give way in proportion rather than one absorbing all of it.
    const taxCap = Math.min(outstandingTax, round2(refundAmount))
    let parts = round2(refundedExciseThisTime + refundedSalesThisTime)
    if (parts > taxCap + 0.005) {
      const factor = parts > 0 ? taxCap / parts : 0
      refundedExciseThisTime = round2(refundedExciseThisTime * factor)
      refundedSalesThisTime = Math.max(0, round2(taxCap - refundedExciseThisTime))
      parts = round2(refundedExciseThisTime + refundedSalesThisTime)
    }
    refundedTaxThisTime = parts
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

  // The amount check above ran against an UNLOCKED read, so five refunds fired at the same instant
  // all saw refundedAmount 0, all passed, and all wrote — $75 refunded against a $25 order. Re-read
  // the order row inside the transaction with FOR UPDATE and re-validate: the lock serialises the
  // callers, and any that would push the cumulative refund past the total is rolled back. (money race)
  let raceReject: { status: number; body: any } | null = null
  try {
  await db.transaction(async (tx) => {
    const locked: any = await tx.execute(sql`SELECT refunded_amount, status FROM orders WHERE id = ${id} AND company_id = ${currentUser.companyId} FOR UPDATE`)
    const lr = (locked.rows || locked)[0]
    if (lr && !['completed', 'partially_refunded'].includes(String(lr.status))) {
      raceReject = { status: 400, body: { error: 'This order was just refunded by another action — nothing left to refund.' } }
      throw new Error('__REFUND_RACE__')
    }
    const lockedRefunded = round2(Number(lr?.refunded_amount ?? 0) || 0)
    if (round2(lockedRefunded + refundAmount) > orderTotal + 0.005) {
      const remain = round2(Math.max(0, orderTotal - lockedRefunded))
      raceReject = { status: 400, body: { error: `Cannot refund ${money(refundAmount)} — only ${money(remain)} of the ${money(orderTotal)} total remains refundable`, remainingRefundable: remain, alreadyRefunded: lockedRefunded, orderTotal } }
      throw new Error('__REFUND_RACE__')
    }

    // CLAIM the units before any money moves. The bound is in the WHERE, so the check and the write
    // are a single statement: a second refund for the same line blocks here, re-reads the committed
    // refunded_quantity, and matches no row. Nothing is pro-rated against a quantity somebody else
    // already took. (Dispensary T32 B2)
    for (const r of refundPlan) {
      const claimed: any = await tx.execute(sql`
        UPDATE order_items
        SET refunded_quantity = COALESCE(refunded_quantity, 0) + ${r.qty}
        WHERE id = ${r.line.id}
          AND COALESCE(refunded_quantity, 0) + ${r.qty} <= quantity
        RETURNING id
      `)
      if (!((claimed.rows || claimed)?.length > 0)) {
        raceReject = { status: 409, body: {
          error: `${r.line.productName || 'That item'} was just returned by another action — the units you asked for are no longer outstanding. Reload the order and try again.`,
          code: 'refund_units_taken', orderItemId: r.line.id, requested: r.qty,
        } }
        throw new Error('__REFUND_RACE__')
      }
    }

    // Order status follows how much has been returned: fully refunded closes it; a partial keeps
    // the order alive as 'partially_refunded' so the rest still stands. Cumulative $ is tracked.
    await tx.update(order).set({
      // the drawer this money left, so the close-out expects the shortfall (T44)
      ...(refundCashSessionId ? { refundCashSessionId } : {}),
      status: fullyRefunded ? 'refunded' : 'partially_refunded',
      paymentStatus: fullyRefunded ? 'refunded' : 'partially_refunded',
      refundedAmount: sql`(COALESCE(NULLIF(refunded_amount, ''), '0')::numeric + ${refundAmount})::text`,
      // Tax handed back, accumulated the same way, so the tax surfaces can net it. (M4)
      refundedTax: sql`(COALESCE(NULLIF(refunded_tax, ''), '0')::numeric + ${refundedTaxThisTime})::text`,
      refundedExciseTax: sql`(COALESCE(NULLIF(refunded_excise_tax, ''), '0')::numeric + ${refundedExciseThisTime})::text`,
      refundedSalesTax: sql`(COALESCE(NULLIF(refunded_sales_tax, ''), '0')::numeric + ${refundedSalesThisTime})::text`,
      refundReason: data.reason,
      refundedBy: currentUser.userId,
      refundedAt: new Date(),
      updatedAt: new Date(),
    } as any).where(eq(order.id, id))

    // Restore inventory for the returned units — only if the sale actually decremented it. (F1)
    //
    // completedAt is the marker, and it is the right one: BOTH settlement paths set it and both
    // decrement (POST /complete, and PUT /:id/status when nowCompleting). The parenthetical that
    // used to sit here said a status-flow "completed" never decremented, which stopped being true
    // when that path was taught to move inventory — worth correcting, because the next person to
    // read it would conclude this restore was over-restoring when it is in fact balanced.
    if (data.restoreInventory && existing.completedAt) {
      for (const r of refundPlan) {
        if (!r.line.productId) continue
        await tx.update(product).set({
          stockQuantity: sql`${product.stockQuantity} + ${r.qty}`,
          updatedAt: new Date(),
        } as any).where(eq(product.id, r.line.productId))

        // …and back into the BATCH the units were sold out of. (T41)
        //
        // /complete decrements both the product and the batch (see the sale loop above), and this
        // restore only ever put the product back. So every return quietly shrank the lot's recorded
        // remaining quantity for good: sell 5 from a batch of 20 and take all 5 back, and the batch
        // reads 15 with 20 on the shelf. That gap is the number a recall is answered with — the same
        // figure T46 N14 was raised about from the other direction — so it is a compliance error,
        // not a reporting one, and it compounds with every return.
        //
        // Capped so a return can never inflate a lot past what it held: LEAST(current + qty, …).
        // The ceiling is GREATEST(initial_quantity, current_quantity), not initial_quantity alone,
        // because a manual count correction (batches.ts /deplete) can legitimately set current above
        // initial, and clamping to initial there would destroy that correction. Where the sale had
        // floored a drifted batch at 0, the units still come back — losing them silently would be
        // the same class of error in the other direction.
        //
        // Status is deliberately left alone: the sale loop does not mark a batch depleted when it
        // reaches 0 either (only batches.ts does, explicitly), so there is nothing to reverse.
        if ((r.line as any).batchId) {
          await tx.execute(sql`
            UPDATE batches
            SET current_quantity = LEAST(
                  COALESCE(current_quantity, 0) + ${r.qty},
                  GREATEST(initial_quantity, COALESCE(current_quantity, 0))
                ),
                updated_at = NOW()
            WHERE id = ${(r.line as any).batchId} AND company_id = ${currentUser.companyId}
          `)
        }
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
      // Points SPENT on the order come back with it. Only the earned side was ever reversed, so a
      // $5-off reward bought with 500 points and then returned cost the customer the 500 points AND
      // the reward: the 30 points the sale earned were taken back correctly, and the 500 they had
      // paid simply stayed spent. Returned on the same fraction as everything else, so repeated
      // partial refunds give back exactly what was redeemed and no more. (Dispensary T29 M3)
      //
      // Balance only: the redemption never added to lifetime/earned totals, so returning it must not
      // either — that would inflate the tier ladder with points the customer was given back.
      const pointsToReturn = Math.round((Number(existing.loyaltyPointsRedeemed) || 0) * refundFraction)
      const visitDelta = fullyRefunded ? 1 : 0
      await tx.execute(sql`
        UPDATE loyalty_members
        SET points_balance = GREATEST(0, COALESCE(points_balance::numeric, 0) - ${pointsToReverse} + ${pointsToReturn}),
            total_points_earned = GREATEST(0, COALESCE(total_points_earned::numeric, 0) - ${pointsToReverse}),
            lifetime_points = GREATEST(0, COALESCE(lifetime_points, 0) - ${pointsToReverse}),
            total_visits = GREATEST(0, COALESCE(total_visits::numeric, 0) - ${visitDelta}),
            total_spent = GREATEST(0, COALESCE(total_spent::numeric, 0) - ${refundAmount}),
            updated_at = NOW()
        WHERE contact_id = ${existing.contactId}
          AND company_id = ${currentUser.companyId}
      `)

      // The reversal row goes in FIRST: the tier is summed from the ledger, so a claw-back that has
      // not been written yet is invisible to the recompute and the demotion would land one refund
      // late.
      await tx.execute(sql`
        INSERT INTO loyalty_transactions(id, member_id, type, points, balance_after, order_id, description, company_id, created_at)
        SELECT gen_random_uuid(), lm.id, 'reversal', ${-pointsToReverse}, COALESCE(lm.points_balance::numeric, 0), ${id}, ${'Refund ' + existing.number + ': ' + data.reason}, ${currentUser.companyId}, NOW()
        FROM loyalty_members lm
        WHERE lm.contact_id = ${existing.contactId} AND lm.company_id = ${currentUser.companyId}
      `)

      // Re-evaluate tier against the reduced window so a refund can demote — otherwise a customer
      // keeps a tier earned entirely from returned goods. (retest#10)
      await recomputeTier(tx, currentUser.companyId, { contactId: existing.contactId })
    }
  })
  } catch (e: any) {
    if (e?.message === '__REFUND_RACE__' && raceReject) return c.json((raceReject as any).body, (raceReject as any).status)
    throw e
  }

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
    req: c,
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
      <td style="text-align:right">${money(Number(item.unitPrice))}</td>
      <td style="text-align:right">${money(Number(item.lineTotal))}</td>
    </tr>
  `).join('')

  // Settings → Receipts saves a header, a footer and a show-logo switch, and nothing read any of
  // them: every receipt said "Receipt" and "Thank you for your visit!" whatever the shop had typed.
  // A settings screen that stores a value nothing uses is a promise the product does not keep. (T45 BL3)
  const [receiptCo] = await db.select({ name: company.name, logo: company.logo, settings: company.settings, address: company.address, city: company.city, state: company.state, zip: company.zip, phone: company.phone })
    .from(company).where(eq(company.id, currentUser.companyId)).limit(1)
  const receiptCfg = ((receiptCo?.settings as any) || {}).receipts || {}
  const headerText = String(receiptCfg.headerText || '').trim()
  const footerText = String(receiptCfg.footerText || '').trim()
  const showLogo = receiptCfg.showLogo !== false && !!receiptCo?.logo
  const shopLines = [
    receiptCo?.address,
    [receiptCo?.city, receiptCo?.state, receiptCo?.zip].filter(Boolean).join(' '),
    receiptCo?.phone,
  ].filter((l) => String(l || '').trim())

  // The time on the receipt is the time at the SHOP.
  //
  // T46 N15: it printed 8:46:46 PM for a sale the order page showed at 4:46:46 PM — the server's
  // clock, which on Render is UTC. The customer's copy and the shop's own screen disagreed about
  // when the sale happened by four hours, and the receipt is the half the customer keeps. The zone
  // is named on it so nobody has to work out which clock it is. (T45 M24 fixed the screens; this is
  // the piece of paper.)
  const receiptZone = storeTimeZone(receiptCo)
  const receiptTime = (() => {
    const d = new Date(foundOrder.createdAt as any)
    if (Number.isNaN(d.getTime())) return ''
    try {
      return d.toLocaleString('en-US', { timeZone: receiptZone, timeZoneName: 'short' })
    } catch {
      return d.toLocaleString('en-US')
    }
  })()

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
  .logo { display: block; margin: 0 auto 8px; max-height: 64px; }
  .shop { text-align: center; margin-bottom: 8px; }
  .custom { text-align: center; white-space: pre-wrap; margin: 8px 0; }
</style></head>
<body>
  ${showLogo ? `<img class="logo" src="${escapeHtml(String(receiptCo!.logo))}" alt="">` : ''}
  <h2>${escapeHtml(receiptCo?.name || 'Receipt')}</h2>
  ${shopLines.length ? `<div class="shop">${shopLines.map((l) => escapeHtml(String(l))).join('<br>')}</div>` : ''}
  ${headerText ? `<div class="custom">${escapeHtml(headerText)}</div>` : ''}
  <div class="info">
    Order: ${escapeHtml(foundOrder.number)}<br>
    Date: ${escapeHtml(receiptTime)}<br>
    Type: ${escapeHtml(foundOrder.type)}${(foundOrder as any).isMedical ? ' (Medical)' : ''}
  </div>
  <table>
    <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Total</th></tr></thead>
    <tbody>${itemRows}</tbody>
  </table>
  <table class="totals">
    <tr><td>Subtotal</td><td style="text-align:right">${money(Number(foundOrder.subtotal))}</td></tr>
    <tr><td>Excise Tax</td><td style="text-align:right">${money(Number((foundOrder as any).exciseTax || 0))}</td></tr>
    <tr><td>Sales Tax</td><td style="text-align:right">${money(Number((foundOrder as any).salesTax || 0))}</td></tr>
    ${Number((foundOrder as any).discountAmount) > 0 ? `<tr><td>Discount</td><td style="text-align:right">-${money(Number((foundOrder as any).discountAmount))}</td></tr>` : ''}
    <tr class="grand-total"><td>Total</td><td style="text-align:right">${money(Number(foundOrder.total))}</td></tr>
    ${(foundOrder as any).paymentMethod === 'cash' && (foundOrder as any).cashTendered ? `
    <tr><td>Cash Tendered</td><td style="text-align:right">${money(Number((foundOrder as any).cashTendered))}</td></tr>
    <tr><td>Change Due</td><td style="text-align:right">${money(Number((foundOrder as any).changeDue || 0))}</td></tr>
    ` : ''}
  </table>
  <div class="footer">
    Payment: ${escapeHtml((foundOrder as any).paymentMethod || 'N/A')}<br>
    ${footerText ? escapeHtml(footerText).replace(/\n/g, '<br>') : 'Thank you for your visit!<br>This receipt is for your records.'}
  </div>
  <script>
    // Opened to be printed. The dialog is what the till operator asked for when they pressed the
    // button, so it opens by itself; ?print=0 is there for anyone wanting to read it on screen.
    if (!location.search.includes('print=0')) window.addEventListener('load', () => window.print())
  </script>
</body></html>`

  return c.html(html)
})

export default app
