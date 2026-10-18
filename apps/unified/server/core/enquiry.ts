// A website enquiry (the contact form, the care finder, a catering or waitlist form): saved where the business
// works its leads, and the owner told by email. The routing is the CRM's own (templates/crm/backend/src/routes/
// webhooks.ts): into the Lead Inbox when that feature is on, otherwise a Contact of type 'lead'. In the one app the
// website calls it directly; before, the site saved its own copy and posted the CRM a webhook.
import { insertLead } from '@twomiah/tenant-backend'
import { contact, lead } from '../db/schema/index.ts'
import { escHtml, type EmailService, type Template } from './email.ts'
import type { Logger } from './logger.ts'

export interface Enquiry {
  name: string
  email: string
  phone: string | null
  /** What they wrote, plus every other answer the form asked for (event date, headcount, ZIP…). */
  message: string
  /** The form or page it came from. */
  source: string | null
}

/** The owner's copy of an enquiry. Replying answers the person who wrote. */
export const enquiryTemplates: Record<string, Template> = {
  newEnquiry: (e: Enquiry & { companyName: string }) => ({
    subject: `New website lead — ${e.name}`,
    html: `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#fafaf7;margin:0;padding:40px 16px;color:#1a1a1a;">
    <table width="560" cellpadding="0" cellspacing="0" align="center" style="background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(20,20,30,0.06);">
      <tr><td style="padding:28px 32px 16px;"><div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#888;">${escHtml(e.companyName)} · new lead</div></td></tr>
      <tr><td style="padding:0 32px 12px;"><h2 style="margin:0;font-size:22px;color:#1a1a1a;">${escHtml(e.name)}</h2></td></tr>
      <tr><td style="padding:0 32px 24px;color:#3a3a3a;font-size:15px;line-height:1.6;">
        <div><strong>Email:</strong> <a href="mailto:${escHtml(e.email)}" style="color:#1a1a1a;">${escHtml(e.email)}</a></div>
        ${e.phone ? `<div><strong>Phone:</strong> <a href="tel:${escHtml(e.phone)}" style="color:#1a1a1a;">${escHtml(e.phone)}</a></div>` : ''}
        ${e.source ? `<div style="margin-top:6px;color:#888;font-size:13px;">Submitted from: ${escHtml(e.source)}</div>` : ''}
        <div style="margin-top:18px;padding:14px 18px;background:#fafaf7;border-left:3px solid #f97316;border-radius:4px;white-space:pre-wrap;">${escHtml(e.message)}</div>
      </td></tr>
      <tr><td style="padding:0 32px 24px;"><a href="mailto:${escHtml(e.email)}?subject=Re:%20your%20inquiry" class="button">Reply now</a></td></tr>
      <tr><td style="background:#fafaf7;padding:16px 32px;border-top:1px solid #eee;color:#888;font-size:12px;">This lead is also saved in your leads.</td></tr>
    </table>
  </body></html>`,
    text: `New website lead from ${e.name} <${e.email}>${e.phone ? ' ' + e.phone : ''}\n\n${e.message}${e.source ? '\n\nSubmitted from: ' + e.source : ''}`,
  }),
}

export function createEnquiries(deps: {
  db: any
  email: EmailService
  logger: Logger
  isFeatureEnabled: (companyId: string, feature: string) => Promise<boolean>
}) {
  const { db, email, logger, isFeatureEnabled } = deps

  /** Save the enquiry where the business works its leads. Returns which place it went. */
  async function record(companyId: string, e: Enquiry): Promise<{ kind: 'lead' | 'contact'; id: string }> {
    if (await isFeatureEnabled(companyId, 'lead_inbox')) {
      const row = await insertLead(db, lead, {
        companyId, sourceId: null, platform: 'website',
        parsed: { name: e.name, email: e.email, phone: e.phone ?? undefined, description: e.message },
        rawPayload: { ...e },
      })
      return { kind: 'lead', id: row.id }
    }
    // No inbox to see it in: a Contact of type 'lead', as the CRM has always done.
    const [row] = await db.insert(contact).values({
      companyId, name: e.name, type: 'lead', email: e.email, phone: e.phone || undefined,
      source: e.source || 'website', notes: e.message || undefined,
    }).returning({ id: contact.id })
    return { kind: 'contact', id: row.id }
  }

  /** Tell the owner, at the company's own email. Never throws: the enquiry is already saved. */
  async function notifyOwner(owner: { email: string | null; companyName: string }, e: Enquiry): Promise<void> {
    if (!owner.email) return
    try {
      await email.send(owner.email, 'newEnquiry', { ...e, companyName: owner.companyName }, { replyTo: { address: e.email, name: e.name } })
    } catch (err: any) {
      logger.warn('Owner was not told about a website enquiry', { error: err?.message })
    }
  }

  return { record, notifyOwner }
}
