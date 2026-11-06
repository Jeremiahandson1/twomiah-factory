// Open-shift offers finished (row 17, care_open_shift_offers): what each caregiver answered, the outbox of every message tried, who can be
// reached by what, a posting's response deadline and its series. Every read and write is the company's. Raw SQL lives here (RULEBOOK).
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

const list = (ids: string[]) => sql.join(ids.map((x) => sql`${x}`), sql`, `)

export async function setRespondBy(q: Q, companyId: string, id: string, at: string | null): Promise<void> {
  await q.execute(sql`UPDATE open_shifts SET respond_by = ${at}::timestamp, updated_at = NOW() WHERE id = ${id} AND company_id = ${companyId}`)
}
export async function setSeries(q: Q, companyId: string, ids: string[], seriesId: string): Promise<void> {
  if (!ids.length) return
  await q.execute(sql`UPDATE open_shifts SET series_id = ${seriesId}, updated_at = NOW() WHERE company_id = ${companyId} AND id IN (${list(ids)})`)
}
/**
 * The deadline and series of some postings (the board and the phone read both). respond_by is as the company's clock wrote it, to the minute —
 * deliberately WITHOUT seconds in SQL: camelRows turns any 'YYYY-MM-DDTHH:MM:SS' string into a UTC Date, which a wall-clock time must not become.
 * The ':00' is added here, after camelising.
 */
