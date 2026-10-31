// The SQL of the family text on clock-in / clock-out (core/familyTexts.ts): the relatives of a client who asked for the
// texts, the claim row that makes each text go out once, and its outcome. Every read and write is the company's.
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import { camelFirst, camelRows, rowsOf } from '@twomiah/tenant-backend'
import type { Q } from './homecareCore.ts'

/** A client's active relatives who opted in to visit texts and have a phone number. */
export async function optedInRelatives(q: Q, companyId: string, clientId: string): Promise<{ id: string; name: string; phone: string }[]> {
  return camelRows(await q.execute(sql`SELECT id, name, phone FROM family_members
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_active = true AND visit_text_optin = true
      AND phone IS NOT NULL AND btrim(phone) <> '' ORDER BY is_primary_contact DESC, name`))
}

/** A client's active relatives who asked for the arrival / finish notice by email (care_family_comms). */
export async function emailOptedInRelatives(q: Q, companyId: string, clientId: string): Promise<{ id: string; name: string; email: string }[]> {
  return camelRows(await q.execute(sql`SELECT id, name, email FROM family_members
    WHERE company_id = ${companyId} AND client_id = ${clientId} AND is_active = true AND visit_email_optin = true
      AND email IS NOT NULL AND btrim(email) <> '' ORDER BY is_primary_contact DESC, name`))
}

/**
 * A relative's STOP, by our own code: every active relative of this company whose phone ends in these ten digits stops getting the visit
 * texts, and the time is kept. Returns how many relatives it switched off. (The carrier holds the texts too; this is ours, so a text is never
 * even tried, and the office's screen says why.)
 */
export async function stopFamilyTexts(q: Q, companyId: string, phone: string): Promise<number> {
  const last10 = String(phone).replace(/\D/g, '').slice(-10)
  if (last10.length < 10) return 0
  return rowsOf(await q.execute(sql`UPDATE family_members SET visit_text_optin = false, visit_text_optout_at = NOW(), updated_at = NOW()
    WHERE company_id = ${companyId} AND visit_text_optin = true AND regexp_replace(coalesce(phone, ''), '\\D', '', 'g') LIKE ${'%' + last10}
    RETURNING id`)).length
}

/** Claim (visit, relative, event, channel): true only for the call that inserted the row; it starts as 'pending'. */
export async function claimFamilyText(q: Q, companyId: string, timeEntryId: string, familyMemberId: string, event: string, status: string, channel = 'sms', reason: string | null = null): Promise<boolean> {
  return rowsOf(await q.execute(sql`INSERT INTO family_visit_text (id, company_id, time_entry_id, family_member_id, event, status, channel, reason, created_at)
    VALUES (${createId()}, ${companyId}, ${timeEntryId}, ${familyMemberId}, ${event}, ${status}, ${channel}, ${reason}, NOW())
    ON CONFLICT (time_entry_id, family_member_id, event, channel) DO NOTHING RETURNING id`)).length > 0
}

/** Record how a claimed text ended (and why, when it did not go). */
export async function setFamilyTextStatus(q: Q, companyId: string, timeEntryId: string, familyMemberId: string, event: string, status: string, channel = 'sms', reason: string | null = null): Promise<void> {
  await q.execute(sql`UPDATE family_visit_text SET status = ${status}, reason = ${reason}
    WHERE company_id = ${companyId} AND time_entry_id = ${timeEntryId} AND family_member_id = ${familyMemberId} AND event = ${event} AND channel = ${channel}`)
}

/** The office's screen: what went to relatives (or was held back) in a date range, newest first, with who, which visit and why. */
export async function familyTextLog(q: Q, companyId: string, f: { fromIso: string; beforeIso: string; status?: string; clientId?: string; limit: number }): Promise<any[]> {
  return camelRows(await q.execute(sql`SELECT t.id, t.event, t.status, t.channel, t.reason, t.created_at, t.time_entry_id,
      m.id AS family_member_id, m.name AS relative_name, c.id AS client_id, c.first_name AS client_first, c.last_name AS client_last,
      u.first_name AS caregiver_first, u.last_name AS caregiver_last
    FROM family_visit_text t
    JOIN family_members m ON m.id = t.family_member_id
    JOIN time_entries te ON te.id = t.time_entry_id
    JOIN clients c ON c.id = te.client_id
    JOIN "user" u ON u.id = te.caregiver_id
    WHERE t.company_id = ${companyId} AND t.created_at >= ${f.fromIso}::timestamp AND t.created_at < ${f.beforeIso}::timestamp
      ${f.status ? sql`AND t.status = ${f.status}` : sql``} ${f.clientId ? sql`AND te.client_id = ${f.clientId}` : sql``}
    ORDER BY t.created_at DESC LIMIT ${f.limit}`))
}

/** The first names a visit's text needs. */
export async function visitNames(q: Q, companyId: string, caregiverId: string, clientId: string): Promise<{ caregiverFirst: string; clientFirst: string } | null> {
  return camelFirst(await q.execute(sql`SELECT u.first_name AS caregiver_first, c.first_name AS client_first
    FROM "user" u, clients c WHERE u.id = ${caregiverId} AND u.company_id = ${companyId} AND c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}
