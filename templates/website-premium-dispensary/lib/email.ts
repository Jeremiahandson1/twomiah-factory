/**
 * Resend send + branded HTML wrap. One module so every transactional
 * email shares the same look and we can swap providers from one place.
 */
const RESEND_API = 'https://api.resend.com/emails'

function escape(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}

function fromAddress(): string {
  const email = process.env.FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'onboarding@resend.dev'
  const name = process.env.COMPANY_NAME || 'Twomiah'
  return name + ' <' + email + '>'
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  replyTo?: { email: string; name?: string }
  attachments?: Array<{ content: string; filename: string; type: string; disposition?: 'attachment' | 'inline' }>
}): Promise<boolean> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) { console.warn('[email] RESEND_API_KEY not set; skipping send'); return false }
  const body: any = {
    from: fromAddress(),
    to: [opts.to],
    subject: opts.subject,
    html: opts.html,
  }
  if (opts.replyTo) body.reply_to = opts.replyTo.email
  if (opts.attachments && opts.attachments.length > 0) {
    body.attachments = opts.attachments.map(a => ({
      filename: a.filename,
      content: a.content,  // base64
      content_type: a.type,
    }))
  }
  const res = await fetch(RESEND_API, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn('[email] Resend ' + res.status + ': ' + text)
    return false
  }
  return true
}

