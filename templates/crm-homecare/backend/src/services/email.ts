/**
 * Email Service for Home Care CRM
 *
 * Supports: SendGrid, Mailgun, AWS SES, Resend, Postmark, SMTP
 * Falls back to console logging in dev mode.
 */

import nodemailer from 'nodemailer'
import logger from './logger.ts'

const FROM_EMAIL = process.env.FROM_EMAIL || 'noreply@{{COMPANY_DOMAIN}}'
const FROM_NAME = process.env.FROM_NAME || '{{COMPANY_NAME}}'
const APP_URL = process.env.FRONTEND_URL || ''

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

function createTransporter(): nodemailer.Transporter | null {
  const provider = getProvider()

  switch (provider) {
    case 'sendgrid':
      return nodemailer.createTransport({
        host: 'smtp.sendgrid.net',
        port: 587,
        auth: { user: 'apikey', pass: process.env.SENDGRID_API_KEY },
      })
    case 'mailgun':
      return nodemailer.createTransport({
        host: 'smtp.mailgun.org',
        port: 587,
        auth: {
          user: `postmaster@${process.env.MAILGUN_DOMAIN}`,
          pass: process.env.MAILGUN_API_KEY,
        },
      })
    case 'ses':
      return nodemailer.createTransport({
        host: `email-smtp.${process.env.AWS_SES_REGION}.amazonaws.com`,
        port: 587,
        auth: {
          user: process.env.AWS_SES_SMTP_USER || process.env.AWS_ACCESS_KEY_ID,
          pass: process.env.AWS_SES_SMTP_PASS || process.env.AWS_SECRET_ACCESS_KEY,
        },
      })
    case 'resend':
      return nodemailer.createTransport({
        host: 'smtp.resend.com',
        port: 465,
        secure: true,
        auth: { user: 'resend', pass: process.env.RESEND_API_KEY },
      })
    case 'postmark':
      return nodemailer.createTransport({
        host: 'smtp.postmarkapp.com',
        port: 587,
        auth: {
          user: process.env.POSTMARK_API_KEY,
          pass: process.env.POSTMARK_API_KEY,
        },
      })
    case 'smtp':
      return nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: parseInt(process.env.SMTP_PORT || '587'),
        secure: process.env.SMTP_SECURE === 'true',
        auth: process.env.SMTP_USER ? {
          user: process.env.SMTP_USER,
          pass: process.env.SMTP_PASS,
        } : undefined,
      })
    default:
      return null
  }
}

const transporter = createTransporter()
const PROVIDER = getProvider()

const baseStyles = `
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; }
  .container { max-width: 600px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #0d9488 0%, #14b8a6 100%); color: white; padding: 20px; text-align: center; border-radius: 8px 8px 0 0; }
  .content { background: #fff; padding: 30px; border: 1px solid #e5e7eb; border-top: none; border-radius: 0 0 8px 8px; }
  .button { display: inline-block; background: #0d9488; color: white; padding: 12px 30px; text-decoration: none; border-radius: 6px; margin: 10px 5px; }
  .footer { text-align: center; padding: 20px; color: #6b7280; font-size: 14px; }
  .highlight { background: #f3f4f6; padding: 15px; border-radius: 6px; margin: 15px 0; }
`

interface TemplateResult {
  subject: string
  html: string
  text: string
}

