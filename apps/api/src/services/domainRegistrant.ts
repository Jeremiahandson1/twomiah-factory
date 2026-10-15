// Who a domain is registered TO — checked BEFORE anyone is charged. (E2E Run 2, 10/15)
//
// A store bought testshopco-1015.site: Stripe took the $1.53, then Namecheap refused it — "Parameter RegistrantAddress1
// is Missing" — and the Factory refunded. The registrar requires the registrant's full postal address and a phone; the
// signup collects no address, and the only check before charging was for a phone. Now every path that takes money for
// a domain (staff checkout link, staff at-cost registration, the customer's own checkout) asks registrantGaps() first,
// and the panel collects what is missing. The paid webhook keeps the same check as a backstop.

export type Registrant = { phone?: string | null; address?: string | null; city?: string | null; state?: string | null; zip?: string | null }

const FIELDS: [keyof Registrant, string][] = [['address', 'street address'], ['city', 'city'], ['state', 'state'], ['zip', 'ZIP code'], ['phone', 'phone number']]

/** What the registrar still needs, in words for the person who has to fill it in. Empty when it can register. */
export function registrantGaps(t: Registrant | null | undefined): string[] {
  return FIELDS.filter(([k]) => !String(t?.[k] ?? '').trim()).map(([, label]) => label)
}

export function registrantMessage(gaps: string[]): string {
  return 'The domain registrar needs the company\'s ' + gaps.join(', ') + ' before it will register a domain. Add ' + (gaps.length > 1 ? 'them' : 'it') + ' first — nothing has been charged.'
}

/**
 * A registrant the staff panel sends, cleaned — or why it is not usable. Only the fields given are returned, so a
 * partial form never blanks what is already on file.
 */
export function cleanRegistrant(input: any): { ok: true; patch: Registrant } | { ok: false; error: string } {
  if (!input || typeof input !== 'object') return { ok: true, patch: {} }
  const patch: Registrant = {}
  for (const [k] of FIELDS) {
    if (input[k] === undefined) continue
    const v = String(input[k] ?? '').trim()
    if (v.length > 120) return { ok: false, error: 'That ' + k + ' is too long.' }
    patch[k] = v
  }
  if (patch.state && !/^[A-Za-z]{2}$/.test(patch.state)) return { ok: false, error: 'State must be the two-letter code, like WI.' }
  if (patch.state) patch.state = patch.state.toUpperCase()
  if (patch.zip && !/^\d{5}(-\d{4})?$/.test(patch.zip)) return { ok: false, error: 'ZIP must be 5 digits (or ZIP+4).' }
  if (patch.phone && (patch.phone.replace(/\D/g, '').length < 10)) return { ok: false, error: 'Phone needs at least 10 digits.' }
  return { ok: true, patch }
}
