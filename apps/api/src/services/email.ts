/**
 * Twomiah Factory — Email Notification Service
 * Uses Resend API via raw fetch (no dependency needed).
 * Gracefully no-ops if RESEND_API_KEY is not configured.
 */

import { verticalFor } from '../config/industryRouting'

const RESEND_API = 'https://api.resend.com/emails'

function getApiKey(): string | undefined {
  return process.env.RESEND_API_KEY
}

function getFromEmail(): string {
  return process.env.FACTORY_FROM_EMAIL || 'onboarding@resend.dev'
}

// ─── Base send ───────────────────────────────────────────────────────────────

export async function sendEmail(to: string, subject: string, html: string): Promise<boolean> {
  const apiKey = getApiKey()
  if (!apiKey) {
    console.warn('[Email] RESEND_API_KEY not set — skipping email:', subject)
    return false
  }
  if (!to) {
    console.warn('[Email] No recipient — skipping email:', subject)
    return false
  }

  // Retry transient failures (network, 429, 5xx) — these emails carry tenant
  // credentials and deploy status, so a blip shouldn't silently swallow them.
  const MAX_ATTEMPTS = 3
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(RESEND_API, {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer ' + apiKey,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: 'Twomiah Factory <' + getFromEmail() + '>',
          to: [to],
          subject,
          html,
        }),
        signal: AbortSignal.timeout(30_000),
      })

      if (res.ok) {
        console.log('[Email] Sent:', subject, '→', to)
        return true
      }

      const errBody = await res.text().catch(() => '')
      const retryable = res.status === 429 || res.status >= 500
      console.error('[Email] Resend error (attempt ' + attempt + '/' + MAX_ATTEMPTS + '):', res.status, errBody.slice(0, 200))
      if (!retryable) return false
    } catch (err: any) {
      console.error('[Email] Failed to send (attempt ' + attempt + '/' + MAX_ATTEMPTS + '):', err.message)
    }
    if (attempt < MAX_ATTEMPTS) await new Promise(r => setTimeout(r, attempt * 2000))
  }
  return false
}

// ─── HTML helpers ────────────────────────────────────────────────────────────

