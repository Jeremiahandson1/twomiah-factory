// A website enquiry at a dealership goes into the sales pipeline (CrmSettings.websiteEnquiries 'pipeline'): a sales
// lead at new, on the customer's existing contact when the email (or a phone nothing contradicts) matches — the same
// rule the ADF import uses — and the same message sent again within 30 days kept as the open lead it already made.
// Moved from templates/crm-rv/backend/src/routes/webhooks.ts (T59); called by core/enquiry.ts.
import { contact, salesLead } from '../../db/schema/index.ts'
import { leadIdentityOf, lockLeadIdentity, findLeadContact, recentOpenLead } from '../../data/rvDealership.ts'

export interface PipelineEnquiry { name: string; email: string; phone: string | null; message: string; source: string | null }

export async function recordPipelineEnquiry(db: any, companyId: string, e: PipelineEnquiry): Promise<{ contactId: string; leadId: string; duplicate: boolean; contactCreated: boolean }> {
  const leadSource = e.source || 'website'
  const notes = e.message ? `Message: ${e.message}` : null
  return db.transaction(async (tx: any) => {
    const id = leadIdentityOf({ name: e.name, email: e.email, phone: e.phone })
    await lockLeadIdentity(tx, companyId, id)
    let person: any = await findLeadContact(tx, companyId, id)
    let contactCreated = false
    if (!person) {
      ;[person] = await tx.insert(contact).values({
        name: e.name, type: 'lead', email: e.email || undefined, phone: e.phone || undefined,
        source: leadSource, notes: notes || undefined, companyId,
      }).returning()
      contactCreated = true
    }
    if (!contactCreated) {
      const open = await recentOpenLead(tx, { companyId, contactId: person.id, source: leadSource, days: 30, notes })
      if (open) return { contactId: person.id, leadId: open.id, duplicate: true, contactCreated }
    }
    const [opened] = await tx.insert(salesLead).values({ contactId: person.id, unitId: null, stage: 'new', source: leadSource, notes: notes || undefined, companyId }).returning()
    return { contactId: person.id, leadId: opened.id, duplicate: false, contactCreated }
  })
}
