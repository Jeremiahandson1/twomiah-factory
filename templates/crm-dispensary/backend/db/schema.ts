import { pgTable, text, boolean, integer, decimal, real, timestamp, date, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// ==================== MULTI-TENANT ====================

export const company = pgTable('company', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  logo: text('logo'),
  primaryColor: text('primary_color').default('{{PRIMARY_COLOR}}').notNull(),
  secondaryColor: text('secondary_color'),
  website: text('website'),
  licenseNumber: text('license_number'),
  enabledFeatures: json('enabled_features').default([]).notNull(),
  settings: json('settings').default({}).notNull(),
  integrations: json('integrations').default({}).notNull(),

  // Dispensary-specific
  storeHours: json('store_hours'),
  taxRate: text('tax_rate').default('10'),
  loyaltyPointsPerDollar: integer('loyalty_points_per_dollar').default(1),
  loyaltyEnabled: boolean('loyalty_enabled').default(true),
  deliveryEnabled: boolean('delivery_enabled').default(false),
  merchEnabled: boolean('merch_enabled').default(false),
  purchaseLimitOz: text('purchase_limit_oz').default('2.5'),

  // POS Integration
  integrationKey: text('integration_key'),

  // Stripe
  stripeCustomerId: text('stripe_customer_id').unique(),
  subscriptionTier: text('subscription_tier'),
  licenseType: text('license_type'),
  lifetimeAccess: boolean('lifetime_access').default(false).notNull(),

  // Twilio
  twilioPhoneNumber: text('twilio_phone_number'),
  twilioAccountSid: text('twilio_account_sid'),
  twilioAuthToken: text('twilio_auth_token'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== USERS ====================

export const user = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name').notNull(),
  lastName: text('last_name').notNull(),
  phone: text('phone'),
  avatar: text('avatar'),
  role: text('role').default('owner').notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastLogin: timestamp('last_login'),
  refreshToken: text('refresh_token'),
  resetToken: text('reset_token'),
  resetTokenExp: timestamp('reset_token_exp'),

  // Dispensary PIN auth (for POS quick-login)
  pinHash: text('pin_hash'),
  pinAttempts: integer('pin_attempts').default(0),
  pinLockedUntil: timestamp('pin_locked_until'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('user_email_company_id_key').on(t.email, t.companyId),
  index('user_company_id_idx').on(t.companyId),
])

// ==================== CUSTOMERS ====================

export const contact = pgTable('contact', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').default('lead').notNull(),
  name: text('name').notNull(),
  company: text('company'),
  email: text('email'),
  phone: text('phone'),
  mobile: text('mobile'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  lat: real('lat'),
  lng: real('lng'),
  notes: text('notes'),
  source: text('source'),
  tags: json('tags').default([]).notNull(),
  customFields: json('custom_fields').default({}).notNull(),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('contact_company_id_idx').on(t.companyId),
  index('contact_type_idx').on(t.type),
])

// ==================== PRODUCTS ====================

export const product = pgTable('products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug'),
  category: text('category').notNull(), // flower|edible|concentrate|topical|preroll|vape|merch|accessory
  subcategory: text('subcategory'),
  brand: text('brand'),
  strainName: text('strain_name'),
  strainType: text('strain_type'), // indica|sativa|hybrid|cbd
  thcPercent: text('thc_percent'),
  cbdPercent: text('cbd_percent'),
  weightGrams: text('weight_grams'),
  unitType: text('unit_type'), // each|gram|eighth|quarter|half|ounce
  price: text('price').notNull(),
  compareAtPrice: text('compare_at_price'),
  cost: text('cost'),
  sku: text('sku'),
  barcode: text('barcode'),
  stockQuantity: integer('stock_quantity').default(0),
  lowStockThreshold: integer('low_stock_threshold').default(5),
  trackInventory: boolean('track_inventory').default(true),
  imageUrl: text('image_url'),
  description: text('description'),
  effects: json('effects').default([]),
  flavors: json('flavors').default([]),
  isMerch: boolean('is_merch').default(false),
  requiresAgeVerify: boolean('requires_age_verify').default(true),
  visible: boolean('visible').default(true),
  featured: boolean('featured').default(false),
  active: boolean('active').default(true),
  menuOrder: integer('menu_order').default(0),
  images: json('images').$type<string[]>().default([]),
  tags: json('tags').$type<string[]>().default([]),
  labResults: json('lab_results'),
  metrcTag: text('metrc_tag'),
  taxCategory: text('tax_category'),
  requiresIdCheck: boolean('requires_id_check').default(true),
  requiresWeighing: boolean('requires_weighing').default(false),
  costPrice: text('cost_price'),
  weight: text('weight'),
  weightUnit: text('weight_unit'),
  strain: text('strain'),
  salePrice: text('sale_price'),
  inStock: boolean('in_stock').default(true),
  totalSold: integer('total_sold').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('product_company_id_idx').on(t.companyId),
  index('product_category_idx').on(t.category),
  index('product_sku_idx').on(t.sku),
])

// ==================== PRODUCT CATEGORIES ====================

export const productCategory = pgTable('product_categories', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  slug: text('slug'),
  description: text('description'),
  imageUrl: text('image_url'),
  displayOrder: integer('display_order').default(0),
  visible: boolean('visible').default(true),
})

// ==================== ORDERS ====================

export const order = pgTable('orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  orderNumber: integer('order_number'),
  type: text('type').default('walk_in'), // walk_in|pickup|delivery
  status: text('status').default('pending'), // pending|confirmed|preparing|ready|out_for_delivery|completed|cancelled
  subtotal: text('subtotal').default('0'),
  taxAmount: text('tax_amount').default('0'),
  discountAmount: text('discount_amount').default('0'),
  loyaltyDiscount: text('loyalty_discount').default('0'),
  total: text('total').default('0'),
  totalCannabisWeightOz: text('total_cannabis_weight_oz').default('0'),
  paymentMethod: text('payment_method'), // cash|debit|ach
  paymentStatus: text('payment_status').default('pending'), // pending|paid|refunded
  notes: text('notes'),
  pickupTime: timestamp('pickup_time'),
  deliveryAddress: text('delivery_address'),
  deliveryNotes: text('delivery_notes'),
  deliveryZoneId: text('delivery_zone_id'),
  budtenderId: text('budtender_id').references(() => user.id),
  driverId: text('driver_id').references(() => user.id),
  idVerified: boolean('id_verified').default(false),
  idVerifiedBy: text('id_verified_by'),
  loyaltyPointsEarned: integer('loyalty_points_earned').default(0),
  loyaltyPointsRedeemed: integer('loyalty_points_redeemed').default(0),
  loyaltyRewardId: text('loyalty_reward_id'),
  refundReason: text('refund_reason'),
  refundedBy: text('refunded_by'),
  refundedAt: timestamp('refunded_at'),
  completedAt: timestamp('completed_at'),
  number: text('number'),
  customerName: text('customer_name'),
  customerId: text('customer_id').references(() => contact.id),
  customerDob: text('customer_dob'),
  isMedical: boolean('is_medical').default(false),
  medicalCardNumber: text('medical_card_number'),
  exciseTax: text('excise_tax').default('0'),
  salesTax: text('sales_tax').default('0'),
  totalTax: text('total_tax').default('0'),
  discountReason: text('discount_reason'),
  totalWeightGrams: text('total_weight_grams').default('0'),
  cashTendered: text('cash_tendered'),
  changeDue: text('change_due'),
  deliveryStatus: text('delivery_status'),
  deliveryLat: text('delivery_lat'),
  deliveryLng: text('delivery_lng'),
  deliveredAt: timestamp('delivered_at'),
  tipAmount: text('tip_amount').default('0'),
  tipMethod: text('tip_method'), // cash|debit|split
  locationId: text('location_id'),
  kioskSessionId: text('kiosk_session_id'),
  externalOrderId: text('external_order_id'),
  externalPosSystem: text('external_pos_system'), // dutchie|treez|blaze
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('order_company_id_idx').on(t.companyId),
  index('order_contact_id_idx').on(t.contactId),
  index('order_status_idx').on(t.status),
  index('order_created_at_idx').on(t.createdAt),
  index('order_location_id_idx').on(t.locationId),
])

// ==================== ORDER ITEMS ====================

export const orderItem = pgTable('order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => order.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => product.id, { onDelete: 'set null' }),
  productName: text('product_name'),
  productCategory: text('product_category'),
  quantity: integer('quantity').default(1),
  unitPrice: text('unit_price'),
  totalPrice: text('total_price'),
  weightGrams: text('weight_grams'),
  notes: text('notes'),
  companyId: text('company_id'),
  lineTotal: text('line_total'),
  sku: text('sku'),
  category: text('category'),
  weight: text('weight'),
  weightUnit: text('weight_unit'),
  taxCategory: text('tax_category'),
})

// ==================== LOYALTY ====================

export const loyaltyMember = pgTable('loyalty_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  pointsBalance: integer('points_balance').default(0),
  lifetimePoints: integer('lifetime_points').default(0),
  tier: text('tier').default('bronze'), // bronze|silver|gold|platinum
  referralCode: text('referral_code'),
  referredBy: text('referred_by'),
  optedInSms: boolean('opted_in_sms').default(false),
  optedInEmail: boolean('opted_in_email').default(false),
  joinedAt: timestamp('joined_at').defaultNow(),
  lastActivityAt: timestamp('last_activity_at'),
  totalPointsEarned: integer('total_points_earned').default(0),
  totalVisits: integer('total_visits').default(0),
  totalSpent: text('total_spent').default('0'),
  notes: text('notes'),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('loyalty_member_company_id_idx').on(t.companyId),
  index('loyalty_member_contact_id_idx').on(t.contactId),
])

export const loyaltyTransaction = pgTable('loyalty_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id'),
  memberId: text('member_id').notNull().references(() => loyaltyMember.id, { onDelete: 'cascade' }),
  orderId: text('order_id'),
  type: text('type').notNull(), // earn|redeem|bonus|adjustment|referral|expiry
  points: integer('points').notNull(),
  balanceAfter: integer('balance_after'),
  description: text('description'),
  createdBy: text('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('loyalty_tx_member_id_idx').on(t.memberId),
])

