// The veterinary practice's dashboard: patients, the day's appointments, billed visit revenue, vaccinations due and
// wellness enrolments — not the jobs, quotes and invoices the jobs dashboard counts. Moved from
// templates/crm-vet/backend/src/routes/dashboard.ts. Mounted at /api/dashboard in place of the jobs dashboard where
// the vertical says so (CrmSettings.dashboard 'practice', server/modules/crm.ts), behind 'dashboard'.
import { Hono } from 'hono'
import { eq, and, gte, lt, lte, count, desc, notInArray } from 'drizzle-orm'
import { contact, patient, appointment, visit, wellnessEnrollment, user } from '../../db/schema/index.ts'
import { livingPatientsBySpecies, latestVaccinationsDue } from '../../data/vetDashboard.ts'
import type { CrmDeps } from '../deps.ts'
import type { AppEnv } from '../../http/env.ts'
import { one } from '../../http/reply.ts'

/** A cancelled or no-show slot is not work the practice still has to do. (T12 M3) */
const INACTIVE_APPT = ['cancelled', 'no_show']

/** A tile that can't be read reads as its empty value rather than taking the whole page down (as the template did). */
const safe = async <T>(fn: () => Promise<T>, fallback: T): Promise<T> => {
  try { return await fn() } catch { return fallback }
}

