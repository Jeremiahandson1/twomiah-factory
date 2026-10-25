// The Marketing page's words and its one rule about merge fields, from the business's vocabulary (labels/vocabulary.ts).
// No DOM here, so a test reads exactly what the page shows for each vertical.
//
// Salon live test, 2026-10-25: the audience picker offered "All contacts with an email" and the Personalize buttons
// offered "Company {{company}}" to a salon, whose clients are people. A salon reads clients, a bar guests; the company
// field is offered where the people a business serves can be companies (Vocabulary.customerCompany).
import { vocabulary, capital } from '../labels/vocabulary'

export interface MergeField { key: string; label: string; token: string }

/** The merge fields offered as buttons: the server's list, less a company where the business serves people. */
export function offeredMergeFields(fields: MergeField[]): MergeField[] {
  const w = vocabulary()
  return fields.filter((f) => f.key !== 'company' || w.customerCompany)
}

/** The page's sentences about who an email goes to, in the business's words. */
export function marketingCopy() {
  const { customer } = vocabulary()
  const n = (count: number) => `${count} ${count === 1 ? customer.one : customer.many}`
  return {
    audienceAll: `All ${customer.many} with an email`,
    audienceSegment: `Some ${customer.many}`,
    segmentType: `${capital(customer.one)} type`,
    counting: `Counting ${customer.many}…`,
    willGoTo: (count: number) => `This campaign will go to ${n(count)}.`,
    unsubscribedExcluded: `${capital(customer.many)} who unsubscribed are always excluded.`,
    confirmSend: (name: string) => `Send "${name}" to its audience now? ${capital(customer.many)} who unsubscribed are always excluded.`,
    sentTo: (sent: number, audience: number) => `Sent to ${sent} of ${n(audience)}`,
    sequenceEmpty: `A series of emails sent automatically, spaced out over days, to the ${customer.many} you enroll.`,
    sequenceActive: `Active — ${customer.many} can be enrolled`,
    sequenceHowEnrolled: `${capital(customer.many)} are enrolled by hand from the sequence card. Step 1 goes out within 15 minutes of enrolling; each later step waits its delay after the previous one.`,
    enroll: `Enroll a ${customer.one}`,
    sequenceDeleted: (name: string) => `Delete "${name}"? ${capital(customer.many)} currently enrolled stop receiving it.`,
    enrollSearch: `Search ${customer.many} by name or email…`,
    enrollNone: `No ${customer.many} found`,
    /** The sample person the preview fills the merge fields with. */
    sample: { firstName: 'Alex', lastName: 'Morgan', name: 'Alex Morgan', company: vocabulary().customerCompany ? 'Morgan & Co' : '', email: 'alex@example.com' } as Record<string, string>,
  }
}