export const loyaltyReward = pgTable('loyalty_rewards', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  pointsCost: integer('points_cost').notNull(),
  pointsRequired: integer('points_required'),
  discountType: text('discount_type'), // percent|fixed|free_item
  discountValue: text('discount_value'),
  applicableCategories: json('applicable_categories').default([]),
  productId: text('product_id'),
  minTier: text('min_tier'),
  maxRedemptionsPerDay: integer('max_redemptions_per_day'),
  usageCount: integer('usage_count').default(0),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== DELIVERY ====================

export const deliveryZone = pgTable('delivery_zones', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  zipCodes: json('zip_codes').default([]),
  deliveryFee: text('delivery_fee').default('0'),
  minOrder: text('min_order').default('0'),
  maxOrder: text('max_order'),
  estimatedMinutes: integer('estimated_minutes'),
  active: boolean('active').default(true),
  description: text('description'),
  radiusMiles: text('radius_miles'),
  centerLat: text('center_lat'),
  centerLng: text('center_lng'),
  minimumOrder: text('minimum_order'),
  hoursStart: text('hours_start'),
  hoursEnd: text('hours_end'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== INVENTORY ====================

export const inventoryAdjustment = pgTable('inventory_adjustments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  adjustmentType: text('adjustment_type').notNull(), // restock|damage|theft|count_correction|sale|return
  quantityChange: integer('quantity_change').notNull(),
  quantityBefore: integer('quantity_before'),
  quantityAfter: integer('quantity_after'),
  reason: text('reason'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('inv_adj_company_id_idx').on(t.companyId),
  index('inv_adj_product_id_idx').on(t.productId),
])

// ==================== CASH MANAGEMENT ====================

export const cashSession = pgTable('cash_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  openedAt: timestamp('opened_at').defaultNow(),
  closedAt: timestamp('closed_at'),
  openingBalance: text('opening_balance').default('0'),
  expectedBalance: text('expected_balance').default('0'),
  actualCount: text('actual_count'),
  variance: text('variance'),
  notes: text('notes'),
  status: text('status').default('open'), // open|closed
  openedById: text('opened_by_id'),
  closedById: text('closed_by_id'),
  register: text('register'),
  openingAmount: text('opening_amount'),
  closingAmount: text('closing_amount'),
  expectedAmount: text('expected_amount'),
  denominations: json('denominations'),
}, (t) => [
  index('cash_session_company_id_idx').on(t.companyId),
  index('cash_session_user_id_idx').on(t.userId),
])

// ==================== AUDIT LOG ====================

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  details: json('details'),
  ipAddress: text('ip_address'),
  entity: text('entity'),
  entityName: text('entity_name'),
  changes: json('changes'),
  metadata: json('metadata'),
  userName: text('user_name'),
  userEmail: text('user_email'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('audit_log_company_id_idx').on(t.companyId),
  index('audit_log_action_idx').on(t.action),
  index('audit_log_created_at_idx').on(t.createdAt),
])

// ==================== REPORTING ====================

export const dailySalesSummary = pgTable('daily_sales_summary', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  date: text('date').notNull(),
  totalOrders: integer('total_orders').default(0),
  totalRevenue: text('total_revenue').default('0'),
  cashTotal: text('cash_total').default('0'),
  debitTotal: text('debit_total').default('0'),
  cannabisRevenue: text('cannabis_revenue').default('0'),
  merchRevenue: text('merch_revenue').default('0'),
  taxCollected: text('tax_collected').default('0'),
  totalCannabisWeightOz: text('total_cannabis_weight_oz').default('0'),
  uniqueCustomers: integer('unique_customers').default(0),
  topProductId: text('top_product_id'),
  avgOrderValue: text('avg_order_value').default('0'),
  loyaltyPointsIssued: integer('loyalty_points_issued').default(0),
  loyaltyPointsRedeemed: integer('loyalty_points_redeemed').default(0),
  deliveryOrders: integer('delivery_orders').default(0),
  pickupOrders: integer('pickup_orders').default(0),
  walkInOrders: integer('walk_in_orders').default(0),
  createdAt: timestamp('created_at').defaultNow(),
}, (t) => [
  index('daily_sales_company_id_idx').on(t.companyId),
  index('daily_sales_date_idx').on(t.date),
])

// ==================== TEAM ====================

