// Who a dealership lead belongs to — ONE rule for every door into the pipeline.
//
// The ADF import (routes/salesLeads.ts) had it: an existing contact is reused by email, or by phone when
// nothing contradicts the match, and two copies arriving together are serialised on the customer's
// identity. The website form (routes/webhooks.ts) had none of it, so every submission made a fresh
// contact and a fresh lead — a returning customer became a second person in the CRM each time they
// filled the form in. Both doors now ask this file.
import { contact } from '../../db/schema.ts'
import { eq, and, sql } from 'drizzle-orm'

export interface LeadIdentity { name: string; email: string; phoneDigits: string }

/** Normalise what a door received into the identity the rules below compare. */
export function leadIdentityOf(o: { name?: unknown; email?: unknown; phone?: unknown }): LeadIdentity {
  const emailRaw = String(o.email ?? '').trim().toLowerCase()
  return {
    name: String(o.name ?? '').trim(),
    email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : '',
    phoneDigits: String(o.phone ?? '').replace(/\D/g, '').slice(-10),
  }
}

/**
 * One import at a time per customer identity in this company, for the rest of the transaction — so two
 * copies of the same lead arriving together cannot both create a contact.
 */
export async function lockLeadIdentity(tx: any, companyId: string, id: LeadIdentity) {
  const identity = id.email || (id.phoneDigits.length === 10 ? id.phoneDigits : '') || id.name.toLowerCase()
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`lead-contact:${companyId}:${identity}`}))`)
}

/** The existing contact this lead belongs to, or null when it is somebody new. */
export async function findLeadContact(tx: any, companyId: string, id: LeadIdentity): Promise<any | null> {
  const { name, email, phoneDigits } = id
  let found: any = null
  if (email) {
    ;[found] = await tx.select().from(contact)
      .where(and(eq(contact.companyId, companyId), sql`lower(${contact.email}) = ${email}`)).limit(1)
  }
  /**
   * A SHARED PHONE IS NOT A SHARED IDENTITY. (T42 → T58d)
   *
   *   Owner: "an ADF lead with a different name and email but the same phone is treated as a
   *   duplicate."
   *
   * It was. Email found nothing, the phone found somebody else, and the new lead was attached to
   * THEIR contact — then the duplicate check found that person's open lead and returned it, so the new
   * enquiry was never recorded at all. A couple on one mobile, a household landline and a business
   * switchboard all produce this, and in each case two people are two leads.
   *
   * A phone match is still worth having — plenty of leads arrive with a phone and no email, and
   * matching them is the whole point. What it must not do is override evidence that this is somebody
   * ELSE. So the match stands unless the incoming lead CONTRADICTS it: a different email, or a different
   * name. Missing information on either side contradicts nothing.
   *
   * Email alone remains sufficient on its own (above) — an address is one person's.
   */
  if (!found && phoneDigits.length === 10) {
    const [byPhone] = await tx.select().from(contact)
      .where(and(eq(contact.companyId, companyId), sql`right(regexp_replace(coalesce(${contact.phone}, ''), '\\D', '', 'g'), 10) = ${phoneDigits}`)).limit(1)
    if (byPhone) {
      const theirEmail = String(byPhone.email || '').trim().toLowerCase()
      const emailsDiffer = !!email && !!theirEmail && theirEmail !== email
      const plain = (s: unknown) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ')
      const namesDiffer = !!plain(name) && !!plain(byPhone.name) && plain(byPhone.name) !== plain(name)
      if (!emailsDiffer && !namesDiffer) found = byPhone
      // else: somebody else on the same line — the caller creates their own contact.
    }
  }
  return found || null
}
