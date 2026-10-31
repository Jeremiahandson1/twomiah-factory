// The business's own account: its Twomiah subscription records, the accounting connection, sign-in states for
// third-party connections, browser push, and support tickets. Column for column the base CRM's tables
// (templates/crm/backend/db/schema.ts), so a tenant's rows move across unchanged.
import { pgTable, text, boolean, integer, decimal, timestamp, json, index, uniqueIndex } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact } from './crm.ts'

// QuickBooks Online connection (one per company). Replaces the raw-SQL quickbooks_connection table that
// db/prune-legacy.ts drops on every boot — which is why QuickBooks could never stay connected here.
export const qbIntegration = pgTable('qb_integration', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().unique().references(() => company.id, { onDelete: 'cascade' }),
  accessToken: text('access_token'),
  refreshToken: text('refresh_token'),
  realmId: text('realm_id'),
  tokenExpiresAt: timestamp('token_expires_at'),
  syncEnabled: boolean('sync_enabled').default(false).notNull(),
  lastSyncedAt: timestamp('last_synced_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('qb_integration_company_id_idx').on(t.companyId),
])

/**
 * One QuickBooks sync, automatic or pressed (0029): when it ran, what it sent and what failed — the Integrations card's
 * sync log (crm/office/quickbooksAutoSync.ts).
 */
export const qbSyncRun = pgTable('qb_sync_run', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  trigger: text('trigger').default('auto').notNull(),          // 'auto' | 'manual'
  status: text('status').default('running').notNull(),         // 'running' | 'ok' | 'partial' | 'failed'
  customers: integer('customers').default(0).notNull(),
  invoices: integer('invoices').default(0).notNull(),
  payments: integer('payments').default(0).notNull(),
  /** A store's: paid orders sent as sales receipts, refunds as refund receipts, Stripe payouts as deposits (0044). */
  orders: integer('orders').default(0).notNull(),
  refunds: integer('refunds').default(0).notNull(),
  payouts: integer('payouts').default(0).notNull(),
  failed: integer('failed').default(0).notNull(),
  error: text('error'),
  startedAt: timestamp('started_at').defaultNow().notNull(),
  finishedAt: timestamp('finished_at'),
}, (t) => [
  index('qb_sync_run_company_started_idx').on(t.companyId, t.startedAt),
])

/**
 * A record QuickBooks refused, waiting to be tried again (0029): attempts so far, the last error in QuickBooks' words,
 * and when the next try is due. Removed when the record goes across. One row per record.
 */
export const qbSyncFailure = pgTable('qb_sync_failure', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  entity: text('entity').notNull(),                            // 'customer' | 'invoice' | 'payment' | 'order' | 'refund' | 'payout'
  entityId: text('entity_id').notNull(),
  label: text('label'),
  attempts: integer('attempts').default(1).notNull(),
  lastError: text('last_error'),
  nextAttemptAt: timestamp('next_attempt_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  uniqueIndex('qb_sync_failure_record_uniq').on(t.companyId, t.entity, t.entityId),
])

export const subscription = pgTable('subscription', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().unique().references(() => company.id),

  stripeSubscriptionId: text('stripe_subscription_id').notNull().unique(),

  packageId: text('package_id').notNull(),
  billingCycle: text('billing_cycle').notNull(),
  status: text('status').default('active').notNull(),

  userCount: integer('user_count').default(1).notNull(),
  basePrice: decimal('base_price', { precision: 10, scale: 2 }).notNull(),
  totalPrice: decimal('total_price', { precision: 10, scale: 2 }).notNull(),
  features: json('features').default([]).notNull(),
  addons: json('addons'),

  trialEndsAt: timestamp('trial_ends_at'),
  currentPeriodStart: timestamp('current_period_start').notNull(),
  currentPeriodEnd: timestamp('current_period_end').notNull(),
  canceledAt: timestamp('canceled_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const license = pgTable('license', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  type: text('type').notNull(),
  packageId: text('package_id'),
  features: json('features').notNull(),

  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  stripePaymentId: text('stripe_payment_id'),

  purchasedAt: timestamp('purchased_at').notNull(),
  expiresAt: timestamp('expires_at'),
  status: text('status').default('active').notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('license_company_id_idx').on(t.companyId),
])

export const addonPurchase = pgTable('addon_purchase', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  addonId: text('addon_id').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  amount: decimal('amount', { precision: 10, scale: 2 }).notNull(),
  stripePaymentId: text('stripe_payment_id'),
  expiresAt: timestamp('expires_at'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('addon_purchase_company_id_idx').on(t.companyId),
])

export const usageRecord = pgTable('usage_record', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  type: text('type').notNull(),
  quantity: integer('quantity').default(1).notNull(),
  metadata: json('metadata'),

  recordedAt: timestamp('recorded_at').defaultNow().notNull(),
}, (t) => [
  index('usage_record_company_id_type_recorded_at_idx').on(t.companyId, t.type, t.recordedAt),
])

