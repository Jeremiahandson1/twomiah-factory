// Service-trades layer: a customer's service sites, job photos, vehicle trips, the activity log and portal sessions —
// the tables the trades CRMs (basic, field service, landscaping, bar) share beyond the base CRM's. Column for column
// from templates/crm-{basic,fieldservice,landscaping,bar}/backend/db/schema.ts (the union where they differ).
import { pgTable, text, integer, real, timestamp, json, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, job } from './crm.ts'
import { vehicle } from './field.ts'

export const activityLog = pgTable('activity_log', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id),
  entityType: text('entity_type').notNull(),
  entityId: text('entity_id').notNull(),
  action: text('action').notNull(),
  description: text('description'),
  metadata: json('metadata'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('activity_log_company_id_idx').on(t.companyId),
  index('activity_log_entity_type_entity_id_idx').on(t.entityType, t.entityId),
])

export const jobPhoto = pgTable('job_photo', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  jobId: text('job_id').notNull().references(() => job.id, { onDelete: 'cascade' }),
  uploadedById: text('uploaded_by_id').references(() => user.id, { onDelete: 'set null' }),
  url: text('url').notNull(),
  thumbnailUrl: text('thumbnail_url'),
  caption: text('caption'),
  takenAt: timestamp('taken_at').defaultNow().notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  // What the photo shows — before, damage, during, after … (templates/crm-roof job_photo.photo_type; roofing's
  // insurance paperwork is built from them). Every other vertical's photo is 'general'.
  photoType: text('photo_type').default('general').notNull(),
}, (t) => [
  index('job_photo_company_id_idx').on(t.companyId),
  index('job_photo_job_id_idx').on(t.jobId),
])

export const portalSession = pgTable('portal_session', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  token: text('token').notNull().unique(),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  expiresAt: timestamp('expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('portal_session_token_idx').on(t.token),
  index('portal_session_contact_id_idx').on(t.contactId),
])

export const site = pgTable('site', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  address: text('address'),
  city: text('city'),
  state: text('state'),
  zip: text('zip'),
  accessNotes: text('access_notes'),
  // Area-based pricing: measured serviceable areas for this property (square feet)
  lawnSqft: integer('lawn_sqft'),
  bedSqft: integer('bed_sqft'),
  hardscapeSqft: integer('hardscape_sqft'),
  lotSqft: integer('lot_sqft'),
  drivewaySqft: integer('driveway_sqft'),
  measuredAt: timestamp('measured_at'),
  measurementSource: text('measurement_source'), // manual, aerial, on_site
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),

  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  contactId: text('contact_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
}, (t) => [
  index('site_company_id_idx').on(t.companyId),
  index('site_contact_id_idx').on(t.contactId),
])

// Vehicle trips. A trip is bracketed by start/end; the distance is computed
// from the assigned driver's location_log pings within the trip window (the
// same phone-based location feed geofencing uses). No separate GPS device.
export const vehicleTrip = pgTable('vehicle_trip', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  status: text('status').default('active').notNull(), // active | completed
  startTime: timestamp('start_time').defaultNow().notNull(),
  endTime: timestamp('end_time'),
  startLat: real('start_lat'),
  startLng: real('start_lng'),
  endLat: real('end_lat'),
  endLng: real('end_lng'),
  distanceMiles: real('distance_miles'),
  purpose: text('purpose'),

  vehicleId: text('vehicle_id').notNull().references(() => vehicle.id, { onDelete: 'cascade' }),
  userId: text('user_id').references(() => user.id, { onDelete: 'set null' }),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),

  createdAt: timestamp('created_at').defaultNow().notNull(),
}, (t) => [
  index('vehicle_trip_company_id_status_idx').on(t.companyId, t.status),
  index('vehicle_trip_vehicle_id_idx').on(t.vehicleId),
])