function wrap(title: string, body: string): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#fafaf7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1a1a1a;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#fafaf7;padding:48px 16px;">
<tr><td align="center">
<table width="560" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
  <tr><td style="padding:28px 36px 0;">
    <a href="https://twomiah.com" style="text-decoration:none;color:#1a1a1a;font-size:13px;font-weight:700;letter-spacing:0.16em;text-transform:uppercase;">TWOMIAH</a>
  </td></tr>
  <tr><td style="padding:24px 36px 8px;">
    <h2 style="margin:0 0 8px;color:#1a1a1a;font-size:22px;font-weight:700;line-height:1.3;">${title}</h2>
  </td></tr>
  <tr><td style="padding:8px 36px 36px;color:#3a3a3a;font-size:15px;line-height:1.6;">
    ${body}
  </td></tr>
  <tr><td style="background:#fafaf7;padding:20px 36px;border-top:1px solid #eee;text-align:left;">
    <p style="margin:0;color:#888;font-size:12px;line-height:1.5;">
      Twomiah Software Ventures &middot; Eau Claire, WI<br>
      <a href="https://twomiah.com" style="color:#888;text-decoration:underline;">twomiah.com</a> &middot;
      <a href="https://twomiah.com/terms" style="color:#888;text-decoration:underline;">Terms</a> &middot;
      <a href="https://twomiah.com/privacy" style="color:#888;text-decoration:underline;">Privacy</a> &middot;
      <a href="mailto:support@twomiah.com" style="color:#888;text-decoration:underline;">support@twomiah.com</a>
    </p>
  </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`
}

function btn(url: string, label: string): string {
  return `<a href="${url}" style="display:inline-block;background:#f97316;color:#ffffff;padding:14px 30px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;margin:8px 0 4px;">${label}</a>`
}

function kv(label: string, value: string): string {
  return `<p style="margin:4px 0;color:#333;"><strong style="color:#666;">${label}:</strong> ${value}</p>`
}

// ─── Product name helper ────────────────────────────────────────────────────

function getProductName(industry?: string, products?: string[]): string {
  if (industry === 'home_care') return 'Care'
  if (industry === 'automotive') return 'Drive'
  if (verticalFor(industry) === 'rv') return 'Roam'
  if (verticalFor(industry) === 'veterinary') return 'Vet'
  if (industry === 'field_service' || industry === 'hvac' || industry === 'plumbing' || industry === 'electrical') return 'Wrench'
  if (products?.includes('crm-fieldservice')) return 'Wrench'
  if (products?.includes('crm-homecare')) return 'Care'
  if (products?.includes('crm-automotive')) return 'Drive'
  if (products?.includes('crm-rv')) return 'Roam'
  if (products?.includes('crm-vet')) return 'Vet'
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
  tenant: { name: string; email?: string; slug: string; industry?: string; products?: string[]; admin_password?: string; twomiah_subdomain?: string | null },
  urls: { apiUrl?: string; deployedUrl?: string; siteUrl?: string; repoUrl?: string; adsUrl?: string; twomiahSubdomain?: string }
): Promise<boolean> {
  if (!tenant.email) return false

  const product = getProductName(tenant.industry, tenant.products)

  const products = tenant.products || []
  const hasWebsite = products.includes('website') || products.includes('website-premium')
  const isPremiumWebsite = products.includes('website-premium')
  // Store tenants: the "CRM" (deployedUrl) is actually the crm-store product/order
  // admin, and the website /admin is only a content editor — so relabel everything
  // to point the merchant at the right place.
  const isStore = verticalFor(tenant.industry) === 'store'
  // The auto-attached Twomiah subdomain is the friendliest URL we can give
  // the tenant — it's branded ("acme-cleaning.twomiah.app"), free, and
  // never breaks. Prefer it over the Render-provided hostname when present.
  const friendlySiteUrl = urls.twomiahSubdomain || tenant.twomiah_subdomain || urls.siteUrl
  // Website admins live at <site>/admin — the SPA bundled inside the
  // tenant's website service. CRMs handle their own auth at the deployed
  // CRM URL above, so we only surface the website admin when a website
  // product is included.
  const websiteAdminUrl = hasWebsite && friendlySiteUrl
    ? friendlySiteUrl.replace(/\/+$/, '') + '/admin'
    : null

  const urlLines: string[] = []
  if (urls.deployedUrl) urlLines.push(kv(isStore ? 'Store admin (products, orders, payments)' : 'CRM', `<a href="${urls.deployedUrl}">${urls.deployedUrl}</a>`))
  if (friendlySiteUrl) urlLines.push(kv(isStore ? 'Storefront' : 'Website', `<a href="${friendlySiteUrl}">${friendlySiteUrl}</a>`))
  if (websiteAdminUrl) urlLines.push(kv(isStore ? 'Storefront content editor' : 'Website admin', `<a href="${websiteAdminUrl}">${websiteAdminUrl}</a>`))
  if (urls.apiUrl && urls.apiUrl !== urls.deployedUrl) urlLines.push(kv('API', `<a href="${urls.apiUrl}">${urls.apiUrl}</a>`))

  const passwordLine = tenant.admin_password
    ? `<p style="color:#333;line-height:1.6;">Your temporary password is: <code style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:14px;">${tenant.admin_password}</code><br><span style="color:#666;font-size:13px;">Please change this after your first login.</span></p>`
    : `<p style="color:#333;line-height:1.6;">Log in with the email and password you created during signup.</p>`

  const body = `
    <p style="color:#333;line-height:1.6;">Great news! Your <strong>Twomiah ${isStore ? 'store' : product + ' CRM'}</strong> for <strong>${tenant.name}</strong> is ready to use.</p>
    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#166534;font-weight:600;">&#10003; Your ${isStore ? 'store' : 'CRM'} is live</p>
      ${urlLines.join('\n      ')}
    </div>
    ${passwordLine}
    <div style="background:#f8f8fa;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 12px;color:#1a1a2e;font-weight:600;">3 things to do first:</p>
      <ol style="margin:0;padding-left:20px;color:#333;line-height:1.8;">
        ${isStore ? `
        <li>Open <strong>Payments</strong> in your store admin and connect your payment account so you can accept orders</li>
        <li>Add your products — or edit the sample products we added to get you started</li>
        <li>Preview your storefront and place a test order</li>` : `
        <li>Complete the onboarding wizard to set up your company profile</li>
        <li>Add your first ${product === 'Care' ? 'client' : 'contact'} and create a ${product === 'Care' ? 'care plan' : 'job'}</li>
        <li>Invite your team members from Settings</li>`}
      </ol>
    </div>
    ${isPremiumWebsite ? `
    <div style="background:#faf5ff;border:1px solid #e9d5ff;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 4px;color:#6b21a8;font-weight:600;">Tweak your site</p>
      <p style="margin:0;color:#581c87;font-size:14px;">Open the Website admin to edit any section's wording, swap photos, reorder, or add a new page. The draft is yours to refine.</p>
    </div>` : ''}
    <p style="color:#666;font-size:14px;">Services may take a few minutes to fully start up after deployment.</p>
    ${urls.deployedUrl ? btn(urls.deployedUrl, isStore ? 'Log In to Your Store Admin' : 'Log In to Your CRM') : websiteAdminUrl ? btn(websiteAdminUrl, 'Open Website Admin') : urls.siteUrl ? btn(urls.siteUrl, 'View Your Website') : ''}`

  return sendEmail(
    tenant.email,
    isStore ? 'Your Twomiah store is ready' : `Your Twomiah ${product} CRM is ready`,
    wrap(isStore ? 'Your Store is Ready' : `Your ${product} CRM is Ready`, body)
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

// ─── Local-business intake notifications ─────────────────────────────────────

/**
 * Fires when a visitor submits the website-intake form on /businesses.
 * Notifies the internal team so a human can reach out within one business day.
 * Includes signed URLs (7-day expiry) for any uploaded logo + reference photos.
 */
export async function notifyNewIntake(
  data: {
    businessName: string
    businessType: string
    contactEmail: string
    contactPhone?: string | null
    currentSite?: string | null
    brandColors?: string | null
    notes?: string | null
    logoUrl?: string | null
    photoUrls?: string[]
    intakeId?: string
  }
): Promise<boolean> {
  const to = process.env.INTAKE_NOTIFY_EMAIL || 'support@twomiah.com'

  const photoLinks = (data.photoUrls || [])
    .map((u, i) => '<a href="' + u + '" target="_blank">Photo ' + (i + 1) + '</a>')
    .join(' &nbsp;Â·&nbsp; ')

  const body = `
    <p style="color:#333;line-height:1.6;">A new local-business website intake came in via <strong>twomiah.com/businesses</strong>. Respond within one business day.</p>
    <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:6px;padding:16px;margin:16px 0;">
      ${kv('Business', data.businessName)}
      ${kv('Type', data.businessType)}
      ${kv('Email', '<a href="mailto:' + data.contactEmail + '">' + data.contactEmail + '</a>')}
      ${data.contactPhone ? kv('Phone', data.contactPhone) : ''}
      ${data.currentSite ? kv('Current site', '<a href="' + data.currentSite + '" target="_blank">' + data.currentSite + '</a>') : ''}
      ${data.brandColors ? kv('Brand / colors', data.brandColors) : ''}
    </div>
    ${data.logoUrl ? `<p style="color:#333;font-size:14px;line-height:1.6;"><strong>Logo:</strong> <a href="${data.logoUrl}" target="_blank">Download</a> &nbsp; <span style="color:#888;font-size:12px;">(link expires in 7 days; regenerate from platform if older)</span></p>` : ''}
    ${photoLinks ? `<p style="color:#333;font-size:14px;line-height:1.6;"><strong>Reference photos:</strong> ${photoLinks}</p>` : ''}
    ${data.notes ? `<p style="color:#333;font-size:14px;line-height:1.6;"><strong>Notes:</strong><br>${data.notes.substring(0, 2000).replace(/\n/g, '<br>')}</p>` : ''}
    ${data.intakeId ? btn('https://twomiah-factory-platform.onrender.com/tenants/' + data.intakeId, 'View in Factory Platform') : ''}`

  return sendEmail(to, 'New website intake: ' + data.businessName, wrap('New Local-Business Intake', body))
}

/**
 * Fires when staff approves a composed premium preview — sends the
 * prospect the link to view it. Until this fires, the public preview
 * URL returns "not ready yet" so the prospect never sees unreviewed
 * AI output.
 */
export async function notifyPreviewReady(
  data: { to: string; businessName: string; previewUrl: string }
): Promise<boolean> {
  const body = `
    <p style="color:#333;line-height:1.6;font-size:16px;">Hi there — your <strong>${data.businessName}</strong> website preview is ready.</p>
    <p style="color:#333;line-height:1.6;">This is a 4-page draft of what your site could look like, built from what you shared at sign-up. It's meant to show you the <em>shape</em> of the site — the structure, voice, and direction. The small details (the exact copy, the photos, the specific service descriptions) are yours to fine-tune once you're in.</p>
    ${btn(data.previewUrl, 'View your preview')}
    <p style="color:#666;line-height:1.6;font-size:14px;margin-top:24px;"><strong>When the direction feels right,</strong> hit "Approve &amp; build my site" on the preview page. We'll deploy the live version within an hour of payment clearing, and you'll get login details to swap photos, edit copy, and add your own touches through a simple editor — no code, no design tools to learn.</p>
    <p style="color:#666;line-height:1.6;font-size:14px;"><strong>If the vibe is off</strong> (wrong industry, wrong tone, wrong feel) use the "Request changes" button at the bottom right of any preview page — someone on our team will read it and follow up within one business day.</p>`

  return sendEmail(data.to, `Your ${data.businessName} website preview is ready`, wrap('Your preview is ready', body))
}

/**
 * Day-1 post-launch tips email. Sent ~24-72h after a premium tenant
 * pays. Celebrates the launch and gives 3 concrete next steps.
 */
export async function notifyPostLaunchTips(
  data: { to: string; businessName: string; siteUrl: string; adminUrl: string }
): Promise<boolean> {
  const body = `
    <p style="color:#333;line-height:1.6;font-size:16px;">Hi — your <strong>${data.businessName}</strong> site has been live for a day. Here's what most owners do this week to make it work harder for them:</p>
    <div style="background:#fafaf7;border-radius:10px;padding:18px 22px;margin:18px 0;">
      <p style="margin:0 0 10px;color:#1a1a1a;font-weight:600;">1. Share the link with three customers who'd say nice things</p>
      <p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.5;">Their reactions are honest. Their feedback is gold. Their referrals are the cheapest marketing you'll ever pay for.</p>
      <p style="margin:0 0 10px;color:#1a1a1a;font-weight:600;">2. Add 2-3 real photos from a recent job</p>
      <p style="margin:0 0 16px;color:#666;font-size:14px;line-height:1.5;">The composed draft uses stock for slots you didn't fill. Replacing them with actual work makes the site feel local and earned — buyers can tell the difference.</p>
      <p style="margin:0 0 10px;color:#1a1a1a;font-weight:600;">3. Add it to your Google Business Profile + email signature</p>
      <p style="margin:0;color:#666;font-size:14px;line-height:1.5;">Two minutes each. Every quote you send for the next month carries your site on it.</p>
    </div>
    ${btn(data.adminUrl, 'Open your site admin')}
    <p style="color:#666;line-height:1.6;font-size:14px;margin-top:24px;">When a contact form lead comes in, it'll land in your inbox automatically. Reply fast — most owners who reply within an hour close 30% more.</p>
    <p style="color:#999;line-height:1.6;font-size:12px;margin-top:24px;">Hit reply if you want a hand with any of the above.</p>`
  return sendEmail(data.to, `Three things to do with your new ${data.businessName} site this week`, wrap('Your site is live — now what?', body))
}

/**
 * 24-hour follow-up nudge sent to customers who submitted an intake,
 * received a preview, but haven't clicked Approve & buy yet. One-shot
 * — sentinel `preview_followup_sent_at` prevents repeats.
 */
export async function notifyPreviewFollowup(
  data: { to: string; businessName: string; previewUrl: string }
): Promise<boolean> {
  const body = `
    <p style="color:#333;line-height:1.6;font-size:16px;">Hi — just checking in on your <strong>${data.businessName}</strong> website preview.</p>
    <p style="color:#333;line-height:1.6;">You opened the draft yesterday. If anything wasn't right, hit the <strong>Request changes</strong> button on any page and we'll send you an updated version in 1–2 minutes. We can iterate as many times as you want — there's no charge to revise.</p>
    ${btn(data.previewUrl, 'Open your preview')}
    <p style="color:#666;line-height:1.6;font-size:14px;margin-top:24px;">When you're happy, the <strong>Approve &amp; build my site</strong> button on the preview takes you to checkout. Live site within 10 minutes after that.</p>
    <p style="color:#999;line-height:1.6;font-size:12px;margin-top:24px;">Got questions? Just reply to this email — it goes straight to a human.</p>`
  return sendEmail(data.to, `Anything you'd change about your ${data.businessName} preview?`, wrap('Still thinking about it?', body))
}

/**
 * Internal notification when a customer submits feedback on their
 * premium-website preview. Routed to STAFF_NOTIFY_EMAIL (falls back
 * to FACTORY_FROM_EMAIL) so somebody actually sees the request.
 */
export async function notifyIntakeFeedback(
  data: { businessName: string; intakeId: string; message: string; contactEmail?: string }
): Promise<boolean> {
  const to = process.env.STAFF_NOTIFY_EMAIL || process.env.FACTORY_FROM_EMAIL || ''
  if (!to) return false

  const escaped = data.message.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] || c))
  const body = `
    <p style="color:#333;line-height:1.6;">New preview feedback from <strong>${data.businessName}</strong>${data.contactEmail ? ' (' + data.contactEmail + ')' : ''}:</p>
    <div style="background:#f8f8fa;border-left:3px solid #f97316;padding:14px 18px;margin:16px 0;border-radius:4px;white-space:pre-wrap;color:#1a1a1a;line-height:1.55;">${escaped}</div>
    <p style="color:#666;font-size:14px;">Open Premium Review on the platform to see all feedback for this intake and trigger a recompose.</p>
    <p style="color:#999;font-size:12px;">Intake: <code>${data.intakeId}</code></p>`
  return sendEmail(to, `[Preview feedback] ${data.businessName}`, wrap('Preview feedback received', body))
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

