// Phone notifications' raw SQL (RULEBOOK §2), for core/phonePush.ts and crm/notify/jobAssignments.ts: the phones a person
// signed in on, and the jobs whose person or time changed since they were last told.
import { and, eq, inArray, sql } from 'drizzle-orm'
import { expoPushTokens, job, jobAssignee, jobPushState, user } from '../db/schema/index.ts'

/**
 * A job's scheduled day and time as one comparable text: 'YYYY-MM-DD HH:MM', the day alone with no time, NULL with no
 * day. Migration 0015 seeds job_push_state with this exact expression.
 */
export const SCHEDULED_FOR = sql`CASE WHEN ${job.scheduledDate} IS NULL THEN NULL ELSE to_char(${job.scheduledDate}, 'YYYY-MM-DD') || COALESCE(' ' || NULLIF(${job.scheduledTime}, ''), '') END`

/**
 * Everyone on a job who can sign in, as one comparable text: the lead (assigned_to_id), then the others on it
 * (job_assignee, 2026-10-24) by id, comma-separated; NULL with nobody. A job with only a lead reads exactly as
 * assigned_to_id did, so the state migration 0015 seeded still matches and nobody is told twice.
 */
export const ASSIGNEES = sql`NULLIF(concat_ws(',', ${job.assignedToId}, (SELECT string_agg(${jobAssignee.userId}, ',' ORDER BY ${jobAssignee.userId}) FROM ${jobAssignee} WHERE ${jobAssignee.jobId} = ${job.id} AND ${jobAssignee.userId} IS NOT NULL)), '')`

/** Work that is finished, lost or called off: a change to it is not news to anyone. */
const CLOSED = ['completed', 'complete', 'cancelled', 'canceled', 'closed', 'lost', 'invoiced', 'paid', 'archived']

export interface JobChange {
  jobId: string
  title: string
  number: string | null
  /** ASSIGNEES: everyone on the job who can sign in, comma-separated (what job_push_state.assignee_id records). */
  assigneeId: string | null
  scheduledFor: string | null
  previousAssigneeId: string | null
  previousScheduledFor: string | null
  /** No row yet: the job is new since the state was filled. */
  fresh: boolean
  closed: boolean
}

/** Jobs whose person or time differ from what was last announced (at most `limit`, oldest change first). */
export async function jobChanges(db: any, companyId: string, limit = 500): Promise<JobChange[]> {
  const rows = await db.select({
    jobId: job.id, title: job.title, number: job.number, status: job.status,
    assigneeId: ASSIGNEES, scheduledFor: SCHEDULED_FOR,
    stateJobId: jobPushState.jobId, previousAssigneeId: jobPushState.assigneeId, previousScheduledFor: jobPushState.scheduledFor,
  }).from(job)
    .leftJoin(jobPushState, eq(jobPushState.jobId, job.id))
    .where(and(eq(job.companyId, companyId), sql`(${jobPushState.jobId} IS NULL OR ${jobPushState.assigneeId} IS DISTINCT FROM ${ASSIGNEES} OR ${jobPushState.scheduledFor} IS DISTINCT FROM ${SCHEDULED_FOR})`))
    .orderBy(job.updatedAt)
    .limit(limit)
  return rows.map((r: any) => ({
    jobId: r.jobId, title: r.title, number: r.number ?? null, assigneeId: r.assigneeId ?? null, scheduledFor: r.scheduledFor ?? null,
    previousAssigneeId: r.previousAssigneeId ?? null, previousScheduledFor: r.previousScheduledFor ?? null,
    fresh: !r.stateJobId, closed: CLOSED.includes(String(r.status || '').toLowerCase()),
  }))
}

/** Records what a job was announced as. */
export async function recordJobState(db: any, c: Pick<JobChange, 'jobId' | 'assigneeId' | 'scheduledFor'>): Promise<void> {
  await db.insert(jobPushState).values({ jobId: c.jobId, assigneeId: c.assigneeId, scheduledFor: c.scheduledFor, updatedAt: new Date() })
    .onConflictDoUpdate({ target: jobPushState.jobId, set: { assigneeId: c.assigneeId, scheduledFor: c.scheduledFor, updatedAt: new Date() } })
}

/** The phones these people are signed in on (in this company; null: one company per database, a caller that knows only
 * the person — home care's visit notices). */
export async function phoneTokensOf(db: any, companyId: string | null, userIds: string[]): Promise<{ id: string; token: string; userId: string }[]> {
  if (!userIds.length) return []
  const who = inArray(expoPushTokens.userId, userIds)
  return db.select({ id: expoPushTokens.id, token: expoPushTokens.token, userId: expoPushTokens.userId }).from(expoPushTokens)
    .where(companyId ? and(eq(expoPushTokens.companyId, companyId), who) : who)
}

/** A phone the app was removed from (Expo answered DeviceNotRegistered). */
export async function forgetPhoneToken(db: any, id: string): Promise<void> {
  await db.delete(expoPushTokens).where(eq(expoPushTokens.id, id))
}

/** This phone is now this person's (a phone someone else signed in on moves to the caller). */
export async function savePhoneToken(db: any, companyId: string, userId: string, token: string, platform: string | null) {
  const [row] = await db.insert(expoPushTokens).values({ companyId, userId, token, platform })
    .onConflictDoUpdate({ target: expoPushTokens.token, set: { companyId, userId, platform, lastSeenAt: new Date() } })
    .returning()
  return row
}

/** Signed out on this phone: only the caller's own token goes. */
export async function removePhoneToken(db: any, companyId: string, userId: string, token: string): Promise<number> {
  const r = await db.delete(expoPushTokens)
    .where(and(eq(expoPushTokens.token, token), eq(expoPushTokens.userId, userId), eq(expoPushTokens.companyId, companyId)))
    .returning({ id: expoPushTokens.id })
  return r.length
}

/** The company's people who can sign in (active), with their seat — the caller decides who among them is told. */
export async function activePeople(db: any, companyId: string): Promise<{ id: string; role: string }[]> {
  return db.select({ id: user.id, role: user.role }).from(user).where(and(eq(user.companyId, companyId), eq(user.isActive, true)))
}