export const teamMember = pgTable('team_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  userId: text('user_id').references(() => user.id),
  role: text('role').default('budtender'),
  status: text('status').default('active'),
  permissions: json('permissions').$type<string[]>().default([]),
  name: text('name'),
  email: text('email'),
  phone: text('phone'),
  department: text('department'),
  hireDate: timestamp('hire_date'),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  active: boolean('active').default(true),
  skills: json('skills').$type<string[]>().default([]),
  notes: text('notes'),
  invitedAt: timestamp('invited_at'),
  joinedAt: timestamp('joined_at'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== DOCUMENTS ====================

export const document = pgTable('documents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  name: text('name').notNull(),
  type: text('type'),
  url: text('url'),
  size: integer('size'),
  uploadedBy: text('uploaded_by').references(() => user.id),
  contactId: text('contact_id'),
  orderId: text('order_id'),
  tags: json('tags').$type<string[]>().default([]),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== LEADS ====================

export const lead = pgTable('leads', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  name: text('name'),
  email: text('email'),
  phone: text('phone'),
  source: text('source'),
  status: text('status').default('new'),
  message: text('message'),
  service: text('service'),
  address: text('address'),
  assignedTo: text('assigned_to'),
  notes: text('notes'),
  convertedContactId: text('converted_contact_id'),
  sourcePlatform: text('source_platform'),
  sourceId: text('source_id'),
  homeownerName: text('homeowner_name'),
  rawPayload: json('raw_payload'),
  receivedAt: timestamp('received_at').defaultNow(),
  contactedAt: timestamp('contacted_at'),
  budget: text('budget'),
  location: text('location'),
  jobType: text('job_type'),
  description: text('description'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

export const leadSource = pgTable('lead_sources', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  name: text('name').notNull(),
  type: text('type'),
  active: boolean('active').default(true),
  leadCount: integer('lead_count').default(0),
  platform: text('platform'),
  label: text('label'),
  inboundEmail: text('inbound_email'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  enabled: boolean('enabled').default(true),
  config: json('config').default({}),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// ==================== SUPPORT ====================

export const supportTicket = pgTable('support_tickets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  contactId: text('contact_id'),
  subject: text('subject').notNull(),
  description: text('description'),
  status: text('status').default('open'),
  priority: text('priority').default('medium'),
  assignedTo: text('assigned_to'),
  category: text('category'),
  number: text('number'),
  type: text('type'),
  source: text('source'),
  assignedToId: text('assigned_to_id'),
  createdById: text('created_by_id'),
  tags: json('tags').default([]),
  aiCategory: text('ai_category'),
  aiPriorityScore: integer('ai_priority_score'),
  slaResponseDue: timestamp('sla_response_due'),
  slaResolveDue: timestamp('sla_resolve_due'),
  firstResponseAt: timestamp('first_response_at'),
  resolvedAt: timestamp('resolved_at'),
  rating: integer('rating'),
  ratingComment: text('rating_comment'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  closedAt: timestamp('closed_at'),
})

export const supportTicketMessage = pgTable('support_ticket_messages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  ticketId: text('ticket_id').references(() => supportTicket.id),
  userId: text('user_id'),
  contactId: text('contact_id'),
  message: text('message').notNull(),
  body: text('body'),
  isInternal: boolean('is_internal').default(false),
  createdAt: timestamp('created_at').defaultNow(),
})

export const supportSlaPolicy = pgTable('support_sla_policies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id),
  name: text('name').notNull(),
  responseTimeMinutes: integer('response_time_minutes'),
  resolutionTimeMinutes: integer('resolution_time_minutes'),
  resolveTimeMinutes: integer('resolve_time_minutes'),
  escalateAfterMinutes: integer('escalate_after_minutes'),
  priority: text('priority'),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

export const supportKnowledgeBase = pgTable('support_knowledge_base', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  title: text('title').notNull(),
  content: text('content').notNull(),
  category: text('category'),
  tags: json('tags').default([]).notNull(),
  isFaq: boolean('is_faq').default(false).notNull(),
  published: boolean('published').default(true).notNull(),
  sortOrder: integer('sort_order').default(0).notNull(),
  viewCount: integer('view_count').default(0).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('support_kb_company_id_idx').on(t.companyId),
  index('support_kb_category_idx').on(t.category),
])

// ==================== METRC INTEGRATION ====================

export const metrcConfig = pgTable('metrc_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  apiKey: text('api_key'),
  userKey: text('user_key'),
  licenseNumber: text('license_number'),
  state: text('state').default('MI'),
  environment: text('environment').default('production'), // sandbox|production
  autoSync: boolean('auto_sync').default(true),
  syncInterval: integer('sync_interval').default(15), // minutes
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'), // success|error
  lastSyncError: text('last_sync_error'),
  syncPackages: boolean('sync_packages').default(true),
  syncSales: boolean('sync_sales').default(true),
  syncTransfers: boolean('sync_transfers').default(true),
  syncPlants: boolean('sync_plants').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const metrcPackage = pgTable('metrc_packages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  metrcId: integer('metrc_id'),
  tag: text('tag').notNull(),
  label: text('label'),
  packageType: text('package_type'),
  sourcePackageLabels: text('source_package_labels'),
  itemName: text('item_name'),
  itemCategory: text('item_category'),
  itemStrainName: text('item_strain_name'),
  quantity: text('quantity'),
  unitOfMeasure: text('unit_of_measure'),
  patientLicenseNumber: text('patient_license_number'),
  labTestingState: text('lab_testing_state'),
  productionBatchNumber: text('production_batch_number'),
  productId: text('product_id').references(() => product.id, { onDelete: 'set null' }),
  isOnHold: boolean('is_on_hold').default(false),
  archivedDate: timestamp('archived_date'),
  finishedDate: timestamp('finished_date'),
  receivedDateTime: timestamp('received_date_time'),
  lastModified: timestamp('last_modified'),
  rawData: json('raw_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('metrc_pkg_company_id_idx').on(t.companyId),
  index('metrc_pkg_tag_idx').on(t.tag),
  index('metrc_pkg_product_id_idx').on(t.productId),
])

export const metrcSaleReceipt = pgTable('metrc_sale_receipts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  metrcId: integer('metrc_id'),
  receiptNumber: text('receipt_number'),
  salesDateTime: timestamp('sales_date_time'),
  salesCustomerType: text('sales_customer_type'),
  patientLicenseNumber: text('patient_license_number'),
  totalPackages: integer('total_packages'),
  totalPrice: text('total_price'),
  orderId: text('order_id').references(() => order.id, { onDelete: 'set null' }),
  isFinal: boolean('is_final').default(false),
  lastModified: timestamp('last_modified'),
  rawData: json('raw_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('metrc_sale_company_id_idx').on(t.companyId),
  index('metrc_sale_order_id_idx').on(t.orderId),
])

export const metrcTransfer = pgTable('metrc_transfers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  metrcId: integer('metrc_id'),
  manifestNumber: text('manifest_number'),
  shipperFacilityLicenseNumber: text('shipper_facility_license_number'),
  shipperFacilityName: text('shipper_facility_name'),
  transporterFacilityLicenseNumber: text('transporter_facility_license_number'),
  transporterFacilityName: text('transporter_facility_name'),
  recipientFacilityLicenseNumber: text('recipient_facility_license_number'),
  recipientFacilityName: text('recipient_facility_name'),
  shipmentTypeName: text('shipment_type_name'),
  estimatedDepartureDateTime: timestamp('estimated_departure_date_time'),
  estimatedArrivalDateTime: timestamp('estimated_arrival_date_time'),
  receivedDateTime: timestamp('received_date_time'),
  packages: json('packages').default([]),
  rawData: json('raw_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('metrc_transfer_company_id_idx').on(t.companyId),
])

export const metrcSyncLog = pgTable('metrc_sync_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  syncType: text('sync_type').notNull(), // packages|sales|transfers|plants
  status: text('status').notNull(), // started|success|error
  recordsProcessed: integer('records_processed').default(0),
  recordsCreated: integer('records_created').default(0),
  recordsUpdated: integer('records_updated').default(0),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
})

// ==================== LICENSE MANAGEMENT ====================

export const license = pgTable('licenses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  licenseNumber: text('license_number').notNull(),
  licenseType: text('license_type').notNull(), // retail|cultivation|processing|distribution|testing|microbusiness
  issuingAuthority: text('issuing_authority'),
  state: text('state'),
  status: text('status').default('active'), // active|pending|suspended|revoked|expired
  issuedDate: date('issued_date'),
  expirationDate: date('expiration_date'),
  renewalDate: date('renewal_date'),
  renewalReminderDays: integer('renewal_reminder_days').default(60),
  renewalReminderSent: boolean('renewal_reminder_sent').default(false),
  licenseHolder: text('license_holder'),
  address: text('address'),
  city: text('city'),
  zip: text('zip'),
  notes: text('notes'),
  documentUrl: text('document_url'),
  metrcLinked: boolean('metrc_linked').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('license_company_id_idx').on(t.companyId),
  index('license_expiration_idx').on(t.expirationDate),
])

// ==================== MULTI-LOCATION INVENTORY ====================

export const location = pgTable('locations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').default('dispensary'), // dispensary|warehouse|vault|display
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  phone: text('phone'),
  licenseNumber: text('license_number'),
  isDefault: boolean('is_default').default(false),
  isActive: boolean('is_active').default(true),
  storeHours: json('store_hours'),
  lat: real('lat'),
  lng: real('lng'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('location_company_id_idx').on(t.companyId),
])

export const productLocation = pgTable('product_locations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => location.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  quantity: integer('quantity').default(0),
  minQuantity: integer('min_quantity').default(0),
  maxQuantity: integer('max_quantity'),
  aisle: text('aisle'),
  shelf: text('shelf'),
  bin: text('bin'),
  rfidTag: text('rfid_tag'),
  lastCountedAt: timestamp('last_counted_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('product_location_unique').on(t.productId, t.locationId),
  index('product_location_company_idx').on(t.companyId),
])

export const inventoryTransfer = pgTable('inventory_transfers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  fromLocationId: text('from_location_id').notNull().references(() => location.id),
  toLocationId: text('to_location_id').notNull().references(() => location.id),
  status: text('status').default('pending'), // pending|in_transit|received|cancelled
  initiatedBy: text('initiated_by').references(() => user.id),
  receivedBy: text('received_by').references(() => user.id),
  notes: text('notes'),
  transferredAt: timestamp('transferred_at'),
  receivedAt: timestamp('received_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('inv_transfer_company_id_idx').on(t.companyId),
])

export const inventoryTransferItem = pgTable('inventory_transfer_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  transferId: text('transfer_id').notNull().references(() => inventoryTransfer.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id),
  quantity: integer('quantity').notNull(),
  receivedQuantity: integer('received_quantity'),
  notes: text('notes'),
})

// ==================== BATCH / LOT LIFECYCLE ====================

export const batch = pgTable('batches', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  batchNumber: text('batch_number').notNull(),
  productId: text('product_id').references(() => product.id, { onDelete: 'set null' }),
  metrcTag: text('metrc_tag'),
  status: text('status').default('active'), // active|quarantine|depleted|recalled|expired
  initialQuantity: integer('initial_quantity').notNull(),
  currentQuantity: integer('current_quantity').notNull(),
  unitOfMeasure: text('unit_of_measure').default('each'),
  receivedDate: date('received_date'),
  expirationDate: date('expiration_date'),
  manufacturingDate: date('manufacturing_date'),
  supplier: text('supplier'),
  supplierLicense: text('supplier_license'),
  cost: text('cost'),
  locationId: text('location_id').references(() => location.id),
  labTested: boolean('lab_tested').default(false),
  labTestId: text('lab_test_id'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('batch_company_id_idx').on(t.companyId),
  index('batch_product_id_idx').on(t.productId),
  index('batch_number_idx').on(t.batchNumber),
  index('batch_metrc_tag_idx').on(t.metrcTag),
])

// ==================== LABEL PRINTING ====================

export const labelTemplate = pgTable('label_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').default('product'), // product|package|shelf|receipt
  width: text('width').default('2'), // inches
  height: text('height').default('1'),
  orientation: text('orientation').default('landscape'), // landscape|portrait
  fields: json('fields').default([]).notNull(), // Array of { key, label, x, y, fontSize, fontWeight, maxWidth }
  includeQrCode: boolean('include_qr_code').default(false),
  includeBarcode: boolean('include_barcode').default(true),
  includeLogo: boolean('include_logo').default(false),
  includeThcWarning: boolean('include_thc_warning').default(true),
  includeLabResults: boolean('include_lab_results').default(false),
  complianceState: text('compliance_state').default('MI'),
  isDefault: boolean('is_default').default(false),
  active: boolean('active').default(true),
  previewHtml: text('preview_html'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('label_template_company_id_idx').on(t.companyId),
])

export const labelPrintJob = pgTable('label_print_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  templateId: text('template_id').references(() => labelTemplate.id),
  productId: text('product_id').references(() => product.id),
  batchId: text('batch_id').references(() => batch.id),
  quantity: integer('quantity').default(1),
  status: text('status').default('pending'), // pending|printing|completed|failed
  printedBy: text('printed_by').references(() => user.id),
  labelData: json('label_data'), // Resolved data for the label
  printedAt: timestamp('printed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== RFID ====================

export const rfidTag = pgTable('rfid_tags', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  epc: text('epc').notNull(), // Electronic Product Code
  tid: text('tid'), // Tag ID (unique hardware ID)
  productId: text('product_id').references(() => product.id, { onDelete: 'set null' }),
  batchId: text('batch_id').references(() => batch.id, { onDelete: 'set null' }),
  locationId: text('location_id').references(() => location.id, { onDelete: 'set null' }),
  status: text('status').default('active'), // active|deactivated|lost|damaged
  lastScannedAt: timestamp('last_scanned_at'),
  lastScannedLocation: text('last_scanned_location'),
  encodedData: json('encoded_data'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('rfid_epc_unique').on(t.epc),
  index('rfid_company_id_idx').on(t.companyId),
  index('rfid_product_id_idx').on(t.productId),
])

export const rfidScanLog = pgTable('rfid_scan_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  tagId: text('tag_id').references(() => rfidTag.id),
  epc: text('epc').notNull(),
  scanType: text('scan_type').notNull(), // inventory_count|receiving|transfer|sale|audit
  locationId: text('location_id').references(() => location.id),
  scannedBy: text('scanned_by').references(() => user.id),
  rssi: integer('rssi'), // signal strength
  readerDevice: text('reader_device'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== COMPLIANCE REPORTING ====================

export const complianceReport = pgTable('compliance_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  reportType: text('report_type').notNull(), // daily_sales|inventory_snapshot|waste|transfer|metrc_reconciliation|tax
  period: text('period'), // daily|weekly|monthly|quarterly|annual
  startDate: date('start_date'),
  endDate: date('end_date'),
  state: text('state'),
  status: text('status').default('generated'), // generated|submitted|accepted|rejected
  generatedBy: text('generated_by').references(() => user.id),
  submittedAt: timestamp('submitted_at'),
  data: json('data'), // The actual report data
  fileUrl: text('file_url'), // Export file URL
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('compliance_report_company_id_idx').on(t.companyId),
  index('compliance_report_type_idx').on(t.reportType),
])

export const wasteLog = pgTable('waste_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => product.id),
  batchId: text('batch_id').references(() => batch.id),
  metrcTag: text('metrc_tag'),
  wasteType: text('waste_type').notNull(), // expired|damaged|contaminated|trim|plant_material|other
  quantity: text('quantity').notNull(),
  unitOfMeasure: text('unit_of_measure').default('grams'),
  reason: text('reason'),
  method: text('method'), // composted|rendered|returned|destroyed
  witnessedBy: text('witnessed_by'),
  loggedBy: text('logged_by').references(() => user.id),
  metrcReported: boolean('metrc_reported').default(false),
  metrcReportedAt: timestamp('metrc_reported_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('waste_log_company_id_idx').on(t.companyId),
])

// ==================== DELIVERY TRACKING ====================

export const driverLocation = pgTable('driver_locations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  driverId: text('driver_id').notNull().references(() => user.id),
  orderId: text('order_id').references(() => order.id),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  heading: real('heading'),
  speed: real('speed'),
  accuracy: real('accuracy'),
  batteryLevel: integer('battery_level'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('driver_loc_company_id_idx').on(t.companyId),
  index('driver_loc_driver_id_idx').on(t.driverId),
  index('driver_loc_order_id_idx').on(t.orderId),
  index('driver_loc_created_at_idx').on(t.createdAt),
])

export const deliveryRoute = pgTable('delivery_routes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  driverId: text('driver_id').notNull().references(() => user.id),
  status: text('status').default('planned'), // planned|active|completed|cancelled
  stops: json('stops').default([]).notNull(), // Array of { orderId, address, lat, lng, sequence, status, eta, arrivedAt, departedAt }
  totalDistanceMiles: text('total_distance_miles'),
  totalDurationMinutes: integer('total_duration_minutes'),
  optimizedAt: timestamp('optimized_at'),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('delivery_route_company_id_idx').on(t.companyId),
  index('delivery_route_driver_id_idx').on(t.driverId),
])

// ==================== KIOSK ====================

export const kioskSession = pgTable('kiosk_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  kioskId: text('kiosk_id'), // Physical device identifier
  sessionToken: text('session_token'),
  customerId: text('customer_id').references(() => contact.id),
  orderId: text('order_id').references(() => order.id),
  status: text('status').default('browsing'), // browsing|ordering|checkout|completed|abandoned
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  idVerified: boolean('id_verified').default(false),
  ageVerified: boolean('age_verified').default(false),
})

// ==================== AI RECOMMENDATIONS ====================

export const productRecommendation = pgTable('product_recommendations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  score: real('score'), // 0-1 relevance score
  reason: text('reason'), // frequently_bought|similar_strain|trending|complementary|new_arrival
  context: json('context'), // { basedOn: [...productIds], algorithm: 'collaborative_filtering' }
  shown: boolean('shown').default(false),
  clicked: boolean('clicked').default(false),
  purchased: boolean('purchased').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('recommendation_company_id_idx').on(t.companyId),
  index('recommendation_contact_id_idx').on(t.contactId),
])

// ==================== REFERRAL PROGRAM ====================

export const referral = pgTable('referrals', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  referrerId: text('referrer_id').notNull().references(() => contact.id), // Person who referred
  referredId: text('referred_id').references(() => contact.id), // Person who was referred
  referralCode: text('referral_code').notNull(),
  status: text('status').default('pending'), // pending|signed_up|first_purchase|rewarded|expired
  referrerRewardPoints: integer('referrer_reward_points').default(0),
  referredRewardPoints: integer('referred_reward_points').default(0),
  referrerRewardType: text('referrer_reward_type'), // points|discount_percent|discount_fixed|free_item
  referrerRewardValue: text('referrer_reward_value'),
  referredRewardType: text('referred_reward_type'),
  referredRewardValue: text('referred_reward_value'),
  rewardedAt: timestamp('rewarded_at'),
  expiresAt: timestamp('expires_at'),
  orderId: text('order_id').references(() => order.id), // First qualifying purchase
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('referral_company_id_idx').on(t.companyId),
  index('referral_code_idx').on(t.referralCode),
  index('referral_referrer_id_idx').on(t.referrerId),
])

export const referralConfig = pgTable('referral_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  enabled: boolean('enabled').default(true),
  referrerRewardType: text('referrer_reward_type').default('points'), // points|discount_percent|discount_fixed|free_item
  referrerRewardValue: text('referrer_reward_value').default('100'), // 100 points
  referredRewardType: text('referred_reward_type').default('discount_percent'),
  referredRewardValue: text('referred_reward_value').default('10'), // 10% off first order
  minPurchaseAmount: text('min_purchase_amount'),
  expirationDays: integer('expiration_days').default(90),
  maxReferralsPerCustomer: integer('max_referrals_per_customer'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== CUSTOM REPORTS / BI ====================

export const savedReport = pgTable('saved_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  reportType: text('report_type').notNull(), // sales|inventory|compliance|loyalty|budtender|custom
  config: json('config').notNull(), // { metrics, dimensions, filters, dateRange, groupBy, sortBy, chartType }
  schedule: text('schedule'), // cron expression for auto-run
  lastRunAt: timestamp('last_run_at'),
  lastRunData: json('last_run_data'),
  createdBy: text('created_by').references(() => user.id),
  isPublic: boolean('is_public').default(false),
  pinned: boolean('pinned').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('saved_report_company_id_idx').on(t.companyId),
])

export const biWidget = pgTable('bi_widgets', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  dashboardId: text('dashboard_id'),
  title: text('title').notNull(),
  widgetType: text('widget_type').notNull(), // kpi|line_chart|bar_chart|pie_chart|table|heatmap|gauge
  dataSource: text('data_source').notNull(), // sales|orders|inventory|loyalty|budtenders|compliance
  config: json('config').notNull(), // { metric, dimension, filters, dateRange, color, size }
  position: json('position'), // { x, y, w, h } for grid layout
  refreshInterval: integer('refresh_interval'), // seconds
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('bi_widget_company_id_idx').on(t.companyId),
])

// ==================== WEBSITE ANALYTICS ====================

export const pageView = pgTable('page_views', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  page: text('page').notNull(),
  referrer: text('referrer'),
  userAgent: text('user_agent'),
  ip: text('ip'),
  sessionId: text('session_id'),
  contactId: text('contact_id').references(() => contact.id),
  country: text('country'),
  region: text('region'),
  city: text('city'),
  device: text('device'), // desktop|mobile|tablet
  browser: text('browser'),
  os: text('os'),
  utm_source: text('utm_source'),
  utm_medium: text('utm_medium'),
  utm_campaign: text('utm_campaign'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('page_view_company_id_idx').on(t.companyId),
  index('page_view_created_at_idx').on(t.createdAt),
  index('page_view_session_idx').on(t.sessionId),
])

// ==================== SUPPLY CHAIN ====================

// Cultivation / Grow Tracking
export const plant = pgTable('plants', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  metrcTag: text('metrc_tag'),
  strainName: text('strain_name').notNull(),
  strainType: text('strain_type'), // indica|sativa|hybrid|cbd|auto
  phase: text('phase').default('vegetative'), // clone|seedling|vegetative|flowering|harvested|destroyed
  plantDate: date('plant_date'),
  harvestDate: date('harvest_date'),
  destroyedDate: date('destroyed_date'),
  destroyedReason: text('destroyed_reason'),
  roomId: text('room_id'),
  locationId: text('location_id').references(() => location.id),
  motherPlantId: text('mother_plant_id'),
  batchId: text('batch_id').references(() => batch.id),
  wetWeight: text('wet_weight'),
  dryWeight: text('dry_weight'),
  notes: text('notes'),
  images: json('images').$type<string[]>().default([]),
  growthLog: json('growth_log').default([]), // Array of { date, phase, notes, height, nutrients }
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('plant_company_id_idx').on(t.companyId),
  index('plant_metrc_tag_idx').on(t.metrcTag),
  index('plant_phase_idx').on(t.phase),
])

