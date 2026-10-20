// Texts to the customer about their booking — the premium site's three (server-static.ts: the confirmation, the
// reminder the day before, the review request after a completed visit), sent through the CRM's own texting
// (packages/tenant-backend integrations/sms.ts sendSMS) instead of a bare Twilio call: a customer who replied STOP is
// not texted, an empty messaging balance or a business without texting set up refuses before anything is spent, and
// each text lands in the customer's thread in Messages. A booking's customer is its contact (the engine links one).
import type { BookingRow } from './engine.ts'

export type TextOutcome = 'sent' | 'skipped' | 'refused'

export interface BookingTexts {
  /**
   * 'sent' (or a carrier failure, recorded in the thread), 'skipped' (no contact or phone, or they opted out — nothing
   * to try again), 'refused' (texting not set up or no balance — the business can fix it, so try again later).
   */
  send(b: Pick<BookingRow, 'companyId' | 'contactId' | 'customerPhone'>, message: string): Promise<TextOutcome>
}

export interface SmsSender {
  sendSMS(companyId: string, p: { contactId?: string; message: string }): Promise<any>
}

export function createBookingTexts(sms: SmsSender): BookingTexts {
  return {
    async send(b, message) {
      if (!b.contactId || !b.customerPhone) return 'skipped'
      const r = await sms.sendSMS(b.companyId, { contactId: b.contactId, message })
      if (r === null) return 'skipped'
      return r?.refused ? 'refused' : 'sent'
    },
  }
}

/** The words, from the site's texts; the business is named first, so the customer knows who is writing. */
export const bookingTextFor = {
  confirmed: (m: { companyName: string; serviceName: string; when: string; manageUrl: string }) =>
    `${m.companyName}: your ${m.serviceName} is booked for ${m.when}. Change or cancel: ${m.manageUrl} Reply STOP to opt out.`,
  reminder: (m: { companyName: string; serviceName: string; when: string; manageUrl: string }) =>
    `${m.companyName}: a reminder of your ${m.serviceName} on ${m.when}. Change or cancel: ${m.manageUrl}`,
  review: (m: { companyName: string; customerName: string; reviewLink: string }) =>
    `Hi ${m.customerName.split(' ')[0] || 'there'}, thanks for choosing ${m.companyName}! If we did good work, a quick review would mean a lot: ${m.reviewLink}`.slice(0, 320),
}
