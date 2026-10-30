// The store add-on: the catalogue (products, their images and variants), orders with their lines and refunds, discount
// codes, product reviews, the commerce settings, and the merchant's own payment, shipping and supplier connections.
// Column for column from templates/crm-store/backend/db/schema.ts (docs/UNIFIED_STORE_PLAN.md decision 3), with the
// unified rules applied: text ids (the store's uuids move across as text), `company_id` on every top-level record,
// `json` for `jsonb`, `timestamp` (UTC) for `timestamptz`, text for the template's three enums. Money stays integer
// cents in columns named `*_cents`, tax in basis points, as the store keeps it.
//
// Not here, because the unified app already has them: the business (`company`: name, email, onboarding, and in its
// settings the subscription and the loyalty programme's rules), the people who sign in (`user`), a shopper (`contact` —
// decision 2: checkout finds or makes the contact, and the order carries contact_id), loyalty (the shared
// loyalty_members / _transactions / _rewards, by contact), email aliases, inbound mail, Google Business, the audit log
// and two-factor sign-in.
import { pgTable, text, integer, boolean, timestamp, json, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company } from './core.ts'
import { contact } from './crm.ts'

export type StoreAddress = { line1: string; line2?: string; city: string; state: string; postalCode: string; country: string }
/** A ship-to region's rate: matches when the buyer's country (and state, if listed) is covered; first match wins. */
export type ShippingZone = { name: string; countries: string[]; states: string[]; rateCents: number; freeThresholdCents?: number | null }
export type TaxRate = { country: string; state: string; rateBps: number }
/** The units one refund covers. */
export type RefundLine = { orderItemId: string; quantity: number }

// ── Catalogue ────────────────────────────────────────────────────────────────
export const storeProduct = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  description: text('description'),
  status: text('status').notNull().default('draft'), // draft | active | archived
  featured: boolean('featured').notNull().default(false),
  leadTimeDays: integer('lead_time_days'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  position: integer('position').notNull().default(0),
  /** physical | gift_card — a gift card is sold as a product and emailed as a code when the order is paid. */
  kind: text('kind').notNull().default('physical'),
  /** The product feeds' brand and condition (Google Merchant Center, Meta); the store's name stands in for no brand. */
  brand: text('brand'),
  condition: text('condition').notNull().default('new'), // new | refurbished | used
  /** Groups the shop's products: "You may also like" falls back to the same category. */
  category: text('category'),
  /** The owner's own picks for "Frequently bought together" and "You may also like" (product ids, in order). */
  boughtTogetherIds: json('bought_together_ids').$type<string[]>(),
  alsoLikeIds: json('also_like_ids').$type<string[]>(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('products_company_slug_unique').on(t.companyId, t.slug),
  index('products_company_id_idx').on(t.companyId),
  // The storefront's catalogue: the company's active products, in the shop's order.
  index('products_company_status_position_idx').on(t.companyId, t.status, t.position),
])

export const storeProductImage = pgTable('product_images', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => storeProduct.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  alt: text('alt'),
  position: integer('position').notNull().default(0),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [index('product_images_product_idx').on(t.productId)])

export const storeProductVariant = pgTable('product_variants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => storeProduct.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  compareAtPriceCents: integer('compare_at_price_cents'),
  weightOz: integer('weight_oz'),
  inventoryQty: integer('inventory_qty'), // null = not tracked
  /** Low-stock level (store_low_stock): at or under it, the option is on the Low stock list and the owner's daily email. null = no level. */
  lowStockAt: integer('low_stock_at'),
  /** What one unit costs the shop (the owner types it; margin:read sees it). Sales reports work profit out from it; null = no cost. */
  costCents: integer('cost_cents'),
  /** The feeds' identifiers, sent when present. */
  gtin: text('gtin'),
  mpn: text('mpn'),
  options: json('options').$type<Record<string, string>>(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // One business per database (SPEC §2), so a SKU is unique in it, as the template held it.
  uniqueIndex('product_variants_sku_unique').on(t.sku),
  index('product_variants_product_idx').on(t.productId),
])

