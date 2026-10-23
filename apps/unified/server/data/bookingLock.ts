// One business-day at a time: the lock a booking takes before it checks and claims a time, held until its
// transaction ends. Two customers sending the same slot at the same instant are served one after the other, so the
// second one's check sees the first one's booking (the CRMs' engine, packages/tenant-backend/src/booking/service.ts).
// The premium site had no lock and no unique index, so both were saved.
import { sql } from 'drizzle-orm'

export async function lockBookingDay(tx: any, companyId: string, date: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':booking:' + date}))`)
}

/**
 * The job book's lock — the same key the jobs module takes around every create (packages/tenant-backend jobs.ts
 * jobLock) — so a booking converted into a job and a job made on the Jobs page are numbered and checked one at a time,
 * and two clicks on "Convert to job" make one job.
 */
export async function lockJobBook(tx: any, companyId: string): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${companyId + ':job'}))`)
}
