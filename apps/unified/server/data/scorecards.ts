// TECHNICIAN AND CSR SCORECARDS (parity tier 3, field service — ServiceTitan's technician and CSR scorecards), the figures the team
// revenue report's two scorecard tabs show (crm/field/teamReportTables.ts). Revenue and quote conversion are that report's own
// (data/teamRevenue.ts); these are the rest, per person, for jobs finished in the period:
//   · TECH: jobs completed (the lead and everyone on the crew each count it); started on time — the tech pressed Start within
//     ON_TIME_MINUTES of the booked time, on the business's clock (a job with no booked time or no start is not counted either way);
//     call-backs — the same customer has another job made within CALLBACK_DAYS of this one being completed (ServiceTitan's recall).
//   · CSR: jobs booked — the office person who made the job (job.created_by_id), made in the period, and how many of those were
//     completed and how many cancelled.
import { and, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm'
import { zonedWallTimeToUtc, storeDateString } from '@twomiah/tenant-backend'
import { job, jobAssignee } from '../db/schema/index.ts'
import type { Range } from './teamReports.ts'

export const ON_TIME_MINUTES = 15
export const CALLBACK_DAYS = 30
const DAY = 86_400_000
const keyOf = (userId: unknown, memberId: unknown) => (userId ? `u:${userId}` : memberId ? `m:${memberId}` : null)

export interface TechScore { key: string; completed: number; timed: number; onTime: number; callbacks: number }
export interface CsrScore { key: string; booked: number; completed: number; cancelled: number }

/** When the job was booked to start, as an instant, or null (no date or no time). */
export function bookedStart(scheduledDate: Date | string | null, scheduledTime: string | null, tz: string): Date | null {
  if (!scheduledDate || !scheduledTime || !/^\d{1,2}:\d{2}/.test(scheduledTime)) return null
  const day = storeDateString(new Date(scheduledDate as any), 'UTC')
  const at = zonedWallTimeToUtc(day, scheduledTime.slice(0, 5), tz)
  return isNaN(at.getTime()) ? null : at
}

export async function techScores(db: any, companyId: string, range: Range, tz: string): Promise<Map<string, TechScore>> {
  const done = await db.select({ id: job.id, contactId: job.contactId, lead: job.assignedToId, leadMember: job.assignedToMemberId, completedAt: job.completedAt, startedAt: job.startedAt, scheduledDate: job.scheduledDate, scheduledTime: job.scheduledTime })
    .from(job).where(and(eq(job.companyId, companyId), eq(job.status, 'completed'), isNotNull(job.completedAt), range.gte ? gte(job.completedAt, range.gte) : undefined, range.lte ? lte(job.completedAt, range.lte) : undefined))
  const out = new Map<string, TechScore>()
  if (!done.length) return out
  const crew = await db.select({ jobId: jobAssignee.jobId, userId: jobAssignee.userId, memberId: jobAssignee.memberId }).from(jobAssignee).where(inArray(jobAssignee.jobId, (done as any[]).map((j) => j.id)))
  // Call-backs: the same customers' jobs made after the first of these was completed.
  const contacts = [...new Set((done as any[]).map((j) => j.contactId).filter(Boolean))] as string[]
  const earliest = new Date(Math.min(...(done as any[]).map((j) => new Date(j.completedAt).getTime())))
  const later = contacts.length ? await db.select({ id: job.id, contactId: job.contactId, createdAt: job.createdAt }).from(job)
    .where(and(eq(job.companyId, companyId), inArray(job.contactId, contacts), gte(job.createdAt, earliest))) : []
  const slot = (k: string) => { let s = out.get(k); if (!s) { s = { key: k, completed: 0, timed: 0, onTime: 0, callbacks: 0 }; out.set(k, s) } return s }
  for (const j of done as any[]) {
    const people = new Set<string>([keyOf(j.lead, j.leadMember), ...(crew as any[]).filter((c) => c.jobId === j.id).map((c) => keyOf(c.userId, c.memberId))].filter(Boolean) as string[])
    const booked = bookedStart(j.scheduledDate, j.scheduledTime, tz)
    const timed = !!(booked && j.startedAt)
    const onTime = timed && new Date(j.startedAt).getTime() <= booked!.getTime() + ON_TIME_MINUTES * 60_000
    const doneAt = new Date(j.completedAt).getTime()
    const callback = (later as any[]).some((x) => x.id !== j.id && x.contactId && x.contactId === j.contactId && new Date(x.createdAt).getTime() > doneAt && new Date(x.createdAt).getTime() <= doneAt + CALLBACK_DAYS * DAY)
    for (const k of people) {
      const s = slot(k)
      s.completed++
      if (timed) { s.timed++; if (onTime) s.onTime++ }
      if (callback) s.callbacks++
    }
  }
  return out
}

export async function csrScores(db: any, companyId: string, range: Range): Promise<Map<string, CsrScore>> {
  const made = await db.select({ by: job.createdById, status: job.status }).from(job)
    .where(and(eq(job.companyId, companyId), isNotNull(job.createdById), range.gte ? gte(job.createdAt, range.gte) : undefined, range.lte ? lte(job.createdAt, range.lte) : undefined))
  const out = new Map<string, CsrScore>()
  for (const r of made as any[]) {
    const k = `u:${r.by}`
    const s = out.get(k) ?? { key: k, booked: 0, completed: 0, cancelled: 0 }
    s.booked++
    if (r.status === 'completed') s.completed++
    if (r.status === 'cancelled') s.cancelled++
    out.set(k, s)
  }
  return out
}
