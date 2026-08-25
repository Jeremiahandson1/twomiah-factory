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
  // Dropship forwarding (null when no supplier is connected / items unmapped)
  supplierOrderId: text('supplier_order_id'),
  supplierStatus: text('supplier_status'), // 'placed' | 'error' | 'unmapped' | 'hold' | 'shipped'
  supplierCostCents: integer('supplier_cost_cents'),
  supplierError: text('supplier_error'),

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

  // Abandoned-cart recovery. A pending order IS the abandoned cart: checkout
  // records it, with items, before the customer ever reaches the payment page.
  recoveryToken: text('recovery_token'),
  abandonedEmailSentAt: timestamp('abandoned_email_sent_at', { withTimezone: true }),
  recoveredAt: timestamp('recovered_at', { withTimezone: true }),
  reviewRequestSentAt: timestamp('review_request_sent_at', { withTimezone: true }),
  // Carrier label bought through the shipping provider (tracking itself still
  // lives in trackingCarrier/trackingNumber, shared with manual fulfilment).
  labelUrl: text('label_url'),
  labelCostCents: integer('label_cost_cents'),
  labelPurchasedAt: timestamp('label_purchased_at', { withTimezone: true }),

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
// ── Shipping carrier (label purchase) ───────────────────────────────────────
// Same shape as supplier_config: one connected row, credentials encrypted at
// rest, everything else null-safe so a store with no carrier just keeps
// entering tracking numbers by hand.
export const shippingConfig = pgTable('shipping_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // 'easypost'
  mode: text('mode').notNull().default('test'),
  credentialsEnc: text('credentials_enc').notNull(), // AES-GCM (apiKey)
  fromAddress: jsonb('from_address').$type<Address & { name?: string; phone?: string }>(),
  defaultParcel: jsonb('default_parcel').$type<{ lengthIn: number; widthIn: number; heightIn: number; weightOz: number }>(),
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// ── Product reviews ─────────────────────────────────────────────────────────
// Reviews land as 'pending' and are only shown publicly once approved — an
// open review box on a small store is a spam magnet.
export const productReviews = pgTable('product_reviews', {
  id: uuid('id').primaryKey().defaultRandom(),
  productId: uuid('product_id').notNull().references(() => products.id, { onDelete: 'cascade' }),
  // Set when the review came from a real order — that is what "verified" means.
  orderId: uuid('order_id').references(() => orders.id, { onDelete: 'set null' }),
  authorName: text('author_name').notNull(),
  authorEmail: text('author_email'),
  rating: integer('rating').notNull(),
  title: text('title'),
  body: text('body'),
  status: text('status').notNull().default('pending'), // pending | approved | rejected
  verifiedPurchase: boolean('verified_purchase').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index('product_reviews_product_idx').on(t.productId),
  index('product_reviews_status_idx').on(t.status),
])

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
  // Optional region-based overrides. When a buyer's ship-to region matches a zone
  // / tax rate, it wins over the flat rates above; otherwise the flat rates apply.
  shippingZones: jsonb('shipping_zones').$type<ShippingZone[]>(),
  taxRates: jsonb('tax_rates').$type<TaxRate[]>(),
  storefrontOrigin: text('storefront_origin'), // allowlisted origin for public API/CORS
  abandonedCartEnabled: boolean('abandoned_cart_enabled').notNull().default(true),
  abandonedCartDelayMinutes: integer('abandoned_cart_delay_minutes').notNull().default(60),
  reviewsEnabled: boolean('reviews_enabled').notNull().default(true),
  reviewRequestDays: integer('review_request_days').notNull().default(7),
  onboardingCompletedAt: timestamp('onboarding_completed_at', { withTimezone: true }), // set once by POST /api/onboarding/complete
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
  resetToken: text('reset_token'), // one-time password-reset token (1h expiry)
  resetTokenExp: timestamp('reset_token_exp', { withTimezone: true }),
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

// ── Region-based rates (stored as JSON on store_settings) ────────────────────
// A zone/rate matches when the buyer's ship-to country (and state, if listed) is
// covered. Empty arrays/strings mean "any". First match wins; flat rates are the
// fallback when nothing matches.
export type ShippingZone = {
  name: string
  countries: string[]           // ISO country codes; [] = any
  states: string[]              // state/province codes; [] = any within the countries
  rateCents: number
  freeThresholdCents?: number | null
}
export type TaxRate = {
  country: string               // ISO country code; '' = any
  state: string                 // state code; '' = any within country
  rateBps: number               // basis points
}

// ── Discount / promo codes ───────────────────────────────────────────────────
export const discountCodes = pgTable('discount_codes', {
  id: uuid('id').primaryKey().defaultRandom(),
  code: text('code').notNull(),                 // stored uppercase
  type: text('type').notNull(),                 // 'percent' | 'fixed'
  value: integer('value').notNull(),            // percent (1-100) or fixed cents
  active: boolean('active').notNull().default(true),
  minSubtotalCents: integer('min_subtotal_cents').notNull().default(0),
  maxUses: integer('max_uses'),                 // null = unlimited
  usedCount: integer('used_count').notNull().default(0),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('discount_codes_code_unique').on(t.code)])

// ── Branded email aliases (support@, orders@ on the tenant domain) ──
// Field names must match packages/tenant-backend createEmailAliasesRoutes
// (localPart/routingMode/forwardTo/enabled). Every write syncs to the factory,
// which mirrors the alias into Cloudflare Email Routing.
export const emailAlias = pgTable('email_alias', {
  id: uuid('id').primaryKey().defaultRandom(),
  localPart: text('local_part').notNull(),                        // "support"
  routingMode: text('routing_mode').notNull().default('forward'), // 'forward' | 'crm'
  forwardTo: text('forward_to'),                                  // set when routing_mode='forward'
  enabled: boolean('enabled').notNull().default(true),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('email_alias_local_part_idx').on(t.localPart)])

// ── Dropship supplier connection (Printful / CJ) ──
export const supplierConfig = pgTable('supplier_config', {
  id: uuid('id').primaryKey().defaultRandom(),
  provider: text('provider').notNull(), // 'printful' | 'cj'
  mode: text('mode').notNull().default('test'),
  credentialsEnc: text('credentials_enc').notNull(), // AES-GCM (apiKey/accountEmail/webhookToken)
  autoForward: boolean('auto_forward').notNull().default(true),
  connected: boolean('connected').notNull().default(false),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})

// Our variant → the supplier's variant. An order only auto-forwards when
// EVERY line item has a mapping (never partial-forward).
export const variantSupplierMap = pgTable('variant_supplier_map', {
  id: uuid('id').primaryKey().defaultRandom(),
  variantId: uuid('variant_id').notNull().references(() => productVariants.id, { onDelete: 'cascade' }),
  supplierVariantRef: text('supplier_variant_ref').notNull(),
  supplierItemName: text('supplier_item_name'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex('variant_supplier_map_variant_unique').on(t.variantId)])

// -- Inbound email routed into the back-office via crm-mode aliases --
// Field names match packages/tenant-backend inbound routes.
export const inboundMessage = pgTable('inbound_message', {
  id: uuid('id').primaryKey().defaultRandom(),
  toLocalPart: text('to_local_part').notNull(),
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  subject: text('subject'),
  textBody: text('text_body'),
  htmlBody: text('html_body'),
  spfVerdict: text('spf_verdict'),
  dkimVerdict: text('dkim_verdict'),
  rawHeaders: text('raw_headers'),
  receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index('inbound_message_received_at_idx').on(t.receivedAt)])

// -- Google Business Profile connection (reviews inbox). One listing per tenant
// in V1. OAuth brokered by the factory; tokens forwarded via X-Factory-Key to
// /api/internal/gbp/store-tokens. Logic lives in packages/tenant-backend/gbp.ts.
export const gbpConnection = pgTable('gbp_connection', {
  id: uuid('id').primaryKey().defaultRandom(),
  externalEmail: text('external_email'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
  accountName: text('account_name'),
  locationName: text('location_name'),
  locationTitle: text('location_title'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
})
