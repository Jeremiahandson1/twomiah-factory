// A website enquiry at a dealership goes into the sales pipeline (CrmSettings.websiteEnquiries 'pipeline'): a sales
// lead at new, on the customer's existing contact when the email (or a phone nothing contradicts) matches — the same
// rule the ADF import uses — and the same message sent again within 30 days kept as the open lead it already made.
// The website chat's lead (a phone and no email is enough) names what the visitor wants as `unitOfInterest` ("2024
// Jayco Jay Flight (Stock #J1042)"): it goes on the lead's notes, and a stock number in it links the lead to this
// dealer's unit with exactly that stock number — never a guess from the model name; an unknown one links nothing.
// Moved from templates/crm-rv/backend/src/routes/webhooks.ts (T59); called by core/enquiry.ts.
import { contact, salesLead } from '../../db/schema/index.ts'
import { leadIdentityOf, lockLeadIdentity, findLeadContact, recentOpenLead, unitByStockNumber } from '../../data/rvDealership.ts'

export interface PipelineEnquiry { name: string; email: string; phone: string | null; message: string; source: string | null; interest?: string }

export async function recordPipelineEnquiry(db: any, companyId: string, e: PipelineEnquiry): Promise<{ contactId: string; leadId: string; duplicate: boolean; contactCreated: boolean }> {
  const leadSource = e.source || 'website'
  const interest = (e.interest || '').trim().slice(0, 200)
  const notes = [interest && `Interested in: ${interest}`, e.message && `Message: ${e.message}`].filter(Boolean).join('\n') || null
  // The stock number in it ("… (Stock #J1042)"), read as the template read it.
  const stockNumber = interest.match(/stock\s*#?\s*([A-Za-z0-9-]+)/i)?.[1] || ''
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
    const unitId = stockNumber ? (await unitByStockNumber(tx, companyId, stockNumber))?.id ?? null : null
    const [opened] = await tx.insert(salesLead).values({ contactId: person.id, unitId, stage: 'new', source: leadSource, notes: notes || undefined, companyId }).returning()
    return { contactId: person.id, leadId: opened.id, duplicate: false, contactCreated }
  })
}