export const growRoom = pgTable('grow_rooms', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  name: text('name').notNull(),
  type: text('type').default('flower'), // clone|veg|flower|dry|cure
  capacity: integer('capacity'),
  currentCount: integer('current_count').default(0),
  environment: json('environment'), // { temperature, humidity, co2, lightCycle }
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const harvest = pgTable('harvests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  harvestName: text('harvest_name').notNull(),
  strainName: text('strain_name'),
  metrcTag: text('metrc_tag'),
  roomId: text('room_id'),
  plantCount: integer('plant_count'),
  totalWetWeight: text('total_wet_weight'),
  totalDryWeight: text('total_dry_weight'),
  totalWaste: text('total_waste'),
  harvestDate: date('harvest_date'),
  dryDate: date('dry_date'),
  cureDate: date('cure_date'),
  finishedDate: date('finished_date'),
  status: text('status').default('drying'), // drying|curing|finished|packaged
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('harvest_company_id_idx').on(t.companyId),
])

// Manufacturing / Processing
export const manufacturingJob = pgTable('manufacturing_jobs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobNumber: text('job_number').notNull(),
  type: text('type').notNull(), // extraction|infusion|packaging|repackaging|remediation
  status: text('status').default('planned'), // planned|in_progress|quality_check|completed|failed
  inputBatches: json('input_batches').default([]), // Array of { batchId, quantity, metrcTag }
  outputBatches: json('output_batches').default([]),
  inputWeight: text('input_weight'),
  outputWeight: text('output_weight'),
  yield: text('yield'), // percentage
  method: text('method'), // co2|butane|ethanol|rosin|distillation
  equipment: text('equipment'),
  operatorId: text('operator_id').references(() => user.id),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  qualityNotes: text('quality_notes'),
  metrcReported: boolean('metrc_reported').default(false),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('mfg_job_company_id_idx').on(t.companyId),
])

// Distribution / Wholesale
export const wholesaleCustomer = pgTable('wholesale_customers', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  licenseNumber: text('license_number'),
  licenseType: text('license_type'),
  contactName: text('contact_name'),
  email: text('email'),
  phone: text('phone'),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  paymentTerms: text('payment_terms').default('net_30'), // cod|net_15|net_30|net_60
  creditLimit: text('credit_limit'),
  currentBalance: text('current_balance').default('0'),
  notes: text('notes'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('wholesale_customer_company_id_idx').on(t.companyId),
])

export const wholesaleOrder = pgTable('wholesale_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => wholesaleCustomer.id),
  orderNumber: text('order_number').notNull(),
  status: text('status').default('draft'), // draft|submitted|confirmed|shipped|delivered|invoiced|paid|cancelled
  subtotal: text('subtotal').default('0'),
  taxAmount: text('tax_amount').default('0'),
  total: text('total').default('0'),
  paymentStatus: text('payment_status').default('unpaid'), // unpaid|partial|paid
  shippingAddress: text('shipping_address'),
  manifestNumber: text('manifest_number'),
  transferId: text('transfer_id'),
  notes: text('notes'),
  dueDate: date('due_date'),
  shippedAt: timestamp('shipped_at'),
  deliveredAt: timestamp('delivered_at'),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('wholesale_order_company_id_idx').on(t.companyId),
  index('wholesale_order_customer_id_idx').on(t.customerId),
])

export const wholesaleOrderItem = pgTable('wholesale_order_items', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  orderId: text('order_id').notNull().references(() => wholesaleOrder.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => product.id),
  batchId: text('batch_id').references(() => batch.id),
  name: text('name'),
  sku: text('sku'),
  quantity: integer('quantity').notNull(),
  unitPrice: text('unit_price').notNull(),
  lineTotal: text('line_total'),
  metrcTag: text('metrc_tag'),
})

// Lab Testing / CoA
export const labTest = pgTable('lab_tests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  batchId: text('batch_id').references(() => batch.id),
  productId: text('product_id').references(() => product.id),
  metrcTag: text('metrc_tag'),
  labName: text('lab_name'),
  labLicenseNumber: text('lab_license_number'),
  sampleId: text('sample_id'),
  testOrderNumber: text('test_order_number'),
  status: text('status').default('submitted'), // submitted|in_progress|passed|failed|retesting
  overallResult: text('overall_result'), // pass|fail
  // Cannabinoid results
  totalThc: text('total_thc'),
  totalCbd: text('total_cbd'),
  totalCbg: text('total_cbg'),
  totalCbn: text('total_cbn'),
  totalCannabinoids: text('total_cannabinoids'),
  // Terpene profile
  terpenes: json('terpenes'), // Array of { name, percentage }
  totalTerpenes: text('total_terpenes'),
  // Contaminant testing
  pesticides: text('pesticides'), // pass|fail
  heavyMetals: text('heavy_metals'), // pass|fail
  microbials: text('microbials'), // pass|fail
  mycotoxins: text('mycotoxins'), // pass|fail
  residualSolvents: text('residual_solvents'), // pass|fail
  moisture: text('moisture'),
  waterActivity: text('water_activity'),
  foreignMatter: text('foreign_matter'), // pass|fail
  // CoA document
  coaUrl: text('coa_url'),
  coaData: json('coa_data'), // Full parsed CoA
  testedAt: timestamp('tested_at'),
  resultsReceivedAt: timestamp('results_received_at'),
  expiresAt: timestamp('expires_at'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lab_test_company_id_idx').on(t.companyId),
  index('lab_test_batch_id_idx').on(t.batchId),
  index('lab_test_product_id_idx').on(t.productId),
])

// ==================== FRANCHISE / MULTI-STORE ====================

