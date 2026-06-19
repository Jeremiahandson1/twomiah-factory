import { pgTable, text, boolean, integer, decimal, real, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
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
  role: text('role').default('user').notNull(),
  hourlyRate: decimal('hourly_rate', { precision: 10, scale: 2 }),
  isActive: boolean('is_active').default(true).notNull(),
  lastLogin: timestamp('last_login'),
  refreshToken: text('refresh_token'),
  resetToken: text('reset_token'),
  resetTokenExp: timestamp('reset_token_exp'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  uniqueIndex('user_email_company_id_key').on(t.email, t.companyId),
  index('user_company_id_idx').on(t.companyId),
])

// ==================== CRM ====================

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

// ==================== UNITS (RV / POWERSPORTS INVENTORY) ====================
// Dealers call inventory "units" regardless of type. One model covers RVs and
// powersports via the `category` discriminator; type-specific columns are nullable
// and only populated for the categories they apply to.

export const unit = pgTable('unit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),

  // --- Identity ---
  // category: motorhome | towable | motorcycle | atv | utv | sxs | pwc | snowmobile | boat
  category: text('category').notNull(),
  condition: text('condition').default('new').notNull(), // new, used, consignment
  stockNumber: text('stock_number'),
  vin: text('vin'), // VIN (motorized) or serial number (towables / powersports)
  year: integer('year'),
  make: text('make'), // OEM / brand (Winnebago, Forest River, Polaris, Yamaha, Sea-Doo…)
  modelName: text('model_name'),
  trim: text('trim'), // floorplan code (RV) or trim/edition (powersports)
  status: text('status').default('available').notNull(), // available, sold, pending, on_order, in_service

  // --- Pricing ---
  msrp: decimal('msrp', { precision: 10, scale: 2 }),
  listedPrice: decimal('listed_price', { precision: 10, scale: 2 }),
  internetPrice: decimal('internet_price', { precision: 10, scale: 2 }),
  cost: decimal('cost', { precision: 10, scale: 2 }),

  // --- Media / descriptive ---
  photos: json('photos').default([]).notNull(),
  floorplanImg: text('floorplan_img'), // RV floorplan diagram
  description: text('description'),
  features: json('features').default([]).notNull(),
  exteriorColor: text('exterior_color'),
  interiorColor: text('interior_color'),

  // --- RV-specific ---
  rvClass: text('rv_class'), // A, B, B+, C, super_c (motorhomes only)
  towableType: text('towable_type'), // travel_trailer, fifth_wheel, toy_hauler, pop_up, teardrop, destination
  lengthFt: decimal('length_ft', { precision: 5, scale: 1 }),
  sleeps: integer('sleeps'),
  slideOuts: integer('slide_outs'),
  gvwr: integer('gvwr'), // gross vehicle weight rating (lbs)
  dryWeight: integer('dry_weight'), // unloaded vehicle weight (lbs)
  hitchWeight: integer('hitch_weight'), // tongue / pin weight (lbs, towables)
  chassis: text('chassis'), // Ford F53, Freightliner, Mercedes Sprinter…
  freshTankGal: integer('fresh_tank_gal'),
  greyTankGal: integer('grey_tank_gal'),
  blackTankGal: integer('black_tank_gal'),
  generatorHours: integer('generator_hours'),
  awnings: integer('awnings'),

  // --- Motorized / powersports mechanical ---
  fuelType: text('fuel_type'), // gas, diesel, propane, electric
  engine: text('engine'), // engine / chassis engine description
  engineCc: integer('engine_cc'), // powersports displacement
  mileage: integer('mileage'), // motorhomes
  hours: integer('hours'), // powersports / generator usage hours
  transmission: text('transmission'),
  drivetrain: text('drivetrain'), // 2wd/4wd (UTV), etc.

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('unit_company_id_idx').on(t.companyId),
  index('unit_status_idx').on(t.status),
  index('unit_category_idx').on(t.category),
  index('unit_make_idx').on(t.make),
  uniqueIndex('unit_vin_company_id_key').on(t.vin, t.companyId),
])

