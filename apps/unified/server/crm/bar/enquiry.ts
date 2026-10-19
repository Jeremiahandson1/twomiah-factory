// The bar's two website forms (CrmSettings.websiteForms 'bar'), called by core/enquiry.ts. Moved from
// templates/crm-bar/backend/src/routes/webhooks.ts, where the bar's separate website posted them to the CRM; here the
// website is the same app, so the form reaches this directly and the consent evidence carries the visitor's own
// address rather than one the site forwarded.
//
//   party     a party request WITH A DATE opens an enquiry in the party book (status 'enquiry', which never holds a
//             room) for the guest it came from. Without a real date, or with Parties off, it is an ordinary lead.
//   regulars  a guest who asked to hear from the bar: tagged 'regular'; their birthday and, when they ticked the box
//             and gave an email, the consent evidence (the words shown, where, from which address, when) appended to
//             the guest's custom fields. The form never changes an existing guest's name, phone or type.
import { eq } from 'drizzle-orm'
import { contact } from '../../db/schema/index.ts'
import { createEvent, validateEventInput, DATE_RE, MAX_EVENT_NAME } from '../restaurant/eventBooking.ts'
import { phoneKey } from './barLoyalty.ts'

/** The form's own answers, as the visitor sent them. */
export type BarForm = Record<string, string | undefined>

const OCCASION_TYPES: Array<[RegExp, string]> = [
  [/birthday|bday/i, 'birthday'], [/anniversar/i, 'anniversary'], [/wedding|rehearsal|shower|engagement/i, 'wedding'],
  [/christmas|holiday|xmas/i, 'christmas_party'], [/work|office|company|corporate|team/i, 'corporate'],
  [/funeral|memorial|celebration of life|wake/i, 'funeral'],
]
export const occasionType = (o: string | null) => (o ? OCCASION_TYPES.find(([re]) => re.test(o))?.[1] : null) || 'other'
const clip = (v: unknown, n: number) => { const s = v == null ? '' : String(v).trim(); return s ? s.slice(0, n) : null }

/** The guest a form is from: the existing contact (same email, or same phone) or a new one. Never edits a guest. */
async function guestFor(tx: any, companyId: string, name: string, email: string | null, phone: string | null, type: string) {
  const rows = await tx.select().from(contact).where(eq(contact.companyId, companyId))
  // One phone key with the register's (barLoyalty.ts): '+1 715 555 0142' and '(715) 555-0142' are one guest.
  const e = (email || '').toLowerCase(), p = phoneKey(phone)
  const hit = rows.find((r: any) => (e && String(r.email || '').toLowerCase() === e) || (p.length >= 7 && (phoneKey(r.phone) === p || phoneKey(r.mobile) === p)))
  if (hit) return { guest: hit, created: false }
  const [row] = await tx.insert(contact).values({ name, type, email: email || undefined, phone: phone || undefined, source: 'website', companyId }).returning()
  return { guest: row, created: true }
}

/** A party request with a real date, as an enquiry in the party book; null when it is an ordinary lead. */
export async function partyEnquiry(db: any, companyId: string, f: BarForm, partiesOn: boolean): Promise<{ eventId: string; contactId: string } | null> {
  const date = typeof f.requestedDate === 'string' && DATE_RE.test(f.requestedDate) ? f.requestedDate : null
  if (!date || !partiesOn) return null
  const name = clip(f.name, 120)!
  const size = Number.parseInt(String(f.partySize ?? ''), 10)
  const occasion = clip(f.occasion, 80)
  const input = {
    name: `${occasion || 'Party'} — ${name}`.slice(0, MAX_EVENT_NAME), eventDate: date, status: 'enquiry',
    eventType: occasionType(occasion), guestCount: Number.isFinite(size) && size > 0 && size <= 2000 ? size : null,
    notes: clip(f.message, 2000), source: 'website',
  }
  if (validateEventInput(input)) return null // a date that is not a real day: it goes to the inbox, never dropped
  return db.transaction(async (tx: any) => {
    const { guest } = await guestFor(tx, companyId, name, clip(f.email, 200), clip(f.phone, 40), 'lead')
    const ev = await createEvent(tx, companyId, { ...input, contactId: guest.id })
    return { eventId: ev.id, contactId: guest.id }
  })
}

/** A Regulars sign-up: the guest, tagged, with their birthday and the consent evidence. Returns the guest's id. */
export async function joinRegulars(db: any, companyId: string, f: BarForm, visitor: { ip: string | null; page: string | null }): Promise<string> {
  const name = clip(f.name, 120)!
  return db.transaction(async (tx: any) => {
    const { guest } = await guestFor(tx, companyId, name, clip(f.email, 200), clip(f.phone, 40), 'client')
    const tags: string[] = Array.isArray(guest.tags) ? guest.tags : []
    const custom: Record<string, any> = guest.customFields && typeof guest.customFields === 'object' ? { ...guest.customFields } : {}
    const month = Number(f.birthdayMonth), day = Number(f.birthdayDay)
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) custom.birthday = { month, day }
    // Consent to email is recorded only with an email to send to.
    if (clip(f.consentText, 1000) && clip(f.email, 200)) {
      const evidence = {
        channel: 'email', text: clip(f.consentText, 1000), source: clip(f.consentSource, 200) || clip(visitor.page, 200) || 'website',
        ip: clip(visitor.ip, 80), at: new Date().toISOString(),
      }
      custom.marketingConsent = [...(Array.isArray(custom.marketingConsent) ? custom.marketingConsent : []), evidence]
    }
    await tx.update(contact).set({ tags: tags.includes('regular') ? tags : [...tags, 'regular'], customFields: custom, updatedAt: new Date() }).where(eq(contact.id, guest.id))
    return guest.id
  })
}

/** The forms this module answers, and what each needs from the visitor: a name and a way to reach them. */
export const BAR_FORMS = new Set(['party', 'regulars'])
