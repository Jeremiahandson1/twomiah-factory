// Email: the sending machinery of the CRM templates' services/email.ts (provider detection, transport, send,
// sendRaw, the recorder hook, inline button colours) with one change. The templates baked the company's name,
// domain and colour in at build time ({{COMPANY_NAME}}, {{COMPANY_DOMAIN}}, {{PRIMARY_COLOR_ON_WHITE}}); the
// unified app serves every company from one build, so each message reads them from the company row when it is sent.
// Each module's own messages (invoices, quotes, bookings…) move in with that module; this file holds the core ones.
import nodemailer from 'nodemailer'
import type { Transporter } from 'nodemailer'
import { company } from '../db/schema/index.ts'
import { colourOnWhite } from './brandColour.ts'
import type { Logger } from './logger.ts'

type EmailProvider = 'sendgrid' | 'mailgun' | 'ses' | 'resend' | 'postmark' | 'smtp' | 'console'

function getProvider(): EmailProvider {
  if (process.env.SENDGRID_API_KEY) return 'sendgrid'
  if (process.env.MAILGUN_API_KEY) return 'mailgun'
  if (process.env.AWS_SES_REGION) return 'ses'
  if (process.env.RESEND_API_KEY) return 'resend'
  if (process.env.POSTMARK_API_KEY) return 'postmark'
  if (process.env.SMTP_HOST) return 'smtp'
  return 'console'
}

function createTransporter(provider: EmailProvider): Transporter | null {
  switch (provider) {
    case 'sendgrid':
      return nodemailer.createTransport({ host: 'smtp.sendgrid.net', port: 587, auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY } })
    case 'mailgun':
      return nodemailer.createTransport({ host: 'smtp.mailgun.org', port: 587, auth: { user: `postmaster@${process.env.MAILGUN_DOMAIN}`, pass: process.env.MAILGUN_API_KEY } })
    case 'ses':
      return nodemailer.createTransport({
        host: `email-smtp.${process.env.AWS_SES_REGION}.amazonaws.com`, port: 587,
        auth: { user: process.env.AWS_SES_SMTP_USER || process.env.AWS_ACCESS_KEY_ID, pass: process.env.AWS_SES_SMTP_PASS || process.env.AWS_SECRET_ACCESS_KEY },
      })
    case 'resend':
      return nodemailer.createTransport({ host: 'smtp.resend.com', port: 465, secure: true, auth: { user: 'resend', pass: process.env.RESEND_API_KEY } })
    case 'postmark':
      return nodemailer.createTransport({ host: 'smtp.postmarkapp.com', port: 587, auth: { user: process.env.POSTMARK_API_KEY, pass: process.env.POSTMARK_API_KEY } })
    case 'smtp':
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST, port: parseInt(process.env.SMTP_PORT || '587'), secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
      })
    default:
      return null
  }
}

