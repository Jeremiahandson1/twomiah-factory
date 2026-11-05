// The messages a booking sends, as email templates on the app's one email service (core/email.ts). Wording from the
// premium site (lib/email.ts) — confirmation with a calendar invite, owner notice, reminder, rebook, waitlist — plus
// the two it never sent: a changed time and a cancellation. Times are written in the business's zone, with the zone
// named (the CRMs' T58: an email is read away from the screen that could have explained it).
import { escHtml, baseStyles, type Template, type Brand } from '../core/email.ts'

/** A booking as a message needs it. Built by happenings.ts. */
export type BookingMessage = {
  serviceName: string
  when: string
  customerName: string
  customerEmail: string
  customerPhone?: string | null
  customerAddress?: string | null
  customerNotes?: string | null
  manageUrl: string
  previousWhen?: string
  bookUrl?: string
  reviewLink?: string | null
  intro?: string | null
  subject?: string | null
  deposit?: string | null
  /** The vertical's own sentence for this booking (engine addOn.note), shown under the booking's details. */
  note?: string | null
}

/** "Tuesday, November 3, 2026 at 9:00 AM CST" in the business's zone. */
export function whenText(d: Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(d)
}

/** One event as an .ics file: attached to the confirmation and served at /booking/<token>/ics. */
export function icsFor(e: { uid: string; summary: string; startAt: Date; endAt: Date; location?: string | null; description?: string; cancelled?: boolean }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\r?\n/g, '\\n')
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twomiah//Bookings//EN', 'CALSCALE:GREGORIAN',
    'BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${fmt(new Date())}`, `DTSTART:${fmt(e.startAt)}`, `DTEND:${fmt(e.endAt)}`,
    `SUMMARY:${esc(e.summary)}`, e.location ? `LOCATION:${esc(e.location)}` : '', e.description ? `DESCRIPTION:${esc(e.description)}` : '',
    `STATUS:${e.cancelled ? 'CANCELLED' : 'CONFIRMED'}`, 'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean).join('\r\n')
}

/** {service}, {when}, {customerName}, {address}, {company} in the owner's own subject or intro. */
function fill(template: string, m: BookingMessage, b: Brand) {
  const vars: Record<string, string> = { service: m.serviceName, when: m.when, customerName: m.customerName, address: m.customerAddress || '', company: b.companyName }
  return template.replace(/\{(\w+)\}/g, (_x, k) => vars[k] ?? '')
}

const page = (b: Brand, heading: string, body: string, button?: { href: string; label: string }) => `
  <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
  <body><div class="container">
    <div class="header"><h1 style="margin:0;font-size:22px;">${escHtml(heading)}</h1></div>
    <div class="content">${body}${button ? `<p style="text-align:center;margin-top:24px;"><a href="${escHtml(button.href)}" class="button">${escHtml(button.label)}</a></p>` : ''}</div>
    <div class="footer">${escHtml(b.companyName)}</div>
  </div></body></html>`

const card = (m: BookingMessage) => `
  <div class="highlight">
    <div style="font-weight:600;color:#1a1a1a;">${escHtml(m.serviceName)}</div>
    <div style="color:#4b5563;font-size:14px;">${escHtml(m.when)}</div>
    ${m.customerAddress ? `<div style="color:#4b5563;font-size:14px;margin-top:4px;">${escHtml(m.customerAddress)}</div>` : ''}
  </div>`

