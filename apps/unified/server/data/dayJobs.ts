// A company day's open jobs (RULEBOOK §2: raw SQL lives here), for the day route (crm/field/dayRoute.ts): the jobs on
// that day by the company's clock (tenant-backend jobLocalDay — a booking's instant in the company's zone, a day marker
// as the day it names), not cancelled or completed, for one person (the jobs they lead or are on) or for everyone.
import { and, eq, notInArray, sql } from 'drizzle-orm'
import { companyTimeZone, jobLocalDay, onJob } from '@twomiah/tenant-backend'
import { job, jobAssignee } from '../db/schema/index.ts'

export async function openJobsOnDay(db: any, companyId: string, date: string, person: string | null, extra: any[] = []): Promise<any[]> {
  const tz = await companyTimeZone(db, companyId)
  return db.select().from(job).where(and(
    eq(job.companyId, companyId),
    sql`${jobLocalDay(job.scheduledDate, job.source, tz)} = ${date}::date`,
    notInArray(job.status, ['cancelled', 'completed']),
    ...(person ? [onJob(db, { job, jobAssignee }, person)] : []),
    ...extra,
  ))
}
