import { pgTable, text, boolean, integer, decimal, real, timestamp, date, time, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
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
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (t) => [
  index('order_company_id_idx').on(t.companyId),
  index('order_contact_id_idx').on(t.contactId),
  index('order_status_idx').on(t.status),
  index('order_created_at_idx').on(t.createdAt),
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
