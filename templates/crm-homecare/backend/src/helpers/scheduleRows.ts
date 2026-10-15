// How a schedule row leaves the API: dates as 'YYYY-MM-DD', times as wall-clock 'HH:MM:SS' (the
// TIMESTAMP columns' time part), snake_case like the screens ported from CVHC expect.
import { sql, type SQL } from 'drizzle-orm'
import { db } from '../../db/index.ts'

export const SCHED_COLS = (alias = 's'): SQL => sql.raw(`
  ${alias}.id, ${alias}.caregiver_id, ${alias}.client_id, ${alias}.title, ${alias}.schedule_type, ${alias}.frequency,
  ${alias}.day_of_week,
  to_char(${alias}.date, 'YYYY-MM-DD') AS date,
  to_char(${alias}.start_time, 'HH24:MI:SS') AS start_time,
  to_char(${alias}.end_time, 'HH24:MI:SS') AS end_time,
  to_char(${alias}.effective_date, 'YYYY-MM-DD') AS effective_date,
  to_char(${alias}.anchor_date, 'YYYY-MM-DD') AS anchor_date,
  to_char(${alias}.end_date, 'YYYY-MM-DD') AS end_date,
  to_char(${alias}.suspended_from, 'YYYY-MM-DD') AS suspended_from,
  ${alias}.is_active, ${alias}.status, ${alias}.notes, ${alias}.care_type_id,
  COALESCE(${alias}.is_training, false) AS is_training,
  COALESCE(${alias}.is_split_shift, false) AS is_split_shift, ${alias}.split_shift_group_id, ${alias}.split_segment,
  ${alias}.created_at, ${alias}.updated_at`)

export const EXC_COLS = sql.raw(`
  se.id, se.schedule_id, to_char(se.exception_date, 'YYYY-MM-DD') AS exception_date, se.exception_type,
  to_char(se.override_start_time, 'HH24:MI:SS') AS override_start_time,
  to_char(se.override_end_time, 'HH24:MI:SS') AS override_end_time,
  se.override_caregiver_id, se.override_client_id, se.override_notes, se.cancel_reason, se.created_by, se.created_at`)

export async function rows<T = any>(q: SQL): Promise<T[]> {
  const r: any = await db.execute(q)
  return (r?.rows ?? r ?? []) as T[]
}

export async function one<T = any>(q: SQL): Promise<T | null> {
  return (await rows<T>(q))[0] ?? null
}

/** Rows of a query run on `q` — `db` or a transaction handle (inside a transaction, never `db`). */
export async function rowsOf(q: { execute: (q: SQL) => Promise<any> }, query: SQL): Promise<any[]> {
  const r: any = await q.execute(query)
  return (r?.rows ?? r ?? []) as any[]
}

/** One schedule row in the API shape, or null. */
export async function scheduleById(id: string, activeOnly = false): Promise<any | null> {
  return one(sql`SELECT ${SCHED_COLS()} FROM schedules s WHERE s.id = ${id} ${activeOnly ? sql`AND s.is_active = true` : sql``}`)
}

/**
 * Attach each recurring pattern's per-date exceptions, so a client expanding it can tell that an
 * occurrence was cancelled or rescheduled. Without this a cancelled visit still shows — and the
 * phone's auto-clock-in would clock somebody in to it.
 */
export async function attachExceptions(list: any[]): Promise<any[]> {
  const ids = list.filter((s) => s.day_of_week !== null && s.day_of_week !== undefined).map((s) => s.id)
  if (!ids.length) return list.map((s) => ({ ...s, exceptions: [] }))
  const exc = await rows(sql`SELECT ${EXC_COLS} FROM schedule_exceptions se
    WHERE se.schedule_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)}) ORDER BY se.exception_date`)
  const byId: Record<string, any[]> = {}
  for (const e of exc) (byId[e.schedule_id] ||= []).push(e)
  return list.map((s) => ({ ...s, exceptions: byId[s.id] || [] }))
}

/** An IN-list of bound params. */
export const inList = (vals: string[]): SQL => sql.join(vals.map((v) => sql`${v}`), sql`, `)

export const isOffice = (user: any) => user?.role === 'admin' || user?.role === 'owner'
export const userIdOf = (user: any): string => user?.userId || user?.id