export async function offerFields(q: Q, companyId: string, ids: string[]): Promise<Map<string, { respondBy: string | null; seriesId: string | null }>> {
  if (!ids.length) return new Map()
  const rows = camelRows(await q.execute(sql`SELECT id, to_char(respond_by, 'YYYY-MM-DD"T"HH24:MI') AS respond_by, series_id FROM open_shifts
    WHERE company_id = ${companyId} AND id IN (${list(ids)})`)) as any[]
  return new Map(rows.map((r) => [String(r.id), { respondBy: r.respondBy ? `${r.respondBy}:00` : null, seriesId: r.seriesId ?? null }]))
}
/** Every posting of a series, oldest first. */
export async function seriesPostings(q: Q, companyId: string, seriesId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT os.id, os.client_id, os.schedule_id, to_char(os.date, 'YYYY-MM-DD') AS shift_date, to_char(os.start_time, 'HH24:MI:SS') AS start_time,
      to_char(os.end_time, 'HH24:MI:SS') AS end_time, os.status, os.auto_assign, os.created_by_id, os.visible_to, os.notes
    FROM open_shifts os WHERE os.company_id = ${companyId} AND os.series_id = ${seriesId} ORDER BY os.date, os.start_time`))
}

// ── Answers ─────────────────────────────────────────────────────────────────────────────────────

export async function recordResponse(q: Q, companyId: string, shiftId: string, caregiverId: string, response: 'declined' | 'hidden', reason: string | null): Promise<void> {
  await q.execute(sql`INSERT INTO open_shift_response (id, company_id, open_shift_id, caregiver_id, response, reason, created_at)
    VALUES (${createId()}, ${companyId}, ${shiftId}, ${caregiverId}, ${response}, ${reason}, NOW())
    ON CONFLICT (open_shift_id, caregiver_id) DO UPDATE SET response = EXCLUDED.response, reason = EXCLUDED.reason, created_at = NOW()`)
}
/** Forget every answer to a posting (a resend "to everyone, answers cleared"). Returns how many were cleared. */
export async function clearResponses(q: Q, companyId: string, shiftId: string): Promise<number> {
  return rowsOf(await q.execute(sql`DELETE FROM open_shift_response WHERE company_id = ${companyId} AND open_shift_id = ${shiftId} RETURNING id`)).length
}
export async function responsesFor(q: Q, companyId: string, ids: string[]): Promise<{ openShiftId: string; caregiverId: string; response: string; reason: string | null }[]> {
  if (!ids.length) return []
  return camelRows(await q.execute(sql`SELECT open_shift_id, caregiver_id, response, reason FROM open_shift_response
    WHERE company_id = ${companyId} AND open_shift_id IN (${list(ids)})`)) as any
}
/** The postings this caregiver declined or hid, and the ones they were sent. */
export async function mineAnswered(q: Q, companyId: string, caregiverId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`SELECT open_shift_id FROM open_shift_response WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId}`)) as any[]
  return new Set(rows.map((r) => String(r.openShiftId)))
}
export async function mineSent(q: Q, companyId: string, caregiverId: string): Promise<Set<string>> {
  const rows = camelRows(await q.execute(sql`SELECT open_shift_id FROM open_shift_notifications WHERE company_id = ${companyId} AND caregiver_id = ${caregiverId}`)) as any[]
  return new Set(rows.map((r) => String(r.openShiftId)))
}
/** For each posting: how many caregivers were sent it, how many accepted. */
export async function offerCounts(q: Q, companyId: string, ids: string[]): Promise<Map<string, { sent: number; accepted: number }>> {
  if (!ids.length) return new Map()
  const rows = camelRows(await q.execute(sql`
    SELECT os.id,
      (SELECT COUNT(*)::int FROM open_shift_notifications n WHERE n.open_shift_id = os.id) AS sent,
      (SELECT COUNT(*)::int FROM open_shift_claims c WHERE c.open_shift_id = os.id AND c.status <> 'rejected') AS accepted
    FROM open_shifts os WHERE os.company_id = ${companyId} AND os.id IN (${list(ids)})`)) as any[]
  return new Map(rows.map((r) => [String(r.id), { sent: Number(r.sent), accepted: Number(r.accepted) }]))
}
export async function sentTo(q: Q, companyId: string, shiftId: string): Promise<string[]> {
  return (camelRows(await q.execute(sql`SELECT caregiver_id FROM open_shift_notifications WHERE company_id = ${companyId} AND open_shift_id = ${shiftId}`)) as any[]).map((r) => String(r.caregiverId))
}

// ── Who can be reached by what ──────────────────────────────────────────────────────────────────

export async function reachability(q: Q, companyId: string, ids: string[]): Promise<{ id: string; firstName: string; lastName: string; phone: string | null; email: string | null; hasApp: boolean }[]> {
  if (!ids.length) return []
  const rows = camelRows(await q.execute(sql`
    SELECT u.id, u.first_name, u.last_name, NULLIF(btrim(u.phone), '') AS phone, NULLIF(btrim(u.email), '') AS email,
      (u.last_login IS NOT NULL OR EXISTS (SELECT 1 FROM expo_push_tokens t WHERE t.user_id = u.id)) AS has_app
    FROM "user" u WHERE u.company_id = ${companyId} AND u.id IN (${list(ids)})`)) as any[]
  return rows.map((r) => ({ id: String(r.id), firstName: r.firstName, lastName: r.lastName, phone: r.phone ?? null, email: r.email ?? null, hasApp: !!r.hasApp }))
}

// ── The outbox ──────────────────────────────────────────────────────────────────────────────────

export async function addMessage(q: Q, companyId: string, shiftId: string, caregiverId: string, m: { channel: string; target: string | null; status: string; detail: string | null }): Promise<void> {
  await q.execute(sql`INSERT INTO open_shift_message (id, company_id, open_shift_id, caregiver_id, channel, target, status, detail, created_at)
    VALUES (${createId()}, ${companyId}, ${shiftId}, ${caregiverId}, ${m.channel}, ${m.target}, ${m.status}, ${m.detail}, NOW())`)
}
export async function outbox(q: Q, companyId: string, shiftId: string): Promise<any[]> {
  return camelRows(await q.execute(sql`
    SELECT m.id, m.caregiver_id, m.channel, m.target, m.status, m.detail, m.created_at, u.first_name, u.last_name
      FROM open_shift_message m JOIN "user" u ON u.id = m.caregiver_id
     WHERE m.company_id = ${companyId} AND m.open_shift_id = ${shiftId} ORDER BY m.created_at DESC, m.id`))
}
/**
 * The (caregiver, channel) pairs whose LATEST message for this posting failed — what "resend the failures" tries again. A pair that later
 * went through is not in the list.
 */
export async function failedPairs(q: Q, companyId: string, shiftId: string): Promise<{ caregiverId: string; channel: string }[]> {
  return camelRows(await q.execute(sql`
    SELECT DISTINCT ON (caregiver_id, channel) caregiver_id, channel, status
      FROM open_shift_message WHERE company_id = ${companyId} AND open_shift_id = ${shiftId}
     ORDER BY caregiver_id, channel, created_at DESC, id DESC`)).filter((r: any) => r.status === 'failed') as any
}
/** Everyone who has had any message for this posting. */
export async function messagedCaregivers(q: Q, companyId: string, shiftId: string): Promise<string[]> {
  return (camelRows(await q.execute(sql`SELECT DISTINCT caregiver_id FROM open_shift_message WHERE company_id = ${companyId} AND open_shift_id = ${shiftId}`)) as any[]).map((r) => String(r.caregiverId))
}

/** Take back postings that were just made (a series that came out shorter than two weeks). */
export async function deletePostings(q: Q, companyId: string, ids: string[]): Promise<void> {
  if (!ids.length) return
  await q.execute(sql`DELETE FROM open_shifts WHERE company_id = ${companyId} AND id IN (${list(ids)})`)
}
