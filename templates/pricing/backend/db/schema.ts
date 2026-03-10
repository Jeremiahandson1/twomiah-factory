import { pgTable, text, boolean, timestamp, decimal, integer, jsonb, json, date, index, unique } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { relations } from 'drizzle-orm'

// ─── Company ────────────────────────────────────────────────────────────────────

export const company = pgTable('company', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  slug: text('slug').notNull().unique(),
  email: text('email'),
  phone: text('phone'),
  logo: text('logo'),
  primaryColor: text('primary_color').default('{{PRIMARY_COLOR}}'),
  settings: jsonb('settings'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const companyRelations = relations(company, ({ many }) => ({
  users: many(user),
  territories: many(territory),
  repProfiles: many(repProfile),
  productCategories: many(productCategory),
  promotions: many(promotion),
  quotes: many(quote),
  contractTemplates: many(contractTemplate),
  resourceLibraryItems: many(resourceLibraryItem),
  financingLenders: many(financingLender),
  pricebookImports: many(pricebookImport),
  commissionRecords: many(commissionRecord),
  auditLogs: many(auditLog),
}))

// ─── User ───────────────────────────────────────────────────────────────────────

export const user = pgTable('user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  firstName: text('first_name'),
  lastName: text('last_name'),
  phone: text('phone'),
  role: text('role').default('rep').notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  refreshToken: text('refresh_token'),
  lastLogin: timestamp('last_login'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => ({
  companyIdx: index('user_company_idx').on(t.companyId),
  emailCompanyUnique: unique('user_email_company_unique').on(t.email, t.companyId),
}))

export const userRelations = relations(user, ({ one, many }) => ({
  company: one(company, { fields: [user.companyId], references: [company.id] }),
  repProfiles: many(repProfile),
}))

// ─── Territory ──────────────────────────────────────────────────────────────────

export const territory = pgTable('territory', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('territory_tenant_idx').on(t.tenantId),
}))

export const territoryRelations = relations(territory, ({ one, many }) => ({
  company: one(company, { fields: [territory.tenantId], references: [company.id] }),
  repProfiles: many(repProfile),
  priceRanges: many(priceRange),
  pricingGuardrails: many(pricingGuardrail),
}))

// ─── Rep Profile ────────────────────────────────────────────────────────────────

export const repProfile = pgTable('rep_profile', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').references(() => territory.id),
  role: text('role').default('rep').notNull(), // rep | senior_rep | manager | admin
  maxDiscountPct: decimal('max_discount_pct', { precision: 5, scale: 2 }),
  commissionBasePct: decimal('commission_base_pct', { precision: 5, scale: 2 }).default('5'),
  commissionBonusPct: decimal('commission_bonus_pct', { precision: 5, scale: 2 }).default('50'),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('rep_profile_tenant_idx').on(t.tenantId),
  userIdx: index('rep_profile_user_idx').on(t.userId),
}))

export const repProfileRelations = relations(repProfile, ({ one, many }) => ({
  company: one(company, { fields: [repProfile.tenantId], references: [company.id] }),
  user: one(user, { fields: [repProfile.userId], references: [user.id] }),
  territory: one(territory, { fields: [repProfile.territoryId], references: [territory.id] }),
  quotes: many(quote),
  commissionRecords: many(commissionRecord),
  quotePriceAdjustments: many(quotePriceAdjustment),
}))

// ─── Product Category ───────────────────────────────────────────────────────────

export const productCategory = pgTable('product_category', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  icon: text('icon'),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('product_category_tenant_idx').on(t.tenantId),
}))

export const productCategoryRelations = relations(productCategory, ({ one, many }) => ({
  company: one(company, { fields: [productCategory.tenantId], references: [company.id] }),
  products: many(product),
}))

// ─── Product ────────────────────────────────────────────────────────────────────

export const product = pgTable('product', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').notNull().references(() => productCategory.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  measurementType: text('measurement_type').notNull(), // united_inches | sq_ft | linear_ft | count | fixed
  mode: text('mode').default('menu').notNull(), // menu | estimator
  imageUrl: text('image_url'),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('product_tenant_idx').on(t.tenantId),
  categoryIdx: index('product_category_idx').on(t.categoryId),
}))

