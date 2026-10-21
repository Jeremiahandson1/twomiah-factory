// "Text me": the one consent a customer gives to be texted by the business, on every form that asks for a phone number
// (the website's enquiry forms, the booking page, the roof estimator) — unticked, optional, the same words everywhere,
// and kept: who, when, where, and what the box said (db/schema sms_consent). The carriers ask a business to hold this
// before they approve its texting (A2P 10DLC; the Factory's campaign describes exactly this box), and the booking's
// automatic texts are sent only to a number that agreed (booking/texts.ts).
import { and, eq } from 'drizzle-orm'
import { smsConsent } from '../db/schema/index.ts'
import { SMS_TERMS } from './legal.ts'

/** What the customer is agreeing to be texted about, in their words. */
export type ConsentTopic = 'booking' | 'enquiry' | 'estimate'

/** The words beside the box — stored with the consent, since the consent is to what it said. */
export const consentWording = (topic: ConsentTopic) =>
  `Text me about my ${topic}. ${SMS_TERMS.frequency} ${SMS_TERMS.rates} ${SMS_TERMS.stopHelp}`

/**
 * The box, for a form. Unticked; never required — agreeing to texts is never a condition of anything. Links to the
 * business's own privacy policy and terms (site/legal.ts). `smsConsentFor` says which wording the server records.
 */
export function consentBoxHtml(topic: ConsentTopic): string {
  return `<label class="sms-consent"><input type="checkbox" name="smsConsent" value="yes"><input type="hidden" name="smsConsentFor" value="${topic}"><span>${consentWording(topic)} <a href="/privacy" target="_blank" rel="noopener">Privacy</a> · <a href="/terms" target="_blank" rel="noopener">Terms</a></span></label>`
}

/** E.164 for a US number as people type it, or null. */
export function phoneE164(phone: unknown): string | null {
  const d = String(phone ?? '').replace(/\D/g, '')
  if (d.length === 10) return '+1' + d
  if (d.length === 11 && d.startsWith('1')) return '+' + d
  return null
}

const TOPICS = new Set<ConsentTopic>(['booking', 'enquiry', 'estimate'])
/** Did this form's box get ticked? (A form posts "yes"; a JSON body may send true.) */
export const ticked = (b: Record<string, any>) => b?.smsConsent === 'yes' || b?.smsConsent === true || b?.smsConsent === 'on'
export const topicOf = (b: Record<string, any>, fallback: ConsentTopic): ConsentTopic => (TOPICS.has(b?.smsConsentFor) ? b.smsConsentFor : fallback)

/**
 * Keep a "yes". A ticked box replaces the earlier record for that number (one row per business and number); a
 * customer simply texting the business (`texted_first`) never overwrites a box they ticked — it only starts a record.
 */
export async function recordConsent(db: any, companyId: string, c: { phone: unknown; source: 'website_form' | 'booking' | 'texted_first'; topic?: ConsentTopic; page?: string | null; ip?: string | null }): Promise<boolean> {
  const phone = phoneE164(c.phone)
  if (!phone) return false
  const row = {
    companyId, phone, source: c.source, page: c.page ? String(c.page).slice(0, 500) : null, ip: c.ip ? String(c.ip).slice(0, 100) : null,
    wording: c.topic ? consentWording(c.topic) : null, givenAt: new Date(),
  }
  if (c.source === 'texted_first') await db.insert(smsConsent).values(row).onConflictDoNothing({ target: [smsConsent.companyId, smsConsent.phone] })
  else await db.insert(smsConsent).values(row).onConflictDoUpdate({ target: [smsConsent.companyId, smsConsent.phone], set: { source: row.source, page: row.page, ip: row.ip, wording: row.wording, givenAt: row.givenAt } })
  return true
}

/** STOP: the "yes" is gone. (The carrier and Twilio stop the texts; contact.optedOutSms marks the customer.) */
export async function withdrawConsent(db: any, companyId: string, phone: unknown): Promise<void> {
  const p = phoneE164(phone)
  if (p) await db.delete(smsConsent).where(and(eq(smsConsent.companyId, companyId), eq(smsConsent.phone, p)))
}

/** Has this number agreed to be texted by this business? */
export async function hasConsent(db: any, companyId: string, phone: unknown): Promise<boolean> {
  const p = phoneE164(phone)
  if (!p) return false
  const [row] = await db.select({ id: smsConsent.id }).from(smsConsent).where(and(eq(smsConsent.companyId, companyId), eq(smsConsent.phone, p))).limit(1)
  return !!row
}
