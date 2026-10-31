// A restaurant's website form into the event book (restaurant-bar-depth #3; Tripleseat forms by source). The restaurant's
// catering form (site/views/sections/catering/inquiry-form.ejs) used to make an ordinary lead. With the
// 'event_web_enquiries' feature on, one with a real event date opens an ENQUIRY in the event book — the same way the bar's
// party form does (crm/bar/enquiry.ts partyEnquiry), with the guest made a contact, the head count, the occasion and
// what they wrote — so it is worked, held and reported like any other. Without a real date it stays a lead.
import { partyEnquiry, type BarForm } from '../bar/enquiry.ts'
import { campaignByToken } from './eventSources.ts'
import { formRoom, roomQuestion } from './eventSpaces.ts'

const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : '' }

/** The catering form's answers as the party enquiry reads them; the event is made with the source 'website'. */
export async function cateringEnquiry(db: any, companyId: string, f: BarForm, extras: FormExtras = {}): Promise<{ eventId: string; contactId: string } | null> {
  const venue = clip(f.venue, 300)
  const mapped: BarForm = {
    name: f.name, email: f.email, phone: f.phone,
    requestedDate: f.eventDate, partySize: f.headcount, occasion: clip(f.venueType, 80) || 'Catering',
    message: [clip(f.notes || f.message, 2000), venue ? `Venue: ${venue}` : ''].filter(Boolean).join('\n'),
  }
  return partyEnquiry(db, companyId, mapped, true, extras)
}

/** What a website form's room choice and campaign add to the enquiry it opens (restaurant-bar parity #4). */
export interface FormExtras { source?: string; campaignId?: string | null; spaceId?: string | null; startTime?: string | null; endTime?: string | null }

/**
 * Read the form's `campaign` (the token in its embed) and `spaceId` (the room it preferred), and its hours, when the venue has
 * the form's rooms and campaigns on. A token or room that does not match a live one is ignored — the enquiry is still taken,
 * as it always was. The room is a PREFERENCE: an enquiry holds nothing, whatever room it names.
 */
export async function formExtras(db: any, companyId: string, f: Record<string, string | undefined>, on: boolean): Promise<FormExtras> {
  if (!on) return {}
  const out: FormExtras = {}
  const camp = await campaignByToken(db, companyId, f.campaign)
  if (camp) { out.source = camp.source; out.campaignId = camp.id }
  const room = await formRoom(db, companyId, f.spaceId)
  if (room) out.spaceId = room.id
  const { win } = roomQuestion({ startTime: f.startTime, endTime: f.endTime })
  if (win) { out.startTime = win.startTime!; out.endTime = win.endTime! }
  return out
}
