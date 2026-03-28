// Standalone Roof Estimator — Database Schema
// Separate from CRM schema. Manages tenants, API keys, and reports.

import { pgTable, text, integer, real, boolean, timestamp, decimal, json, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'

// ==================== TENANTS ====================
// Registered companies (from Factory deploy or self-signup)

export const tenant = pgTable('tenant', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  slug: text('slug').notNull().unique(),
  companyName: text('company_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  website: text('website'),
  logoUrl: text('logo_url'),
  primaryColor: text('primary_color').default('#f97316'),

  // Billing
  plan: text('plan').default('free').notNull(), // free, starter, pro
  monthlyReportLimit: integer('monthly_report_limit').default(100).notNull(),
  reportsUsedThisMonth: integer('reports_used_this_month').default(0).notNull(),
  billingResetDate: timestamp('billing_reset_date'),
  stripeCustomerId: text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),

  // Auth
  apiKey: text('api_key').notNull().unique().$defaultFn(() => `re_${createId()}`),
  active: boolean('active').default(true).notNull(),

  // Source
  source: text('source').default('self_signup').notNull(), // self_signup, factory_deploy
  factoryTenantId: text('factory_tenant_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('tenant_slug_idx').on(t.slug),
  index('tenant_api_key_idx').on(t.apiKey),
])

// ==================== USERS (for web UI login) ====================

export const user = pgTable('estimator_user', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),
  email: text('email').notNull(),
  passwordHash: text('password_hash').notNull(),
  name: text('name'),
  role: text('role').default('admin').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('user_tenant_idx').on(t.tenantId),
  index('user_email_idx').on(t.email),
])

// ==================== ROOF REPORTS ====================

export const roofReport = pgTable('roof_report', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  tenantId: text('tenant_id').notNull().references(() => tenant.id, { onDelete: 'cascade' }),

  // Address
  address: text('address').notNull(),
  city: text('city').notNull(),
  state: text('state').notNull(),
  zip: text('zip').notNull(),
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  formattedAddress: text('formatted_address'),

  // Measurements
  totalAreaSqft: real('total_area_sqft').notNull(),
  totalSquares: real('total_squares').notNull(),
  segmentCount: integer('segment_count').notNull(),
  imageryQuality: text('imagery_quality').notNull(),
  imageryDate: text('imagery_date'),
  aerialImagePath: text('aerial_image_path'),
  roofMaskPath: text('roof_mask_path'),

  // Data (JSON blobs)
  segments: json('segments').notNull(),
  edges: json('edges').notNull(),
  measurements: json('measurements').notNull(),
  rawSolarData: json('raw_solar_data'),

  // User edits
  userEdited: boolean('user_edited').default(false).notNull(),
  originalEdges: json('original_edges'),
  originalMeasurements: json('original_measurements'),

  // Source tracking
  imagerySource: text('imagery_source').default('google_solar'),
  elevationSource: text('elevation_source').default('google_dsm'),
  dsmGridPath: text('dsm_grid_path'),

  // AI-detected properties
  roofCondition: integer('roof_condition'),
  roofMaterial: text('roof_material'),
  treeOverhangPct: real('tree_overhang_pct'),

  // Payment
  status: text('status').default('free').notNull(),
  stripePaymentIntentId: text('stripe_payment_intent_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('report_tenant_idx').on(t.tenantId),
])

// ==================== TRAINING DATA ====================
// Every user edit = a labeled training example for ML model improvement.
// Stores: satellite image ref + auto-detected edges (input) + user-corrected edges (label)

export const trainingExample = pgTable('training_example', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  reportId: text('report_id').references(() => roofReport.id, { onDelete: 'set null' }),

  // Location (for geographic diversity tracking)
  lat: real('lat').notNull(),
  lng: real('lng').notNull(),
  state: text('state'),

  // Image reference
  aerialImagePath: text('aerial_image_path'),    // path to satellite PNG
  imagerySource: text('imagery_source'),          // google_solar, nearmap
  imageryQuality: text('imagery_quality'),
  zoom: integer('zoom'),
  imageWidth: integer('image_width'),
  imageHeight: integer('image_height'),

  // Auto-detected (model input — what the AI predicted)
  autoEdges: json('auto_edges').notNull(),        // edges before user correction
  autoSegments: json('auto_segments'),            // segments from RANSAC/SAM
  detectionMethod: text('detection_method'),       // ransac, sam2, nearmap_ai

  // User-corrected (ground truth label — what was actually correct)
  correctedEdges: json('corrected_edges').notNull(),
  correctedMeasurements: json('corrected_measurements'),

  // Quality metrics
  edgesAdded: integer('edges_added').default(0),      // how many the user added
  edgesDeleted: integer('edges_deleted').default(0),   // how many the user removed
  edgesModified: integer('edges_modified').default(0), // how many the user changed type on
  editScore: real('edit_score'),                       // 0-1, lower = more corrections needed

  // Roof characteristics (for stratified training)
  roofComplexity: text('roof_complexity'),   // simple, moderate, complex
  buildingCount: integer('building_count'),   // structures on parcel

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('training_report_idx').on(t.reportId),
  index('training_state_idx').on(t.state),
  index('training_created_idx').on(t.createdAt),
])