// ─── Domain + subscription renewal warnings ──────────────────────────────────

function renewalBanner(daysRemaining: number, kind: 'domain' | 'subscription'): string {
  const urgent = daysRemaining <= 7
  const label = kind === 'domain' ? 'domain' : 'subscription'
  if (urgent) {
    return `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:6px;padding:16px;margin:16px 0;">
       <p style="margin:0 0 4px;color:#991b1b;font-weight:600;font-size:16px;">&#9888; Only ${daysRemaining} day${daysRemaining === 1 ? '' : 's'} until your ${label} renews</p>
       <p style="margin:0;color:#991b1b;">If your payment method fails, your ${label} will lapse.</p>
     </div>`
  }
  return `<div style="background:#fefce8;border:1px solid #fde68a;border-radius:6px;padding:16px;margin:16px 0;">
     <p style="margin:0 0 4px;color:#92400e;font-weight:600;font-size:16px;">${daysRemaining} days until your ${label} renews</p>
     <p style="margin:0;color:#92400e;">Make sure your payment method on file is current.</p>
   </div>`
}

export async function notifyDomainRenewal(
  tenant: { name: string; email?: string; domain?: string | null; admin_email?: string | null },
  daysRemaining: number,
  billingUrl?: string
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const subject = `Your domain ${tenant.domain || ''} renews in ${daysRemaining} days`
  const cta = billingUrl ? btn(billingUrl, 'Review Billing') : ''
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    ${renewalBanner(daysRemaining, 'domain')}
    <p style="color:#333;line-height:1.6;">We're reaching out ahead of the auto-renewal so there are no surprises. Your domain <strong>${tenant.domain || '(unnamed)'}</strong> is set to renew automatically.</p>
    <p style="color:#666;font-size:14px;">If your website, email, or CRM depend on this domain (they do), a lapsed renewal means downtime. Updating your payment method now avoids it.</p>
    ${cta}`
  return sendEmail(to, subject, wrap('Domain Renewal Coming Up', body))
}

export async function notifySubscriptionRenewal(
  tenant: { name: string; email?: string; admin_email?: string | null; plan?: string | null },
  daysRemaining: number,
  billingUrl?: string
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const planLabel = (tenant.plan || 'starter').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
  const subject = `Your Twomiah ${planLabel} subscription renews in ${daysRemaining} days`
  const cta = billingUrl ? btn(billingUrl, 'Update Billing') : ''
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    ${renewalBanner(daysRemaining, 'subscription')}
    <p style="color:#333;line-height:1.6;">Your <strong>${planLabel}</strong> plan is set to renew automatically. Confirm your card is current to avoid any interruption.</p>
    ${cta}`
  return sendEmail(to, subject, wrap('Subscription Renewal Coming Up', body))
}

