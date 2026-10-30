// A restaurant's website form into the event book (restaurant-bar-depth #3; Tripleseat forms by source). The restaurant's
// catering form (site/views/sections/catering/inquiry-form.ejs) used to make an ordinary lead. With the
// 'event_web_enquiries' feature on, one with a real event date opens an ENQUIRY in the event book — the same way the bar's
// party form does (crm/bar/enquiry.ts partyEnquiry), with the guest made a contact, the head count, the occasion and
// what they wrote — so it is worked, held and reported like any other. Without a real date it stays a lead.
import { partyEnquiry, type BarForm } from '../bar/enquiry.ts'

const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : '' }

/** The catering form's answers as the party enquiry reads them; the event is made with the source 'website'. */
export async function cateringEnquiry(db: any, companyId: string, f: BarForm): Promise<{ eventId: string; contactId: string } | null> {
  const venue = clip(f.venue, 300)
  const mapped: BarForm = {
    name: f.name, email: f.email, phone: f.phone,
    requestedDate: f.eventDate, partySize: f.headcount, occasion: clip(f.venueType, 80) || 'Catering',
    message: [clip(f.notes || f.message, 2000), venue ? `Venue: ${venue}` : ''].filter(Boolean).join('\n'),
  }
  return partyEnquiry(db, companyId, mapped, true)
}