export const productRelations = relations(product, ({ one, many }) => ({
  company: one(company, { fields: [product.tenantId], references: [company.id] }),
  category: one(productCategory, { fields: [product.categoryId], references: [productCategory.id] }),
  priceRanges: many(priceRange),
  addons: many(addon),
  pricingGuardrails: many(pricingGuardrail),
  resourceLibraryItems: many(resourceLibraryItem),
  contractTemplates: many(contractTemplate),
  quoteLines: many(quoteLine),
}))

// ─── Price Range ────────────────────────────────────────────────────────────────

export const priceRange = pgTable('price_range', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').references(() => territory.id),
  minValue: decimal('min_value', { precision: 10, scale: 2 }).notNull(),
  maxValue: decimal('max_value', { precision: 10, scale: 2 }).notNull(),
  parPrice: decimal('par_price', { precision: 10, scale: 2 }).notNull(),
  retailPrice: decimal('retail_price', { precision: 10, scale: 2 }).notNull(),
  retailMarkupPct: decimal('retail_markup_pct', { precision: 5, scale: 2 }),
  yr1MarkupPct: decimal('yr1_markup_pct', { precision: 5, scale: 2 }).default('20'),
  day30MarkupPct: decimal('day30_markup_pct', { precision: 5, scale: 2 }).default('10'),
  todayDiscountPct: decimal('today_discount_pct', { precision: 5, scale: 2 }).default('10'),
}, (t) => ({
  productIdx: index('price_range_product_idx').on(t.productId),
  territoryIdx: index('price_range_territory_idx').on(t.territoryId),
}))

export const priceRangeRelations = relations(priceRange, ({ one }) => ({
  product: one(product, { fields: [priceRange.productId], references: [product.id] }),
  territory: one(territory, { fields: [priceRange.territoryId], references: [territory.id] }),
}))

// ─── Addon ──────────────────────────────────────────────────────────────────────

export const addon = pgTable('addon', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  groupName: text('group_name'),
  name: text('name').notNull(),
  description: text('description'),
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  priceType: text('price_type').default('flat').notNull(), // flat | per_unit
  required: boolean('required').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  sortOrder: integer('sort_order').default(0),
  imageUrl: text('image_url'),
  dependsOnAddonId: text('depends_on_addon_id').references(() => addon.id),
}, (t) => ({
  productIdx: index('addon_product_idx').on(t.productId),
}))

export const addonRelations = relations(addon, ({ one }) => ({
  product: one(product, { fields: [addon.productId], references: [product.id] }),
  dependsOnAddon: one(addon, { fields: [addon.dependsOnAddonId], references: [addon.id] }),
}))

// ─── Pricing Guardrail ──────────────────────────────────────────────────────────

export const pricingGuardrail = pgTable('pricing_guardrail', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => product.id, { onDelete: 'cascade' }),
  territoryId: text('territory_id').references(() => territory.id),
  floorPrice: decimal('floor_price', { precision: 10, scale: 2 }),
  maxRepDiscountPct: decimal('max_rep_discount_pct', { precision: 5, scale: 2 }),
  maxSeniorDiscountPct: decimal('max_senior_discount_pct', { precision: 5, scale: 2 }),
  managerPinRequiredBelowPct: decimal('manager_pin_required_below_pct', { precision: 5, scale: 2 }),
}, (t) => ({
  productIdx: index('pricing_guardrail_product_idx').on(t.productId),
}))

export const pricingGuardrailRelations = relations(pricingGuardrail, ({ one }) => ({
  product: one(product, { fields: [pricingGuardrail.productId], references: [product.id] }),
  territory: one(territory, { fields: [pricingGuardrail.territoryId], references: [territory.id] }),
}))

// ─── Promotion ──────────────────────────────────────────────────────────────────

export const promotion = pgTable('promotion', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  discountType: text('discount_type').notNull(), // pct | flat
  discountValue: decimal('discount_value', { precision: 10, scale: 2 }).notNull(),
  appliesTo: text('applies_to').notNull(), // all | category | product
  appliesToId: text('applies_to_id'),
  startsAt: timestamp('starts_at'),
  expiresAt: timestamp('expires_at'),
  active: boolean('active').default(true).notNull(),
  promoCode: text('promo_code'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('promotion_tenant_idx').on(t.tenantId),
}))

export const promotionRelations = relations(promotion, ({ one }) => ({
  company: one(company, { fields: [promotion.tenantId], references: [company.id] }),
}))

// ─── Resource Library Item ──────────────────────────────────────────────────────

export const resourceLibraryItem = pgTable('resource_library_item', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => product.id),
  type: text('type').notNull(), // pdf | image | video
  name: text('name').notNull(),
  url: text('url').notNull(),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('resource_library_item_tenant_idx').on(t.tenantId),
}))

