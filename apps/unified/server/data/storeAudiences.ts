// Who goes into an audience file (store_audiences, 2026-10-31): the segment's customers (the same SQL as everywhere,
// data/storeSegments.ts) who can be marketed to — not unsubscribed — and have an email or a phone number. Raw SQL stays here (RULEBOOK §2).
import { sql } from 'drizzle-orm'
import { contact } from '../db/schema/index.ts'
import type { SegmentDefinition } from '../db/schema/store.ts'
import { segmentCondition } from './storeSegments.ts'

export const AUDIENCE_LIMIT = 50_000

export interface AudiencePerson { id: string; name: string | null; email: string | null; phone: string | null; mobile: string | null; city: string | null; state: string | null; zip: string | null }

/** Everyone in the segment who has not unsubscribed and has some way to be matched; and how many were left out for it. */
export async function audiencePeople(db: any, companyId: string, def: SegmentDefinition, timeZone: string, now?: Date): Promise<{ people: AudiencePerson[]; leftOut: { unsubscribed: number; unmatchable: number } }> {
  const cond = segmentCondition(companyId, def, timeZone, now)
  const rows: Array<AudiencePerson & { emailOptOut: boolean }> = await db.select({
    id: contact.id, name: contact.name, email: contact.email, phone: contact.phone, mobile: contact.mobile, city: contact.city, state: contact.state, zip: contact.zip, emailOptOut: contact.emailOptOut,
  }).from(contact).where(cond).orderBy(sql`${contact.createdAt} desc`, contact.id).limit(AUDIENCE_LIMIT)
  const people: AudiencePerson[] = []
  let unsubscribed = 0, unmatchable = 0
  for (const { emailOptOut, ...p } of rows) {
    if (emailOptOut) { unsubscribed++; continue }
    if (!(p.email || '').trim() && !(p.phone || '').trim() && !(p.mobile || '').trim()) { unmatchable++; continue }
    people.push(p)
  }
  return { people, leftOut: { unsubscribed, unmatchable } }
}