// ── Orders ───────────────────────────────────────────────────────────────────
export const storeOrder = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  /** The shopper (decision 2): found by email or made at checkout. The order keeps its own snapshot of who and where. */
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  orderNumber: text('order_number'), // given when the order is paid
  provider: text('provider').notNull(), // stripe | square | paypal
  providerSessionId: text('provider_session_id').notNull(),
  providerPaymentId: text('provider_payment_id'),
  status: text('status').notNull().default('pending'), // pending | paid | fulfilled | shipped | delivered | cancelled | refunded
  refundPendingAt: timestamp('refund_pending_at'),
  refundId: text('refund_id'),
  refundedAt: timestamp('refunded_at'),
  refundError: text('refund_error'),
  refundedCents: integer('refunded_cents').notNull().default(0),
  customerEmail: text('customer_email').notNull(),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  shippingAddress: json('shipping_address').$type<StoreAddress>(),
  billingAddress: json('billing_address').$type<StoreAddress>(),
  supplierOrderId: text('supplier_order_id'),
  supplierStatus: text('supplier_status'), // placed | error | unmapped | hold | shipped
  supplierCostCents: integer('supplier_cost_cents'),
  supplierError: text('supplier_error'),
  subtotalCents: integer('subtotal_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull().default('usd'),
  discountCode: text('discount_code'),
  loyaltyRewardId: text('loyalty_reward_id'),
  loyaltyDiscountCents: integer('loyalty_discount_cents').notNull().default(0),
  customerNote: text('customer_note'),
  internalNote: text('internal_note'),
  fulfilledAt: timestamp('fulfilled_at'),
  trackingCarrier: text('tracking_carrier'),
  trackingNumber: text('tracking_number'),
  recoveryToken: text('recovery_token'),
  abandonedEmailSentAt: timestamp('abandoned_email_sent_at'),
  recoveredAt: timestamp('recovered_at'),
  reviewRequestSentAt: timestamp('review_request_sent_at'),
  labelUrl: text('label_url'),
  labelCostCents: integer('label_cost_cents'),
  labelPurchasedAt: timestamp('label_purchased_at'),
  /** ship | pickup | digital (gift cards only: nothing to send). A pickup order is never shipped, nor a shipped one picked up. */
  fulfillment: text('fulfillment').notNull().default('ship'),
  /** storefront | draft (made by the owner for a customer, paid from the emailed link). */
  source: text('source').notNull().default('storefront'),
  /** Tax worked out by Stripe Tax at checkout (filled from the paid session), not the store's flat rate. */
  taxAutomatic: boolean('tax_automatic').notNull().default(false),
  /** A gift card the shopper paid part (or all) of this order with: what was taken off it, and what has gone back. */
  giftCardId: text('gift_card_id'),
  giftCardCents: integer('gift_card_cents').notNull().default(0),
  giftCardRefundedCents: integer('gift_card_refunded_cents').notNull().default(0),
  /** The customer group whose prices this order was made at (a wholesale customer's draft order). */
  customerGroupId: text('customer_group_id'),
  /** A chargeback's state at the provider (needs_response, under_review, won, lost ...); null when there is none. */
  disputeStatus: text('dispute_status'),
  readyForPickupAt: timestamp('ready_for_pickup_at'),
  pickedUpAt: timestamp('picked_up_at'),
  /** The QuickBooks sales receipt this paid order became (store/books.ts): set once it is sent, so it is never sent twice. */
  qbSalesReceiptId: text('qb_sales_receipt_id'),
  qbSyncedAt: timestamp('qb_synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  // One order per provider checkout session: a retried webhook finds the order instead of making a second.
  uniqueIndex('orders_provider_session_unique').on(t.provider, t.providerSessionId),
  uniqueIndex('orders_order_number_unique').on(t.orderNumber),
  index('orders_company_id_idx').on(t.companyId),
  index('orders_contact_id_idx').on(t.contactId),
  index('orders_status_idx').on(t.status),
  index('orders_created_idx').on(t.createdAt),
  // A refund or dispute notice finds its order by the payment's id.
  index('orders_provider_payment_idx').on(t.providerPaymentId),
])

