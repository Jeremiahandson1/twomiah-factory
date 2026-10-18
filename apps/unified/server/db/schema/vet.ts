// Veterinary add-on: patients, visits, vaccinations, lab results, prescriptions and wellness plans. Column for column
// from templates/crm-vet/backend/db/schema.ts.
import { pgTable, text, boolean, integer, decimal, timestamp, date, json, uniqueIndex, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { appointment } from './appointments.ts'
import { company, user } from './core.ts'
import { contact, invoice } from './crm.ts'

export const labResult = pgTable('lab_result', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'cascade' }),
  visitId: text('visit_id').references(() => visit.id, { onDelete: 'set null' }),
  testName: text('test_name').notNull(),
  category: text('category'),                          // bloodwork/urinalysis/imaging/cytology/...
  resultDate: date('result_date'),
  status: text('status').default('final').notNull(),  // pending/final
  results: json('results').default({}).notNull(),     // {analyte: {value, unit, range, flag}}
  summary: text('summary'),
  fileUrl: text('file_url'),                           // uploaded PDF/image — no lab-device integration
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('lab_result_company_id_idx').on(t.companyId),
  index('lab_result_patient_id_idx').on(t.patientId),
])

export const patient = pgTable('patient', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  ownerId: text('owner_id').notNull().references(() => contact.id, { onDelete: 'cascade' }),
  name: text('name').notNull(),
  species: text('species').default('dog').notNull(), // dog/cat/avian/reptile/equine/exotic/other
  breed: text('breed'),
  sex: text('sex'),                                  // male/female/unknown
  spayedNeutered: boolean('spayed_neutered').default(false).notNull(),
  dob: date('dob'),
  weightLb: decimal('weight_lb', { precision: 6, scale: 2 }),
  color: text('color'),
  microchip: text('microchip'),
  bloodType: text('blood_type'),
  insuranceProvider: text('insurance_provider'),
  insurancePolicy: text('insurance_policy'),
  allergies: text('allergies'),
  alerts: text('alerts'),                            // medical/behavioral flag shown on the chart
  rabiesTag: text('rabies_tag'),
  photo: text('photo'),
  deceased: boolean('deceased').default(false).notNull(),
  deceasedDate: date('deceased_date'),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('patient_company_id_idx').on(t.companyId),
  index('patient_owner_id_idx').on(t.ownerId),
])

export const prescription = pgTable('prescription', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'cascade' }),
  visitId: text('visit_id').references(() => visit.id, { onDelete: 'set null' }),
  prescriberId: text('prescriber_id').references(() => user.id, { onDelete: 'set null' }),
  drug: text('drug').notNull(),
  strength: text('strength'),
  form: text('form'),                                 // tablet/liquid/injectable/...
  sig: text('sig'),                                   // dosing instructions
  quantity: text('quantity'),
  refills: integer('refills').default(0).notNull(),
  isControlled: boolean('is_controlled').default(false).notNull(), // dispensing/EPCS/PDMP deferred
  prescribedDate: timestamp('prescribed_date').defaultNow().notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('prescription_company_id_idx').on(t.companyId),
  index('prescription_patient_id_idx').on(t.patientId),
])

export const vaccination = pgTable('vaccination', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'cascade' }),
  visitId: text('visit_id').references(() => visit.id, { onDelete: 'set null' }),
  providerId: text('provider_id').references(() => user.id, { onDelete: 'set null' }),
  vaccine: text('vaccine').notNull(),                 // rabies/DHPP/bordetella/FVRCP/lepto/...
  manufacturer: text('manufacturer'),
  lotNumber: text('lot_number'),
  serialNumber: text('serial_number'),
  site: text('site'),
  route: text('route'),
  givenDate: date('given_date').notNull(),
  dueDate: date('due_date'),                          // drives reminders + rabies-cert expiry
  isRabies: boolean('is_rabies').default(false).notNull(),
  rabiesTag: text('rabies_tag'),
  notes: text('notes'),
  // What reminding has already been done about THIS due date, so the list can say so and the practice
  // does not text the same owner about the same shot every morning. (Vet T12 M9)
  lastRemindedAt: timestamp('last_reminded_at'),
  reminderCount: integer('reminder_count').default(0).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('vaccination_company_id_idx').on(t.companyId),
  index('vaccination_patient_id_idx').on(t.patientId),
  index('vaccination_due_idx').on(t.dueDate),
])

export const visit = pgTable('visit', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'cascade' }),
  appointmentId: text('appointment_id').references(() => appointment.id, { onDelete: 'set null' }),
  providerId: text('provider_id').references(() => user.id, { onDelete: 'set null' }),
  visitDate: timestamp('visit_date').defaultNow().notNull(),
  reason: text('reason'),                             // presenting complaint
  weightLb: decimal('weight_lb', { precision: 6, scale: 2 }),
  temperatureF: decimal('temperature_f', { precision: 5, scale: 2 }),
  heartRate: integer('heart_rate'),
  respRate: integer('resp_rate'),
  subjective: text('subjective'),                     // SOAP
  objective: text('objective'),
  assessment: text('assessment'),
  plan: text('plan'),
  diagnoses: json('diagnoses').default([]).notNull(), // problem list (string[])
  treatments: text('treatments'),
  notes: text('notes'),
  total: decimal('total', { precision: 10, scale: 2 }),
  invoiceId: text('invoice_id'), // set once the visit charge has been billed (VET-15)
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('visit_company_id_idx').on(t.companyId),
  index('visit_patient_id_idx').on(t.patientId),
  // ONE VISIT BILLS ONCE, enforced by the database and not only by the route. The T41 blocker raced
  // POST /visits/:id/invoice and got two 201s on the same visit. (migration 0029)
  uniqueIndex('visit_invoice_id_unique_idx').on(t.invoiceId),
])

export const wellnessEnrollment = pgTable('wellness_enrollment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  planId: text('plan_id').notNull().references(() => wellnessPlan.id, { onDelete: 'cascade' }),
  patientId: text('patient_id').notNull().references(() => patient.id, { onDelete: 'cascade' }),
  ownerId: text('owner_id').references(() => contact.id, { onDelete: 'set null' }),
  status: text('status').default('active').notNull(), // active/paused/cancelled
  billingCycle: text('billing_cycle').default('monthly').notNull(),
  startDate: date('start_date'),
  renewsAt: date('renews_at'),
  /** the period already invoiced — makes the billing run idempotent (T12 H3) */
  lastBilledFor: date('last_billed_for'),
  lastInvoiceId: text('last_invoice_id').references(() => invoice.id, { onDelete: 'set null' }),
  cancelledAt: timestamp('cancelled_at'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('wellness_enrollment_company_id_idx').on(t.companyId),
  index('wellness_enrollment_patient_id_idx').on(t.patientId),
])

export const wellnessPlan = pgTable('wellness_plan', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  name: text('name').notNull(),
  description: text('description'),
  species: text('species'),                           // optional species restriction
  monthlyPrice: decimal('monthly_price', { precision: 8, scale: 2 }),
  annualPrice: decimal('annual_price', { precision: 8, scale: 2 }),
  benefits: json('benefits').default([]).notNull(),   // string[]
  active: boolean('active').default(true).notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
}, (t) => [
  index('wellness_plan_company_id_idx').on(t.companyId),
])