// ─── Offboard lifecycle ───────────────────────────────────────────────────────

export async function notifyOffboardStarted(
  tenant: { name: string; email?: string; admin_email?: string | null; domain?: string | null; render_frontend_url?: string | null },
  graceEndsAt: Date,
  reactivationUrl?: string
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const graceStr = graceEndsAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <p style="color:#333;line-height:1.6;">We've started offboarding your Twomiah account. Here's what happens next:</p>
    <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:6px;padding:16px;margin:16px 0;">
      <p style="margin:0 0 8px;color:#1e3a8a;font-weight:600;">Your 30-day grace period</p>
      <p style="margin:0;color:#1e3a8a;font-size:14px;">Your CRM, website, and data stay live until <strong>${graceStr}</strong>. If you change your mind, reactivate any time during this window — nothing gets deleted.</p>
    </div>
    <ul style="color:#333;line-height:1.8;font-size:14px;padding-left:20px;">
      <li>Your subscription is cancelled at the end of the current billing period (no further charges).</li>
      <li>Your domain ${tenant.domain ? '<strong>' + tenant.domain + '</strong>' : ''} has been unlocked for transfer — a separate email with the auth (EPP) code is on its way.</li>
      <li>A data export (CSV + JSON) will be emailed to you shortly.</li>
      <li>After ${graceStr}, your Render services and Cloudflare zone are decommissioned.</li>
    </ul>
    ${reactivationUrl ? btn(reactivationUrl, 'Change my mind — reactivate') : ''}
    <p style="color:#666;font-size:14px;margin-top:16px;">Questions? Just reply to this email and we'll help.</p>`
  return sendEmail(to, `Offboarding started — grace period through ${graceStr}`, wrap('Offboarding Started', body))
}

