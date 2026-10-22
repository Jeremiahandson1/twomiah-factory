// Marketing and messages (SPEC §4.6): campaigns, texts, email, sequences, call tracking, the AI receptionist,
// reviews, financing, ad experiments and the Google Business connection. Column for column the base CRM's tables
// (templates/crm/backend/db/schema.ts), so a tenant's rows move across unchanged; the ad-experiment timestamps lose
// their zone (RULEBOOK §2: every other timestamp in the CRM is zone-less UTC).
import { pgTable, text, boolean, integer, decimal, timestamp, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { clients } from './homecare.ts'
import { company, user } from './core.ts'
import { contact, invoice, job, quote } from './crm.ts'

export const inboundMessage = pgTable('inbound_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  toLocalPart: text('to_local_part').notNull(),        // alias that received it
  fromEmail: text('from_email').notNull(),
  fromName: text('from_name'),
  subject: text('subject'),
  textBody: text('text_body'),
  htmlBody: text('html_body'),
  spfVerdict: text('spf_verdict'),
  dkimVerdict: text('dkim_verdict'),
  rawHeaders: text('raw_headers'),
  receivedAt: timestamp('received_at').defaultNow().notNull(),
}, (t) => [
  index('inbound_message_received_at_idx').on(t.receivedAt),
  index('inbound_message_from_email_idx').on(t.fromEmail),
])

export const campaign = pgTable('campaign', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  type: text('type').default('email').notNull(),
  subject: text('subject'),
  content: text('content'),
  status: text('status').default('draft').notNull(),
  audienceType: text('audience_type').default('all').notNull(),
  audienceFilter: json('audience_filter'),
  unsubscribeCount: integer('unsubscribe_count').default(0).notNull(),
  scheduledDate: timestamp('scheduled_date'),
  sentAt: timestamp('sent_at'),
  recipientCount: integer('recipient_count').default(0).notNull(),
  lastError: text('last_error'), // why the last send failed — shown on the campaign row
  openCount: integer('open_count').default(0).notNull(),
  clickCount: integer('click_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('campaign_company_id_idx').on(t.companyId),
])

export const message = pgTable('message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  type: text('type').default('email').notNull(),
  direction: text('direction').default('outbound').notNull(),
  subject: text('subject'),
  body: text('body').notNull(),
  status: text('status').default('draft').notNull(),
  sentAt: timestamp('sent_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('message_company_id_idx').on(t.companyId),
  index('message_contact_id_idx').on(t.contactId),
])

export const smsConversation = pgTable('sms_conversation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  phoneNumber: text('phone_number').notNull(),
  status: text('status').default('active').notNull(),
  unreadCount: integer('unread_count').default(0).notNull(),
  lastMessageAt: timestamp('last_message_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
}, (t) => [
  uniqueIndex('sms_conversation_company_id_phone_number_key').on(t.companyId, t.phoneNumber),
  index('sms_conversation_company_id_status_idx').on(t.companyId, t.status),
])

export const smsMessage = pgTable('sms_message', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  direction: text('direction').notNull(),
  body: text('body').notNull(),
  status: text('status').default('queued').notNull(),
  twilioSid: text('twilio_sid').unique(),
  errorCode: text('error_code'),
  errorMessage: text('error_message'),
  mediaUrls: json('media_urls'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),
  deliveredAt: timestamp('delivered_at'),

  conversationId: text('conversation_id').notNull().references(() => smsConversation.id, { onDelete: 'cascade' }),
  sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('sms_message_conversation_id_created_at_idx').on(t.conversationId, t.createdAt),
])

export const smsTemplate = pgTable('sms_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  body: text('body').notNull(),
  category: text('category'),
  active: boolean('active').default(true).notNull(),
  useCount: integer('use_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('sms_template_company_id_category_idx').on(t.companyId, t.category),
])

export const scheduledSms = pgTable('scheduled_sms', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  to: text('to').notNull(),
  body: text('body').notNull(),
  scheduledFor: timestamp('scheduled_for').notNull(),
  status: text('status').default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  errorMessage: text('error_message'),
  createdAt: timestamp('created_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  createdById: text('created_by_id').references(() => user.id, { onDelete: 'set null' }),
}, (t) => [
  index('scheduled_sms_company_id_scheduled_for_status_idx').on(t.companyId, t.scheduledFor, t.status),
])

