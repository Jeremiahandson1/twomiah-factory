/**
 * Twomiah Factory — Email Notification Service
 * Uses SendGrid v3 API via raw fetch (no dependency needed).
 * Gracefully no-ops if SENDGRID_API_KEY is not configured.
 */

const SENDGRID_API = 'https://api.sendgrid.com/v3/mail/send'

function getApiKey(): string | undefined {
  return process.env.SENDGRID_API_KEY
}

function getFromEmail(): string {
  return process.env.FACTORY_FROM_EMAIL || 'noreply@twomiah.app'
}

// ─── Base send ───────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[Email] SENDGRID_API_KEY not set — skipping email:', subject)
    return false
  }
  if (!to) {
    console.warn('[Email] No recipient — skipping email:', subject)
    return false
  }

  try {
    const res = await fetch(SENDGRID_API, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        personalizations: [{ to: [{ email: to }] }],
        from: { email: getFromEmail(), name: 'Twomiah Factory' },
        subject,
        content: [{ type: 'text/html', value: html }],
      }),
      signal: AbortSignal.timeout(30_000),
    })

    if (res.status === 202 || res.status === 200) {
      console.log('[Email] Sent:', subject, '→', to)
      return true
    }

    console.error('[Email] SendGrid error:', res.status)
    return false
  } catch (err: any) {
    console.error('[Email] Failed to send:', err.message)
    return false
  }
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f4f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:40px 20px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <tr><td style="background:#1a1a2e;padding:24px 32px;">
    <h1 style="margin:0;color:#ffffff;font-size:20px;font-weight:600;">Twomiah Factory</h1>
  </td></tr>
  <tr><td style="padding:32px;">
    <h2 style="margin:0 0 16px;color:#1a1a2e;font-size:18px;">${title}</h2>
    ${body}
  </td></tr>
  <tr><td style="background:#f8f8fa;padding:16px 32px;text-align:center;">
    <p style="margin:0;color:#999;font-size:12px;">Twomiah Software Ventures &middot; 2607 Beverly Hills Drive, Eau Claire, WI 54701</p>
    <p style="margin:4px 0 0;color:#bbb;font-size:11px;"><a href="https://twomiah.com/terms" style="color:#bbb;">Terms</a> &middot; <a href="https://twomiah.com/privacy" style="color:#bbb;">Privacy</a> &middot; <a href="mailto:support@twomiah.com" style="color:#bbb;">Support</a></p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function btn(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#4f46e5;color:#ffffff;padding:10px 24px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:16px;">${label}</a>`
}

function kv(label: string, value: string): string {
  return `<p style="margin:4px 0;color:#333;"><strong style="color:#666;">${label}:</strong> ${value}</p>`
}

// ─── Product name helper ────────────────────────────────────────────────────

function getProductName(industry?: string, products?: string[]): string {
  if (industry === 'home_care') return 'Care'
  if (industry === 'automotive') return 'Drive'
  if (industry === 'field_service' || industry === 'hvac' || industry === 'plumbing' || industry === 'electrical') return 'Wrench'
  if (products?.includes('crm-fieldservice')) return 'Wrench'
  if (products?.includes('crm-homecare')) return 'Care'
  if (products?.includes('crm-automotive')) return 'Drive'
  return 'Build'
}

// ─── Notification helpers ────────────────────────────────────────────────────

export async function notifyWelcome(
  tenant: { name: string; email?: string; plan?: string; industry?: string; products?: string[] }
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)
  const trialEnd = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000)
  const trialEndStr = trialEnd.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const planLabel = (tenant.plan || 'starter').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())

  const body = `
    <p style="color:#333;line-height:1.6;">Welcome aboard! Your <strong>Twomiah ${product}</strong> account for <strong>${tenant.name}</strong> has been created.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin:16px 0;">
      ${kv('Company', tenant.name)}
      ${kv('Plan', planLabel)}
      ${kv('Free trial ends', trialEndStr)}
    </div>
    <p style="color:#333;line-height:1.6;">We&rsquo;re building your system now. This typically takes about <strong>10 minutes</strong>. You&rsquo;ll receive a second email with your login URL and temporary password as soon as everything is ready.</p>
    <p style="color:#666;font-size:14px;">If you have questions in the meantime, just reply to this email.</p>`

  return sendEmail(
    tenant.email,
    `Welcome to Twomiah ${product} — your trial has started`,
    wrap(`Welcome to Twomiah ${product}`, body)
  )
}