// ==================== SALES LEADS ====================

export const salesLead = pgTable('sales_lead', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  source: text('source'), // adf_xml, walk_in, web, phone, referral, lead_inbox
  stage: text('stage').default('new').notNull(), // new, contacted, demo, desking, closed_won, closed_lost
  notes: text('notes'),
  tradeInInfo: json('trade_in_info'), // { year, make, model, vin, value }
  followUpDate: timestamp('follow_up_date'),
  closedAt: timestamp('closed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  assignedTo: text('assigned_to').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sales_lead_company_id_idx').on(t.companyId),
  index('sales_lead_stage_idx').on(t.stage),
  index('sales_lead_assigned_to_idx').on(t.assignedTo),
  index('sales_lead_contact_id_idx').on(t.contactId),
])

// ==================== REPAIR ORDERS ====================

export const repairOrder = pgTable('repair_order', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  roNumber: text('ro_number'),
  writeUpDate: timestamp('write_up_date').defaultNow().notNull(),
  status: text('status').default('open').notNull(), // open, in_progress, waiting_parts, ready, closed
  customerUnitInfo: json('customer_unit_info'), // { vin, year, make, model, mileage, hours } for units not in inventory
  services: json('services').default([]).notNull(), // [{ description, laborHours, partsCost, laborCost }]
  advisorName: text('advisor_name'),
  estimatedTotal: decimal('estimated_total', { precision: 10, scale: 2 }),
  actualTotal: decimal('actual_total', { precision: 10, scale: 2 }),
  notes: text('notes'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  customerId: text('customer_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  unitId: text('unit_id').references(() => unit.id, { onDelete: 'set null' }),
  technicianId: text('technician_id').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('repair_order_company_id_idx').on(t.companyId),
  index('repair_order_status_idx').on(t.status),
  index('repair_order_customer_id_idx').on(t.customerId),
  uniqueIndex('repair_order_ro_number_company_id_key').on(t.roNumber, t.companyId),
])

// ==================== SERVICE-TO-SALES ALERTS ====================

export const serviceSalesAlert = pgTable('service_sales_alert', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  alertMessage: text('alert_message'),
  alertedAt: timestamp('alerted_at').defaultNow().notNull(),
  dismissedAt: timestamp('dismissed_at'),
  convertedToLead: boolean('converted_to_lead').default(false).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  repairOrderId: text('repair_order_id').notNull().references(() => repairOrder.id, { onDelete: 'cascade' }),
  salesLeadId: text('sales_lead_id').references(() => salesLead.id, { onDelete: 'set null' }),
  salespersonId: text('salesperson_id').notNull().references(() => user.id, { onDelete: 'cascade' }),
  customerId: text('customer_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('service_sales_alert_company_id_idx').on(t.companyId),
  index('service_sales_alert_salesperson_id_idx').on(t.salespersonId),
  index('service_sales_alert_dismissed_at_idx').on(t.dismissedAt),
])

// ==================== AUDIT LOG ====================

export const auditLog = pgTable('audit_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  action: text('action').notNull(),
  entity: text('entity').notNull(),
  entityId: text('entity_id'),
  entityName: text('entity_name'),
  changes: json('changes'),
  metadata: json('metadata'),
  ipAddress: text('ip_address'),
  userAgent: text('user_agent'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  userId: text('user_id'),
  userName: text('user_name'),
  userEmail: text('user_email'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('audit_log_company_id_idx').on(t.companyId),
  index('audit_log_entity_entity_id_idx').on(t.entity, t.entityId),
  index('audit_log_user_id_idx').on(t.userId),
  index('audit_log_created_at_idx').on(t.createdAt),
])

// ==================== SUPPORT TICKETS ====================

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

// ==================== LEAD INBOX ====================

export const leadSource = pgTable('lead_source', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  platform: text('platform').notNull(), // rv_trader, rvusa, rvt, cycletrader, atvtrader, boattrader, adf_email, web, other
  label: text('label').notNull(),
  inboundEmail: text('inbound_email'),
  webhookUrl: text('webhook_url'),
  webhookSecret: text('webhook_secret'),
  enabled: boolean('enabled').default(true).notNull(),
  config: json('config').default({}).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lead_source_company_id_idx').on(t.companyId),
  index('lead_source_platform_idx').on(t.platform),
])

export const lead = pgTable('lead', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sourcePlatform: text('source_platform').notNull(),
  sourceId: text('source_id').references(() => leadSource.id, { onDelete: 'set null' }),
  customerName: text('customer_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  unitInterest: text('unit_interest'), // stock #, model, or category the lead asked about
  location: text('location'),
  budget: text('budget'),
  description: text('description'),
  status: text('status').default('new').notNull(), // new, contacted, converted, dismissed
  rawPayload: json('raw_payload'),
  convertedContactId: text('converted_contact_id').references(() => contact.id, { onDelete: 'set null' }),
  contactedAt: timestamp('contacted_at'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('lead_company_id_idx').on(t.companyId),
  index('lead_status_idx').on(t.status),
  index('lead_src_platform_idx').on(t.sourcePlatform),
  index('lead_received_at_idx').on(t.receivedAt),
])

// ==================== SMS / MESSAGING (UNIFIED INBOX) ====================
// Every customer text — inbound and outbound — is logged here and attributed
// to the dealership (not a salesperson's personal phone). Grouped by contactId
// to form a conversation thread.

export const message = pgTable('message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  direction: text('direction').notNull(), // inbound, outbound
  body: text('body').notNull(),
  status: text('status').default('queued').notNull(), // queued, sent, delivered, failed, received
  channel: text('channel').default('sms').notNull(), // sms, mms
  mediaUrls: json('media_urls').default([]).notNull(), // MMS / service tech photos
  fromNumber: text('from_number'),
  toNumber: text('to_number'),
  twilioSid: text('twilio_sid'),
  errorMessage: text('error_message'),
  readAt: timestamp('read_at'), // when a staff user read an inbound message
  source: text('source').default('manual').notNull(), // manual, sequence, service_status
  createdAt: timestamp('created_at').defaultNow().notNull(),

  contactId: text('contact_id').references(() => contact.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }), // staff who sent (outbound)
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('message_company_id_idx').on(t.companyId),
  index('message_contact_id_idx').on(t.contactId),
  index('message_created_at_idx').on(t.createdAt),
])