export async function notifyEppCode(
  tenant: { name: string; email?: string; admin_email?: string | null; domain?: string | null },
  eppCode: string
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <p style="color:#333;line-height:1.6;">Here's the EPP authorization code for transferring <strong>${tenant.domain || '(your domain)'}</strong> to another registrar.</p>
    <div style="background:#f3f4f6;border:1px solid #d1d5db;border-radius:6px;padding:16px;margin:16px 0;font-family:monospace;word-break:break-all;">
      ${eppCode}
    </div>
    <p style="color:#333;line-height:1.6;font-size:14px;"><strong>How to use it:</strong></p>
    <ol style="color:#333;line-height:1.8;font-size:14px;padding-left:20px;">
      <li>Sign up or log in at the new registrar (Namecheap, GoDaddy, Cloudflare, etc.).</li>
      <li>Start a "transfer in" for your domain.</li>
      <li>Paste this EPP code when asked.</li>
      <li>Approve the transfer email that arrives at the domain's registrant email.</li>
    </ol>
    <p style="color:#666;font-size:14px;">The transfer usually completes within 5–7 days. Your domain is unlocked on our side so there's nothing else to do here.</p>`
  return sendEmail(to, `Your EPP code for ${tenant.domain || 'domain transfer'}`, wrap('Domain Transfer Authorization Code', body))
}