export async function notifyDeployComplete(
  tenant: { name: string; email?: string; slug: string; industry?: string; products?: string[]; admin_password?: string },
  urls: { apiUrl?: string; deployedUrl?: string; siteUrl?: string; repoUrl?: string; adsUrl?: string }
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)

  const urlLines: string[] = []
  if (urls.deployedUrl) urlLines.push(kv('CRM', `<a href="${urls.deployedUrl}">${urls.deployedUrl}</a>`))
  if (urls.siteUrl) urlLines.push(kv('Website', `<a href="${urls.siteUrl}">${urls.siteUrl}</a>`))
  if (urls.apiUrl && urls.apiUrl !== urls.deployedUrl) urlLines.push(kv('API', `<a href="${urls.apiUrl}">${urls.apiUrl}</a>`))

  const passwordLine = tenant.admin_password
    ? `<p style="color:#333;line-height:1.6;">Your temporary password is: <code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:14px;">${tenant.admin_password}</code><br><span style="color:#666;font-size:13px;">Please change this after your first login.</span></p>`
    : `<p style="color:#333;line-height:1.6;">Log in with the email and password you created during signup.</p>`

  const body = `
    <p style="color:#333;line-height:1.6;">Great news! Your <strong>Twomiah ${product}</strong> CRM for <strong>${tenant.name}</strong> is ready to use.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#166534;font-weight:600;">&#10003; Your CRM is live</p>
      ${urlLines.join('\n      ')}
    </div>
    ${passwordLine}
    <div style="background:#f8f8fa;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 12px;color:#1a1a2e;font-weight:600;">3 things to do first:</p>
      <ol style="margin:0;padding-left:20px;color:#333;line-height:1.8;">
        <li>Complete the onboarding wizard to set up your company profile</li>
        <li>Add your first ${product === 'Care' ? 'client' : 'contact'} and create a ${product === 'Care' ? 'care plan' : 'job'}</li>
        <li>Invite your team members from Settings</li>
      </ol>
    </div>
    <p style="color:#666;font-size:14px;">Services may take a few minutes to fully start up after deployment.</p>
    ${urls.deployedUrl ? btn(urls.deployedUrl, 'Log In to Your CRM') : ''}`

  return sendEmail(
    tenant.email,
    `Your Twomiah ${product} CRM is ready`,
    wrap(`Your ${product} CRM is Ready`, body)
  )
}

export async function notifyStillWorking(
  tenant: { name: string; email?: string; industry?: string; products?: string[] }
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)

  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <p style="color:#333;line-height:1.6;">Your <strong>Twomiah ${product}</strong> build is taking a little longer than usual — we&rsquo;re still working on it. No action needed on your end.</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0;color:#92400e;">This sometimes happens on first deploys while cloud infrastructure provisions. You&rsquo;ll get another email as soon as your CRM is live.</p>
    </div>
    <p style="color:#666;font-size:14px;">If you don&rsquo;t hear from us within another 30 minutes, just reply to this email and we&rsquo;ll look into it.</p>`

  return sendEmail(
    tenant.email,
    `Still working on your Twomiah ${product} build`,
    wrap('Your Build Is Taking a Bit Longer', body)
  )
}

export async function notifyDeployFailed(
  tenant: { name: string; email?: string; slug: string },
  error: string
): Promise<boolean> {
  if (!tenant.email) return false

  const body = `
    <p style="color:#333;line-height:1.6;">The deployment for <strong>${tenant.name}</strong> (<code>${tenant.slug}</code>) has failed.</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#991b1b;font-weight:600;">&#10007; Deployment Failed</p>
      <p style="margin:0;color:#991b1b;font-family:monospace;font-size:13px;word-break:break-all;">${error}</p>
    </div>
    <p style="color:#666;font-size:14px;">Check the Factory dashboard for details or retry the deployment.</p>`

  return sendEmail(tenant.email, 'Deployment Failed: ' + tenant.name, wrap('Deployment Failed', body))
}

export async function notifyNewTicket(
  ticket: { number: string; subject: string; priority: string; category?: string; description?: string; submitter_email?: string; tenant_id?: string },
  tenantEmail?: string
): Promise<boolean> {
  const to = tenantEmail || ticket.submitter_email
  if (!to) return false

  const body = `
    <p style="color:#333;line-height:1.6;">A new support ticket has been created.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin:16px 0;">
      ${kv('Ticket', ticket.number)}
      ${kv('Subject', ticket.subject)}
      ${kv('Priority', ticket.priority)}
      ${ticket.category ? kv('Category', ticket.category) : ''}
    </div>
    ${ticket.description ? `<p style="color:#333;font-size:14px;line-height:1.6;"><strong>Description:</strong><br>${ticket.description.substring(0, 500)}</p>` : ''}
    <p style="color:#666;font-size:14px;">Our team will respond as soon as possible.</p>`

  return sendEmail(to, 'Ticket Created: ' + ticket.number + ' — ' + ticket.subject, wrap('New Support Ticket', body))
}

export async function notifyTicketReply(
  ticket: { number: string; subject: string; submitter_email?: string },
  message: { body: string; sender_name?: string; sender_type?: string },
  tenantEmail?: string
): Promise<boolean> {
  const to = tenantEmail || ticket.submitter_email
  if (!to) return false

  const senderLabel = message.sender_name || (message.sender_type === 'agent' ? 'Support Agent' : 'Customer')

  const body = `
    <p style="color:#333;line-height:1.6;">A new reply has been added to ticket <strong>${ticket.number}</strong>.</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin:16px 0;">
      ${kv('Ticket', ticket.number + ' — ' + ticket.subject)}
      ${kv('From', senderLabel)}
    </div>
    <div style="background:#f8f8fa;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0;color:#333;line-height:1.6;white-space:pre-wrap;">${message.body.substring(0, 1000)}</p>
    </div>`

  return sendEmail(to, 'Reply on ' + ticket.number + ': ' + ticket.subject, wrap('Ticket Reply', body))
}

// ─── Trial lifecycle notifications ───────────────────────────────────────────

/**
 * Generic trial warning — sends a "your trial is ending" email with days
 * remaining. Used for 7-day, 3-day, and 1-day warnings with escalating
 * urgency copy.
 */
export async function notifyTrialWarning(
  tenant: { name: string; email?: string; slug?: string; render_frontend_url?: string; industry?: string; products?: string[]; plan?: string },
  daysRemaining: number
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)
  const planLabel = (tenant.plan || 'starter').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const loginUrl = tenant.render_frontend_url || `https://${tenant.slug}.onrender.com`
  const upgradeUrl = loginUrl.replace(/\/$/, '') + '/crm/settings/billing'

  // Escalating urgency
  const urgent = daysRemaining <= 3
  const banner = urgent
    ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
         <p style="margin:0 0 4px;color:#991b1b;font-weight:600;font-size:16px;">${daysRemaining === 1 ? '\u26A0 Last day of your free trial' : `\u26A0 Only ${daysRemaining} days left in your free trial`}</p>
         <p style="margin:0;color:#991b1b;">After your trial ends, your CRM will lock until you upgrade.</p>
       </div>`
    : `<div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:16px 0;">
         <p style="margin:0 0 4px;color:#92400e;font-weight:600;font-size:16px;">${daysRemaining} days left in your free trial</p>
         <p style="margin:0;color:#92400e;">Upgrade before your trial ends to keep uninterrupted access.</p>
       </div>`

  const subject = urgent
    ? (daysRemaining === 1 ? `Last day of your Twomiah ${product} trial` : `${daysRemaining} days left — upgrade your Twomiah ${product}`)
    : `${daysRemaining} days left in your Twomiah ${product} trial`

  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    ${banner}
    <p style="color:#333;line-height:1.6;">Your <strong>Twomiah ${product}</strong> free trial has been up and running for ${30 - daysRemaining} days. You still have full access to every feature on the <strong>${planLabel}</strong> plan.</p>
    <p style="color:#333;line-height:1.6;">When your trial ends, your CRM will enter a read-only paywall state until you add a payment method. Your data stays safe — upgrade any time to unlock it.</p>
    ${btn(upgradeUrl, 'Upgrade Now')}
    <p style="color:#666;font-size:14px;margin-top:24px;">Questions? Just reply to this email and we will help.</p>`

  return sendEmail(tenant.email, subject, wrap(urgent ? 'Trial Ending Soon' : 'Your Trial Is Ending', body))
}

