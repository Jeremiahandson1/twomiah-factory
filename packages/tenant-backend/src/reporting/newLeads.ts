// NEW LEADS — the enquiries nobody has acted on yet, wherever they wait. One count for every dashboard that shows the tile
// (the jobs-family dashboard, roofing's) and the phone app.
//
// It counted Lead Inbox rows at `new` only. Two live tenants then disagreed for no reason a person could see (2026-10-22):
// the contractor's read 1 (a website enquiry nobody had answered) and the landscaper's 0 — its one website enquiry had been
// converted into a contact, and the lead the owner had typed in on the Contacts page was in no inbox. Both were still
// leads nobody had quoted. And a business without the Lead Inbox, whose website enquiries are saved as lead contacts
// (apps/unified server/core/enquiry.ts), was shown no figure at all.
//
// So a new lead is either of:
//   · an inbox enquiry still at `new` — not yet marked contacted, converted or dismissed (where the inbox is on);
//   · a contact of type `lead` added in the last NEW_LEAD_DAYS days that nothing has been done for yet: no quote, no job,
//     no invoice. A converted inbox enquiry is this contact, so it is counted once, here, until somebody quotes it.
// An old lead nobody followed up is not "new"; an imported book of past leads does not flood the tile.
import { and, count, eq, gte, notExists } from 'drizzle-orm'

export const NEW_LEAD_DAYS = 30

export interface NewLeadTables { lead?: any; contact: any; quote: any; job: any; invoice: any }
export interface NewLeads { total: number; inbox: number; contacts: number }

export async function countNewLeads(db: any, t: NewLeadTables, companyId: string, o: { inbox: boolean; now?: Date }): Promise<NewLeads> {
  const since = new Date((o.now ?? new Date()).getTime() - NEW_LEAD_DAYS * 24 * 60 * 60 * 1000)
  const [inboxRows, contactRows] = await Promise.all([
    o.inbox && t.lead
      ? db.select({ value: count() }).from(t.lead).where(and(eq(t.lead.companyId, companyId), eq(t.lead.status, 'new')))
      : Promise.resolve([{ value: 0 }]),
    db.select({ value: count() }).from(t.contact).where(and(
      eq(t.contact.companyId, companyId),
      eq(t.contact.type, 'lead'),
      gte(t.contact.createdAt, since),
      notExists(db.select({ id: t.quote.id }).from(t.quote).where(eq(t.quote.contactId, t.contact.id))),
      notExists(db.select({ id: t.job.id }).from(t.job).where(eq(t.job.contactId, t.contact.id))),
      notExists(db.select({ id: t.invoice.id }).from(t.invoice).where(eq(t.invoice.contactId, t.contact.id))),
    )),
  ])
  const inbox = Number(inboxRows[0]?.value ?? 0)
  const contacts = Number(contactRows[0]?.value ?? 0)
  return { total: inbox + contacts, inbox, contacts }
}