export const bookingTemplates: Record<string, Template> = {
  bookingConfirmed: (m: BookingMessage, b) => {
    const intro = m.intro ? `<div>${escHtml(fill(m.intro, m, b)).replace(/\n/g, '<br>')}</div>` : `<p>Hi ${escHtml(m.customerName)},</p><p>Your booking is confirmed.</p>`
    return {
      subject: m.subject ? fill(m.subject, m, b) : `Booking confirmed — ${m.serviceName}`,
      html: page(b, 'Booking confirmed', `${intro}${card(m)}${m.deposit ? `<p>Deposit paid: ${escHtml(m.deposit)}.</p>` : ''}${m.note ? `<p style="font-weight:600;">${escHtml(m.note)}</p>` : ''}<p style="font-size:14px;color:#4b5563;">A calendar invite is attached. Need to change it? Use the button below.</p>`, { href: m.manageUrl, label: 'Manage your booking' }),
      text: `Hi ${m.customerName}, your booking is confirmed: ${m.serviceName}, ${m.when}.${m.customerAddress ? ' ' + m.customerAddress + '.' : ''}\n\nReschedule or cancel: ${m.manageUrl}${m.note ? '\n\n' + m.note : ''}`,
    }
  },
  bookingNewForOwner: (m: BookingMessage, b) => ({
    subject: `New booking: ${m.serviceName} — ${m.customerName}`,
    html: page(b, 'New booking', `<p><strong>${escHtml(m.customerName)}</strong> (${escHtml(m.customerEmail)}${m.customerPhone ? ', ' + escHtml(m.customerPhone) : ''}) booked:</p>${card(m)}${m.customerNotes ? `<p style="white-space:pre-wrap;">${escHtml(m.customerNotes)}</p>` : ''}`),
    text: `New booking: ${m.customerName} <${m.customerEmail}>${m.customerPhone ? ' ' + m.customerPhone : ''}\n${m.serviceName}, ${m.when}${m.customerNotes ? '\n\n' + m.customerNotes : ''}`,
  }),
  bookingMoved: (m: BookingMessage, b) => ({
    subject: `New time for your ${m.serviceName}`,
    html: page(b, 'Your booking has a new time', `<p>Hi ${escHtml(m.customerName)},</p>${m.previousWhen ? `<p>It was ${escHtml(m.previousWhen)}. It's now:</p>` : ''}${card(m)}`, { href: m.manageUrl, label: 'See your booking' }),
    text: `Hi ${m.customerName}, your ${m.serviceName} is now ${m.when}${m.previousWhen ? ` (was ${m.previousWhen})` : ''}.\n\n${m.manageUrl}`,
  }),
  bookingMovedForOwner: (m: BookingMessage, b) => ({
    subject: `Moved: ${m.serviceName} — ${m.customerName}`,
    html: page(b, 'A customer moved their booking', `<p><strong>${escHtml(m.customerName)}</strong> moved their booking${m.previousWhen ? ` from ${escHtml(m.previousWhen)}` : ''} to:</p>${card(m)}`),
    text: `${m.customerName} moved their ${m.serviceName}${m.previousWhen ? ` from ${m.previousWhen}` : ''} to ${m.when}.`,
  }),
  bookingCancelled: (m: BookingMessage, b) => ({
    subject: `Cancelled: your ${m.serviceName}`,
    html: page(b, 'Your booking is cancelled', `<p>Hi ${escHtml(m.customerName)},</p><p>This booking has been cancelled:</p>${card(m)}${m.bookUrl ? '<p>You can book another time whenever it suits you.</p>' : ''}`, m.bookUrl ? { href: m.bookUrl, label: 'Book another time' } : undefined),
    text: `Hi ${m.customerName}, your ${m.serviceName} on ${m.when} has been cancelled.${m.bookUrl ? '\n\nBook another time: ' + m.bookUrl : ''}`,
  }),
  bookingCancelledForOwner: (m: BookingMessage, b) => ({
    subject: `Cancelled: ${m.serviceName} — ${m.customerName}`,
    html: page(b, 'A customer cancelled', `<p><strong>${escHtml(m.customerName)}</strong> cancelled:</p>${card(m)}`),
    text: `${m.customerName} cancelled their ${m.serviceName} on ${m.when}.`,
  }),
  bookingReminder: (m: BookingMessage, b) => ({
    subject: `Reminder: ${m.serviceName}, ${m.when}`,
    html: page(b, 'See you soon', `<p>Hi ${escHtml(m.customerName)},</p><p>A reminder of your booking:</p>${card(m)}${m.note ? `<p style="font-weight:600;">${escHtml(m.note)}</p>` : ''}`, { href: m.manageUrl, label: 'Reschedule or cancel' }),
    text: `Hi ${m.customerName}, a reminder: ${m.serviceName}, ${m.when}.${m.note ? '\n\n' + m.note : ''}\n\nReschedule or cancel: ${m.manageUrl}`,
  }),
  bookingRebook: (m: BookingMessage, b) => ({
    subject: `Ready for your next ${m.serviceName}?`,
    html: page(b, 'Ready for the next one?', `<p>Hi ${escHtml(m.customerName)},</p><p>It's been a while since your last <strong>${escHtml(m.serviceName)}</strong>. Pick a time that suits you.</p>`, m.bookUrl ? { href: m.bookUrl, label: `Book your next ${m.serviceName}` } : undefined),
    text: `Hi ${m.customerName}, ready for your next ${m.serviceName}?${m.bookUrl ? ' ' + m.bookUrl : ''}`,
  }),
  bookingReviewRequest: (m: BookingMessage, b) => ({
    subject: `How did we do?`,
    html: page(b, 'Thank you', `<p>Hi ${escHtml(m.customerName)},</p><p>Thanks for choosing ${escHtml(b.companyName)} for your ${escHtml(m.serviceName)}. If you have a minute, a review helps other people find us.</p>`, m.reviewLink ? { href: m.reviewLink, label: 'Leave a review' } : undefined),
    text: `Hi ${m.customerName}, thanks for choosing ${b.companyName}. ${m.reviewLink ? 'Leave a review: ' + m.reviewLink : ''}`,
  }),
  bookingWaitlistOpening: (m: BookingMessage, b) => ({
    subject: `A ${m.serviceName} time just opened`,
    html: page(b, 'A time opened up', `<p>Hi ${escHtml(m.customerName)},</p><p>You asked to hear when a <strong>${escHtml(m.serviceName)}</strong> time opens. One just did — ${escHtml(m.when)} — and times go quickly.</p>`, m.bookUrl ? { href: m.bookUrl, label: 'Book a time' } : undefined),
    text: `Hi ${m.customerName}, a ${m.serviceName} time just opened (${m.when}).${m.bookUrl ? ' Book: ' + m.bookUrl : ''}`,
  }),
}