export const resourceLibraryItemRelations = relations(resourceLibraryItem, ({ one }) => ({
  company: one(company, { fields: [resourceLibraryItem.tenantId], references: [company.id] }),
  product: one(product, { fields: [resourceLibraryItem.productId], references: [product.id] }),
}))

// ─── Contract Template ──────────────────────────────────────────────────────────

export const contractTemplate = pgTable('contract_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  productId: text('product_id').references(() => product.id),
  state: text('state'),
  contentHtml: text('content_html').notNull(),
  rescissionDays: integer('rescission_days').default(3),
  version: integer('version').default(1),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('contract_template_tenant_idx').on(t.tenantId),
}))

export const contractTemplateRelations = relations(contractTemplate, ({ one, many }) => ({
  company: one(company, { fields: [contractTemplate.tenantId], references: [company.id] }),
  product: one(product, { fields: [contractTemplate.productId], references: [product.id] }),
  quoteContracts: many(quoteContract),
}))

// ─── Quote ──────────────────────────────────────────────────────────────────────

export const quote = pgTable('quote', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  repId: text('rep_id').notNull().references(() => repProfile.id),
  customerName: text('customer_name').notNull(),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerState: text('customer_state'),
  referralSource: text('referral_source'),
  referralName: text('referral_name'),
  status: text('status').default('draft').notNull(), // draft | presented | signed | closed | expired | cancelled
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }).default('0'),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }),
  financingTerm: integer('financing_term'),
  financingMonthly: decimal('financing_monthly', { precision: 10, scale: 2 }),
  financingLender: text('financing_lender'),
  financingApplicationId: text('financing_application_id'),
  financingStatus: text('financing_status'),
  depositAmount: decimal('deposit_amount', { precision: 10, scale: 2 }),
  depositPaidAt: timestamp('deposit_paid_at'),
  depositMethod: text('deposit_method'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  expiresAt: timestamp('expires_at'),
  presentedAt: timestamp('presented_at'),
  signedAt: timestamp('signed_at'),
  completedAt: timestamp('completed_at'),
  syncedToCrm: boolean('synced_to_crm').default(false),
  crmJobId: text('crm_job_id'),
  offlineCreated: boolean('offline_created').default(false),
  customerToken: text('customer_token').unique(),
}, (t) => ({
  tenantIdx: index('quote_tenant_idx').on(t.tenantId),
  repIdx: index('quote_rep_idx').on(t.repId),
  statusIdx: index('quote_status_idx').on(t.status),
}))

export const quoteRelations = relations(quote, ({ one, many }) => ({
  company: one(company, { fields: [quote.tenantId], references: [company.id] }),
  rep: one(repProfile, { fields: [quote.repId], references: [repProfile.id] }),
  lines: many(quoteLine),
  contracts: many(quoteContract),
  commissionRecords: many(commissionRecord),
  inflationSnapshots: many(quoteInflationSnapshot),
}))

// ─── Quote Line ─────────────────────────────────────────────────────────────────

export const quoteLine = pgTable('quote_line', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quoteId: text('quote_id').notNull().references(() => quote.id, { onDelete: 'cascade' }),
  productId: text('product_id').notNull().references(() => product.id),
  mode: text('mode').notNull(),
  measurementValue: decimal('measurement_value', { precision: 10, scale: 2 }),
  tier: text('tier').default('best').notNull(), // good | better | best
  parPrice: decimal('par_price', { precision: 10, scale: 2 }),
  retailPrice: decimal('retail_price', { precision: 10, scale: 2 }),
  yr1Price: decimal('yr1_price', { precision: 10, scale: 2 }),
  day30Price: decimal('day30_price', { precision: 10, scale: 2 }),
  todayPrice: decimal('today_price', { precision: 10, scale: 2 }),
  presentedPrice: decimal('presented_price', { precision: 10, scale: 2 }),
  sellingPrice: decimal('selling_price', { precision: 10, scale: 2 }),
  addonsTotal: decimal('addons_total', { precision: 10, scale: 2 }).default('0'),
  quantity: integer('quantity').default(1),
  lineTotal: decimal('line_total', { precision: 10, scale: 2 }),
  discountAmount: decimal('discount_amount', { precision: 10, scale: 2 }).default('0'),
  discountReason: text('discount_reason'),
  promotionId: text('promotion_id').references(() => promotion.id),
}, (t) => ({
  quoteIdx: index('quote_line_quote_idx').on(t.quoteId),
  productIdx: index('quote_line_product_idx').on(t.productId),
}))

