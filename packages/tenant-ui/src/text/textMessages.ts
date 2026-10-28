// The ready messages the Text button offers. Each is a sentence the OWNER chooses to send, written from what the record
// holds and the vertical's own words (labels/vocabulary.ts readyText) — nothing about the business is stated that the
// record does not carry: no prices, no times, no promises. A customer link is included only where the record has one.
import { vocabulary } from '../labels/vocabulary'

export interface TextMessage { id: 'blank' | 'invoice' | 'quote' | 'ready'; label: string; body: string }

export interface TextContext {
  /** The customer's name as the record has it ("Sam Lee"); the greeting uses the first word. */
  name?: string | null
  businessName?: string | null
  /** An invoice or quote of this customer: its number and its own private link (/d/<token>), when it has been sent. */
  invoice?: { number?: string | null; link?: string | null } | null
  quote?: { number?: string | null; link?: string | null } | null
}

/**
 * The customer's own link to a quote or an invoice — /d/<token>, the one every quote and invoice email carries
 * (tenant-backend portal/documentLinks.ts). The token exists once the document has been sent (and a quote's is kept from a seat
 * that does not administer quotes), so no token: no link, and the message is not offered. On the admin's own address
 * (app.<domain>) the app hands a /d/ link to the business's domain by redirect.
 */
export function documentLink(token: unknown): string | null {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token) || typeof window === 'undefined') return null
  return `${window.location.origin}/d/${token}`
}

const first = (name?: string | null) => String(name || '').trim().split(/\s+/)[0] || ''

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1)

/**
 * "Hi Sam, Westridge Builders here. We're on our way." — the business is named only when the app knows it; without it the
 * sentence runs on from the greeting ("Hi Sam, we're on our way."). `line` starts lower-case.
 */
function say(c: TextContext, line: string): string {
  const f = first(c.name)
  const biz = String(c.businessName || '').trim()
  const hi = f ? `Hi ${f},` : 'Hi,'
  return biz ? `${hi} ${biz} here. ${cap(line)}` : `${hi} ${line}`
}

export function textMessages(c: TextContext): TextMessage[] {
  const out: TextMessage[] = [{ id: 'blank', label: 'A blank text', body: '' }]
  if (c.invoice?.link) out.push({ id: 'invoice', label: 'Your invoice', body: say(c, `here is your invoice${c.invoice.number ? ` #${c.invoice.number}` : ''}: ${c.invoice.link}`) })
  if (c.quote?.link) out.push({ id: 'quote', label: 'Your quote', body: say(c, `here is your quote${c.quote.number ? ` #${c.quote.number}` : ''}: ${c.quote.link}`) })
  const ready = vocabulary().readyText
  if (ready) out.push({ id: 'ready', label: cap(ready).replace(/\.$/, ''), body: say(c, ready) })
  return out
}
