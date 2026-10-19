// The veterinary appointment book's SQL (moved from templates/crm-vet/backend/src/routes/appointments.ts): the
// per-business lock that serialises a booking's check-then-write, and the exam-room overlap scan.
import { sql, eq, and, ne } from 'drizzle-orm'
import { appointment } from '../db/schema/index.ts'

/**
 * One advisory lock per business, held for the transaction, so two staff saving the same provider or room at once
 * can't both pass the overlap scan (the vet double-book race).
 */
export async function lockAppointmentBook(tx: any, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':appt'}))`)
}

/** The business's non-cancelled appointments in one exam room, the room's name compared trimmed and case-blind. */
export async function appointmentsInRoom(exec: any, companyId: string, room: string) {
  return exec.select().from(appointment).where(and(
    eq(appointment.companyId, companyId),
    sql`lower(trim(${appointment.room})) = ${room.trim().toLowerCase()}`,
    ne(appointment.status, 'cancelled'),
  ))
}