const templates: Record<string, (data: any) => TemplateResult> = {
  portalInvite: (data) => ({
    subject: `Your ${data.companyName} Care Portal Access`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Home Care Portal</p></div>
        <div class="content">
          <h2>Welcome to Your Care Portal</h2>
          <p>Hi ${data.contactName},</p>
          <p>You now have access to your home care portal where you can view your care schedule, invoices, caregivers, and more.</p>
          <p style="text-align:center;"><a href="${data.portalUrl}" class="button">Access Your Portal</a></p>
          <div class="highlight">
            <p>With your portal you can:</p>
            <ul style="margin:0;padding-left:20px;">
              <li>View upcoming visits and care schedule</li>
              <li>See your assigned caregivers</li>
              <li>Review and pay invoices</li>
              <li>View your care plan details</li>
              <li>Send messages to the agency</li>
            </ul>
          </div>
          <p><small>This link is unique to you. Do not share it with others.</small></p>
        </div>
        <div class="footer">${data.companyName} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, access your care portal for ${data.companyName}: ${data.portalUrl}`,
  }),

  portalSetupInvite: (data) => ({
    subject: `Set Up Your ${data.companyName} Portal Account`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Home Care Portal</p></div>
        <div class="content">
          <h2>Set Up Your Account</h2>
          <p>Hi ${data.contactName},</p>
          <p>You've been invited to access the ${data.companyName} client portal. Click below to set your password and get started.</p>
          <p style="text-align:center;"><a href="${data.setupUrl}" class="button">Set Up My Account</a></p>
          <p><small>This link expires in 7 days. If you did not expect this invitation, you can safely ignore it.</small></p>
        </div>
        <div class="footer">${data.companyName} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, set up your ${data.companyName} portal account: ${data.setupUrl}`,
  }),

  invoiceEmail: (data) => ({
    subject: `Invoice #${data.invoiceNumber} from ${data.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}
        table.inv { width: 100%; border-collapse: collapse; margin: 15px 0; }
        table.inv th, table.inv td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
        table.inv th { background: #f9fafb; font-weight: 600; }
      </style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Home Care Invoice</p></div>
        <div class="content">
          <p>Hi ${data.contactName},</p>
          <p>Please find your invoice details below.</p>
          <div class="highlight">
            <p style="margin:0;"><strong>Invoice #${data.invoiceNumber}</strong></p>
            <p style="margin:4px 0 0;">Total: <strong>$${data.total}</strong></p>
            <p style="margin:4px 0 0;">Amount Due: <strong>$${data.amountDue}</strong></p>
            <p style="margin:4px 0 0;">Due Date: ${data.dueDate}</p>
          </div>
          ${data.lineItems ? `
          <table class="inv">
            <thead><tr><th>Date</th><th>Service</th><th>Hours</th><th>Amount</th></tr></thead>
            <tbody>${data.lineItems}</tbody>
          </table>` : ''}
          ${data.payUrl ? `<p style="text-align:center;"><a href="${data.payUrl}" class="button">Pay Now</a></p>` : ''}
          <p><small>If you have questions about this invoice, please contact us.</small></p>
        </div>
        <div class="footer">
          ${data.companyName} &mdash; HIPAA-compliant care services<br>
          <small>This message may contain Protected Health Information (PHI). If you are not the intended recipient, please delete this email and notify the sender immediately.</small>
        </div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, Invoice #${data.invoiceNumber} for $${data.amountDue} is due ${data.dueDate}. ${data.payUrl ? `Pay online: ${data.payUrl}` : ''}`,
  }),

  familyPortalWelcome: (data) => ({
    subject: `Welcome to ${data.companyName} Family Portal`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Family Care Portal</p></div>
        <div class="content">
          <h2>Welcome, ${data.familyName}!</h2>
          <p>You've been given access to the family portal for <strong>${data.clientName}</strong>.</p>
          <div class="highlight">
            <p><strong>Your Login:</strong></p>
            <p style="margin:4px 0;">Email: ${data.email}</p>
            <p style="margin:4px 0;">Temporary Password: <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px;">${data.tempPassword}</code></p>
          </div>
          <p style="text-align:center;"><a href="${data.portalUrl}" class="button">Log In to Portal</a></p>
          <p><small>Please change your password after your first login. This link is confidential.</small></p>
        </div>
        <div class="footer">
          ${data.companyName} &mdash; HIPAA-compliant care portal<br>
          <small>This message may contain Protected Health Information (PHI). If you are not the intended recipient, please delete this email and notify the sender immediately.</small>
        </div>
      </div></body></html>
    `,
    text: `Welcome ${data.familyName}! Log in to the ${data.companyName} family portal for ${data.clientName}: ${data.portalUrl} | Email: ${data.email} | Temp password: ${data.tempPassword}`,
  }),

  familyPasswordReset: (data) => ({
    subject: `Password Reset - ${data.companyName} Family Portal`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Family Care Portal</p></div>
        <div class="content">
          <h2>Password Reset</h2>
          <p>Hi ${data.familyName},</p>
          <p>We received a request to reset your family portal password. Click below to set a new password.</p>
          <p style="text-align:center;"><a href="${data.resetUrl}" class="button">Reset Password</a></p>
          <p><small>This link expires in 1 hour. If you did not request this, you can safely ignore it.</small></p>
        </div>
        <div class="footer">${data.companyName} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
    text: `Hi ${data.familyName}, reset your ${data.companyName} family portal password: ${data.resetUrl}`,
  }),

  passwordReset: (data) => ({
    subject: `Password Reset - ${data.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1><p style="margin:4px 0 0;opacity:0.9;">Password Reset</p></div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>Hi ${data.userName},</p>
          <p>We received a request to reset your password. Click below to set a new one.</p>
          <p style="text-align:center;"><a href="${data.resetUrl}" class="button">Reset Password</a></p>
          <p><small>This link expires in 1 hour. If you did not request this, you can safely ignore it.</small></p>
        </div>
        <div class="footer">${data.companyName}</div>
      </div></body></html>
    `,
    text: `Hi ${data.userName}, reset your ${data.companyName} password: ${data.resetUrl}`,
  }),
}

async function send(
  to: string,
  templateName: string,
  data: Record<string, unknown>,
): Promise<{ success: boolean; messageId?: string; dev?: boolean }> {
  const template = templates[templateName]
  if (!template) {
    throw new Error(`Email template '${templateName}' not found`)
  }

  const { subject, html, text } = template(data)
  const from = { name: FROM_NAME, address: FROM_EMAIL }

  if (!transporter) {
    console.log('\nEMAIL (dev mode):')
    console.log('To:', to)
    console.log('Subject:', subject)
    console.log('Template:', templateName)
    console.log('---')
    console.log(text)
    console.log('---\n')
    return { success: true, dev: true }
  }

  try {
    const result = await transporter.sendMail({ from, to, subject, html, text })
    logger.info('Email sent', { to, subject, template: templateName, provider: PROVIDER })
    return { success: true, messageId: result.messageId }
  } catch (error: unknown) {
    logger.error('Email failed', { to, template: templateName, error: (error as Error).message })
    throw error
  }
}

const emailService = {
  send,
  PROVIDER,
  isConfigured: PROVIDER !== 'console',
  sendPortalInvite: (to: string, data: Record<string, unknown>) => send(to, 'portalInvite', data),
  sendPortalSetupInvite: (to: string, data: Record<string, unknown>) => send(to, 'portalSetupInvite', data),
  sendInvoiceEmail: (to: string, data: Record<string, unknown>) => send(to, 'invoiceEmail', data),
  sendFamilyPortalWelcome: (to: string, data: Record<string, unknown>) => send(to, 'familyPortalWelcome', data),
  sendFamilyPasswordReset: (to: string, data: Record<string, unknown>) => send(to, 'familyPasswordReset', data),
  sendPasswordReset: (to: string, data: Record<string, unknown>) => send(to, 'passwordReset', data),
}

export default emailService
export { emailService, send }