/** A line, with the product as it was when bought: a later catalogue edit never rewrites an order. */
export const storeOrderItem = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => storeOrder.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => storeProduct.id, { onDelete: 'set null' }),
  variantId: text('variant_id').references(() => storeProductVariant.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(),
  variantName: text('variant_name').notNull(),
  sku: text('sku').notNull(),
  imageUrl: text('image_url'),
  unitPriceCents: integer('unit_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
  refundedQuantity: integer('refunded_quantity').notNull().default(0),
  /** The option's cost when this was bought (a later cost edit never rewrites a sale's profit); null = it had none. */
  unitCostCents: integer('unit_cost_cents'),
}, (t) => [index('order_items_order_idx').on(t.orderId)])

/**
 * One refund of part of an order or the rest of it, written 'pending' (the order's refunded_cents and the lines'
 * refunded_quantity already reserved) before the provider is asked, so an interrupted refund is finished with the same
 * idempotency key, never sent twice. status: pending → refunded | recorded | failed.
 */
export const storeOrderRefund = pgTable('order_refunds', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => storeOrder.id, { onDelete: 'cascade' }),
  amountCents: integer('amount_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  items: json('items').$type<RefundLine[]>().notNull().default([]),
  restock: boolean('restock').notNull().default(false),
  reason: text('reason'),
  status: text('status').notNull().default('pending'),
  moneyBack: text('money_back'),
  providerRefundId: text('provider_refund_id'),
  error: text('error'),
  createdBy: text('created_by'),
  createdByName: text('created_by_name'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  settledAt: timestamp('settled_at'),
  /** The QuickBooks refund receipt this refund became (store/books.ts). */
  qbRefundReceiptId: text('qb_refund_receipt_id'),
  /** How much of amount_cents went back as store credit (a gift card) rather than to the card it was paid with. */
  creditCents: integer('credit_cents').notNull().default(0),
}, (t) => [index('order_refunds_order_idx').on(t.orderId)])

export type ReturnLine = { orderItemId: string; quantity: number }

/**
 * A return (store_returns): a shopper or staff member asks to send some of an order back. requested → approved | declined
 * → received → refunded | exchanged (or cancelled by the shopper before it is decided). The money is NOT here: a refund
 * goes through the order's refund machinery (order_refunds, refund_row_id) and an exchange makes a new order
 * (exchange_order_id) that costs nothing.
 */