function wrap(title: string, bodyHtml: string, ctaButton?: { href: string; label: string }): string {
  const companyName = process.env.COMPANY_NAME || 'Twomiah'
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;margin:0;padding:40px 16px;color:#1a1a1a;">
    <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
      <tr><td style="padding:28px 32px 16px;"><div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">${escape(companyName)}</div></td></tr>
      <tr><td style="padding:0 32px 12px;"><h2 style="margin:0;font-size:22px;color:#1a1a1a;">${escape(title)}</h2></td></tr>
      <tr><td style="padding:0 32px 24px;color:#3a3a3a;font-size:15px;line-height:1.6;">${bodyHtml}</td></tr>
      ${ctaButton ? `<tr><td style="padding:0 32px 28px;"><a href="${escape(ctaButton.href)}" style="display:inline-block;background:#f97316;color:#fff;padding:12px 28px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">${escape(ctaButton.label)}</a></td></tr>` : ''}
      <tr><td style="background:#fafaf7;padding:16px 32px;border-top:1px solid #eee;color:#888;font-size:12px;">If you weren't expecting this email, you can safely ignore it.</td></tr>
    </table>
  </body></html>`
}

// ─── Security-related templates ─────────────────────────────────────────

export async function sendPasswordResetEmail(opts: { to: string; resetUrl: string }): Promise<boolean> {
  const body = `
    <p style="margin:0 0 14px;">Someone (hopefully you) asked to reset the password for this account. Click below to choose a new one. The link expires in 1 hour and can be used once.</p>
    <p style="margin:14px 0 0;color:#888;font-size:13px;">If this wasn't you, ignore this email — your password won't change.</p>`
  return sendEmail({
    to: opts.to,
    subject: 'Reset your password',
    html: wrap('Reset your password', body, { href: opts.resetUrl, label: 'Set a new password' }),
  })
}

export async function sendEmailVerificationEmail(opts: { to: string; verifyUrl: string }): Promise<boolean> {
  const body = `
    <p style="margin:0 0 14px;">Confirm this is your email address so we can send you security notifications and password reset links.</p>
    <p style="margin:14px 0 0;color:#888;font-size:13px;">This link expires in 7 days.</p>`
  return sendEmail({
    to: opts.to,
    subject: 'Confirm your email',
    html: wrap('Confirm your email', body, { href: opts.verifyUrl, label: 'Confirm email' }),
  })
}

// ─── Booking templates ──────────────────────────────────────────────────

interface BookingEmailContext {
  serviceName: string
  startAt: Date
  endAt: Date
  customerName: string
  customerEmail: string
  customerAddress?: string | null
  customerNotes?: string | null
  manageUrl?: string
  icsUrl?: string
  tenantTz?: string
}

function fmtBookingDateTime(d: Date, tz?: string): string {
  return d.toLocaleString('en-US', {
    dateStyle: 'full', timeStyle: 'short',
    timeZone: tz || process.env.TENANT_TIMEZONE || 'America/Chicago',
  })
}

/**
 * Customer confirmation — sent immediately after a booking is created.
 * Lands in their inbox before they refresh the thank-you page. Includes
 * an .ics attachment so Apple Mail / Outlook can auto-add to calendar.
 */
function interpolate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_m, k) => escape(vars[k] || ''))
}

export async function sendBookingConfirmationEmail(opts: BookingEmailContext & { companyName?: string; subjectOverride?: string | null; introOverride?: string | null }): Promise<boolean> {
  const when = fmtBookingDateTime(opts.startAt, opts.tenantTz)
  const vars = {
    service: opts.serviceName, customerName: opts.customerName,
    when, address: opts.customerAddress || '',
    company: opts.companyName || '',
  }
  const intro = opts.introOverride
    ? `<div style="margin:0 0 14px;color:#1a1a1a;">${interpolate(opts.introOverride, vars).replace(/\n/g, '<br>')}</div>`
    : `<p style="margin:0 0 14px;">Hi ${escape(opts.customerName)},</p><p style="margin:0 0 14px;">Your booking is confirmed.</p>`
  const body = `
    ${intro}
    <div style="background:#fafaf7;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <div style="margin-bottom:8px;"><strong style="color:#1a1a1a;">${escape(opts.serviceName)}</strong></div>
      <div style="color:#666;font-size:14px;">${escape(when)}</div>
      ${opts.customerAddress ? `<div style="color:#666;font-size:14px;margin-top:6px;">${escape(opts.customerAddress)}</div>` : ''}
    </div>
    <p style="margin:14px 0 0;font-size:14px;color:#666;">A calendar invite is attached — tap to add it to your phone.</p>
    ${opts.manageUrl ? `<p style="margin:8px 0 0;font-size:14px;color:#666;">Need to reschedule or cancel? <a href="${escape(opts.manageUrl)}" style="color:#f97316;">Manage your booking</a>.</p>` : ''}`
  const ics = buildIcs({
    summary: opts.serviceName + (opts.companyName ? ' — ' + opts.companyName : ''),
    startAt: opts.startAt,
    endAt: opts.endAt,
    location: opts.customerAddress || undefined,
    description: 'Booking confirmation. Manage: ' + (opts.manageUrl || ''),
    uid: 'booking-' + opts.startAt.getTime() + '@twomiah',
  })
  const subject = opts.subjectOverride
    ? interpolate(opts.subjectOverride, vars)
    : 'Booking confirmed — ' + opts.serviceName
  return sendEmail({
    to: opts.customerEmail,
    subject,
    html: wrap('Booking confirmed', body, opts.manageUrl ? { href: opts.manageUrl, label: 'Manage booking' } : undefined),
    attachments: [{
      filename: 'booking.ics',
      content: Buffer.from(ics).toString('base64'),
      type: 'text/calendar; method=REQUEST',
    }],
  })
}

function buildIcs(opts: { summary: string; startAt: Date; endAt: Date; location?: string; description?: string; uid: string }): string {
  const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z')
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Twomiah//Bookings//EN', 'METHOD:REQUEST',
    'BEGIN:VEVENT',
    'UID:' + opts.uid,
    'DTSTAMP:' + fmt(new Date()),
    'DTSTART:' + fmt(opts.startAt),
    'DTEND:' + fmt(opts.endAt),
    'SUMMARY:' + opts.summary.replace(/[\n,;]/g, ' '),
    opts.location ? 'LOCATION:' + opts.location.replace(/[\n,;]/g, ' ') : '',
    opts.description ? 'DESCRIPTION:' + opts.description.replace(/[\n,;]/g, ' ') : '',
    'STATUS:CONFIRMED',
    'END:VEVENT', 'END:VCALENDAR',
  ].filter(Boolean)
  return lines.join('\r\n')
}

/**
 * Owner notification — fires alongside the customer confirmation so
 * the owner sees the booking lobby fast (especially useful before they
 * have the admin SPA open all day).
 */
export async function notifyOwnerOfBooking(opts: BookingEmailContext & { ownerEmail: string }): Promise<boolean> {
  const when = fmtBookingDateTime(opts.startAt, opts.tenantTz)
  const body = `
    <p style="margin:0 0 14px;">New booking from <strong>${escape(opts.customerName)}</strong> (${escape(opts.customerEmail)}).</p>
    <div style="background:#fafaf7;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <div style="margin-bottom:8px;"><strong style="color:#1a1a1a;">${escape(opts.serviceName)}</strong></div>
      <div style="color:#666;font-size:14px;">${escape(when)}</div>
      ${opts.customerAddress ? `<div style="color:#666;font-size:14px;margin-top:6px;">${escape(opts.customerAddress)}</div>` : ''}
      ${opts.customerNotes ? `<div style="color:#3a3a3a;font-size:14px;margin-top:10px;padding-top:10px;border-top:1px solid #eee;white-space:pre-wrap;">${escape(opts.customerNotes)}</div>` : ''}
    </div>`
  return sendEmail({
    to: opts.ownerEmail,
    subject: '[New booking] ' + opts.serviceName + ' — ' + opts.customerName,
    html: wrap('New booking', body),
    replyTo: { email: opts.customerEmail, name: opts.customerName },
  })
}

/**
 * Re-book nudge — sent N days after a completed appointment. "Time
 * for your next clean / tune-up / inspection". Massive lever on
 * customer LTV for service businesses with natural rebook cadences.
 */
export async function sendBookingRebookEmail(opts: BookingEmailContext & { bookUrl: string }): Promise<boolean> {
  const sinceLabel = opts.startAt.toLocaleString('en-US', { dateStyle: 'long' })
  const body = `
    <p style="margin:0 0 14px;">Hi ${escape(opts.customerName)},</p>
    <p style="margin:0 0 14px;">It's been a few weeks since your last <strong>${escape(opts.serviceName)}</strong> on ${escape(sinceLabel)}. Ready for your next one?</p>
    <p style="margin:0 0 14px;">Click below to pick a time — we kept your details so it's a 30-second booking.</p>`
  return sendEmail({
    to: opts.customerEmail,
    subject: 'Ready for your next ' + opts.serviceName + '?',
    html: wrap('Ready for round two?', body, { href: opts.bookUrl, label: 'Book your next ' + opts.serviceName }),
  })
}