export const billingInvoice = pgTable('billing_invoice', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id),

  number: text('number').notNull().unique(),
  periodStart: timestamp('period_start').notNull(),
  periodEnd: timestamp('period_end').notNull(),
  lineItems: json('line_items').notNull(),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).notNull(),
  tax: decimal('tax', { precision: 10, scale: 2 }).default('0').notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  status: text('status').default('pending').notNull(),
  dueDate: timestamp('due_date').notNull(),
  paidAt: timestamp('paid_at'),
  stripeInvoiceId: text('stripe_invoice_id'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('billing_invoice_company_id_idx').on(t.companyId),
])

export const selfHostedLicense = pgTable('self_hosted_license', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  email: text('email').notNull(),
  companyName: text('company_name').notNull(),
  licenseType: text('license_type').notNull(),
  licenseKey: text('license_key').notNull().unique(),
  stripeSessionId: text('stripe_session_id'),
  stripeCustomerId: text('stripe_customer_id'),
  purchasedAt: timestamp('purchased_at').notNull(),
  expiresAt: timestamp('expires_at'),
  isActive: boolean('is_active').default(true).notNull(),
  downloadCount: integer('download_count').default(0).notNull(),
  lastDownloadAt: timestamp('last_download_at'),
  metadata: json('metadata'),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('self_hosted_license_email_idx').on(t.email),
  index('self_hosted_license_license_key_idx').on(t.licenseKey),
])

export const oauthState = pgTable('oauth_state', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  state: text('state').notNull().unique(),
  provider: text('provider').notNull(),
  companyId: text('company_id'),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('oauth_state_state_idx').on(t.state),
])

export const supportTicket = pgTable('support_ticket', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  number: text('number').notNull(),
  subject: text('subject').notNull(),
  description: text('description'),
  status: text('status').default('open').notNull(), // open, in_progress, waiting, resolved, closed
  priority: text('priority').default('normal').notNull(), // low, normal, high, urgent, critical
  category: text('category'), // billing, technical, feature_request, bug, general
  type: text('type').default('internal').notNull(), // internal (from CRM users) or external (from contacts/clients)
  source: text('source').default('portal').notNull(), // portal, email, ai_chat, phone, api

  // SLA tracking
  slaResponseDue: timestamp('sla_response_due'),
  slaResolveDue: timestamp('sla_resolve_due'),
  firstResponseAt: timestamp('first_response_at'),
  resolvedAt: timestamp('resolved_at'),
  closedAt: timestamp('closed_at'),
  escalatedAt: timestamp('escalated_at'),
  escalationLevel: integer('escalation_level').default(0).notNull(),

  // AI fields
  aiSuggested: boolean('ai_suggested').default(false).notNull(),
  aiCategory: text('ai_category'),
  aiPriorityScore: integer('ai_priority_score'),

  // Rating
  rating: integer('rating'), // 1-5 post-resolution
  ratingComment: text('rating_comment'),

  // Relations
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  assignedToId: text('assigned_to_id').references(() => user.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  // Tags & metadata
  tags: json('tags').default([]).notNull(),
  metadata: json('metadata').default({}).notNull(),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('support_ticket_company_id_idx').on(t.companyId),
  index('support_ticket_status_idx').on(t.status),
  index('support_ticket_priority_idx').on(t.priority),
  index('support_ticket_assigned_to_idx').on(t.assignedToId),
  index('support_ticket_contact_id_idx').on(t.contactId),
  index('support_ticket_category_idx').on(t.category),
])

export const supportTicketMessage = pgTable('support_ticket_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  body: text('body').notNull(),
  isInternal: boolean('is_internal').default(false).notNull(), // internal note vs visible reply
  isAi: boolean('is_ai').default(false).notNull(),
  attachments: json('attachments').default([]).notNull(),

  ticketId: text('ticket_id').notNull().references(() => supportTicket.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('support_ticket_message_ticket_id_idx').on(t.ticketId),
])

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

export const supportSlaPolicy = pgTable('support_sla_policy', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  priority: text('priority').notNull(), // maps to ticket priority
  responseTimeMinutes: integer('response_time_minutes').notNull(),
  resolveTimeMinutes: integer('resolve_time_minutes').notNull(),
  escalateAfterMinutes: integer('escalate_after_minutes'),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('support_sla_policy_company_id_idx').on(t.companyId),
])

export const pushSubscription = pgTable('push_subscription', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  userId: text('user_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  endpoint: text('endpoint').notNull().unique(),
  p256dh: text('p256dh').notNull(),
  auth: text('auth').notNull(),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('push_subscription_user_id_idx').on(t.userId),
])
