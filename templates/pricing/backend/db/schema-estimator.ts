import { pgTable, text, boolean, timestamp, decimal, integer, jsonb, index, unique } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { relations } from 'drizzle-orm'
import { company, product, productCategory, repProfile, contractTemplate } from './schema'

// ─── Estimator Product ───────────────────────────────────────────────

export const estimatorProduct = pgTable('estimator_product', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  categoryId: text('category_id').references(() => productCategory.id),
  name: text('name').notNull(),
  description: text('description'),
  measurementUnit: text('measurement_unit').notNull(), // sq_ft, lin_ft, squares, count
  pitchAdjustable: boolean('pitch_adjustable').default(false),
  defaultWasteFactor: decimal('default_waste_factor', { precision: 5, scale: 2 }).default('1.10'),
  laborRate: decimal('labor_rate', { precision: 10, scale: 2 }).notNull(),
  laborUnit: text('labor_unit').notNull(), // sq_ft, lin_ft, hour
  setupFee: decimal('setup_fee', { precision: 10, scale: 2 }).default('0'),
  minimumCharge: decimal('minimum_charge', { precision: 10, scale: 2 }).default('0'),
  retailMarkupPct: decimal('retail_markup_pct', { precision: 5, scale: 2 }).default('100'),
  yr1MarkupPct: decimal('yr1_markup_pct', { precision: 5, scale: 2 }).default('20'),
  day30MarkupPct: decimal('day30_markup_pct', { precision: 5, scale: 2 }).default('10'),
  todayDiscountPct: decimal('today_discount_pct', { precision: 5, scale: 2 }).default('10'),
  sortOrder: integer('sort_order').default(0),
  active: boolean('active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('estimator_product_tenant_idx').on(table.tenantId),
])

// ─── Estimator Material Tier ─────────────────────────────────────────

export const estimatorMaterialTier = pgTable('estimator_material_tier', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => estimatorProduct.id, { onDelete: 'cascade' }),
  tier: text('tier').notNull(), // good, better, best
  materialName: text('material_name').notNull(),
  materialCostPerUnit: decimal('material_cost_per_unit', { precision: 10, scale: 2 }).notNull(),
  manufacturer: text('manufacturer'),
  productLine: text('product_line'),
  warrantyYears: integer('warranty_years'),
  features: jsonb('features').default([]),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('estimator_material_tier_product_idx').on(table.productId),
])

// ─── Pitch Multiplier ────────────────────────────────────────────────

export const pitchMultiplier = pgTable('pitch_multiplier', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  pitch: text('pitch').notNull(), // e.g. '4/12', '6/12'
  multiplier: decimal('multiplier', { precision: 5, scale: 2 }).notNull(),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('pitch_multiplier_tenant_idx').on(table.tenantId),
])

// ─── Estimator Addon ─────────────────────────────────────────────────

export const estimatorAddon = pgTable('estimator_addon', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  productId: text('product_id').notNull().references(() => estimatorProduct.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  pricingType: text('pricing_type').notNull(), // flat, per_unit, per_sq_ft
  price: decimal('price', { precision: 10, scale: 2 }).notNull(),
  unit: text('unit'),
  defaultSelected: boolean('default_selected').default(false),
  sortOrder: integer('sort_order').default(0),
}, (table) => [
  index('estimator_addon_product_idx').on(table.productId),
])

// ─── Estimate ────────────────────────────────────────────────────────

export const estimate = pgTable('estimate', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  repId: text('rep_id').references(() => repProfile.id),
  customerName: text('customer_name'),
  customerEmail: text('customer_email'),
  customerPhone: text('customer_phone'),
  customerAddress: text('customer_address'),
  customerState: text('customer_state'),
  referralSource: text('referral_source'),
  referralName: text('referral_name'),
  status: text('status').default('draft').notNull(), // draft, presented, signed, closed, expired, cancelled
  lineItems: jsonb('line_items').default([]),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }),
  totalMaterials: decimal('total_materials', { precision: 10, scale: 2 }),
  totalLabor: decimal('total_labor', { precision: 10, scale: 2 }),
  totalAddons: decimal('total_addons', { precision: 10, scale: 2 }),
  selectedTier: text('selected_tier'),
  notes: text('notes'),
  customerToken: text('customer_token').unique(),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  presentedAt: timestamp('presented_at'),
  signedAt: timestamp('signed_at'),
  completedAt: timestamp('completed_at'),
  offlineCreated: boolean('offline_created').default(false),
}, (table) => [
  index('estimate_tenant_idx').on(table.tenantId),
  index('estimate_rep_idx').on(table.repId),
  index('estimate_status_idx').on(table.status),
])

// ─── Estimate Contract ───────────────────────────────────────────────

export const estimateContract = pgTable('estimate_contract', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  estimateId: text('estimate_id').notNull().references(() => estimate.id, { onDelete: 'cascade' }),
  contractTemplateId: text('contract_template_id').references(() => contractTemplate.id),
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
}, (table) => [
  index('estimate_contract_estimate_idx').on(table.estimateId),
])

// ─── Relations ───────────────────────────────────────────────────────

export const estimatorProductRelations = relations(estimatorProduct, ({ one, many }) => ({
  tenant: one(company, { fields: [estimatorProduct.tenantId], references: [company.id] }),
  category: one(productCategory, { fields: [estimatorProduct.categoryId], references: [productCategory.id] }),
  tiers: many(estimatorMaterialTier),
  addons: many(estimatorAddon),
}))

export const estimatorMaterialTierRelations = relations(estimatorMaterialTier, ({ one }) => ({
  product: one(estimatorProduct, { fields: [estimatorMaterialTier.productId], references: [estimatorProduct.id] }),
}))

export const pitchMultiplierRelations = relations(pitchMultiplier, ({ one }) => ({
  tenant: one(company, { fields: [pitchMultiplier.tenantId], references: [company.id] }),
}))

export const estimatorAddonRelations = relations(estimatorAddon, ({ one }) => ({
  product: one(estimatorProduct, { fields: [estimatorAddon.productId], references: [estimatorProduct.id] }),
}))

export const estimateRelations = relations(estimate, ({ one, many }) => ({
  tenant: one(company, { fields: [estimate.tenantId], references: [company.id] }),
  rep: one(repProfile, { fields: [estimate.repId], references: [repProfile.id] }),
  contracts: many(estimateContract),
}))

export const estimateContractRelations = relations(estimateContract, ({ one }) => ({
  estimate: one(estimate, { fields: [estimateContract.estimateId], references: [estimate.id] }),
  contractTemplate: one(contractTemplate, { fields: [estimateContract.contractTemplateId], references: [contractTemplate.id] }),
}))