export const quoteLineRelations = relations(quoteLine, ({ one, many }) => ({
  quote: one(quote, { fields: [quoteLine.quoteId], references: [quote.id] }),
  product: one(product, { fields: [quoteLine.productId], references: [product.id] }),
  promotion: one(promotion, { fields: [quoteLine.promotionId], references: [promotion.id] }),
  addons: many(quoteLineAddon),
  priceAdjustments: many(quotePriceAdjustment),
}))

// ─── Quote Line Addon ───────────────────────────────────────────────────────────

export const quoteLineAddon = pgTable('quote_line_addon', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quoteLineId: text('quote_line_id').notNull().references(() => quoteLine.id, { onDelete: 'cascade' }),
  addonId: text('addon_id').notNull().references(() => addon.id),
  nameAtTime: text('name_at_time').notNull(),
  priceAtTime: decimal('price_at_time', { precision: 10, scale: 2 }).notNull(),
  quantity: integer('quantity').default(1),
}, (t) => ({
  quoteLineIdx: index('quote_line_addon_line_idx').on(t.quoteLineId),
}))

export const quoteLineAddonRelations = relations(quoteLineAddon, ({ one }) => ({
  quoteLine: one(quoteLine, { fields: [quoteLineAddon.quoteLineId], references: [quoteLine.id] }),
  addon: one(addon, { fields: [quoteLineAddon.addonId], references: [addon.id] }),
}))

// ─── Quote Contract ─────────────────────────────────────────────────────────────

export const quoteContract = pgTable('quote_contract', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quoteId: text('quote_id').notNull().references(() => quote.id, { onDelete: 'cascade' }),
  contractTemplateId: text('contract_template_id').notNull().references(() => contractTemplate.id),
  populatedHtml: text('populated_html').notNull(),
  documentHash: text('document_hash'),
  customerSignatureSvg: text('customer_signature_svg'),
  customerSignedAt: timestamp('customer_signed_at'),
  customerIp: text('customer_ip'),
  customerDeviceFingerprint: text('customer_device_fingerprint'),
  repSignatureSvg: text('rep_signature_svg'),
  repSignedAt: timestamp('rep_signed_at'),
  repIp: text('rep_ip'),
  rescissionExpiresAt: timestamp('rescission_expires_at'),
}, (t) => ({
  quoteIdx: index('quote_contract_quote_idx').on(t.quoteId),
}))

export const quoteContractRelations = relations(quoteContract, ({ one }) => ({
  quote: one(quote, { fields: [quoteContract.quoteId], references: [quote.id] }),
  contractTemplate: one(contractTemplate, { fields: [quoteContract.contractTemplateId], references: [contractTemplate.id] }),
}))

// ─── Quote Price Adjustment ─────────────────────────────────────────────────────

export const quotePriceAdjustment = pgTable('quote_price_adjustment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quoteLineId: text('quote_line_id').notNull().references(() => quoteLine.id, { onDelete: 'cascade' }),
  repId: text('rep_id').notNull().references(() => repProfile.id),
  originalPrice: decimal('original_price', { precision: 10, scale: 2 }).notNull(),
  adjustedPrice: decimal('adjusted_price', { precision: 10, scale: 2 }).notNull(),
  adjustmentReason: text('adjustment_reason'),
  managerOverride: boolean('manager_override').default(false),
  managerPinHash: text('manager_pin_hash'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  quoteLineIdx: index('quote_price_adj_line_idx').on(t.quoteLineId),
}))

export const quotePriceAdjustmentRelations = relations(quotePriceAdjustment, ({ one }) => ({
  quoteLine: one(quoteLine, { fields: [quotePriceAdjustment.quoteLineId], references: [quoteLine.id] }),
  rep: one(repProfile, { fields: [quotePriceAdjustment.repId], references: [repProfile.id] }),
}))

// ─── Commission Record ──────────────────────────────────────────────────────────