/** Text a person typed, made safe to put in an email's HTML. */
export function escHtml(v: unknown): string {
  return String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

/** What a message needs to know about the company sending it. */
export interface Brand {
  companyName: string
  /** The company colour, darkened only as far as white text on it (and it on white) needs to read. */
  colourOnWhite: string
}

export const baseStyles = (b: Brand) => `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: ${b.colourOnWhite}; color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
  .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
  .button { display: inline-block; background: ${b.colourOnWhite}; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
  .button-secondary { background: #6b7280; }
  .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  .highlight { background: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0; }
  .amount { font-size: 32px; font-weight: bold; color: ${b.colourOnWhite}; text-align: center; padding: 20px; }
`

/**
 * Button colours, inline. Mail clients paint a link in their own link colour unless the anchor itself says
 * otherwise, so every `class="button"` anchor gets its background and white text written on the element.
 */
export function inlineButtonColours(html: string, b: Brand): string {
  return html.replace(/<a ([^>]*?)class="button( button-secondary)?"([^>]*)>/g, (m, before: string, secondary: string | undefined, after: string) => {
    if (/\sstyle=/.test(before + after)) return m
    const bg = secondary ? '#4b5563' : b.colourOnWhite
    return `<a ${before}class="button${secondary || ''}"${after} style="display:inline-block;background:${bg};color:#ffffff !important;padding:12px 30px;text-decoration:none;border-radius:6px;font-weight:600;">`
  })
}

export interface TemplateResult { subject: string; html: string; text: string }
export type Template = (data: any, b: Brand, appUrl: string) => TemplateResult

/** The core messages. A module adds its own with `register`. */
export const coreTemplates: Record<string, Template> = {
  // The link is the reset: its token is checked by /api/auth/reset-password. The shared sign-in also hands over a
  // six-digit "code" that is never stored or asked for anywhere, so the email printed a number nobody could use
  // (owner, 2026-10-22: "it gave me a code but didnt ask for the code anywhere") — it is left out.
  passwordReset: (data, b, appUrl) => ({
    subject: 'Reset Your Password',
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>Password Reset</h2>
          <p>Hi ${escHtml(data.firstName)},</p>
          <p>Click the button to choose a new password:</p>
          <p style="text-align:center;"><a href="${appUrl}/reset-password?token=${encodeURIComponent(String(data.resetToken ?? ''))}" class="button">Reset Password</a></p>
          <p>This link expires in 1 hour. If you didn't request this, ignore this email.</p>
        </div>
        <div class="footer">&copy; ${new Date().getFullYear()} ${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.firstName}, choose a new password here: ${appUrl}/reset-password?token=${encodeURIComponent(String(data.resetToken ?? ''))}\n\nThe link expires in 1 hour. If you didn't ask for this, ignore this email.`,
  }),

  // A new teammate chooses their own password from this link (shared company routes, Settings › Users).
  teamInvite: (data, b) => ({
    subject: `You're invited to join ${data.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">You're Invited!</h1></div>
        <div class="content">
          <p>Hi ${escHtml(data.firstName || 'there')},</p>
          <p><strong>${escHtml(data.inviterName)}</strong> has invited you to join <strong>${escHtml(data.companyName)}</strong>. Choose your password to sign in.</p>
          <p>Your role: <strong>${escHtml(data.role)}</strong></p>
          <p style="text-align:center;"><a href="${escHtml(data.inviteLink)}" class="button">Accept Invitation</a></p>
          <p>This invitation expires in 7 days.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.firstName || 'there'},\n\n${data.inviterName} invited you to join ${data.companyName}. Choose your password to sign in: ${data.inviteLink}\n\nThis invitation expires in 7 days.`,
  }),
}

type EmailRecord = { to: string; subject: string; status: 'sent' | 'failed'; errorMessage?: string }

export function createEmailService(deps: { db: any; logger: Logger }) {
  const { db, logger } = deps
  const provider = getProvider()
  const transporter = createTransporter(provider)
  const templates: Record<string, Template> = { ...coreTemplates }
  let recordEmail: ((e: EmailRecord) => Promise<void>) | null = null
  const appUrl = () => process.env.FRONTEND_URL || ''

  /** The sending company, read when the message is built: one build serves every company. */
  async function brand(): Promise<Brand> {
    const [row] = await db.select({ name: company.name, primaryColor: company.primaryColor }).from(company).limit(1)
    return { companyName: row?.name || 'Twomiah', colourOnWhite: colourOnWhite(row?.primaryColor || '#f97316') }
  }

  async function from(b: Brand, name?: string, address?: string) {
    const fromAddress = address || process.env.FROM_EMAIL
    // The templates fell back to noreply@<their domain>, which the provider refuses until that domain is verified,
    // so a message "sent" from it was dropped downstream. The Factory sets FROM_EMAIL on every tenant; without it,
    // production refuses to send rather than report a send that won't arrive.
    if (!fromAddress && process.env.NODE_ENV === 'production') throw new Error('FROM_EMAIL is not configured')
    return { name: name || process.env.FROM_NAME || b.companyName, address: fromAddress || 'noreply@localhost' }
  }

  /** Send one of the registered messages. Throws in production when no provider is configured. */
  async function send(to: string, templateName: string, data: Record<string, unknown>, options: Record<string, unknown> = {}) {
    const template = templates[templateName]
    if (!template) throw new Error(`Email template '${templateName}' not found`)
    const b = await brand()
    const { subject, html: styledHtml, text } = template(data, b, appUrl())
    const html = inlineButtonColours(styledHtml, b)

    // Without a provider, development logs the message; production refuses, because a clean return would let the
    // caller stamp a record "sent" that never went.
    if (!transporter && process.env.NODE_ENV === 'production') throw new Error('No email provider is configured')
    if (!transporter) {
      logger.info('Email (dev mode, not sent)', { to, subject, template: templateName })
      return { success: true, dev: true }
    }
    try {
      const result = await transporter.sendMail({
        from: (options.from as any) || await from(b),
        to, subject, html, text,
        // Mail goes out from a verified sending domain, so replies are pointed back at the business.
        ...(process.env.REPLY_TO_EMAIL ? { replyTo: process.env.REPLY_TO_EMAIL } : {}),
        ...options,
      })
      logger.info('Email sent', { to, subject, template: templateName, provider })
      void recordEmail?.({ to, subject, status: 'sent' })
      return { success: true, messageId: result.messageId as string }
    } catch (error: unknown) {
      logger.error('Email failed', { to, template: templateName, error: (error as Error).message })
      void recordEmail?.({ to, subject, status: 'failed', errorMessage: (error as Error).message })
      throw error
    }
  }

  /**
   * Send a composed message (campaigns, drip steps, a material order to a supplier) through the same provider. Not recorded: its
   * caller records it. `attachments` are files sent with it; `replyTo` points the reply at a person (it wins over REPLY_TO_EMAIL).
   * With no provider in development it sends nothing and answers `dev: true` — a caller that must know the mail went checks that.
   */
  async function sendRaw({ to, cc, subject, html, text, fromName, fromEmail, replyTo, attachments }: {
    to: string; cc?: string; subject: string; html: string; text?: string; fromName?: string; fromEmail?: string; replyTo?: string
    attachments?: Array<{ filename: string; content: Buffer; contentType?: string }>
  }) {
    if (!transporter && process.env.NODE_ENV === 'production') throw new Error('No email provider is configured')
    if (!transporter) {
      logger.info('Email (dev mode, not sent)', { to, subject })
      return { success: true, dev: true }
    }
    const b = await brand()
    const result = await transporter.sendMail({
      from: await from(b, fromName, fromEmail), to, subject, html,
      ...(cc ? { cc } : {}), ...(text ? { text } : {}), ...(attachments?.length ? { attachments } : {}),
      ...(replyTo ? { replyTo } : process.env.REPLY_TO_EMAIL ? { replyTo: process.env.REPLY_TO_EMAIL } : {}),
    })
    logger.info('Email sent', { to, subject, provider })
    return { success: true, messageId: result.messageId as string }
  }

  return {
    provider,
    send,
    sendRaw,
    /** A module's messages, added when the module is mounted. A name already taken is a mistake, so it throws. */
    register(more: Record<string, Template>) {
      for (const [name, t] of Object.entries(more)) {
        if (templates[name]) throw new Error(`Email template '${name}' is already registered`)
        templates[name] = t
      }
    },
    setRecorder(fn: ((e: EmailRecord) => Promise<void>) | null) { recordEmail = fn },
    sendPasswordReset(to: string, data: Record<string, unknown>) { return send(to, 'passwordReset', data) },
    sendTeamInvite(to: string, data: Record<string, unknown>) { return send(to, 'teamInvite', data) },
  }
}

export type EmailService = ReturnType<typeof createEmailService>