export const storeReturn = pgTable('store_returns', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull().references(() => storeOrder.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  returnNumber: text('return_number').notNull(),
  status: text('status').notNull().default('requested'),
  /** shopper | staff */
  startedBy: text('started_by').notNull().default('shopper'),
  startedByName: text('started_by_name'),
  /** refund | exchange */
  resolution: text('resolution').notNull().default('refund'),
  /** defective | wrong_item | not_as_described | changed_mind | other */
  reason: text('reason').notNull().default('other'),
  note: text('note'),
  /** An exchange: what the shopper would like instead, in their words. */
  wanted: text('wanted'),
  /** The shopper would rather have store credit than the card refunded. */
  preferCredit: boolean('prefer_credit').notNull().default(false),
  staffNote: text('staff_note'),
  declineReason: text('decline_reason'),
  items: json('items').$type<ReturnLine[]>().notNull().default([]),
  /** Started after the return window closed, by a staff member who allowed it. */
  late: boolean('late').notNull().default(false),
  /** Worked out at approval and kept: what the goods were worth, what the shop keeps, what goes back and how. */
  lineValueCents: integer('line_value_cents').notNull().default(0),
  restockingFeeCents: integer('restocking_fee_cents').notNull().default(0),
  returnShippingFeeCents: integer('return_shipping_fee_cents').notNull().default(0),
  refundCents: integer('refund_cents').notNull().default(0),
  creditCents: integer('credit_cents').notNull().default(0),
  labelUrl: text('label_url'),
  labelTracking: text('label_tracking'),
  labelCarrier: text('label_carrier'),
  labelCostCents: integer('label_cost_cents'),
  labelClaimedAt: timestamp('label_claimed_at'),
  /** The order_refunds row that sent the money back, and the order an exchange made. */
  refundRowId: text('refund_row_id'),
  exchangeOrderId: text('exchange_order_id'),
  decidedAt: timestamp('decided_at'),
  decidedByName: text('decided_by_name'),
  receivedAt: timestamp('received_at'),
  receivedByName: text('received_by_name'),
  /** The units went back on the shelf when the parcel was received (not when the money went back). */
  restockedAt: timestamp('restocked_at'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('store_returns_company_number_unique').on(t.companyId, t.returnNumber),
  index('store_returns_order_idx').on(t.orderId),
  index('store_returns_company_status_idx').on(t.companyId, t.status),
])

/**
 * What the store's books need QuickBooks to know that QuickBooks does not hold itself (store/books.ts): the bank account
 * the payouts land in (the owner's choice) and the accounts and items the store made or found in QuickBooks, by name,
 * so each is looked up once. One row per company.
 */
export const storeBooks = pgTable('store_books', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  bankAccountId: text('bank_account_id'),
  bankAccountName: text('bank_account_name'),
  refs: json('refs').$type<Record<string, string>>().notNull().default({}),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('store_books_company_unique').on(t.companyId)])

/**
 * One Stripe payout as the books saw it: what Stripe paid into the bank, the fees taken out of it, and the QuickBooks
 * deposit made for it (so it matches the bank's line). `lines` is what was in it, for the owner to read.
 */
export const storePayout = pgTable('store_payouts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  providerPayoutId: text('provider_payout_id').notNull(),
  amountCents: integer('amount_cents').notNull(),
  feeCents: integer('fee_cents').notNull().default(0),
  arrivedAt: timestamp('arrived_at').notNull(),
  lines: json('lines').$type<unknown[]>().notNull().default([]),
  qbDepositId: text('qb_deposit_id'),
  qbSyncedAt: timestamp('qb_synced_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('store_payouts_company_payout_unique').on(t.companyId, t.providerPayoutId)])

// ── Marketing ────────────────────────────────────────────────────────────────
export const discountCode = pgTable('discount_codes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  code: text('code').notNull(), // stored upper case
  type: text('type').notNull(), // percent | fixed
  value: integer('value').notNull(), // percent (1-100) or cents
  active: boolean('active').notNull().default(true),
  minSubtotalCents: integer('min_subtotal_cents').notNull().default(0),
  maxUses: integer('max_uses'), // null = no limit
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('discount_codes_company_code_unique').on(t.companyId, t.code),
])

/** Shown publicly only once approved (pending | approved | rejected); "verified" means it came from a real order. */
export const productReview = pgTable('product_reviews', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => storeProduct.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => storeOrder.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email'),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  status: text('status').notNull().default('pending'),
  verifiedPurchase: boolean('verified_purchase').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('product_reviews_company_id_idx').on(t.companyId),
  index('product_reviews_product_idx').on(t.productId),
  index('product_reviews_status_idx').on(t.status),
])

// ── Settings and connections ─────────────────────────────────────────────────
/**
 * The store's commerce settings, one row per company. The template's store_settings also held the business — its name,
 * support email, onboarding, subscription and loyalty rules — which are the company row's here (decision 1).
 */