export const storeGroup = pgTable('store_groups', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  type: text('type').default('chain'), // chain|franchise|coop
  parentGroupId: text('parent_group_id'),
  settings: json('settings').default({}), // Shared settings across stores
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const storeGroupMember = pgTable('store_group_members', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  groupId: text('group_id').notNull().references(() => storeGroup.id, { onDelete: 'cascade' }),
  locationId: text('location_id').notNull().references(() => location.id, { onDelete: 'cascade' }),
  role: text('role').default('member'), // owner|manager|member
  joinedAt: timestamp('joined_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('store_group_member_unique').on(t.groupId, t.locationId),
])

// ==================== TIP MANAGEMENT ====================
// (Added to order table via tipAmount field — see order schema update needed)
// Tip pooling and distribution tracking

export const tipPool = pgTable('tip_pools', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  date: date('date').notNull(),
  locationId: text('location_id').references(() => location.id),
  totalTips: text('total_tips').default('0'),
  distributionMethod: text('distribution_method').default('equal'), // equal|hours_worked|sales_volume|custom
  status: text('status').default('open'), // open|calculated|distributed
  distributions: json('distributions').default([]), // Array of { userId, amount, hours, salesVolume }
  calculatedBy: text('calculated_by').references(() => user.id),
  distributedAt: timestamp('distributed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('tip_pool_company_id_idx').on(t.companyId),
  index('tip_pool_date_idx').on(t.date),
])

// ==================== CUSTOMER CHECK-IN & QUEUE ====================

export const checkinQueue = pgTable('checkin_queue', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  contactId: text('contact_id').references(() => contact.id),
  customerName: text('customer_name'),
  customerPhone: text('customer_phone'),
  status: text('status').default('waiting'), // waiting|called|serving|completed|no_show
  position: integer('position'),
  source: text('source').default('walk_in'), // walk_in|qr_code|online_order|curbside|kiosk
  orderId: text('order_id').references(() => order.id), // Pre-existing online/pickup order
  assignedBudtenderId: text('assigned_budtender_id').references(() => user.id),
  idScanned: boolean('id_scanned').default(false),
  idVerified: boolean('id_verified').default(false),
  idData: json('id_data'), // { firstName, lastName, dob, expiration, state, idNumber, idType, rawBarcode }
  isMedical: boolean('is_medical').default(false),
  medicalCardNumber: text('medical_card_number'),
  medicalCardExpiry: date('medical_card_expiry'),
  medicalCardImageUrl: text('medical_card_image_url'),
  customerFlags: json('customer_flags').default([]), // Array of { flag, reason, flaggedBy, flaggedAt }
  priority: integer('priority').default(0), // Higher = served first (online orders, VIP)
  estimatedWaitMinutes: integer('estimated_wait_minutes'),
  notes: text('notes'),
  checkedInAt: timestamp('checked_in_at').defaultNow().notNull(),
  calledAt: timestamp('called_at'),
  servingAt: timestamp('serving_at'),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('checkin_queue_company_id_idx').on(t.companyId),
  index('checkin_queue_location_id_idx').on(t.locationId),
  index('checkin_queue_status_idx').on(t.status),
])

// ==================== ID SCANNING ====================

export const idScan = pgTable('id_scans', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  scanMethod: text('scan_method').notNull(), // barcode|magnetic_stripe|ocr|manual|digital_id
  idType: text('id_type'), // drivers_license|state_id|passport|military|tribal
  idState: text('id_state'),
  idNumber: text('id_number'), // Hashed for privacy
  firstName: text('first_name'),
  lastName: text('last_name'),
  dateOfBirth: date('date_of_birth'),
  expirationDate: date('expiration_date'),
  isExpired: boolean('is_expired').default(false),
  isUnderage: boolean('is_underage').default(false),
  isFlagged: boolean('is_flagged').default(false), // Suspicious/fake
  flagReason: text('flag_reason'),
  ageAtScan: integer('age_at_scan'),
  rawData: json('raw_data'), // Encrypted scan data
  scannedBy: text('scanned_by').references(() => user.id),
  deviceId: text('device_id'),
  locationId: text('location_id').references(() => location.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('id_scan_company_id_idx').on(t.companyId),
  index('id_scan_contact_id_idx').on(t.contactId),
  index('id_scan_created_at_idx').on(t.createdAt),
])

// ==================== BIOTRACK CONFIG ====================

export const biotrackConfig = pgTable('biotrack_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  apiUrl: text('api_url'),
  username: text('username'),
  password: text('password'), // Encrypted
  licenseNumber: text('license_number'),
  state: text('state'),
  environment: text('environment').default('production'),
  autoSync: boolean('auto_sync').default(true),
  syncInterval: integer('sync_interval').default(15),
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const biotrackSyncLog = pgTable('biotrack_sync_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  syncType: text('sync_type').notNull(),
  status: text('status').notNull(),
  recordsProcessed: integer('records_processed').default(0),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
})

// ==================== PLAID / PAY BY BANK ====================

export const plaidConfig = pgTable('plaid_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  plaidClientId: text('plaid_client_id'),
  plaidSecret: text('plaid_secret'),
  plaidEnvironment: text('plaid_environment').default('sandbox'), // sandbox|development|production
  enabled: boolean('enabled').default(false),
  processorPartner: text('processor_partner'), // For ACH routing
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const customerBankAccount = pgTable('customer_bank_accounts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  plaidAccessToken: text('plaid_access_token'), // Encrypted
  plaidAccountId: text('plaid_account_id'),
  institutionName: text('institution_name'),
  accountName: text('account_name'),
  accountMask: text('account_mask'), // Last 4 digits
  accountType: text('account_type'), // checking|savings
  isDefault: boolean('is_default').default(true),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('customer_bank_company_idx').on(t.companyId),
  index('customer_bank_contact_idx').on(t.contactId),
])

export const achTransaction = pgTable('ach_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  orderId: text('order_id').references(() => order.id),
  bankAccountId: text('bank_account_id').references(() => customerBankAccount.id),
  amount: text('amount').notNull(),
  status: text('status').default('pending'), // pending|processing|completed|failed|returned
  transferId: text('transfer_id'), // From Plaid/processor
  failureReason: text('failure_reason'),
  processedAt: timestamp('processed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('ach_tx_company_idx').on(t.companyId),
  index('ach_tx_order_idx').on(t.orderId),
])

// ==================== DIGITAL WALLET LOYALTY PASSES ====================

export const walletPass = pgTable('wallet_passes', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  loyaltyMemberId: text('loyalty_member_id').references(() => loyaltyMember.id),
  platform: text('platform').notNull(), // apple|google
  passTypeId: text('pass_type_id'), // Apple pass type identifier
  serialNumber: text('serial_number').notNull().unique(),
  authToken: text('auth_token'),
  pushToken: text('push_token'), // For push updates
  lastUpdatedAt: timestamp('last_updated_at'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('wallet_pass_company_idx').on(t.companyId),
  index('wallet_pass_contact_idx').on(t.contactId),
])

// ==================== AI BUDTENDER / CONVERSATIONAL ====================

export const aiBudtenderSession = pgTable('ai_budtender_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  sessionToken: text('session_token').notNull().unique(),
  channel: text('channel').default('website'), // website|kiosk|mobile_app|sms
  messages: json('messages').default([]).notNull(), // Array of { role: 'user'|'assistant', content, timestamp }
  recommendedProducts: json('recommended_products').default([]), // Array of productIds
  cartItems: json('cart_items').default([]), // Items added from AI suggestions
  convertedToOrder: boolean('converted_to_order').default(false),
  orderId: text('order_id').references(() => order.id),
  satisfaction: integer('satisfaction'), // 1-5 rating
  startedAt: timestamp('started_at').defaultNow().notNull(),
  lastMessageAt: timestamp('last_message_at'),
  completedAt: timestamp('completed_at'),
}, (t) => [
  index('ai_budtender_company_idx').on(t.companyId),
  index('ai_budtender_token_idx').on(t.sessionToken),
])

export const aiBudtenderConfig = pgTable('ai_budtender_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  enabled: boolean('enabled').default(true),
  personality: text('personality').default('friendly'), // friendly|professional|casual|expert
  greeting: text('greeting'),
  systemPrompt: text('system_prompt'), // Custom instructions for the AI
  maxRecommendations: integer('max_recommendations').default(5),
  enabledChannels: json('enabled_channels').default(['website', 'kiosk']),
  temperature: text('temperature').default('0.7'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SEO / INDIVIDUAL PRODUCT PAGES ====================

export const seoProductPage = pgTable('seo_product_pages', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  slug: text('slug').notNull(),
  metaTitle: text('meta_title'),
  metaDescription: text('meta_description'),
  canonicalUrl: text('canonical_url'),
  ogImage: text('og_image'),
  structuredData: json('structured_data'), // JSON-LD schema.org Product
  customContent: text('custom_content'), // Additional marketing copy
  isPublished: boolean('is_published').default(true),
  lastIndexedAt: timestamp('last_indexed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('seo_product_slug_unique').on(t.companyId, t.slug),
  index('seo_product_company_idx').on(t.companyId),
])

// ==================== PREDICTIVE INVENTORY ====================

export const inventoryForecast = pgTable('inventory_forecasts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  forecastDate: date('forecast_date').notNull(),
  predictedDailySales: text('predicted_daily_sales'),
  daysUntilStockout: integer('days_until_stockout'),
  suggestedReorderQty: integer('suggested_reorder_qty'),
  suggestedReorderDate: date('suggested_reorder_date'),
  confidence: real('confidence'), // 0-1
  algorithm: text('algorithm').default('moving_average'), // moving_average|exponential_smoothing|seasonal
  inputData: json('input_data'), // { historicalSales, seasonality, trend }
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('inv_forecast_company_idx').on(t.companyId),
  index('inv_forecast_product_idx').on(t.productId),
])

export const reorderSuggestion = pgTable('reorder_suggestions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id),
  locationId: text('location_id').references(() => location.id),
  currentStock: integer('current_stock'),
  suggestedQuantity: integer('suggested_quantity'),
  estimatedStockoutDate: date('estimated_stockout_date'),
  urgency: text('urgency').default('normal'), // low|normal|high|critical
  supplier: text('supplier'),
  estimatedCost: text('estimated_cost'),
  status: text('status').default('pending'), // pending|approved|ordered|dismissed
  approvedBy: text('approved_by').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('reorder_company_idx').on(t.companyId),
])

// ==================== GAMIFIED LOYALTY ====================

export const loyaltyChallenge = pgTable('loyalty_challenges', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  type: text('type').notNull(), // visit_streak|spending_goal|category_explorer|referral_race|daily_spin|punch_card
  rules: json('rules').notNull(), // { target, period, category, multiplier, etc. }
  rewardType: text('reward_type').notNull(), // points|discount_percent|discount_fixed|free_item|multiplier
  rewardValue: text('reward_value').notNull(),
  bonusMultiplier: real('bonus_multiplier'), // e.g., 2x points during event
  imageUrl: text('image_url'),
  startDate: date('start_date'),
  endDate: date('end_date'),
  maxParticipants: integer('max_participants'),
  isActive: boolean('is_active').default(true),
  isRecurring: boolean('is_recurring').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('loyalty_challenge_company_idx').on(t.companyId),
])