export async function notifyDataExportReady(
  tenant: { name: string; email?: string; admin_email?: string | null },
  signedUrl: string,
  expiresAt: Date
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const expStr = expiresAt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <p style="color:#333;line-height:1.6;">Your account data export is ready. It includes every contact, job, quote, invoice, document, and attachment from your account.</p>
    ${btn(signedUrl, 'Download Export')}
    <p style="color:#666;font-size:14px;margin-top:16px;">This download link expires on <strong>${expStr}</strong>. Save the files to your own storage before then.</p>`
  return sendEmail(to, 'Your Twomiah data export is ready', wrap('Data Export Ready', body))
}

export async function notifyReactivated(
  tenant: { name: string; email?: string; admin_email?: string | null }
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const body = `
    <p style="color:#333;line-height:1.6;">Welcome back, ${tenant.name} — your account has been reactivated.</p>
    <p style="color:#333;line-height:1.6;">Your subscription has been restored and the offboard timer has been cancelled. Nothing was deleted during the grace period, so everything picks up where you left off.</p>`
  return sendEmail(to, 'Your Twomiah account is reactivated', wrap('Welcome Back', body))
}

export async function notifyOffboardComplete(
  tenant: { name: string; email?: string; admin_email?: string | null }
): Promise<boolean> {
  const to = tenant.admin_email || tenant.email
  if (!to) return false
  const body = `
    <p style="color:#333;line-height:1.6;">Hi ${tenant.name},</p>
    <p style="color:#333;line-height:1.6;">Your offboarding is complete. Your Twomiah services have been decommissioned per the plan you chose. Thanks for trying us — if you ever come back, your slug is still reserved and the door is always open.</p>`
  return sendEmail(to, 'Offboarding complete', wrap('Goodbye (for now)', body))
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
