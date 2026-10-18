// CRM layer (SPEC §4.4). Column for column the base CRM's tables (templates/crm/backend/db/schema.ts), so a
// tenant's rows move across unchanged. Present in every tenant: a website enquiry is a lead or a contact even for a
// business without the CRM switched on (SPEC §4.7), so these come first; the rest of the CRM follows in step 3.
import { pgTable, text, boolean, real, timestamp, json, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company } from './core.ts'

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
  qbCustomerId: text('qb_customer_id'),
  portalEnabled: boolean('portal_enabled').default(false).notNull(),
  portalToken: text('portal_token'),
  portalTokenExp: timestamp('portal_token_exp'),
  lastPortalVisit: timestamp('last_portal_visit'),
  /** Withdrawn SMS consent: the shared sender refuses to text a contact carrying this. */
  optedOutSms: boolean('opted_out_sms').default(false).notNull(),
  emailOptOut: boolean('email_opt_out').default(false).notNull(),
  emailOptOutAt: timestamp('email_opt_out_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('contact_company_id_idx').on(t.companyId),
  index('contact_type_idx').on(t.type),
])

// ==================== LEAD INBOX ====================

export const leadSource = pgTable('lead_source', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  platform: text('platform').notNull(), // angi, homeadvisor, thumbtack, google_lsa, houzz, other
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
  homeownerName: text('homeowner_name').notNull(),
  email: text('email'),
  phone: text('phone'),
  jobType: text('job_type'),
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
  index('lead_platform_idx').on(t.sourcePlatform),
  index('lead_received_at_idx').on(t.receivedAt),
])