export const commissionRecord = pgTable('commission_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  repId: text('rep_id').notNull().references(() => repProfile.id),
  quoteId: text('quote_id').notNull().references(() => quote.id),
  parAmount: decimal('par_amount', { precision: 10, scale: 2 }).notNull(),
  sellingAmount: decimal('selling_amount', { precision: 10, scale: 2 }).notNull(),
  baseCommission: decimal('base_commission', { precision: 10, scale: 2 }).notNull(),
  bonusCommission: decimal('bonus_commission', { precision: 10, scale: 2 }).notNull(),
  totalCommission: decimal('total_commission', { precision: 10, scale: 2 }).notNull(),
  basePaidAt: timestamp('base_paid_at'),
  bonusPaidAt: timestamp('bonus_paid_at'),
  status: text('status').default('pending').notNull(), // pending | base_paid | completed | cancelled
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('commission_record_tenant_idx').on(t.tenantId),
  repIdx: index('commission_record_rep_idx').on(t.repId),
  quoteIdx: index('commission_record_quote_idx').on(t.quoteId),
}))

export const commissionRecordRelations = relations(commissionRecord, ({ one }) => ({
  company: one(company, { fields: [commissionRecord.tenantId], references: [company.id] }),
  rep: one(repProfile, { fields: [commissionRecord.repId], references: [repProfile.id] }),
  quote: one(quote, { fields: [commissionRecord.quoteId], references: [quote.id] }),
}))

// ─── Financing Lender ───────────────────────────────────────────────────────────

export const financingLender = pgTable('financing_lender', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  apiKeyEncrypted: text('api_key_encrypted'),
  priorityOrder: integer('priority_order').default(0),
  minAmount: decimal('min_amount', { precision: 10, scale: 2 }),
  maxAmount: decimal('max_amount', { precision: 10, scale: 2 }),
  active: boolean('active').default(true).notNull(),
  termsAvailable: json('terms_available').default([]),
}, (t) => ({
  tenantIdx: index('financing_lender_tenant_idx').on(t.tenantId),
}))

export const financingLenderRelations = relations(financingLender, ({ one }) => ({
  company: one(company, { fields: [financingLender.tenantId], references: [company.id] }),
}))

// ─── Pricebook Import ───────────────────────────────────────────────────────────

export const pricebookImport = pgTable('pricebook_import', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  filename: text('filename').notNull(),
  status: text('status').default('pending').notNull(), // pending | processing | complete | failed
  rowsTotal: integer('rows_total').default(0),
  rowsImported: integer('rows_imported').default(0),
  rowsFailed: integer('rows_failed').default(0),
  errorLog: json('error_log').default([]),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('pricebook_import_tenant_idx').on(t.tenantId),
}))

export const pricebookImportRelations = relations(pricebookImport, ({ one }) => ({
  company: one(company, { fields: [pricebookImport.tenantId], references: [company.id] }),
}))

// ─── Quote Inflation Snapshot ───────────────────────────────────────────────────

export const quoteInflationSnapshot = pgTable('quote_inflation_snapshot', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  quoteId: text('quote_id').notNull().references(() => quote.id, { onDelete: 'cascade' }),
  snapshotDate: date('snapshot_date').notNull(),
  materialsIndex1yr: decimal('materials_index_1yr', { precision: 5, scale: 2 }),
  materialsIndex3yr: decimal('materials_index_3yr', { precision: 5, scale: 2 }),
  materialsIndex5yr: decimal('materials_index_5yr', { precision: 5, scale: 2 }),
  laborIndex1yr: decimal('labor_index_1yr', { precision: 5, scale: 2 }),
  laborIndex3yr: decimal('labor_index_3yr', { precision: 5, scale: 2 }),
  laborIndex5yr: decimal('labor_index_5yr', { precision: 5, scale: 2 }),
  dataSource: text('data_source'),
}, (t) => ({
  quoteIdx: index('quote_inflation_snapshot_quote_idx').on(t.quoteId),
}))

export const quoteInflationSnapshotRelations = relations(quoteInflationSnapshot, ({ one }) => ({
  quote: one(quote, { fields: [quoteInflationSnapshot.quoteId], references: [quote.id] }),
}))

// ─── Audit Log ──────────────────────────────────────────────────────────────────

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id'),
  action: text('action').notNull(),
  entityType: text('entity_type'),
  entityId: text('entity_id'),
  oldValue: json('old_value'),
  newValue: json('new_value'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => ({
  tenantIdx: index('audit_log_tenant_idx').on(t.tenantId),
  entityIdx: index('audit_log_entity_idx').on(t.entityType, t.entityId),
}))

export const auditLogRelations = relations(auditLog, ({ one }) => ({
  company: one(company, { fields: [auditLog.tenantId], references: [company.id] }),
}))
