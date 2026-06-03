import { pgTable, serial, varchar, text, integer, boolean, decimal, timestamp, jsonb, uuid, index, uniqueIndex } from 'drizzle-orm/pg-core'

// Lead statuses for pipeline management
export const leadStatuses = pgTable('lead_statuses', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 50 }).notNull().unique(),
  color: varchar('color', { length: 7 }).default('#6b7280'),
  sortOrder: integer('sort_order').default(0),
  isActive: boolean('is_active').default(true),
  createdAt: timestamp('created_at').defaultNow(),
})

// Services offered
export const services = pgTable('services', {
  id: serial('id').primaryKey(),
  name: varchar('name', { length: 100 }).notNull(),
  slug: varchar('slug', { length: 100 }).notNull().unique(),
  description: text('description'),
  icon: varchar('icon', { length: 50 }),
  isActive: boolean('is_active').default(true),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
})

// Leads from contact form and other sources
export const leads = pgTable('leads', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }).notNull(),
  address: varchar('address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }).default('{{STATE}}'),
  zip: varchar('zip', { length: 20 }),
  source: varchar('source', { length: 50 }).default('website'),
  statusId: integer('status_id').references(() => leadStatuses.id),
  preferredDate: timestamp('preferred_date'),
  preferredTime: varchar('preferred_time', { length: 50 }),
  comments: text('comments'),
  ipAddress: varchar('ip_address', { length: 45 }),
  userAgent: text('user_agent'),
  referrer: text('referrer'),
  assignedTo: integer('assigned_to'),
  estimatedValue: decimal('estimated_value', { precision: 10, scale: 2 }),
  probability: integer('probability').default(50),
  nextFollowUp: timestamp('next_follow_up'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  convertedAt: timestamp('converted_at'),
  closedAt: timestamp('closed_at'),
}, (table) => [
  index('idx_leads_status').on(table.statusId),
  index('idx_leads_created').on(table.createdAt),
  index('idx_leads_email').on(table.email),
  index('idx_leads_phone').on(table.phone),
])

// Lead services junction table
export const leadServices = pgTable('lead_services', {
  id: serial('id').primaryKey(),
  leadId: integer('lead_id').notNull().references(() => leads.id, { onDelete: 'cascade' }),
  serviceId: integer('service_id').notNull().references(() => services.id, { onDelete: 'cascade' }),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  uniqueIndex('lead_services_unique').on(table.leadId, table.serviceId),
])

// Contacts (converted leads or direct entries)
export const contacts = pgTable('contacts', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),
  leadId: integer('lead_id').references(() => leads.id),
  firstName: varchar('first_name', { length: 100 }).notNull(),
  lastName: varchar('last_name', { length: 100 }).notNull(),
  email: varchar('email', { length: 255 }),
  phone: varchar('phone', { length: 20 }),
  phoneSecondary: varchar('phone_secondary', { length: 20 }),
  address: varchar('address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }).default('{{STATE}}'),
  zip: varchar('zip', { length: 20 }),
  type: varchar('type', { length: 50 }).default('residential'),
  tags: text('tags').array(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
}, (table) => [
  index('idx_contacts_email').on(table.email),
])

// Quotes/Estimates
export const quotes = pgTable('quotes', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),
  quoteNumber: varchar('quote_number', { length: 50 }).unique(),
  leadId: integer('lead_id').references(() => leads.id),
  contactId: integer('contact_id').references(() => contacts.id),
  title: varchar('title', { length: 255 }),
  description: text('description'),
  subtotal: decimal('subtotal', { precision: 10, scale: 2 }).default('0'),
  taxRate: decimal('tax_rate', { precision: 5, scale: 4 }).default('0'),
  taxAmount: decimal('tax_amount', { precision: 10, scale: 2 }).default('0'),
  discount: decimal('discount', { precision: 10, scale: 2 }).default('0'),
  total: decimal('total', { precision: 10, scale: 2 }).default('0'),
  status: varchar('status', { length: 50 }).default('draft'),
  validUntil: timestamp('valid_until'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  sentAt: timestamp('sent_at'),
  acceptedAt: timestamp('accepted_at'),
  rejectedAt: timestamp('rejected_at'),
}, (table) => [
  index('idx_quotes_status').on(table.status),
])

// Quote line items
export const quoteItems = pgTable('quote_items', {
  id: serial('id').primaryKey(),
  quoteId: integer('quote_id').notNull().references(() => quotes.id, { onDelete: 'cascade' }),
  serviceId: integer('service_id').references(() => services.id),
  description: text('description').notNull(),
  quantity: decimal('quantity', { precision: 10, scale: 2 }).default('1'),
  unit: varchar('unit', { length: 50 }).default('each'),
  unitPrice: decimal('unit_price', { precision: 10, scale: 2 }).notNull(),
  total: decimal('total', { precision: 10, scale: 2 }).notNull(),
  sortOrder: integer('sort_order').default(0),
  createdAt: timestamp('created_at').defaultNow(),
})

// Jobs/Projects
export const jobs = pgTable('jobs', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),
  jobNumber: varchar('job_number', { length: 50 }).unique(),
  quoteId: integer('quote_id').references(() => quotes.id),
  contactId: integer('contact_id').references(() => contacts.id),
  title: varchar('title', { length: 255 }).notNull(),
  description: text('description'),
  address: varchar('address', { length: 255 }),
  city: varchar('city', { length: 100 }),
  state: varchar('state', { length: 50 }).default('{{STATE}}'),
  zip: varchar('zip', { length: 20 }),
  scheduledStart: timestamp('scheduled_start'),
  scheduledEnd: timestamp('scheduled_end'),
  actualStart: timestamp('actual_start'),
  actualEnd: timestamp('actual_end'),
  status: varchar('status', { length: 50 }).default('pending'),
  contractAmount: decimal('contract_amount', { precision: 10, scale: 2 }),
  paidAmount: decimal('paid_amount', { precision: 10, scale: 2 }).default('0'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow(),
  completedAt: timestamp('completed_at'),
}, (table) => [
  index('idx_jobs_status').on(table.status),
])

// Activity/Notes log (polymorphic)
export const activities = pgTable('activities', {
  id: serial('id').primaryKey(),
  uuid: uuid('uuid').defaultRandom().unique(),
  entityType: varchar('entity_type', { length: 50 }).notNull(),
  entityId: integer('entity_id').notNull(),
  type: varchar('type', { length: 50 }).notNull(),
  title: varchar('title', { length: 255 }),
  description: text('description'),
  metadata: jsonb('metadata').default({}),
  createdBy: integer('created_by'),
  createdAt: timestamp('created_at').defaultNow(),
}, (table) => [
  index('idx_activities_entity').on(table.entityType, table.entityId),
])