export async function notifyTrialExpired(
  tenant: { name: string; email?: string; slug?: string; render_frontend_url?: string; industry?: string; products?: string[]; plan?: string }
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)
  const loginUrl = tenant.render_frontend_url || `https://${tenant.slug}.onrender.com`
  const upgradeUrl = loginUrl.replace(/\/$/, '') + '/crm/settings/billing'

  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#991b1b;font-weight:600;font-size:16px;">\u26A0 Your free trial has ended</p>
      <p style="margin:0;color:#991b1b;">Your Twomiah ${product} CRM is now locked. Upgrade to restore access.</p>
    </div>
    <p style="color:#333;line-height:1.6;">Don't worry &mdash; every contact, job, quote, invoice, and file you created during your trial is <strong>still there</strong>. It's safe and unchanged. The moment you add a payment method, everything unlocks exactly as you left it.</p>
    ${btn(upgradeUrl, 'Upgrade to Unlock')}
    <p style="color:#333;line-height:1.6;margin-top:24px;">Not sure what plan fits? Reply to this email and we will help you pick.</p>
    <p style="color:#999;font-size:12px;margin-top:32px;">If you don't upgrade within 30 days, we'll send one more reminder before archiving your account.</p>`

  return sendEmail(
    tenant.email,
    `Your Twomiah ${product} trial has ended — upgrade to unlock your CRM`,
    wrap('Trial Ended', body)
  )
}

export async function notifyBillingPastDue(
  tenant: { name: string; email?: string; stripe_subscription_id?: string }
): Promise<boolean> {
  if (!tenant.email) return false

  const body = `
    <p style="color:#333;line-height:1.6;">The subscription payment for <strong>${tenant.name}</strong> has failed and the account is now <strong>past due</strong>.</p>
    <div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#92400e;font-weight:600;">&#9888; Payment Past Due</p>
      <p style="margin:0;color:#92400e;">Please update the payment method to avoid service interruption.</p>
    </div>
    <p style="color:#666;font-size:14px;">If you believe this is an error, please contact support.</p>`

  return sendEmail(tenant.email, 'Payment Past Due: ' + tenant.name, wrap('Payment Past Due', body))
}
