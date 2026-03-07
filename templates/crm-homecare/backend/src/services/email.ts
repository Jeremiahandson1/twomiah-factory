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
const APP_URL = process.env.FRONTEND_URL || 'http://localhost:5173'

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
  sendPortalInvite: (to: string, data: Record<string, unknown>) => send(to, 'portalInvite', data),
  sendPortalSetupInvite: (to: string, data: Record<string, unknown>) => send(to, 'portalSetupInvite', data),
}

export default emailService
export { emailService, send }
