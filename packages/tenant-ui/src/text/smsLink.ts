// The sms: link a "Text" button opens — the user's OWN texting app, with the number and a ready message. Nothing is sent by
// Twomiah and nothing is billed: it is the same as typing the number into Messages.
//
// The body syntax is not the same everywhere (checked 2026-10-27, not assumed):
//   RFC 5724 (the standard) and Android     sms:+15551234567?body=Hello%20there
//   iPhone (iOS 8 and later; the older ';'  sms:+15551234567&body=Hello%20there
//     form no longer works)
//   unknown phone (the QR code is scanned   sms:+15551234567?&body=Hello%20there
//     by whatever phone the owner has)       — the form vendors recommend for "both"; the '?' makes it a standard URI with
//                                              an empty first field, the '&' is what iOS looks for. NOT verified on a device
//                                              by us: the Text dialog says what to do if the message arrives empty.
// The body is always percent-encoded UTF-8 (a space is %20, a new line %0A); iOS is stricter than Android about it.

export type SmsTarget = 'ios' | 'other' | 'either'

/** The number as an sms: link wants it: digits, and a leading + if there was one. null when it is not a usable number. */
export function smsNumber(raw: unknown): string | null {
  const s = typeof raw === 'string' ? raw.trim() : ''
  const digits = s.replace(/\D/g, '')
  if (digits.length < 7 || digits.length > 15) return null
  return (s.startsWith('+') ? '+' : '') + digits
}

export function smsHref(phone: unknown, body: string, target: SmsTarget): string | null {
  const n = smsNumber(phone)
  if (!n) return null
  if (!body) return `sms:${n}`
  // encodeURIComponent leaves ! ' ( ) * alone; iOS is the stricter reader, so those are encoded too.
  const enc = encodeURIComponent(body).replace(/[!'()*]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase())
  return target === 'ios' ? `sms:${n}&body=${enc}` : target === 'other' ? `sms:${n}?body=${enc}` : `sms:${n}?&body=${enc}`
}

/** Which body syntax THIS device wants. An iPad in desktop mode reports itself as a Mac with a touch screen. */
export function deviceTarget(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string } = typeof navigator !== 'undefined' ? navigator : { userAgent: '', maxTouchPoints: 0 }): SmsTarget {
  if (/iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)) return 'ios'
  return 'other'
}

/** Whether this device can text: a phone or tablet. A computer shows a QR code to scan with a phone instead. */
export function canTextHere(nav: Pick<Navigator, 'userAgent' | 'maxTouchPoints'> & { platform?: string } = typeof navigator !== 'undefined' ? navigator : { userAgent: '', maxTouchPoints: 0 }): boolean {
  return /Android|iPhone|iPad|iPod/i.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
}
