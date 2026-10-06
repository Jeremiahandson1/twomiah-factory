import { Hono } from 'hono'
import { db } from '../../db/index.ts'
import { contact, patient, appointment, visit, vaccination, wellnessEnrollment, user } from '../../db/schema.ts'
import { eq, and, gte, lt, lte, count, desc, sql, notInArray } from 'drizzle-orm'
import { authenticate } from '../middleware/auth.ts'

/**
 * Veterinary practice dashboard — patients, appointments, visit revenue,
 * preventive-care reminders due and wellness enrollments (not the contractor
 * jobs/quotes/invoices the base ships).
 */

/** A cancelled or no-show slot is not work the practice still has to do. (T12 M3) */
const INACTIVE_APPT = ['cancelled', 'no_show']

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
    safe(() => db.select({ species: sql<string>`lower(${patient.species})`, c: count() }).from(patient).where(and(eq(patient.companyId, companyId), eq(patient.deceased, false))).groupBy(sql`lower(${patient.species})`), [] as { species: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(patient).where(and(eq(patient.companyId, companyId), eq(patient.deceased, false))), [{ value: 0 }]),
    // "Appointments Today" is what the practice still has to see — a cancelled or no-show slot is not one of them.
    // It counted every row in today's window, so a day with two cancellations read 9 when 7 were coming. (T12 M3)
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, tomorrow), notInArray(appointment.status, INACTIVE_APPT))), [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), lt(appointment.startTime, in7))), [{ value: 0 }]),
    safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
    safe(() => db.select({ value: count() }).from(visit).where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))), [{ value: 0 }]),
    /**
     * REVENUE IS WORK DONE AND BILLED. (T51)
     *
     *   "The revenue tile counts unbilled and future visits."
     *
     * This summed `visit.total` over every visit row dated this month, which counts two things that
     * are not revenue:
     *
     *   · a visit still in the FUTURE — a consultation booked for the 28th is not money, and on the
     *     1st of a month the tile was reporting the whole month ahead as though it had been earned;
     *   · a visit that has happened but has never been BILLED — the charge exists on the chart and
     *     nobody has been asked to pay it.
     *
     * So: visits up to now, that carry an invoice. `visit.invoiceId` is set by the billing route and
     * is the only record of whether the owner was ever asked. The two excluded amounts are returned
     * beside it (`unbilledThisMonth`, `scheduledThisMonth`) rather than silently dropped — a smaller
     * number with no explanation is the next question, and the practice should be able to see the
     * work it has not invoiced.
     */
    safe(() => db.select({ amt: visit.total, invoiceId: visit.invoiceId, visitDate: visit.visitDate }).from(visit)
      .where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))),
      [] as { amt: string | null; invoiceId: string | null; visitDate: any }[]),
    /**
     * THE SAME QUESTION THE REMINDERS LIST ANSWERS. (T51)
     *
     *   "the dashboard says 11 overdue and Reminders says 9"
     *
     * These counted every vaccination ROW with a past due date. The Reminders list
     * (reminders.ts /due) keeps only the LATEST administration per (patient, vaccine) — its own
     * comment says why: "so a renewed vaccine doesn't keep nagging on the old due date" — and skips
     * deceased patients. So a pet whose rabies shot was given again last month still had its old row
     * counted here, and the two screens disagreed about the same clinic by exactly those rows.
     *
     * Neither number was meaningless; they were answers to different questions, and only one of them
     * is what "overdue reminders" means. DISTINCT ON picks the latest administration per pet+vaccine
     * the same way, ordered by given_date, and the join drops deceased patients the same way.
     *
     * Raw SQL because DISTINCT ON has no drizzle builder form, and doing it in JavaScript would mean
     * pulling every vaccination row into memory to count two numbers.
     */
    safe(async () => {
      const r: any = await db.execute(sql`
        SELECT COUNT(*)::int AS value FROM (
          SELECT DISTINCT ON (v.patient_id, lower(v.vaccine)) v.due_date
          FROM vaccination v
          JOIN patient p ON p.id = v.patient_id
          WHERE v.company_id = ${companyId} AND v.due_date IS NOT NULL AND p.deceased = false
          ORDER BY v.patient_id, lower(v.vaccine), v.given_date DESC NULLS LAST
        ) latest
        WHERE latest.due_date < CURRENT_DATE
      `)
      return (r.rows || r) as { value: number }[]
    }, [{ value: 0 }]),
    safe(async () => {
      const r: any = await db.execute(sql`
        SELECT COUNT(*)::int AS value FROM (
          SELECT DISTINCT ON (v.patient_id, lower(v.vaccine)) v.due_date
          FROM vaccination v
          JOIN patient p ON p.id = v.patient_id
          WHERE v.company_id = ${companyId} AND v.due_date IS NOT NULL AND p.deceased = false
          ORDER BY v.patient_id, lower(v.vaccine), v.given_date DESC NULLS LAST
        ) latest
        WHERE latest.due_date >= CURRENT_DATE AND latest.due_date < CURRENT_DATE + INTERVAL '30 days'
      `)
      return (r.rows || r) as { value: number }[]
    }, [{ value: 0 }]),
    safe(() => db.select({ value: count() }).from(wellnessEnrollment).where(and(eq(wellnessEnrollment.companyId, companyId), eq(wellnessEnrollment.status, 'active'))), [{ value: 0 }]),
  ])

  /**
   * Three buckets over the same rows, so they add up to what the month holds and each one can be
   * read on its own. A visit dated today counts as having happened — the practice is looking at its
   * own day, not at an instant.
   */
  const r2 = (n: number) => Math.round(n * 100) / 100
  const happened = (r: any) => !r.visitDate || new Date(r.visitDate).getTime() <= now.getTime()
  const revenueThisMonth = r2(revenueRows
    .filter((r: any) => happened(r) && r.invoiceId)
    .reduce((s: number, r: any) => s + Number(r.amt || 0), 0))
  /** Work done and not yet invoiced — the figure a practice chases at month end. */
  const unbilledThisMonth = r2(revenueRows
    .filter((r: any) => happened(r) && !r.invoiceId)
    .reduce((s: number, r: any) => s + Number(r.amt || 0), 0))
  /** Still to come this month. Not revenue, and not a debt either. */
  const scheduledThisMonth = r2(revenueRows
    .filter((r: any) => !happened(r))
    .reduce((s: number, r: any) => s + Number(r.amt || 0), 0))

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
    // revenueThisMonth is work DONE and BILLED. The other two are what used to be folded into it,
    // returned so the tile can account for the difference instead of just being smaller. (T51)
    visits: { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueThisMonth, unbilledThisMonth, scheduledThisMonth },
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
    // Recent Visits showed $0 against every line because the total was never selected. (T12 M4)
    //
    // RECENT means it has happened. (T41: "Recent Visits is led by a future-dated 2027 visit.")
    // POST/PUT /api/visits now refuse a future date, but a row entered before that fix is still in
    // the table and this panel orders by visitDate DESC — so the one mistyped record would sit at
    // the top of the practice's home page for ever. The clause also keeps the panel honest if a
    // date is ever back-filled from an import.
    safe(() => db.select({ id: visit.id, visitDate: visit.visitDate, reason: visit.reason, total: visit.total, patientName: patient.name, ownerName: contact.name })
      .from(visit).leftJoin(patient, eq(visit.patientId, patient.id)).leftJoin(contact, eq(patient.ownerId, contact.id))
      .where(and(eq(visit.companyId, companyId), lte(visit.visitDate, now))).orderBy(desc(visit.visitDate)).limit(5), []),
    safe(() => db.select({ id: appointment.id, startTime: appointment.startTime, type: appointment.type, status: appointment.status, patientName: patient.name, ownerName: contact.name, providerFirstName: user.firstName, providerLastName: user.lastName })
      .from(appointment).leftJoin(patient, eq(appointment.patientId, patient.id)).leftJoin(contact, eq(appointment.ownerId, contact.id)).leftJoin(user, eq(appointment.providerId, user.id))
      .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now))).orderBy(appointment.startTime).limit(8), []),
  ])

  return c.json({ recentPatients, recentVisits, upcomingAppointments })
})

export default app
