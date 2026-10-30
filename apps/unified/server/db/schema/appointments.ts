// Appointments (salons and vets): a time booked with a person for a client — the salon's with a stylist for a
// service, the vet's with a provider for a patient. The union of both, from templates/crm-{salon,vet}/backend/db/schema.ts.
import { pgTable, text, decimal, timestamp, integer, index } from 'drizzle-orm/pg-core'
import { createId } from '@paralleldrive/cuid2'
import { company, user } from './core.ts'
import { contact, teamMember } from './crm.ts'
import { serviceMenu } from './salon.ts'
import { patient } from './vet.ts'

export const appointment = pgTable('appointment', {
  id: text('id').primaryKey().$defaultFn(() => createId()),
  contactId: text('contact_id').references(() => contact.id, { onDelete: 'set null' }),
  stylistId: text('stylist_id').references(() => user.id, { onDelete: 'set null' }),
  // A stylist is not always a LOGIN. stylist_id points at `user`, so a chair-only stylist added on the
  // Team page — who lives in team_member and has a different id — could never be booked: the write was
  // refused by the foreign key while /api/team/assignable went on offering them. Second column so a
  // roster stylist can hold the chair too; exactly one of the two is ever set. (Salon T20 H1)
  stylistMemberId: text('stylist_member_id').references(() => teamMember.id, { onDelete: 'set null' }),
  serviceId: text('service_id').references(() => serviceMenu.id, { onDelete: 'set null' }),
  status: text('status').default('scheduled').notNull(), // scheduled/confirmed/checked_in/in_chair/completed/no_show/cancelled
  station: text('station'),                              // chair / room
  startTime: timestamp('start_time').notNull(),
  endTime: timestamp('end_time'),
  checkedInAt: timestamp('checked_in_at'),
  reminderSentAt: timestamp('reminder_sent_at'),                 // day-before text sent (services/appointmentReminders.ts)
  reminderNotes: text('reminder_notes'),
  quotedPrice: decimal('quoted_price', { precision: 10, scale: 2 }),
  notes: text('notes'),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at').defaultNow().notNull(),
  /** When it was cancelled (the book, the client's own link): what a late-cancel fee is measured from. Null until cancelled. */
  cancelledAt: timestamp('cancelled_at'),
  /** The service's processing gap as it was when booked (salon): free for `processingMin` minutes from `processingAfterMin` in. Null = none. */
  processingAfterMin: integer('processing_after_min'),
  processingMin: integer('processing_min'),
  companyId: text('company_id').notNull().references(() => company.id, { onDelete: 'cascade' }),
  patientId: text('patient_id').references(() => patient.id, { onDelete: 'set null' }),
  ownerId: text('owner_id').references(() => contact.id, { onDelete: 'set null' }),
  providerId: text('provider_id').references(() => user.id, { onDelete: 'set null' }),
  type: text('type').default('wellness').notNull(),   // wellness/sick/surgery/dental/recheck/grooming/euthanasia
  room: text('room'),
  reason: text('reason'),
}, (t) => [
  index('appointment_company_id_idx').on(t.companyId),
  index('appointment_contact_id_idx').on(t.contactId),
  index('appointment_start_idx').on(t.startTime),
])