export const storeSettings = pgTable('store_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  currency: text('currency').notNull().default('usd'),
  flatShippingCents: integer('flat_shipping_cents').notNull().default(0),
  freeShippingThresholdCents: integer('free_shipping_threshold_cents'),
  taxRateBps: integer('tax_rate_bps').notNull().default(0), // 725 = 7.25%
  shippingZones: json('shipping_zones').$type<ShippingZone[]>(),
  taxRates: json('tax_rates').$type<TaxRate[]>(),
  abandonedCartEnabled: boolean('abandoned_cart_enabled').notNull().default(true),
  abandonedCartDelayMinutes: integer('abandoned_cart_delay_minutes').notNull().default(60),
  reviewsEnabled: boolean('reviews_enabled').notNull().default(true),
  reviewRequestDays: integer('review_request_days').notNull().default(7),
  /** Sales tax by the shopper's address, worked out by Stripe Tax at checkout (Stripe only). Off: the rates above. */
  stripeTaxEnabled: boolean('stripe_tax_enabled').notNull().default(false),
  /** Local pickup: offered at checkout with no shipping charge, at this address and these hours. */
  pickupEnabled: boolean('pickup_enabled').notNull().default(false),
  pickupAddress: text('pickup_address'),
  pickupHours: text('pickup_hours'),
  /** The private part of the product feeds' addresses (Google Merchant Center, Meta); a new one retires the old. */
  feedToken: text('feed_token'),
  /** The shop-local day (YYYY-MM-DD) the owner's low-stock email last went out: the claim that keeps it to one a day. */
  lowStockDigestOn: text('low_stock_digest_on'),
  /** The return rule (store_returns): days after the order shipped (else was placed) that a return may be started. */
  returnWindowDays: integer('return_window_days').notNull().default(30),
  /** Kept from the goods' value on a return, in basis points (1000 = 10%); not kept when the return is the shop's fault. */
  restockingFeeBps: integer('restocking_fee_bps').notNull().default(0),
  /** Kept for the return postage; not kept when the return is the shop's fault. */
  returnShippingFeeCents: integer('return_shipping_fee_cents').notNull().default(0),
  /** Buy the shopper a prepaid return label (EasyPost) when a return is approved. */
  returnLabels: boolean('return_labels').notNull().default(false),
  /** May a signed-in shopper start a return themselves? Off: only staff start them. */
  shopperReturns: boolean('shopper_returns').notNull().default(true),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('store_settings_company_unique').on(t.companyId)])

/** The merchant's own payment account. Credentials encrypted at rest (AES-GCM); never sent to a browser. */
export const paymentConfig = pgTable('payment_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // stripe | square | paypal
  mode: text('mode').notNull().default('test'), // test | live
  credentialsEnc: text('credentials_enc').notNull(),
  webhookSecretEnc: text('webhook_secret_enc'),
  publishableKey: text('publishable_key'),
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('payment_config_company_id_idx').on(t.companyId)])

/** The label carrier (EasyPost). A store with none enters tracking numbers by hand. */
export const shippingConfig = pgTable('shipping_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // easypost
  mode: text('mode').notNull().default('test'),
  credentialsEnc: text('credentials_enc').notNull(),
  fromAddress: json('from_address').$type<StoreAddress & { name?: string; phone?: string }>(),
  defaultParcel: json('default_parcel').$type<{ lengthIn: number; widthIn: number; heightIn: number; weightOz: number }>(),
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('shipping_config_company_id_idx').on(t.companyId)])

/** The dropship supplier (Printful or CJ). */
export const supplierConfig = pgTable('supplier_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  provider: text('provider').notNull(), // printful | cj
  mode: text('mode').notNull().default('test'),
  credentialsEnc: text('credentials_enc').notNull(),
  autoForward: boolean('auto_forward').notNull().default(true),
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [index('supplier_config_company_id_idx').on(t.companyId)])

/** Our variant → the supplier's. An order forwards only when every line has one (never part of an order). */
export const variantSupplierMap = pgTable('variant_supplier_map', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  variantId: text('variant_id').notNull().references(() => storeProductVariant.id, { onDelete: 'cascade' }),
  supplierVariantRef: text('supplier_variant_ref').notNull(),
  supplierItemName: text('supplier_item_name'),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('variant_supplier_map_variant_unique').on(t.variantId)])

