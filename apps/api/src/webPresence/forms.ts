// A $19 site's two forms reach the owner by OUR email, not Netlify's.
//
// Why: Netlify's form email notice may only go to a member of the Twomiah Netlify team (its API answers 422 "must be the email of a
// team member" for any other address — the first real customer, 11/07). So the site's own function, which already takes every
// form post (site/handler.mjs leads / apply: rate limit, robot check, cleaning), sends the cleaned message here, signed with the
// site's secret, and the Factory mails the owner. Netlify Forms still keeps a copy (the backup); it no longer emails anyone.
//
// The owner's inbox is the one they set in the editor (the site sends it from its own stored model); none set → the account's email.
// The reply-to is the visitor's address when they gave one, so the owner answers by pressing Reply. Nothing is stored here.
import { cleanLine, cleanBlock, cleanEmail, cleanPhone, checkResume, RESUME_TYPES } from './site/clean.mjs'
import { LIMITS } from './site/shapes.mjs'
import type { SiteRow } from './service'

export interface FormMail {
  to: string
  subject: string
  html: string
  replyTo?: string
  attachment?: { filename: string; content: string /* base64 */ }
}
export interface FormDeps {
  db: any
  sendFormEmail: (m: FormMail) => Promise<boolean>
  alert: (key: string, what: string, detail: string, tenantId?: string) => Promise<void>
}

export class FormError extends Error { constructor(message: string, readonly status: number) { super(message) } }

const esc = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

/** The labelled lines of each form, in the order the owner reads them. Anything else the site sends is ignored. */
const LEAD_FIELDS: Array<[string, string, (v: unknown) => string]> = [
  ['name', 'Name', (v) => cleanLine(v, 100)], ['email', 'Email', (v) => cleanEmail(v)], ['phone', 'Phone', (v) => cleanPhone(v)],
  ['message', 'Message', (v) => cleanBlock(v, 3000)], ['extra1', '', (v) => cleanLine(v, 270)], ['extra2', '', (v) => cleanLine(v, 270)],
]
const APPLY_FIELDS: Array<[string, string, (v: unknown) => string]> = [
  ['name', 'Name', (v) => cleanLine(v, 100)], ['email', 'Email', (v) => cleanEmail(v)], ['phone', 'Phone', (v) => cleanPhone(v)],
  ['job', 'Job', (v) => cleanLine(v, 80)], ['availability', 'Availability', (v) => cleanLine(v, 200)], ['about', 'About them', (v) => cleanBlock(v, 1500)],
]

/** The largest body the route accepts: a resume at its limit, as base64, plus the fields. */
export const FORM_BODY_MAX = Math.ceil(LIMITS.resumeMb * 1024 * 1024 * 4 / 3) + 40_000

export function formEmail(business: string, form: 'lead' | 'apply', fields: Record<string, string>, hasResume: boolean): { subject: string; html: string } {
  const rows = (form === 'lead' ? LEAD_FIELDS : APPLY_FIELDS)
    .filter(([k]) => fields[k])
    .map(([k, label]) => {
      const v = esc(fields[k]).replace(/\n/g, '<br>')
      return label
        ? `<tr><td style="padding:6px 12px 6px 0;color:#4a5565;vertical-align:top;white-space:nowrap">${label}</td><td style="padding:6px 0">${v}</td></tr>`
        : `<tr><td colspan="2" style="padding:6px 0">${v}</td></tr>`
    }).join('')
  const who = fields.name ? esc(fields.name) : 'Someone'
  const lead = form === 'lead' ? `${who} sent a message from the website of ${esc(business)}.` : `${who} applied for a job through the website of ${esc(business)}.`
  const reply = fields.email ? 'Press Reply to answer them.' : 'They left no email; call them back on the number above.'
  return {
    subject: form === 'lead' ? `New message from your website — ${fields.name || 'a visitor'}` : `New job application — ${fields.name || 'an applicant'}`,
    html: `<div style="font-family:system-ui,sans-serif;max-width:560px;margin:0 auto;color:#14181f"><p>${lead}</p>` +
      `<table style="border-collapse:collapse;font-size:15px;line-height:1.5">${rows}</table>` +
      (hasResume ? '<p>Their resume is attached.</p>' : '') +
      `<p style="color:#4a5565;font-size:14px">${reply}</p></div>`,
  }
}

/**
 * Deliver one form message to the owner. `body` is what the site sent (already cleaned there; cleaned again here — the Factory
 * trusts the signature, not the shape). Throws FormError (400) on a message that is not a form message; returns ok:false when the
 * email could not be sent, so the site tells the visitor it did not go through.
 */
export async function deliverForm(d: FormDeps, row: SiteRow, body: any): Promise<{ ok: boolean }> {
  const form = body?.form === 'lead' || body?.form === 'apply' ? body.form as 'lead' | 'apply' : null
  if (!form) throw new FormError('That did not look right.', 400)
  const fields: Record<string, string> = {}
  for (const [k, , clean] of form === 'lead' ? LEAD_FIELDS : APPLY_FIELDS) { const v = clean(body?.fields?.[k]); if (v) fields[k] = v }
  if (!fields.name || (!fields.email && !fields.phone)) throw new FormError('That did not look right.', 400)

  let attachment: FormMail['attachment']
  if (form === 'apply' && body?.resume) {
    const ext = String(body.resume.ext || '').toLowerCase()
    const content = typeof body.resume.content === 'string' ? body.resume.content : ''
    if (!(RESUME_TYPES as Record<string, string>)[ext] || !/^[A-Za-z0-9+/]+={0,2}$/.test(content)) throw new FormError('That did not look right.', 400)
    const bytes = Buffer.from(content, 'base64')
    const chk = checkResume({ name: 'resume.' + ext, size: bytes.length, head: new Uint8Array(bytes.subarray(0, 8)) })
    if (!chk.ok) throw new FormError(chk.error || 'That file is not accepted.', 400)
    attachment = { filename: 'resume.' + ext, content }
  }

  const { data: tenant } = await d.db.from('tenants').select('id, name, email, admin_email').eq('id', row.tenant_id).maybeSingle()
  if (!tenant) throw new FormError('That did not look right.', 400)
  const to = cleanEmail(body?.inbox) || cleanEmail(tenant.admin_email) || cleanEmail(tenant.email)
  if (!to) {
    await d.alert('web-presence-form-inbox:' + row.tenant_id, 'A Web presence site has a form message and no address to send it to', `Form: ${form}`, row.tenant_id)
    return { ok: false }
  }
  const m = formEmail(String(tenant.name || 'your business'), form, fields, !!attachment)
  const ok = await d.sendFormEmail({ to, subject: m.subject, html: m.html, ...(fields.email ? { replyTo: fields.email } : {}), ...(attachment ? { attachment } : {}) })
  if (!ok) await d.alert('web-presence-form-send:' + row.tenant_id, 'A Web presence form message could not be emailed to the owner', `Form: ${form} (Netlify Forms kept a copy)`, row.tenant_id)
  return { ok }
}