export const emailLog = pgTable('email_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  to: text('to').notNull(),
  subject: text('subject').notNull(),
  body: text('body'),
  status: text('status').default('queued').notNull(),
  sendgridId: text('sendgrid_id'),
  errorMessage: text('error_message'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  sentAt: timestamp('sent_at'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  sentById: text('sent_by_id').references(() => user.id, { onDelete: 'set null' }),

  invoiceId: text('invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  quoteId: text('quote_id').references(() => quote.id, { onDelete: 'set null' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
}, (t) => [
  index('email_log_company_id_created_at_idx').on(t.companyId, t.createdAt),
  index('email_log_contact_id_idx').on(t.contactId),
])

export const reviewRequest = pgTable('review_request', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('pending').notNull(), // pending, sent, clicked, completed, failed
  channel: text('channel').default('both').notNull(), // sms, email, both
  sentAt: timestamp('sent_at'),
  clickedAt: timestamp('clicked_at'),
  followUpSentAt: timestamp('follow_up_sent_at'),
  openedAt: timestamp('opened_at'),
  submittedAt: timestamp('submitted_at'),
  reviewLink: text('review_link'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').references(() => job.id, { onDelete: 'set null' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('review_request_company_id_idx').on(t.companyId),
  index('review_request_status_idx').on(t.status),
])

export const review = pgTable('review', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  rating: integer('rating').notNull(),
  comment: text('comment'),
  platform: text('platform').default('google').notNull(),
  externalId: text('external_id'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  requestId: text('request_id').unique().references(() => reviewRequest.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('review_company_id_idx').on(t.companyId),
])

export const financingApplication = pgTable('financing_application', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  provider: text('provider').default('wisetack').notNull(), // wisetack, greensky, mosaic, synchrony, hearth, enhancify, service_finance
  status: text('status').default('pending').notNull(),
  amount: decimal('amount', { precision: 12, scale: 2 }).notNull(),
  term: integer('term'),
  apr: decimal('apr', { precision: 5, scale: 2 }),
  externalId: text('external_id'),
  applicationUrl: text('application_url'),
  approvedAmount: decimal('approved_amount', { precision: 12, scale: 2 }),
  providerData: json('provider_data'), // raw response from provider

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('financing_application_company_id_idx').on(t.companyId),
])

export const emailTemplate = pgTable('email_template', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  type: text('type'),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('email_template_company_id_idx').on(t.companyId),
])

export const emailCampaign = pgTable('email_campaign', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  subject: text('subject').notNull(),
  body: text('body').notNull(),
  status: text('status').default('draft').notNull(),
  recipientFilter: json('recipient_filter'),
  scheduledAt: timestamp('scheduled_at'),
  sentAt: timestamp('sent_at'),
  stats: json('stats'),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('email_campaign_company_id_idx').on(t.companyId),
])

export const automation = pgTable('automation', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  conditions: json('conditions'),
  actions: json('actions').notNull(),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('automation_company_id_idx').on(t.companyId),
])

export const trackingNumber = pgTable('tracking_number', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  phoneNumber: text('phone_number').notNull(),
  forwardTo: text('forward_to'),
  name: text('name'),
  source: text('source'),
  campaign: text('campaign'),
  medium: text('medium'),
  providerId: text('provider_id'),
  provider: text('provider'),
  active: boolean('active').default(true).notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('tracking_number_company_id_idx').on(t.companyId),
])

export const phoneCall = pgTable('phone_call', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  callerNumber: text('caller_number').notNull(),
  status: text('status').notNull(),
  duration: integer('duration'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),

  trackingNumberId: text('tracking_number_id').notNull().references(() => trackingNumber.id, { onDelete: 'cascade' }),
  companyId: text('company_id').references(() => company.id),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('phone_call_tracking_number_id_idx').on(t.trackingNumberId),
])

export const emailRecipient = pgTable('email_recipient', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  // The campaign the email marketing module sends: `campaign` (packages/tenant-backend marketing.ts writes its id
  // here). This pointed at `email_campaign`, a table nothing writes, so every recipient row was refused and "Send now"
  // reported "Sent to 0 of 2 contacts (2 failed)" with the raw foreign-key error on the campaign (live, 2026-10-22).
  campaignId: text('campaign_id').notNull().references(() => campaign.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').references(() => contact.id),
  email: text('email').notNull(),
  status: text('status').default('pending').notNull(),
  sentAt: timestamp('sent_at'),
  openedAt: timestamp('opened_at'),
  clickedAt: timestamp('clicked_at'),
  openCount: integer('open_count').default(0).notNull(),
  clickCount: integer('click_count').default(0).notNull(),
  unsubscribedAt: timestamp('unsubscribed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('email_recipient_campaign_id_status_idx').on(t.campaignId, t.status),
])

export const callLog = pgTable('call_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  trackingNumberId: text('tracking_number_id').references(() => trackingNumber.id),
  contactId: text('contact_id').references(() => contact.id),
  callerNumber: text('caller_number'),
  callerName: text('caller_name'),
  callerCity: text('caller_city'),
  callerState: text('caller_state'),
  source: text('source'),
  campaign: text('campaign'),
  medium: text('medium'),
  keyword: text('keyword'),
  landingPage: text('landing_page'),
  direction: text('direction').default('inbound'),
  duration: integer('duration'),
  status: text('status').default('completed').notNull(),
  startTime: timestamp('start_time'),
  endTime: timestamp('end_time'),
  recordingUrl: text('recording_url'),
  transcription: text('transcription'),
  tags: json('tags'),
  notes: text('notes'),
  firstTimeCaller: boolean('first_time_caller').default(false),
  providerId: text('provider_id'),
  isLead: boolean('is_lead').default(false),
  leadValue: decimal('lead_value', { precision: 12, scale: 2 }),
  aiSummary: text('ai_summary'),
  aiResponseSent: boolean('ai_response_sent').default(false),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // Home care's (templates/crm-homecare call_log).
  clientId: text('client_id').references(() => clients.id),
}, (t) => [
  index('call_log_company_id_idx').on(t.companyId),
  index('call_log_contact_id_idx').on(t.contactId),
])

