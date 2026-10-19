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
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  uniqueIndex('products_company_slug_unique').on(t.companyId, t.slug),
  index('products_company_id_idx').on(t.companyId),
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
}, (t) => [index('order_refunds_order_idx').on(t.orderId)])

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
