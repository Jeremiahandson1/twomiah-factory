// NEW LEADS — the enquiries nobody has acted on yet, wherever they wait. One rule for the count on every dashboard that
// shows the tile (the jobs-family dashboard, roofing's), the phone app, and the one list the tile opens — the same
// conditions build all of them, so the list is exactly the rows counted (as Jobber's "filtered by New" is).
//
// A new lead is either of:
//   · an inbox enquiry still at `new` — not yet marked contacted, converted or dismissed (where the Lead Inbox is on);
//   · a contact of type `lead` that nothing has been done for yet: no quote, no job, no invoice. A lead converted into a
//     customer is no longer of type `lead`; a converted inbox enquiry IS such a contact, so it is counted once, here,
//     until somebody quotes, books or bills it. Contacts have no dismissed state of their own (contact.type and the
//     inbox row's status are the only lifecycle in the schema): a lead contact leaves the count by being converted,
//     quoted, booked, billed or deleted.
// Left out on purpose:
//   · a contact that came in by an import or a move from another system — an imported book of old leads would otherwise
//     flood the tile. Such a contact carries customFields.importedAt (server/crm/office/importService.ts) or a source of
//     'import' / '<system>_migration' (importService, migrationService);
//   · unanswered messages and calls: they are conversations, not leads.
// No time window: a lead nobody has answered is still waiting, however long ago it came.
import { and, count, desc, eq, lt, notExists, sql } from 'drizzle-orm'

export interface NewLeadTables { lead?: any; contact: any; quote: any; job: any; invoice: any }
export interface NewLeads { total: number; inbox: number; contacts: number }
export interface NewLeadRow {
  kind: 'enquiry' | 'contact'
  id: string
  name: string
  email: string | null
  phone: string | null
  source: string | null
  receivedAt: string
}

// `olderThan` narrows the same rows to those that came in before that instant — the ones that have waited too long
// (the dashboard's "unanswered" figure). Absent, every new lead, as before.
const enquiryWhere = (t: NewLeadTables, companyId: string, olderThan?: Date) => and(
  eq(t.lead.companyId, companyId), eq(t.lead.status, 'new'),
  olderThan ? lt(t.lead.receivedAt, olderThan) : undefined,
)
const contactWhere = (db: any, t: NewLeadTables, companyId: string, olderThan?: Date) => and(
  eq(t.contact.companyId, companyId),
  olderThan ? lt(t.contact.createdAt, olderThan) : undefined,
  eq(t.contact.type, 'lead'),
  sql`(${t.contact.customFields}::jsonb ->> 'importedAt') IS NULL`,
  sql`coalesce(${t.contact.source}, '') !~ '^(import|[a-z]+_migration)$'`,
  notExists(db.select({ id: t.quote.id }).from(t.quote).where(eq(t.quote.contactId, t.contact.id))),
  notExists(db.select({ id: t.job.id }).from(t.job).where(eq(t.job.contactId, t.contact.id))),
  notExists(db.select({ id: t.invoice.id }).from(t.invoice).where(eq(t.invoice.contactId, t.contact.id))),
)

export async function countNewLeads(db: any, t: NewLeadTables, companyId: string, o: { inbox: boolean; olderThan?: Date }): Promise<NewLeads> {
  const [inboxRows, contactRows] = await Promise.all([
    o.inbox && t.lead ? db.select({ value: count() }).from(t.lead).where(enquiryWhere(t, companyId, o.olderThan)) : Promise.resolve([{ value: 0 }]),
    db.select({ value: count() }).from(t.contact).where(contactWhere(db, t, companyId, o.olderThan)),
  ])
  const inbox = Number(inboxRows[0]?.value ?? 0)
  const contacts = Number(contactRows[0]?.value ?? 0)
  return { total: inbox + contacts, inbox, contacts }
}

/** The rows the count counts, newest first — the one list the tile opens. Bounded; pagination.total says how many. */
export async function listNewLeads(db: any, t: NewLeadTables, companyId: string, o: { inbox: boolean; limit?: number }): Promise<{ data: NewLeadRow[]; pagination: { page: number; limit: number; total: number; pages: number } }> {
  const limit = Math.min(Math.max(1, o.limit ?? 200), 500)
  const [enquiries, contacts, counted] = await Promise.all([
    o.inbox && t.lead
      ? db.select({ id: t.lead.id, name: t.lead.homeownerName, email: t.lead.email, phone: t.lead.phone, source: t.lead.sourcePlatform, at: t.lead.receivedAt })
        .from(t.lead).where(enquiryWhere(t, companyId)).orderBy(desc(t.lead.receivedAt), desc(t.lead.id)).limit(limit)
      : Promise.resolve([]),
    db.select({ id: t.contact.id, name: t.contact.name, email: t.contact.email, phone: t.contact.phone, source: t.contact.source, at: t.contact.createdAt })
      .from(t.contact).where(contactWhere(db, t, companyId)).orderBy(desc(t.contact.createdAt), desc(t.contact.id)).limit(limit),
    countNewLeads(db, t, companyId, o),
  ])
  const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ''))
  const data: NewLeadRow[] = [
    ...enquiries.map((r: any) => ({ kind: 'enquiry' as const, id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null, source: r.source ?? null, receivedAt: iso(r.at) })),
    ...contacts.map((r: any) => ({ kind: 'contact' as const, id: r.id, name: r.name, email: r.email ?? null, phone: r.phone ?? null, source: r.source ?? null, receivedAt: iso(r.at) })),
  ].sort((a, b) => (a.receivedAt < b.receivedAt ? 1 : a.receivedAt > b.receivedAt ? -1 : 0)).slice(0, limit)
  // A list answers as the app's lists do: the rows and the whole count (one page of up to `limit`).
  return { data, pagination: { page: 1, limit, total: counted.total, pages: Math.max(1, Math.ceil(counted.total / limit)) } }
}
