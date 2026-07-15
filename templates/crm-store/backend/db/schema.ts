// crm-store — tenant e-commerce back-office schema (Drizzle / Postgres).
//
// Source of truth for the tenant's catalog + orders. The public storefront
// (website-store) only READS the active catalog and POSTs checkout requests to
// this backend's public API; it never touches this DB directly.
//
// Design notes carried over from the proven breakerdisplays schema:
//  - order_items snapshot product/variant fields at purchase time, so later
//    catalog edits/deletes never rewrite order history.
//  - unique index on (provider, provider_session_id) makes order creation
//    idempotent against duplicate/retried payment webhooks.
// Generalized here for the factory:
//  - Stripe-specific columns → provider-agnostic (provider + provider_session_id
//    + provider_payment_id) so the same schema serves Stripe / Square / PayPal.
//  - payment_config holds the merchant's OWN provider credentials, ENCRYPTED at
//    rest (never returned to the storefront/client).
import {
  pgTable, pgEnum, uuid, text, integer, boolean, timestamp, jsonb,
  index, uniqueIndex,
} from 'drizzle-orm/pg-core'

// ── Enums ───────────────────────────────────────────────────────────────────
export const productStatusEnum = pgEnum('product_status', ['draft', 'active', 'archived'])
export const orderStatusEnum = pgEnum('order_status', [
  'pending', 'paid', 'fulfilled', 'shipped', 'delivered', 'cancelled', 'refunded',
])
export const paymentProviderEnum = pgEnum('payment_provider', ['stripe', 'square', 'paypal'])

// ── Catalog ─────────────────────────────────────────────────────────────────
export const products = pgTable('products', {
  id: uuid('id').primaryKey().defaultRandom(),
  slug: text('slug').notNull(),
  name: text('name').notNull(),
  tagline: text('tagline'),
  description: text('description'),
  status: productStatusEnum('status').notNull().default('draft'),
  featured: boolean('featured').notNull().default(false),
  leadTimeDays: integer('lead_time_days'),
  seoTitle: text('seo_title'),
  seoDescription: text('seo_description'),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('products_slug_unique').on(t.slug)])

export const productImages = pgTable('product_images', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  alt: text('alt'),
  position: integer('position').notNull().default(0),
  isPrimary: boolean('is_primary').notNull().default(false),
}, (t) => [index('product_images_product_idx').on(t.productId)])

export const productVariants = pgTable('product_variants', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  sku: text('sku').notNull(),
  name: text('name').notNull(),
  priceCents: integer('price_cents').notNull(),
  compareAtPriceCents: integer('compare_at_price_cents'),
  weightOz: integer('weight_oz'),
  inventoryQty: integer('inventory_qty'), // null = untracked / unlimited
  options: jsonb('options').$type<Record<string, string>>(),
  position: integer('position').notNull().default(0),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex('product_variants_sku_unique').on(t.sku),
  index('product_variants_product_idx').on(t.productId),
])

// ── Orders ──────────────────────────────────────────────────────────────────
export const orders = pgTable('orders', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderNumber: text('order_number'), // human-friendly, assigned at paid-confirmation
  provider: paymentProviderEnum('provider').notNull(),
  providerSessionId: text('provider_session_id').notNull(),
  providerPaymentId: text('provider_payment_id'),
  status: orderStatusEnum('status').notNull().default('pending'),

  customerEmail: text('customer_email').notNull(),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  shippingAddress: jsonb('shipping_address').$type<Address>(),
  billingAddress: jsonb('billing_address').$type<Address>(),

  subtotalCents: integer('subtotal_cents').notNull(),
  shippingCents: integer('shipping_cents').notNull().default(0),
  taxCents: integer('tax_cents').notNull().default(0),
  discountCents: integer('discount_cents').notNull().default(0),
  totalCents: integer('total_cents').notNull(),
  currency: text('currency').notNull().default('usd'),

  discountCode: text('discount_code'),
  customerNote: text('customer_note'),
  internalNote: text('internal_note'),
  fulfilledAt: timestamp('fulfilled_at', { withTimezone: true }),
  trackingCarrier: text('tracking_carrier'),
  trackingNumber: text('tracking_number'),

  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  // Idempotency: one order per provider checkout session.
  uniqueIndex('orders_provider_session_unique').on(t.provider, t.providerSessionId),
  uniqueIndex('orders_order_number_unique').on(t.orderNumber),
  index('orders_status_idx').on(t.status),
  index('orders_created_idx').on(t.createdAt),
])

// Snapshot fields so catalog changes never rewrite order history.
export const orderItems = pgTable('order_items', {
  id: uuid('id').primaryKey().defaultRandom(),
  orderId: uuid('order_id').notNull().references(() => orders.id, { onDelete: 'cascade' }),
  productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
  variantId: uuid('variant_id').references(() => productVariants.id, { onDelete: 'set null' }),
  productName: text('product_name').notNull(),
  variantName: text('variant_name').notNull(),
  sku: text('sku').notNull(),
  imageUrl: text('image_url'),
  unitPriceCents: integer('unit_price_cents').notNull(),
  quantity: integer('quantity').notNull(),
  lineTotalCents: integer('line_total_cents').notNull(),
}, (t) => [index('order_items_order_idx').on(t.orderId)])

// ── Payment config (the merchant's OWN provider account) ─────────────────────
// Exactly one active row. `credentials` is encrypted at rest (AES-GCM, key from
// PAYMENT_ENC_KEY) and is NEVER returned by any public endpoint or to the client.
export const paymentConfig = pgTable('payment_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: paymentProviderEnum('provider').notNull(),
  mode: text('mode').notNull().default('test'), // 'test' | 'live'
  credentialsEnc: text('credentials_enc').notNull(), // AES-GCM ciphertext (secret key/tokens)
  webhookSecretEnc: text('webhook_secret_enc'),      // AES-GCM ciphertext (signing secret)
  publishableKey: text('publishable_key'),           // safe-to-expose key (if the provider has one)
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Store settings (brand + shipping/tax basics; token-filled at generation) ──
export const storeSettings = pgTable('store_settings', {
  id: uuid('id').primaryKey().defaultRandom(),
  companyName: text('company_name').notNull(),
  supportEmail: text('support_email'),
  currency: text('currency').notNull().default('usd'),
  flatShippingCents: integer('flat_shipping_cents').notNull().default(0),
  freeShippingThresholdCents: integer('free_shipping_threshold_cents'),
  taxRateBps: integer('tax_rate_bps').notNull().default(0), // basis points, e.g. 725 = 7.25%
  storefrontOrigin: text('storefront_origin'), // allowlisted origin for public API/CORS
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Admin users (tenant staff — proper JWT auth, replaces the shared secret) ──
export const users = pgTable('users', {
  id: uuid('id').primaryKey().defaultRandom(),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').notNull().default('owner'), // owner | staff
  isActive: boolean('is_active').notNull().default(true),
  refreshToken: text('refresh_token'), // last-issued refresh token (rotated on refresh/logout)
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('users_email_unique').on(t.email)])

export type Address = {
  line1: string
  line2?: string
  city: string
  state: string
  postalCode: string
  country: string
}