export const loyaltyChallengeProgress = pgTable('loyalty_challenge_progress', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  challengeId: text('challenge_id').notNull().references(() => loyaltyChallenge.id, { onDelete: 'cascade' }),
  memberId: text('member_id').notNull().references(() => loyaltyMember.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  progress: json('progress').default({}), // { currentStreak, totalVisits, amountSpent, categoriesVisited, etc. }
  percentComplete: real('percent_complete').default(0),
  isCompleted: boolean('is_completed').default(false),
  rewardClaimed: boolean('reward_claimed').default(false),
  completedAt: timestamp('completed_at'),
  claimedAt: timestamp('claimed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('challenge_member_unique').on(t.challengeId, t.memberId),
  index('challenge_progress_company_idx').on(t.companyId),
])

// ==================== DIGITAL SIGNAGE ====================

export const digitalSign = pgTable('digital_signs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  name: text('name').notNull(),
  type: text('type').default('menu_board'), // menu_board|promo|wait_time|welcome|custom
  deviceId: text('device_id'),
  resolution: text('resolution'), // 1920x1080, 3840x2160
  orientation: text('orientation').default('landscape'),
  content: json('content').default({}), // { layout, slides, rotation_seconds, theme }
  playlist: json('playlist').default([]), // Array of { contentType, data, duration }
  isOnline: boolean('is_online').default(false),
  lastHeartbeat: timestamp('last_heartbeat'),
  refreshInterval: integer('refresh_interval').default(60), // seconds
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('digital_sign_company_idx').on(t.companyId),
])

// ==================== CURBSIDE PICKUP ====================

export const curbsideCheckin = pgTable('curbside_checkins', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  orderId: text('order_id').notNull().references(() => order.id),
  contactId: text('contact_id').references(() => contact.id),
  locationId: text('location_id').references(() => location.id),
  vehicleDescription: text('vehicle_description'), // "Red Toyota Camry"
  parkingSpot: text('parking_spot'),
  status: text('status').default('arrived'), // arrived|preparing|bringing_out|completed
  customerNotes: text('customer_notes'),
  assignedStaffId: text('assigned_staff_id').references(() => user.id),
  notifiedAt: timestamp('notified_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('curbside_company_idx').on(t.companyId),
  index('curbside_order_idx').on(t.orderId),
])

// ==================== PRODUCT EQUIVALENCY ====================

export const equivalencyRule = pgTable('equivalency_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  state: text('state').notNull(),
  category: text('category').notNull(), // flower|concentrate|edible|tincture|topical
  equivalencyFactor: text('equivalency_factor').notNull(), // Grams of flower equivalent per unit
  unitOfMeasure: text('unit_of_measure').notNull(), // grams|mg|ml|each
  description: text('description'),
  isActive: boolean('is_active').default(true),
  effectiveDate: date('effective_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('equiv_rule_company_idx').on(t.companyId),
  index('equiv_rule_state_idx').on(t.state),
])

// ==================== TAX FILING ====================

export const taxFiling = pgTable('tax_filings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  filingType: text('filing_type').notNull(), // excise_tax|sales_tax|local_tax|combined
  period: text('period').notNull(), // monthly|quarterly|annual
  periodStart: date('period_start').notNull(),
  periodEnd: date('period_end').notNull(),
  state: text('state'),
  jurisdiction: text('jurisdiction'),
  totalTaxableAmount: text('total_taxable_amount'),
  totalTaxDue: text('total_tax_due'),
  totalTaxCollected: text('total_tax_collected'),
  variance: text('variance'),
  status: text('status').default('draft'), // draft|calculated|reviewed|filed|confirmed
  filingData: json('filing_data'), // Full breakdown for the return
  filedAt: timestamp('filed_at'),
  filedBy: text('filed_by').references(() => user.id),
  confirmationNumber: text('confirmation_number'),
  dueDate: date('due_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('tax_filing_company_idx').on(t.companyId),
  index('tax_filing_period_idx').on(t.periodStart),
])

// ==================== INTEGRATIONS MARKETPLACE ====================

export const integrationPartner = pgTable('integration_partners', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  description: text('description'),
  category: text('category').notNull(), // loyalty|payments|delivery|marketing|analytics|compliance|hardware|menu
  logoUrl: text('logo_url'),
  websiteUrl: text('website_url'),
  apiBaseUrl: text('api_base_url'),
  authType: text('auth_type'), // api_key|oauth2|basic|webhook
  configSchema: json('config_schema'), // JSON schema for required config fields
  isActive: boolean('is_active').default(true),
  isFeatured: boolean('is_featured').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const companyIntegration = pgTable('company_integrations', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  partnerId: text('partner_id').notNull().references(() => integrationPartner.id),
  status: text('status').default('inactive'), // inactive|configuring|active|error|disabled
  config: json('config').default({}), // Partner-specific config (API keys, etc.)
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  enabledAt: timestamp('enabled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('company_integration_unique').on(t.companyId, t.partnerId),
  index('company_integration_company_idx').on(t.companyId),
])

// ==================== HEALTH / UPTIME MONITORING ====================

export const healthCheck = pgTable('health_checks', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  service: text('service').notNull(), // pos|api|database|metrc|biotrack|payments|website
  status: text('status').notNull(), // healthy|degraded|down
  responseTimeMs: integer('response_time_ms'),
  statusCode: integer('status_code'),
  error: text('error'),
  metadata: json('metadata'),
  checkedAt: timestamp('checked_at').defaultNow().notNull(),
}, (t) => [
  index('health_check_company_idx').on(t.companyId),
  index('health_check_service_idx').on(t.service),
  index('health_check_checked_at_idx').on(t.checkedAt),
])