// -- Wholesale: customer groups ------------------------------------------------
/** A group of customers with their own prices: a percent off the whole catalogue, and/or a price per variant. */
export const storeCustomerGroup = pgTable('store_customer_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  percentOff: integer('percent_off').notNull().default(0), // 0-100, on any variant without its own group price
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [uniqueIndex('store_customer_groups_company_name_unique').on(t.companyId, t.name)])

/** A customer (contact) in a group. One group per customer. */
export const storeCustomerGroupMember = pgTable('store_customer_group_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  groupId: text('group_id').notNull().references(() => storeCustomerGroup.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('store_customer_group_members_contact_unique').on(t.contactId),
  index('store_customer_group_members_group_idx').on(t.groupId),
])

/** A group's own price for one variant: wins over the group's percent off. */
export const storeGroupPrice = pgTable('store_group_prices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  groupId: text('group_id').notNull().references(() => storeCustomerGroup.id, { onDelete: 'cascade' }),
  variantId: text('variant_id').notNull().references(() => storeProductVariant.id, { onDelete: 'cascade' }),
  priceCents: integer('price_cents').notNull(),
}, (t) => [uniqueIndex('store_group_prices_group_variant_unique').on(t.groupId, t.variantId)])

// -- Disputes (chargebacks) ----------------------------------------------------
/** A chargeback the provider told us about (Stripe's charge.dispute.*), kept as the provider last described it. */
export const storeDispute = pgTable('store_disputes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  orderId: text('order_id').references(() => storeOrder.id, { onDelete: 'set null' }),
  provider: text('provider').notNull(),
  providerDisputeId: text('provider_dispute_id').notNull(),
  providerPaymentId: text('provider_payment_id'),
  amountCents: integer('amount_cents').notNull(),
  currency: text('currency').notNull().default('usd'),
  reason: text('reason'),
  status: text('status').notNull(),
  livemode: boolean('livemode').notNull().default(false),
  evidenceDueBy: timestamp('evidence_due_by'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('store_disputes_provider_dispute_unique').on(t.provider, t.providerDisputeId),
  index('store_disputes_company_idx').on(t.companyId),
])

// ── Shopper accounts ─────────────────────────────────────────────────────────
// A shopper signs in with an emailed link or code (crm/store/accounts). Their session is NOT the staff session: its own
// cookie, its own table, and it reaches only the shopper's own orders and addresses.

/**
 * One emailed sign-in: a link's token and a short code, both kept only as keyed hashes, good for 15 minutes, used once.
 * `attempts` counts wrong codes: after five the sign-in is spent and a new one must be asked for.
 */
export const shopperLogin = pgTable('shopper_logins', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  codeHash: text('code_hash').notNull(),
  attempts: integer('attempts').notNull().default(0),
  expiresAt: timestamp('expires_at').notNull(),
  consumedAt: timestamp('consumed_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('shopper_logins_token_unique').on(t.tokenHash),
  index('shopper_logins_contact_idx').on(t.contactId, t.createdAt),
])

/** A signed-in shopper's browser: the cookie holds a random token, this holds its hash. Ending it signs the browser out. */
export const shopperSession = pgTable('shopper_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('shopper_sessions_token_unique').on(t.tokenHash),
  index('shopper_sessions_contact_idx').on(t.contactId),
])

/** An address a shopper saved on their account. */
export const shopperAddress = pgTable('shopper_addresses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  label: text('label'),
  name: text('name').notNull(),
  phone: text('phone'),
  address: json('address').$type<StoreAddress>().notNull(),
  isDefault: boolean('is_default').notNull().default(false),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('shopper_addresses_contact_idx').on(t.contactId)])

/**
 * One request to an AI drafting tool, kept for an hour's worth of counting (server/crm/aiUse.ts): the product writer's cap per
 * company. `feature` names the tool, so the next catalog to get a writer (pricebook, a salon's menu) shares the one counter's
 * code, with a count of its own. Rows older than a day are swept as new ones are added.
 */
export const aiDraftUse = pgTable('ai_draft_uses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  feature: text('feature').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [index('ai_draft_uses_company_idx').on(t.companyId, t.feature, t.createdAt)])
