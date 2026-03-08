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
    })

    if (res.status === 202 || res.status === 200) {
      console.log('[Email] Sent:', subject, '→', to)
      return true
    }

    const errBody = await res.text()
    console.error('[Email] SendGrid error (' + res.status + '):', errBody)
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
    <p style="margin:0;color:#999;font-size:12px;">Twomiah Factory &mdash; Automated Notification</p>
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

// ─── Notification helpers ────────────────────────────────────────────────────

export async function notifyDeployComplete(
  tenant: { name: string; email?: string; slug: string },
  urls: { apiUrl?: string; deployedUrl?: string; siteUrl?: string; repoUrl?: string }
): Promise<boolean> {
  if (!tenant.email) return false

  const urlLines: string[] = []
  if (urls.deployedUrl) urlLines.push(kv('CRM', `<a href="${urls.deployedUrl}">${urls.deployedUrl}</a>`))
  if (urls.siteUrl) urlLines.push(kv('Website', `<a href="${urls.siteUrl}">${urls.siteUrl}</a>`))
  if (urls.apiUrl && urls.apiUrl !== urls.deployedUrl) urlLines.push(kv('API', `<a href="${urls.apiUrl}">${urls.apiUrl}</a>`))
  if (urls.repoUrl) urlLines.push(kv('GitHub', `<a href="${urls.repoUrl}">${urls.repoUrl}</a>`))

  const body = `
    <p style="color:#333;line-height:1.6;">Great news! The deployment for <strong>${tenant.name}</strong> (<code>${tenant.slug}</code>) has completed successfully.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#166534;font-weight:600;">&#10003; Deployment Successful</p>
      ${urlLines.join('\n      ')}
    </div>
    <p style="color:#666;font-size:14px;">Services are starting up on Render. The first build may take a few minutes to go live.</p>
    ${urls.deployedUrl ? btn(urls.deployedUrl, 'Open Application') : ''}`

  return sendEmail(tenant.email, 'Deployment Complete: ' + tenant.name, wrap('Deployment Complete', body))
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
