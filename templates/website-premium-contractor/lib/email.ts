/**
 * SendGrid send + branded HTML wrap. One module so every transactional
 * email shares the same look and we can swap providers from one place.
 */
const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'

function escape(s: string): string {
  return s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] || c))
}

function fromAddress(): { email: string; name: string } {
  const email = process.env.FROM_EMAIL || process.env.FACTORY_FROM_EMAIL || 'noreply@twomiah.app'
  const name = process.env.COMPANY_NAME || 'Twomiah'
  return { email, name }
}

export async function sendEmail(opts: {
  to: string
  subject: string
  html: string
  replyTo?: { email: string; name?: string }
}): Promise<boolean> {
  const apiKey = process.env.SENDGRID_API_KEY
  if (!apiKey) { console.warn('[email] SENDGRID_API_KEY not set; skipping send'); return false }
  const body: any = {
    personalizations: [{ to: [{ email: opts.to }], subject: opts.subject }],
    from: fromAddress(),
    content: [{ type: 'text/html', value: opts.html }],
  }
  if (opts.replyTo) body.reply_to = opts.replyTo
  const res = await fetch(SENDGRID_API, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn('[email] SendGrid ' + res.status + ': ' + text)
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