export const aiReceptionistRule = pgTable('ai_receptionist_rule', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(), // after_hours, missed_call, voicemail, new_lead, booking_request, keyword
  channel: text('channel').notNull(), // sms, email, both
  messageTemplate: text('message_template').notNull(),
  delayMinutes: integer('delay_minutes').default(0).notNull(),
  isActive: boolean('is_active').default(true).notNull(),
  keywordMatch: text('keyword_match'), // for keyword trigger
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('ai_receptionist_rule_company_id_idx').on(t.companyId),
])

// One row per company. Keyed by company_id in the CRMs; here the standard id (RULEBOOK §5) with company_id unique, so the
// same lookups by company work and a moved row is given an id.
export const aiReceptionistSettings = pgTable('ai_receptionist_settings', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().unique().references(() => company.id, { onDelete: 'cascade' }),
  isEnabled: boolean('is_enabled').default(false).notNull(),
  businessHoursStart: text('business_hours_start').default('09:00').notNull(),
  businessHoursEnd: text('business_hours_end').default('17:00').notNull(),
  timezone: text('timezone').default('America/Chicago').notNull(),
  greetingText: text('greeting_text'),
  forwardingNumber: text('forwarding_number'),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})

export const dripSequence = pgTable('drip_sequence', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  description: text('description'),
  trigger: text('trigger').notNull(),
  active: boolean('active').default(false).notNull(),
  steps: json('steps'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('drip_sequence_company_id_idx').on(t.companyId),
])

export const sequenceEnrollment = pgTable('sequence_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  sequenceId: text('sequence_id').notNull().references(() => dripSequence.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  currentStep: integer('current_step').default(1).notNull(),
  status: text('status').default('active').notNull(),
  nextEmailAt: timestamp('next_email_at'),
  lastEmailAt: timestamp('last_email_at'),
  completedAt: timestamp('completed_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('sequence_enrollment_sequence_id_idx').on(t.sequenceId),
  index('sequence_enrollment_contact_id_idx').on(t.contactId),
  index('sequence_enrollment_next_email_at_idx').on(t.nextEmailAt),
])

export const emailClick = pgTable('email_click', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  recipientId: text('recipient_id').notNull().references(() => emailRecipient.id, { onDelete: 'cascade' }),
  url: text('url').notNull(),
  clickedAt: timestamp('clicked_at').defaultNow().notNull(),
}, (t) => [
  index('email_click_recipient_id_idx').on(t.recipientId),
])

export const smsAutoResponder = pgTable('sms_auto_responder', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  trigger: text('trigger').notNull(),
  keywords: json('keywords'),
  message: text('message').notNull(),
  afterHoursOnly: boolean('after_hours_only').default(false).notNull(),
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
}, (t) => [
  index('sms_auto_responder_company_id_idx').on(t.companyId),
])

// ─── Twomiah Ads — A/B experiments ─────────────────────────────────────────
// Each experiment tests variants of a landing page against ad traffic.
// We record one row per visitor assignment + one per conversion event.
export const adsExperiment = pgTable('ads_experiment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  path: text('path').notNull(),
  status: text('status').notNull().default('draft'),
  variants: json('variants').notNull().default([]),
  winnerKey: text('winner_key'),
  startedAt: timestamp('started_at'),
  endedAt: timestamp('ended_at'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
}, (t) => [
  index('ads_experiment_company_status_idx').on(t.companyId, t.status),
])

export const adsExperimentAssignment = pgTable('ads_experiment_assignment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  experimentId: text('experiment_id').notNull().references(() => adsExperiment.id, { onDelete: 'cascade' }),
  variantKey: text('variant_key').notNull(),
  visitorId: text('visitor_id').notNull(),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('ads_exp_assignment_exp_idx').on(t.experimentId, t.variantKey),
  index('ads_exp_assignment_visitor_idx').on(t.experimentId, t.visitorId),
])

export const adsExperimentConversion = pgTable('ads_experiment_conversion', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  experimentId: text('experiment_id').notNull().references(() => adsExperiment.id, { onDelete: 'cascade' }),
  variantKey: text('variant_key').notNull(),
  visitorId: text('visitor_id').notNull(),
  eventType: text('event_type').notNull().default('lead'),
  targetId: text('target_id'),
  createdAt: timestamp('created_at').notNull().defaultNow(),
}, (t) => [
  index('ads_exp_conversion_exp_idx').on(t.experimentId, t.variantKey),
])

// -- Google Business Profile connection (single row; factory-brokered OAuth) --
export const gbpConnection = pgTable('gbp_connection', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  externalEmail: text('external_email'),
  accessToken: text('access_token').notNull(),
  refreshToken: text('refresh_token'),
  expiresAt: timestamp('expires_at'),
  accountName: text('account_name'),
  locationName: text('location_name'),
  locationTitle: text('location_title'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
})