/**
 * Waitlist hit — sent when a confirmed booking is cancelled, freeing
 * up a slot that matches an open waitlist entry.
 */
export async function sendWaitlistNotificationEmail(opts: {
  serviceName: string
  customerName: string
  customerEmail: string
  bookUrl: string
}): Promise<boolean> {
  const body = `
    <p style="margin:0 0 14px;">Hi ${escape(opts.customerName)},</p>
    <p style="margin:0 0 14px;">Good news — a <strong>${escape(opts.serviceName)}</strong> slot just opened up.</p>
    <p style="margin:0 0 14px;">Slots tend to go quickly. Click below to grab one before someone else does.</p>`
  return sendEmail({
    to: opts.customerEmail,
    subject: 'A ' + opts.serviceName + ' slot just opened',
    html: wrap('A slot opened up', body, { href: opts.bookUrl, label: 'Book a slot' }),
  })
}

/**
 * 24-hour reminder — fired by an hourly cron when the booking starts
 * within the next ~24 hours and reminder_24h_sent_at is still null.
 */
export async function sendBookingReminderEmail(opts: BookingEmailContext): Promise<boolean> {
  const when = fmtBookingDateTime(opts.startAt, opts.tenantTz)
  const body = `
    <p style="margin:0 0 14px;">Hi ${escape(opts.customerName)},</p>
    <p style="margin:0 0 14px;">Quick reminder of your upcoming booking:</p>
    <div style="background:#fafaf7;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <div style="margin-bottom:8px;"><strong style="color:#1a1a1a;">${escape(opts.serviceName)}</strong></div>
      <div style="color:#666;font-size:14px;">${escape(when)}</div>
      ${opts.customerAddress ? `<div style="color:#666;font-size:14px;margin-top:6px;">${escape(opts.customerAddress)}</div>` : ''}
    </div>
    ${opts.manageUrl ? `<p style="margin:14px 0 0;font-size:14px;color:#666;">Need to reschedule? <a href="${escape(opts.manageUrl)}" style="color:#f97316;">Open your booking</a>.</p>` : ''}`
  return sendEmail({
    to: opts.customerEmail,
    subject: 'Reminder: ' + opts.serviceName + ' tomorrow',
    html: wrap('See you tomorrow', body),
  })
}

export async function sendLoginNotificationEmail(opts: {
  to: string
  ip: string
  userAgent: string
  when: Date
  resetUrl: string
}): Promise<boolean> {
  const whenStr = opts.when.toLocaleString('en-US', { dateStyle: 'long', timeStyle: 'short' })
  const body = `
    <p style="margin:0 0 14px;">A new sign-in to your admin was just recorded:</p>
    <div style="background:#fafaf7;border-left:3px solid #f97316;padding:14px 18px;margin:16px 0;border-radius:4px;font-size:14px;color:#1a1a1a;">
      <div><strong>When:</strong> ${escape(whenStr)}</div>
      <div><strong>IP:</strong> ${escape(opts.ip)}</div>
      <div><strong>Device:</strong> ${escape(opts.userAgent || 'unknown')}</div>
    </div>
    <p style="margin:14px 0 0;">If this was you, no action needed. If not, reset your password right away.</p>`
  return sendEmail({
    to: opts.to,
    subject: 'New sign-in to your admin',
    html: wrap('New sign-in to your admin', body, { href: opts.resetUrl, label: "Wasn't me — reset password" }),
  })
}
