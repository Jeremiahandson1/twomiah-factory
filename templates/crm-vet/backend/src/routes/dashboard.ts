import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, patient, appointment, visit, vaccination, wellnessEnrollment, user } from '../../db/schema.ts'
import { eq, and, gte, lt, count, desc, sql } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

/**
 * Veterinary practice dashboard — patients, appointments, visit revenue,
 * preventive-care reminders due and wellness enrollments (not the contractor
 * jobs/quotes/invoices the base ships).
 */

const app = new Hono()
app.use('*', authenticate)

app.get('/stats', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const tomorrow = new Date(today.getTime() + 86400000)
  const in7 = new Date(today.getTime() + 7 * 86400000)
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [ownerRows, patientsBySpecies, activePatientRows, todayApptRows, upcomingApptRows, apptsByStatus, visitsMonthRows, revenueRows, overdueVaxRows, dueSoonVaxRows, wellnessRows] = await Promise.all([
    safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
    safe(() => db.select({ species: patient.species, c: count() }).from(patient).where(and(eq(patient.companyId, companyId), eq(patient.deceased, false))).groupBy(patient.species), [] as { species: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(patient).where(and(eq(patient.companyId, companyId), eq(patient.deceased, false))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, tomorrow))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), lt(appointment.startTime, in7))), [{ value: 0 }]),
    safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(visit).where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))), [{ value: 0 }]),
    safe(() => db.select({ amt: visit.total }).from(visit).where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))), [] as { amt: string | null }[]),
    // Preventive-care reminders: vaccinations whose due date has passed / is within 30 days.
    safe(() => db.select({ value: count() }).from(vaccination).where(and(eq(vaccination.companyId, companyId), sql`${vaccination.dueDate} IS NOT NULL`, sql`${vaccination.dueDate} < CURRENT_DATE`)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(vaccination).where(and(eq(vaccination.companyId, companyId), sql`${vaccination.dueDate} >= CURRENT_DATE`, sql`${vaccination.dueDate} < CURRENT_DATE + INTERVAL '30 days'`)), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(wellnessEnrollment).where(and(eq(wellnessEnrollment.companyId, companyId), eq(wellnessEnrollment.status, 'active'))), [{ value: 0 }]),
  ])

  const revenueThisMonth = revenueRows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0)

  return c.json({
    contacts: ownerRows[0]?.value ?? 0,
    patients: {
      total: activePatientRows[0]?.value ?? 0,
      active: activePatientRows[0]?.value ?? 0,
      bySpecies: Object.fromEntries(patientsBySpecies.map(p => [p.species, Number(p.c)])),
    },
    appointments: {
      today: todayApptRows[0]?.value ?? 0,
      upcoming7: upcomingApptRows[0]?.value ?? 0,
      byStatus: Object.fromEntries(apptsByStatus.map(a => [a.status, Number(a.c)])),
    },
    visits: { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueThisMonth },
    reminders: { overdue: overdueVaxRows[0]?.value ?? 0, dueSoon: dueSoonVaxRows[0]?.value ?? 0 },
    wellness: { activeEnrollments: wellnessRows[0]?.value ?? 0 },
  })
})

app.get('/recent-activity', async (c) => {
  const user_ = c.get('user') as any
  const companyId = user_.companyId
  const now = new Date()
  const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
    try { return await fn() } catch { return fallback }
  }

  const [recentPatients, recentVisits, upcomingAppointments] = await Promise.all([
    safe(() => db.select({ id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, ownerName: contact.name, updatedAt: patient.updatedAt })
      .from(patient).leftJoin(contact, eq(patient.ownerId, contact.id)).where(eq(patient.companyId, companyId)).orderBy(desc(patient.updatedAt)).limit(5), []),
    safe(() => db.select({ id: visit.id, visitDate: visit.visitDate, reason: visit.reason, patientName: patient.name, ownerName: contact.name })
      .from(visit).leftJoin(patient, eq(visit.patientId, patient.id)).leftJoin(contact, eq(patient.ownerId, contact.id)).where(eq(visit.companyId, companyId)).orderBy(desc(visit.visitDate)).limit(5), []),
    safe(() => db.select({ id: appointment.id, startTime: appointment.startTime, type: appointment.type, status: appointment.status, patientName: patient.name, ownerName: contact.name, providerFirstName: user.firstName, providerLastName: user.lastName })
      .from(appointment).leftJoin(patient, eq(appointment.patientId, patient.id)).leftJoin(contact, eq(appointment.ownerId, contact.id)).leftJoin(user, eq(appointment.providerId, user.id))
      .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now))).orderBy(appointment.startTime).limit(8), []),
  ])

  return c.json({ recentPatients, recentVisits, upcomingAppointments })
})

export default app
