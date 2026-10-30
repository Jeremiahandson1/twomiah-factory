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

/** Claim (visit, relative, event): true only for the call that inserted the row; it starts as 'pending'. */
export async function claimFamilyText(q: Q, companyId: string, timeEntryId: string, familyMemberId: string, event: string, status: string): Promise<boolean> {
  return rowsOf(await q.execute(sql`INSERT INTO family_visit_text (id, company_id, time_entry_id, family_member_id, event, status, created_at)
    VALUES (${createId()}, ${companyId}, ${timeEntryId}, ${familyMemberId}, ${event}, ${status}, NOW())
    ON CONFLICT (time_entry_id, family_member_id, event) DO NOTHING RETURNING id`)).length > 0
}

/** Record how a claimed text ended. */
export async function setFamilyTextStatus(q: Q, companyId: string, timeEntryId: string, familyMemberId: string, event: string, status: string): Promise<void> {
  await q.execute(sql`UPDATE family_visit_text SET status = ${status}
    WHERE company_id = ${companyId} AND time_entry_id = ${timeEntryId} AND family_member_id = ${familyMemberId} AND event = ${event}`)
}

/** The first names a visit's text needs. */
export async function visitNames(q: Q, companyId: string, caregiverId: string, clientId: string): Promise<{ caregiverFirst: string; clientFirst: string } | null> {
  return camelFirst(await q.execute(sql`SELECT u.first_name AS caregiver_first, c.first_name AS client_first
    FROM "user" u, clients c WHERE u.id = ${caregiverId} AND u.company_id = ${companyId} AND c.id = ${clientId} AND c.company_id = ${companyId}`)) ?? null
}