export function createPracticeDashboardRoutes(d: CrmDeps) {
  const { db } = d
  const { hasPermission, getExtraPermissions } = d.permissions
  const app = new Hono<AppEnv>()

  app.get('/stats', async (c) => {
    const me = c.get('user') as any
    const companyId = me.companyId
    const now = new Date()
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const tomorrow = new Date(today.getTime() + 86400000)
    const in7 = new Date(today.getTime() + 7 * 86400000)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

    const [ownerRows, patientsBySpecies, activePatientRows, todayApptRows, upcomingApptRows, apptsByStatus, visitsMonthRows, revenueRows, overdueVax, dueSoonVax, wellnessRows] = await Promise.all([
      safe(() => db.select({ value: count() }).from(contact).where(eq(contact.companyId, companyId)), [{ value: 0 }]),
      safe(() => livingPatientsBySpecies(db, companyId), [] as { species: string; c: number }[]),
      safe(() => db.select({ value: count() }).from(patient).where(and(eq(patient.companyId, companyId), eq(patient.deceased, false))), [{ value: 0 }]),
      // What the practice still has to see today — not a cancelled or no-show slot. (T12 M3)
      safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, tomorrow), notInArray(appointment.status, INACTIVE_APPT))), [{ value: 0 }]),
      safe(() => db.select({ value: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now), lt(appointment.startTime, in7))), [{ value: 0 }]),
      safe(() => db.select({ status: appointment.status, c: count() }).from(appointment).where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, today), lt(appointment.startTime, in7))).groupBy(appointment.status), [] as { status: string; c: number }[]),
      safe(() => db.select({ value: count() }).from(visit).where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))), [{ value: 0 }]),
      // REVENUE IS WORK DONE AND BILLED (T51): the month's visits are read once and split three ways below.
      safe(() => db.select({ amt: visit.total, invoiceId: visit.invoiceId, visitDate: visit.visitDate }).from(visit)
        .where(and(eq(visit.companyId, companyId), gte(visit.visitDate, startOfMonth), lt(visit.visitDate, startOfNextMonth))),
        [] as { amt: string | null; invoiceId: string | null; visitDate: any }[]),
      safe(() => latestVaccinationsDue(db, companyId, 'overdue'), 0),
      safe(() => latestVaccinationsDue(db, companyId, 'soon'), 0),
      safe(() => db.select({ value: count() }).from(wellnessEnrollment).where(and(eq(wellnessEnrollment.companyId, companyId), eq(wellnessEnrollment.status, 'active'))), [{ value: 0 }]),
    ])

    /**
     * Three buckets over the same rows, so they add up to what the month holds: done and billed (revenue), done and
     * not billed (what a practice chases at month end), and still to come. A visit dated today has happened.
     */
    const r2 = (n: number) => Math.round(n * 100) / 100
    const happened = (r: any) => !r.visitDate || new Date(r.visitDate).getTime() <= now.getTime()
    const sum = (rows: any[]) => r2(rows.reduce((s: number, r: any) => s + Number(r.amt || 0), 0))
    const revenueThisMonth = sum(revenueRows.filter((r: any) => happened(r) && r.invoiceId))
    const unbilledThisMonth = sum(revenueRows.filter((r: any) => happened(r) && !r.invoiceId))
    const scheduledThisMonth = sum(revenueRows.filter((r: any) => !happened(r)))
    // Vet staff do not see practice revenue. (T62; owner's decision 2026-10-09)
    const maySeeRevenue = hasPermission(me?.role, 'revenue:read', await getExtraPermissions(me?.userId))

    return one(c, {
      contacts: ownerRows[0]?.value ?? 0,
      patients: {
        total: activePatientRows[0]?.value ?? 0,
        active: activePatientRows[0]?.value ?? 0,
        bySpecies: Object.fromEntries(patientsBySpecies.map((p) => [p.species, Number(p.c)])),
      },
      appointments: {
        today: todayApptRows[0]?.value ?? 0,
        upcoming7: upcomingApptRows[0]?.value ?? 0,
        byStatus: Object.fromEntries(apptsByStatus.map((a) => [a.status, Number(a.c)])),
      },
      // The three money figures go only to revenue:read — absent, with revenueWithheld, so a tile can't print $0.00.
      visits: maySeeRevenue
        ? { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueThisMonth, unbilledThisMonth, scheduledThisMonth }
        : { thisMonth: visitsMonthRows[0]?.value ?? 0, revenueWithheld: true },
      reminders: { overdue: overdueVax, dueSoon: dueSoonVax },
      wellness: { activeEnrollments: wellnessRows[0]?.value ?? 0 },
    })
  })

  app.get('/recent-activity', async (c) => {
    const companyId = (c.get('user') as any).companyId
    const now = new Date()
    const [recentPatients, recentVisits, upcomingAppointments] = await Promise.all([
      safe(() => db.select({ id: patient.id, name: patient.name, species: patient.species, breed: patient.breed, ownerName: contact.name, updatedAt: patient.updatedAt })
        .from(patient).leftJoin(contact, eq(patient.ownerId, contact.id)).where(eq(patient.companyId, companyId)).orderBy(desc(patient.updatedAt)).limit(5), []),
      // RECENT means it has happened (T41), and the total is selected so a line doesn't read $0 (T12 M4). The patient's
      // id too: the panel links each line to its chart, and without it every link was '#' (found moving it).
      safe(() => db.select({ id: visit.id, patientId: visit.patientId, visitDate: visit.visitDate, reason: visit.reason, total: visit.total, patientName: patient.name, ownerName: contact.name })
        .from(visit).leftJoin(patient, eq(visit.patientId, patient.id)).leftJoin(contact, eq(patient.ownerId, contact.id))
        .where(and(eq(visit.companyId, companyId), lte(visit.visitDate, now))).orderBy(desc(visit.visitDate)).limit(5), []),
      safe(() => db.select({ id: appointment.id, startTime: appointment.startTime, type: appointment.type, status: appointment.status, patientName: patient.name, ownerName: contact.name, providerFirstName: user.firstName, providerLastName: user.lastName })
        .from(appointment).leftJoin(patient, eq(appointment.patientId, patient.id)).leftJoin(contact, eq(appointment.ownerId, contact.id)).leftJoin(user, eq(appointment.providerId, user.id))
        .where(and(eq(appointment.companyId, companyId), gte(appointment.startTime, now))).orderBy(appointment.startTime).limit(8), []),
    ])
    return one(c, { recentPatients, recentVisits, upcomingAppointments })
  })

  return app
}