// ==================== FOLLOW-UP SEQUENCES ====================
// Multi-touch SMS/email cadences that work the long RV/powersports research
// cycle. A sequence has ordered steps; enrolling a contact schedules step runs
// that the background runner sends and advances.

export const sequence = pgTable('sequence', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  trigger: text('trigger').default('manual').notNull(), // manual, new_lead, after_sale, after_service
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sequence_company_id_idx').on(t.companyId),
])

export const sequenceStep = pgTable('sequence_step', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  stepOrder: integer('step_order').notNull(),
  delayHours: integer('delay_hours').default(0).notNull(), // hours after the previous step (or enrollment for step 0)
  channel: text('channel').default('sms').notNull(), // sms, email
  subject: text('subject'), // email subject (ignored for sms)
  body: text('body').notNull(), // supports {{firstName}} / {{companyName}} tokens
  createdAt: timestamp('created_at').defaultNow().notNull(),

  sequenceId: text('sequence_id').notNull().references(() => sequence.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sequence_step_sequence_id_idx').on(t.sequenceId),
])

export const sequenceEnrollment = pgTable('sequence_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('active').notNull(), // active, completed, cancelled
  currentStep: integer('current_step').default(0).notNull(), // index of the next step to run
  nextRunAt: timestamp('next_run_at'), // when the next step is due
  enrolledAt: timestamp('enrolled_at').defaultNow().notNull(),
  completedAt: timestamp('completed_at'),

  sequenceId: text('sequence_id').notNull().references(() => sequence.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sequence_enrollment_company_id_idx').on(t.companyId),
  index('sequence_enrollment_next_run_idx').on(t.nextRunAt),
  index('sequence_enrollment_status_idx').on(t.status),
])