export const uptimeIncident = pgTable('uptime_incidents', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  service: text('service').notNull(),
  severity: text('severity').default('minor'), // minor|major|critical
  title: text('title').notNull(),
  description: text('description'),
  status: text('status').default('investigating'), // investigating|identified|monitoring|resolved
  startedAt: timestamp('started_at').defaultNow().notNull(),
  resolvedAt: timestamp('resolved_at'),
  updates: json('updates').default([]), // Array of { status, message, timestamp }
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== ONBOARDING / SUCCESS MANAGER ====================

export const onboardingChecklist = pgTable('onboarding_checklists', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  assignedManagerId: text('assigned_manager_id'),
  assignedManagerName: text('assigned_manager_name'),
  assignedManagerEmail: text('assigned_manager_email'),
  status: text('status').default('not_started'), // not_started|in_progress|completed
  steps: json('steps').default([]).notNull(), // Array of { id, title, description, isCompleted, completedAt, completedBy }
  kickoffScheduledAt: timestamp('kickoff_scheduled_at'),
  kickoffCompletedAt: timestamp('kickoff_completed_at'),
  targetGoLiveDate: date('target_go_live_date'),
  actualGoLiveDate: date('actual_go_live_date'),
  notes: json('notes').default([]),
  percentComplete: real('percent_complete').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== HARDWARE CATALOG ====================

export const hardwareProduct = pgTable('hardware_products', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  category: text('category').notNull(), // pos_terminal|tablet|receipt_printer|label_printer|barcode_scanner|id_scanner|rfid_reader|cash_drawer|kiosk|display
  brand: text('brand'),
  model: text('model'),
  description: text('description'),
  price: text('price'),
  imageUrl: text('image_url'),
  specs: json('specs'), // { dimensions, weight, connectivity, os, etc. }
  compatibleWith: json('compatible_with').default([]), // Array of feature IDs this hardware supports
  inStock: boolean('in_stock').default(true),
  isRecommended: boolean('is_recommended').default(false),
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const hardwareOrder = pgTable('hardware_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  orderNumber: text('order_number').notNull(),
  items: json('items').default([]).notNull(), // Array of { productId, name, quantity, unitPrice, total }
  subtotal: text('subtotal'),
  shippingCost: text('shipping_cost'),
  tax: text('tax'),
  total: text('total'),
  status: text('status').default('pending'), // pending|confirmed|shipped|delivered|cancelled
  shippingAddress: text('shipping_address'),
  trackingNumber: text('tracking_number'),
  orderedBy: text('ordered_by').references(() => user.id),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('hw_order_company_idx').on(t.companyId),
])

// ==================== CONSUMER MOBILE APP ====================

export const mobileAppConfig = pgTable('mobile_app_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  appName: text('app_name'),
  bundleId: text('bundle_id'), // com.dispensaryname.app
  appStoreUrl: text('app_store_url'),
  playStoreUrl: text('play_store_url'),
  iconUrl: text('icon_url'),
  splashScreenUrl: text('splash_screen_url'),
  primaryColor: text('primary_color'),
  enablePushNotifications: boolean('enable_push_notifications').default(true),
  enableOrderAhead: boolean('enable_order_ahead').default(true),
  enableLoyalty: boolean('enable_loyalty').default(true),
  enablePayByBank: boolean('enable_pay_by_bank').default(false),
  enableAiBudtender: boolean('enable_ai_budtender').default(false),
  deeplinkScheme: text('deeplink_scheme'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== SOC 2 TECHNICAL CONTROLS ====================

// CC6.1 — MFA / Two-Factor Authentication
export const mfaDevice = pgTable('mfa_devices', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // totp|sms|email|backup_codes
  name: text('name'), // "Google Authenticator", "Work Phone"
  secret: text('secret'), // TOTP secret (encrypted)
  phoneNumber: text('phone_number'), // For SMS MFA
  backupCodes: json('backup_codes'), // Array of hashed backup codes
  isVerified: boolean('is_verified').default(false),
  isPrimary: boolean('is_primary').default(false),
  lastUsedAt: timestamp('last_used_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('mfa_device_user_idx').on(t.userId),
])

export const mfaChallenge = pgTable('mfa_challenges', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  deviceId: text('device_id').references(() => mfaDevice.id),
  code: text('code'), // Hashed
  type: text('type').notNull(), // totp|sms|email
  status: text('status').default('pending'), // pending|verified|expired|failed
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  expiresAt: timestamp('expires_at').notNull(),
  verifiedAt: timestamp('verified_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// CC6.1 — Password Policy
export const passwordPolicy = pgTable('password_policies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  minLength: integer('min_length').default(12),
  requireUppercase: boolean('require_uppercase').default(true),
  requireLowercase: boolean('require_lowercase').default(true),
  requireNumbers: boolean('require_numbers').default(true),
  requireSpecialChars: boolean('require_special_chars').default(true),
  maxAgeDays: integer('max_age_days').default(90), // Force password change every N days
  historyCount: integer('history_count').default(5), // Can't reuse last N passwords
  maxFailedAttempts: integer('max_failed_attempts').default(5),
  lockoutDurationMinutes: integer('lockout_duration_minutes').default(30),
  mfaRequired: boolean('mfa_required').default(false),
  mfaRequiredForRoles: json('mfa_required_for_roles').default(['owner', 'admin']),
  sessionTimeoutMinutes: integer('session_timeout_minutes').default(480), // 8 hours
  idleTimeoutMinutes: integer('idle_timeout_minutes').default(30),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const passwordHistory = pgTable('password_history', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  passwordHash: text('password_hash').notNull(),
  changedAt: timestamp('changed_at').defaultNow().notNull(),
}, (t) => [
  index('password_history_user_idx').on(t.userId),
])

// CC6.2 — Security Event Logging (beyond audit_log — SOC 2 specific)
export const securityEvent = pgTable('security_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  eventType: text('event_type').notNull(), // login_success|login_failure|mfa_failure|password_change|permission_change|data_export|data_deletion|api_key_created|suspicious_activity|session_hijack_attempt|brute_force_detected|unauthorized_access
  severity: text('severity').default('info'), // info|warning|critical
  description: text('description'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  geoLocation: text('geo_location'),
  metadata: json('metadata'),
  acknowledged: boolean('acknowledged').default(false),
  acknowledgedBy: text('acknowledged_by'),
  acknowledgedAt: timestamp('acknowledged_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('security_event_company_idx').on(t.companyId),
  index('security_event_type_idx').on(t.eventType),
  index('security_event_severity_idx').on(t.severity),
  index('security_event_created_at_idx').on(t.createdAt),
])

// CC6.3 — Active Sessions (for session management + force logout)
export const activeSession = pgTable('active_sessions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  tokenHash: text('token_hash').notNull(), // Hash of refresh token
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  deviceType: text('device_type'), // desktop|mobile|tablet|api
  location: text('location'),
  isActive: boolean('is_active').default(true),
  lastActivityAt: timestamp('last_activity_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at').notNull(),
  revokedAt: timestamp('revoked_at'),
  revokedBy: text('revoked_by'),
  revokedReason: text('revoked_reason'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('active_session_user_idx').on(t.userId),
  index('active_session_company_idx').on(t.companyId),
  index('active_session_token_idx').on(t.tokenHash),
])

// CC7.2 — Data Retention Policies
export const dataRetentionPolicy = pgTable('data_retention_policies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  dataCategory: text('data_category').notNull(), // orders|contacts|audit_logs|security_events|id_scans|session_logs|analytics|metrc_sync|messages
  retentionDays: integer('retention_days').notNull(), // How long to keep
  action: text('action').default('archive'), // archive|anonymize|delete
  isActive: boolean('is_active').default(true),
  lastPurgeAt: timestamp('last_purge_at'),
  nextPurgeAt: timestamp('next_purge_at'),
  recordsPurged: integer('records_purged').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('retention_company_idx').on(t.companyId),
])

export const dataPurgeLog = pgTable('data_purge_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  policyId: text('policy_id').references(() => dataRetentionPolicy.id),
  dataCategory: text('data_category').notNull(),
  action: text('action').notNull(),
  recordsAffected: integer('records_affected'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),
  error: text('error'),
})

// CC7.3 — Access Reviews (periodic review of who has access to what)
export const accessReview = pgTable('access_reviews', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  reviewPeriod: text('review_period'), // Q1-2026, Q2-2026, etc.
  status: text('status').default('pending'), // pending|in_progress|completed
  reviewerId: text('reviewer_id').references(() => user.id),
  entries: json('entries').default([]).notNull(), // Array of { userId, role, permissions, decision: 'keep'|'modify'|'revoke', notes }
  completedAt: timestamp('completed_at'),
  nextReviewDate: date('next_review_date'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('access_review_company_idx').on(t.companyId),
])

// CC8.1 — Change Management
export const changeLog = pgTable('change_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').references(() => company.id, { onDelete: 'cascade' }),
  changeType: text('change_type').notNull(), // config_change|permission_change|feature_toggle|integration_change|schema_migration|deployment
  category: text('category'), // security|operational|compliance|feature
  description: text('description').notNull(),
  changedBy: text('changed_by'),
  approvedBy: text('approved_by'),
  previousValue: json('previous_value'),
  newValue: json('new_value'),
  riskLevel: text('risk_level').default('low'), // low|medium|high|critical
  rollbackPlan: text('rollback_plan'),
  rolledBack: boolean('rolled_back').default(false),
  rolledBackAt: timestamp('rolled_back_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('change_log_company_idx').on(t.companyId),
  index('change_log_type_idx').on(t.changeType),
  index('change_log_created_at_idx').on(t.createdAt),
])

// CC9.1 — Encryption Key Management
export const encryptionKey = pgTable('encryption_keys', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  keyAlias: text('key_alias').notNull(), // pii_encryption|payment_data|api_keys|metrc_credentials
  algorithm: text('algorithm').default('aes-256-gcm'),
  keyVersion: integer('key_version').default(1),
  isActive: boolean('is_active').default(true),
  rotatedAt: timestamp('rotated_at'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('encryption_key_company_idx').on(t.companyId),
])

// A1.2 — Backup Verification
export const backupVerification = pgTable('backup_verifications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  backupType: text('backup_type').notNull(), // database|files|configuration
  status: text('status').notNull(), // success|failure|partial
  backupSize: text('backup_size'),
  restoreTestPassed: boolean('restore_test_passed'),
  restoreTestDetails: text('restore_test_details'),
  verifiedBy: text('verified_by'),
  verifiedAt: timestamp('verified_at').defaultNow().notNull(),
  nextScheduled: timestamp('next_scheduled'),
  metadata: json('metadata'),
})

// SOC 2 Compliance Dashboard Data
export const soc2ComplianceStatus = pgTable('soc2_compliance_status', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  // Trust Service Criteria scores (percentage)
  securityScore: integer('security_score').default(0),
  availabilityScore: integer('availability_score').default(0),
  processingIntegrityScore: integer('processing_integrity_score').default(0),
  confidentialityScore: integer('confidentiality_score').default(0),
  privacyScore: integer('privacy_score').default(0),
  overallScore: integer('overall_score').default(0),
  // Control statuses
  controls: json('controls').default([]).notNull(), // Array of { id, name, category, status: 'pass'|'fail'|'warning'|'not_configured', details, lastCheckedAt }
  lastAssessmentAt: timestamp('last_assessment_at'),
  nextAssessmentDue: date('next_assessment_due'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== GROW INPUTS & TRACEABILITY ====================

export const growInput = pgTable('grow_inputs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  brand: text('brand'),
  type: text('type').notNull(), // nutrient|pesticide|fungicide|herbicide|soil|amendment|beneficial_insect|co2|water_treatment|ph_adjuster|growth_hormone|other
  category: text('category'), // organic|synthetic|biological|mineral
  activeIngredients: json('active_ingredients').default([]), // Array of { name, concentration, unit }
  isOrganic: boolean('is_organic').default(false),
  isOMRIListed: boolean('is_omri_listed').default(false),
  isBannedSubstance: boolean('is_banned_substance').default(false),
  safetyDataSheetUrl: text('safety_data_sheet_url'),
  epaRegistration: text('epa_registration'),
  manufacturer: text('manufacturer'),
  supplier: text('supplier'),
  sku: text('sku'),
  barcode: text('barcode'),
  qrCode: text('qr_code'),
  unitOfMeasure: text('unit_of_measure').default('ml'),
  currentStock: text('current_stock').default('0'),
  minStock: text('min_stock').default('0'),
  costPerUnit: text('cost_per_unit'),
  locationId: text('location_id').references(() => location.id),
  storageRequirements: text('storage_requirements'),
  expirationDate: date('expiration_date'),
  batchNumber: text('batch_number'),
  notes: text('notes'),
  imageUrl: text('image_url'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('grow_input_company_idx').on(t.companyId),
  index('grow_input_type_idx').on(t.type),
])

export const inputApplication = pgTable('input_applications', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  growInputId: text('grow_input_id').notNull().references(() => growInput.id),
  plantId: text('plant_id').references(() => plant.id),
  batchId: text('batch_id').references(() => batch.id),
  roomId: text('room_id').references(() => growRoom.id),
  harvestId: text('harvest_id').references(() => harvest.id),
  quantity: text('quantity').notNull(),
  unitOfMeasure: text('unit_of_measure').notNull(),
  dilutionRatio: text('dilution_ratio'),
  applicationMethod: text('application_method'), // foliar_spray|root_drench|top_dress|injection|fogger|other
  targetArea: text('target_area'), // leaves|roots|soil|full_plant|room
  growPhase: text('grow_phase'), // clone|seedling|vegetative|flowering|harvest|cure
  reason: text('reason'), // feeding|pest_control|disease_prevention|ph_adjustment|flush|other
  preHarvestInterval: integer('pre_harvest_interval'), // Days before harvest to stop
  appliedBy: text('applied_by').references(() => user.id),
  supervisedBy: text('supervised_by').references(() => user.id),
  notes: text('notes'),
  imageUrls: json('image_urls').default([]),
  appliedAt: timestamp('applied_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('input_app_company_idx').on(t.companyId),
  index('input_app_input_idx').on(t.growInputId),
  index('input_app_plant_idx').on(t.plantId),
  index('input_app_batch_idx').on(t.batchId),
  index('input_app_applied_at_idx').on(t.appliedAt),
])

export const inputPolicy = pgTable('input_policies', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  rules: json('rules').default([]).notNull(), // Array of { rule, value, description }
  bannedIngredients: json('banned_ingredients').default([]),
  requiredCertifications: json('required_certifications').default([]),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const qrScanEvent = pgTable('qr_scan_events', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  entityType: text('entity_type').notNull(), // product|batch|plant|grow_input|label
  entityId: text('entity_id').notNull(),
  scannerType: text('scanner_type').default('camera'),
  context: text('context'), // pos_checkout|inventory_count|customer_info|input_application|receiving
  scannedBy: text('scanned_by'),
  deviceInfo: text('device_info'),
  resultAction: text('result_action'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('qr_scan_company_idx').on(t.companyId),
  index('qr_scan_entity_idx').on(t.entityType, t.entityId),
])

// ==================== EMPLOYEE SCHEDULING ====================

export const shift = pgTable('shifts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  locationId: text('location_id').references(() => location.id),
  role: text('role'), // budtender|manager|security|driver|inventory
  date: date('date').notNull(),
  startTime: text('start_time').notNull(), // "09:00"
  endTime: text('end_time').notNull(), // "17:00"
  breakMinutes: integer('break_minutes').default(30),
  status: text('status').default('scheduled'), // scheduled|confirmed|clocked_in|clocked_out|no_show|cancelled
  clockInAt: timestamp('clock_in_at'),
  clockOutAt: timestamp('clock_out_at'),
  actualHours: text('actual_hours'),
  overtimeHours: text('overtime_hours'),
  notes: text('notes'),
  swapRequested: boolean('swap_requested').default(false),
  swapWithUserId: text('swap_with_user_id'),
  swapStatus: text('swap_status'), // pending|approved|rejected
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('shift_company_idx').on(t.companyId),
  index('shift_user_idx').on(t.userId),
  index('shift_date_idx').on(t.date),
  index('shift_location_idx').on(t.locationId),
])

export const scheduleTemplate = pgTable('schedule_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  shifts: json('shifts').default([]).notNull(), // Array of { dayOfWeek, userId, role, startTime, endTime, locationId }
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

export const timeEntry = pgTable('time_entries', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id),
  shiftId: text('shift_id').references(() => shift.id),
  clockIn: timestamp('clock_in').notNull(),
  clockOut: timestamp('clock_out'),
  breakStart: timestamp('break_start'),
  breakEnd: timestamp('break_end'),
  totalMinutes: integer('total_minutes'),
  breakMinutes: integer('break_minutes'),
  overtimeMinutes: integer('overtime_minutes'),
  locationId: text('location_id').references(() => location.id),
  notes: text('notes'),
  approvedBy: text('approved_by').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  payrollExported: boolean('payroll_exported').default(false),
  payrollExportedAt: timestamp('payroll_exported_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('time_entry_company_idx').on(t.companyId),
  index('time_entry_user_idx').on(t.userId),
])

// ==================== TRAINING / LMS ====================

export const trainingCourse = pgTable('training_courses', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  description: text('description'),
  category: text('category'), // compliance|product_knowledge|pos_training|safety|customer_service|company_policy
  type: text('type').default('self_paced'), // self_paced|instructor_led|video|quiz
  content: json('content').default([]).notNull(), // Array of { type: 'text'|'video'|'quiz'|'checklist', title, body, videoUrl, questions }
  passingScore: integer('passing_score').default(80),
  estimatedMinutes: integer('estimated_minutes'),
  isRequired: boolean('is_required').default(false),
  requiredForRoles: json('required_for_roles').default([]),
  dueWithinDays: integer('due_within_days'), // Must complete within N days of hire
  renewalMonths: integer('renewal_months'), // Recertify every N months
  isActive: boolean('is_active').default(true),
  createdBy: text('created_by').references(() => user.id),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('training_course_company_idx').on(t.companyId),
])

export const trainingEnrollment = pgTable('training_enrollments', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  courseId: text('course_id').notNull().references(() => trainingCourse.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  status: text('status').default('assigned'), // assigned|in_progress|completed|failed|expired
  progress: json('progress').default({}), // { currentStep, answers, timeSpent }
  percentComplete: real('percent_complete').default(0),
  score: integer('score'),
  attempts: integer('attempts').default(0),
  startedAt: timestamp('started_at'),
  completedAt: timestamp('completed_at'),
  expiresAt: timestamp('expires_at'),
  certificateUrl: text('certificate_url'),
  assignedBy: text('assigned_by'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('enrollment_unique').on(t.courseId, t.userId),
  index('enrollment_company_idx').on(t.companyId),
  index('enrollment_user_idx').on(t.userId),
])

// ==================== FRAUD / THEFT DETECTION ====================

export const fraudAlert = pgTable('fraud_alerts', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  alertType: text('alert_type').notNull(), // inventory_discrepancy|excessive_voids|unusual_discount|cash_variance|after_hours_activity|pattern_anomaly|shrinkage
  severity: text('severity').default('medium'), // low|medium|high|critical
  description: text('description').notNull(),
  relatedUserId: text('related_user_id').references(() => user.id),
  relatedOrderId: text('related_order_id'),
  relatedProductId: text('related_product_id'),
  locationId: text('location_id').references(() => location.id),
  evidence: json('evidence'), // { details, thresholdValue, actualValue, pattern }
  status: text('status').default('open'), // open|investigating|resolved|dismissed
  resolvedBy: text('resolved_by').references(() => user.id),
  resolvedAt: timestamp('resolved_at'),
  resolution: text('resolution'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('fraud_alert_company_idx').on(t.companyId),
  index('fraud_alert_type_idx').on(t.alertType),
  index('fraud_alert_status_idx').on(t.status),
])

export const fraudRule = pgTable('fraud_rules', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  ruleType: text('rule_type').notNull(), // void_threshold|discount_threshold|cash_variance_threshold|inventory_variance_pct|after_hours_login|rapid_transactions
  threshold: text('threshold').notNull(),
  period: text('period'), // per_shift|per_day|per_week
  severity: text('severity').default('medium'),
  isActive: boolean('is_active').default(true),
  notifyRoles: json('notify_roles').default(['owner', 'manager']),
  createdAt: timestamp('created_at').defaultNow().notNull(),
})

// ==================== VOID / DISCOUNT APPROVAL ====================

export const approvalRequest = pgTable('approval_requests', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  type: text('type').notNull(), // void|discount|refund|price_override|time_adjustment
  requestedBy: text('requested_by').notNull().references(() => user.id),
  orderId: text('order_id').references(() => order.id),
  amount: text('amount'),
  reason: text('reason').notNull(),
  details: json('details'), // { originalPrice, newPrice, discountPercent, etc. }
  status: text('status').default('pending'), // pending|approved|rejected|expired
  approvedBy: text('approved_by').references(() => user.id),
  approvedAt: timestamp('approved_at'),
  rejectedReason: text('rejected_reason'),
  expiresAt: timestamp('expires_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('approval_company_idx').on(t.companyId),
  index('approval_status_idx').on(t.status),
])

// ==================== PURCHASE ORDERS (AUTO-RESTOCK) ====================

export const purchaseOrder = pgTable('purchase_orders', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  poNumber: text('po_number').notNull(),
  supplierId: text('supplier_id'), // wholesaleCustomer or plain text
  supplierName: text('supplier_name'),
  supplierEmail: text('supplier_email'),
  status: text('status').default('draft'), // draft|submitted|confirmed|partial_received|received|cancelled
  items: json('items').default([]).notNull(), // Array of { productId, name, sku, quantity, unitCost, total, receivedQty }
  subtotal: text('subtotal').default('0'),
  tax: text('tax').default('0'),
  shipping: text('shipping').default('0'),
  total: text('total').default('0'),
  notes: text('notes'),
  expectedDate: date('expected_date'),
  submittedAt: timestamp('submitted_at'),
  receivedAt: timestamp('received_at'),
  createdBy: text('created_by').references(() => user.id),
  locationId: text('location_id').references(() => location.id),
  reorderSuggestionId: text('reorder_suggestion_id'), // Link to predictive inventory
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('po_company_idx').on(t.companyId),
  index('po_status_idx').on(t.status),
])

// ==================== MARKETPLACE MENU SYNC ====================

export const menuSyncConfig = pgTable('menu_sync_configs', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  platform: text('platform').notNull(), // weedmaps|leafly|iheartjane|dutchie_marketplace
  apiKey: text('api_key'),
  apiSecret: text('api_secret'),
  storeId: text('store_id'),
  autoSync: boolean('auto_sync').default(false),
  syncInventory: boolean('sync_inventory').default(true),
  syncPrices: boolean('sync_prices').default(true),
  syncImages: boolean('sync_images').default(false),
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('menu_sync_company_idx').on(t.companyId),
])

// ==================== RECEIPT TEMPLATES ====================

export const receiptTemplate = pgTable('receipt_templates', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  locationId: text('location_id').references(() => location.id),
  isDefault: boolean('is_default').default(false),
  headerHtml: text('header_html'), // Logo, company name, address
  footerHtml: text('footer_html'), // Legal disclaimers, return policy
  showLogo: boolean('show_logo').default(true),
  showLicenseNumber: boolean('show_license_number').default(true),
  showMetrcTag: boolean('show_metrc_tag').default(false),
  showLabResults: boolean('show_lab_results').default(false),
  showLoyaltyPoints: boolean('show_loyalty_points').default(true),
  showBudtenderName: boolean('show_budtender_name').default(true),
  customCss: text('custom_css'),
  width: text('width').default('80mm'), // 58mm|80mm for thermal printers
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== EOD RECONCILIATION ====================

export const eodReport = pgTable('eod_reports', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  locationId: text('location_id').references(() => location.id),
  date: date('date').notNull(),
  status: text('status').default('draft'), // draft|reviewed|submitted
  // Sales summary
  totalOrders: integer('total_orders').default(0),
  totalRevenue: text('total_revenue').default('0'),
  cashRevenue: text('cash_revenue').default('0'),
  debitRevenue: text('debit_revenue').default('0'),
  achRevenue: text('ach_revenue').default('0'),
  totalTax: text('total_tax').default('0'),
  totalDiscounts: text('total_discounts').default('0'),
  totalRefunds: text('total_refunds').default('0'),
  totalVoids: integer('total_voids').default(0),
  // Cash reconciliation
  expectedCash: text('expected_cash'),
  actualCash: text('actual_cash'),
  cashVariance: text('cash_variance'),
  // Inventory
  inventoryAdjustments: integer('inventory_adjustments').default(0),
  shrinkageValue: text('shrinkage_value').default('0'),
  // Compliance
  totalCannabisWeightSold: text('total_cannabis_weight_sold').default('0'),
  purchaseLimitViolations: integer('purchase_limit_violations').default(0),
  idVerificationsPerformed: integer('id_verifications_performed').default(0),
  // Staff
  staffOnDuty: integer('staff_on_duty').default(0),
  totalLaborHours: text('total_labor_hours').default('0'),
  totalTips: text('total_tips').default('0'),
  // Loyalty
  loyaltyPointsIssued: integer('loyalty_points_issued').default(0),
  loyaltyPointsRedeemed: integer('loyalty_points_redeemed').default(0),
  newLoyaltyMembers: integer('new_loyalty_members').default(0),
  // Sign-off
  preparedBy: text('prepared_by').references(() => user.id),
  reviewedBy: text('reviewed_by').references(() => user.id),
  reviewedAt: timestamp('reviewed_at'),
  notes: text('notes'),
  complianceChecklist: json('compliance_checklist').default([]), // Array of { item, checked }
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('eod_company_idx').on(t.companyId),
  index('eod_date_idx').on(t.date),
])

// ==================== LEAF DATA SYSTEMS (Washington State) ====================

export const leafDataConfig = pgTable('leaf_data_config', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }).unique(),
  apiKey: text('api_key'),
  mmeId: text('mme_id'), // Marijuana and Marijuana-infused Edible ID
  licenseNumber: text('license_number'),
  environment: text('environment').default('production'),
  autoSync: boolean('auto_sync').default(true),
  lastSyncAt: timestamp('last_sync_at'),
  lastSyncStatus: text('last_sync_status'),
  lastSyncError: text('last_sync_error'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

// ==================== OFFLINE QUEUE ====================

export const offlineTransaction = pgTable('offline_transactions', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull(),
  locationId: text('location_id'),
  deviceId: text('device_id'),
  transactionType: text('transaction_type').notNull(), // order|payment|inventory_adjustment|checkin
  payload: json('payload').notNull(), // Full transaction data to replay
  status: text('status').default('pending'), // pending|synced|failed|conflict
  syncedAt: timestamp('synced_at'),
  syncError: text('sync_error'),
  conflictResolution: text('conflict_resolution'), // auto_resolved|manual_required|skipped
  createdOfflineAt: timestamp('created_offline_at').notNull(), // When it was created on the device
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('offline_tx_company_idx').on(t.companyId),
  index('offline_tx_status_idx').on(t.status),
])
