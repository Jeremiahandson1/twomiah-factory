// Home care's email messages (the client and family portals, signature requests, visit invoices and reminders, the
// staff password reset), moved from templates/crm-homecare/backend/src/services/email.ts. The sending machinery
// (provider detection, transport, dev-mode logging, sendRaw) is the app's (server/core/email.ts), as it is for the
// CRM's messages (server/crm/messages.ts); these are registered once by core/index.ts.
//
// Changes from the template:
//   · every name carries a `homecare` prefix, so none collides with the core's (passwordReset) or the CRM's
//     (invoiceReminder …) — the email service refuses a name already taken;
//   · the header and buttons are the company's colour (baseStyles(b), as every other message), not the template's
//     fixed teal gradient; the company name is the caller's `companyName`, else the sending company's;
//   · the template's sender name/address were build placeholders ({{COMPANY_NAME}}, noreply@{{COMPANY_DOMAIN}}); the
//     app's email service names the company and refuses to send without FROM_EMAIL in production.
//   · the invoice and its reminder link the invoice's own page (/d/<token>, "View and pay"), not /pay/<invoice id>.
// The wording, the other links and what each message interpolates are unchanged (including the caller-built invoice
// `lineItems` rows, which are HTML by design and escaped by their caller). Every other value is escaped in the HTML, as
// the CRM's messages do: the template put names into the page as they were (fixed in the move).
import { baseStyles, escHtml, type Template, type EmailService } from '../../../core/email.ts'

const nameOf = (data: any, b: { companyName: string }) => data.companyName ?? b.companyName
/**
 * An invoice's button: its own private link (/d/<token>, minted by the caller — billing/invoices.ts), with the app's
 * address in front, as the CRM's invoice email does (crm/messages.ts invoiceLink). It was `/pay/<invoice id>`, built
 * only when FRONTEND_URL was set — otherwise the email went out with no way to pay (live test, 2026-10-23).
 */
const invoiceLink = (data: any, appUrl: string): string => (data.documentPath ? appUrl + String(data.documentPath) : '')

export const homecareTemplates: Record<string, Template> = {
  homecareDocumentSignatureRequest: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Please sign: ${data.documentTitle}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Document to sign</p></div>
        <div class="content">
          <h2>${escHtml(data.documentTitle)}</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>${escHtml(n)} has sent you a document to read and sign. You can open it in your care portal, read it in full, and sign it there.</p>
          <p style="text-align:center;margin:28px 0;">
            <a class="button" href="${escHtml(data.portalUrl)}">Open my care portal</a>
          </p>
          <p style="font-size:13px;color:#666;">If you would rather sign on paper, or you have questions about anything in the document, contact us before signing.</p>
        </div>
      </div></body></html>
    `,
      text: `${data.documentTitle}

Hi ${data.contactName},

${n} has sent you a document to read and sign. Open your care portal to read it in full and sign it:

${data.portalUrl}

If you would rather sign on paper, or have questions about anything in it, contact us before signing.`,
    }
  },

  homecarePortalInvite: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Your ${n} Care Portal Access`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Home Care Portal</p></div>
        <div class="content">
          <h2>Welcome to Your Care Portal</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>You now have access to your home care portal where you can view your care schedule, invoices, caregivers, and more.</p>
          <p style="text-align:center;"><a href="${escHtml(data.portalUrl)}" class="button">Access Your Portal</a></p>
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
        <div class="footer">${escHtml(n)} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
      text: `Hi ${data.contactName}, access your care portal for ${n}: ${data.portalUrl}`,
    }
  },

  // Client portal invite. One per person: the client and each relative get their own login, so the greeting is that
  // person and the portal is the client's.
  homecarePortalSetupInvite: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `You're invited to the ${n} Client Portal`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Client Portal</p></div>
        <div class="content">
          <p>Hello ${escHtml(data.contactName)},</p>
          <p>You've been invited to access ${data.clientName && data.clientName !== data.contactName ? `the care portal for <strong>${escHtml(data.clientName)}</strong>` : 'your personal care portal'}. From the portal, you can:</p>
          <ul style="padding-left:20px;">
            <li>View the upcoming visit schedule</li>
            <li>See the assigned caregivers</li>
            <li>Review invoices and billing</li>
            <li>Receive important notifications</li>
          </ul>
          <p style="text-align:center;"><a href="${escHtml(data.setupUrl)}" class="button">Set Up Your Account</a></p>
          <p><small>This link expires in 48 hours. If it has expired, please contact your care coordinator for a new invite.</small></p>
        </div>
        <div class="footer">${escHtml(n)} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
      text: `Hello ${data.contactName}, you've been invited to the ${n} Client Portal. Set up your account (link expires in 48 hours): ${data.setupUrl}`,
    }
  },

  // Self-service reset. Same /portal/setup page and token as an invite, reset wording.
  homecareClientPortalPasswordReset: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Reset your ${n} Client Portal password`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Client Portal</p></div>
        <div class="content">
          <p>Hello ${escHtml(data.contactName)},</p>
          <p>We received a request to reset your Client Portal password. Click the button below to choose a new password:</p>
          <p style="text-align:center;"><a href="${escHtml(data.resetUrl)}" class="button">Reset My Password</a></p>
          <p><small>This link expires in 1 hour. If you didn't request a password reset, you can safely ignore this email &mdash; your current password still works.</small></p>
        </div>
        <div class="footer">${escHtml(n)} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
      text: `Hello ${data.contactName}, reset your ${n} Client Portal password (link expires in 1 hour): ${data.resetUrl}`,
    }
  },

  // An administrator set a new family portal password; tell the relative what it is.
  homecareFamilyPasswordSetByAdmin: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `${n} Family Portal — Password Reset`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Family Care Portal</p></div>
        <div class="content">
          <p>Hello ${escHtml(data.familyName)},</p>
          <p>Your family portal password has been reset by an administrator.</p>
          <div class="highlight">
            <p style="margin:0;"><strong>Your new credentials:</strong></p>
            <p style="margin:4px 0 0;">Email: ${escHtml(data.email)}<br/>New Password: <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px;">${escHtml(data.newPassword)}</code></p>
          </div>
          <p style="text-align:center;"><a href="${escHtml(data.portalUrl)}" class="button">Sign In</a></p>
        </div>
        <div class="footer">${escHtml(n)} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
      text: `Hello ${data.familyName}, your ${n} family portal password has been reset by an administrator. Email: ${data.email} | New password: ${data.newPassword} | Sign in: ${data.portalUrl}`,
    }
  },

  homecareInvoiceEmail: (data, b, appUrl) => {
    const n = nameOf(data, b)
    const link = invoiceLink(data, appUrl)
    return {
      subject: `Invoice #${data.invoiceNumber} from ${n}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}
        table.inv { width: 100%; border-collapse: collapse; margin: 15px 0; }
        table.inv th, table.inv td { padding: 8px 12px; text-align: left; border-bottom: 1px solid #e5e7eb; font-size: 14px; }
        table.inv th { background: #f9fafb; font-weight: 600; }
      </style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Home Care Invoice</p></div>
        <div class="content">
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>Please find your invoice details below.</p>
          <div class="highlight">
            <p style="margin:0;"><strong>Invoice #${escHtml(data.invoiceNumber)}</strong></p>
            <p style="margin:4px 0 0;">Total: <strong>$${escHtml(data.total)}</strong></p>
            <p style="margin:4px 0 0;">Amount Due: <strong>$${escHtml(data.amountDue)}</strong></p>
            <p style="margin:4px 0 0;">Due Date: ${escHtml(data.dueDate)}</p>
          </div>
          ${data.lineItems ? `
          <table class="inv">
            <thead><tr><th>Date</th><th>Service</th><th>Hours</th><th>Amount</th></tr></thead>
            <tbody>${data.lineItems}</tbody>
          </table>` : ''}
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button">View and pay invoice</a></p><p style="font-size:13px;color:#6b7280;text-align:center;">The full invoice, and how to pay it, are at this link.</p>` : ''}
          <p><small>If you have questions about this invoice, please contact us.</small></p>
        </div>
        <div class="footer">
          ${escHtml(n)} &mdash; HIPAA-compliant care services<br>
          <small>This message may contain Protected Health Information (PHI). If you are not the intended recipient, please delete this email and notify the sender immediately.</small>
        </div>
      </div></body></html>
    `,
      text: `Hi ${data.contactName}, Invoice #${data.invoiceNumber} for $${data.amountDue} is due ${data.dueDate}. ${link ? `View and pay: ${link}` : ''}`,
    }
  },

  // Payment reminder (CVHC sendInvoiceReminder): "due soon" before the due date, "N days past due" after it.
  homecareInvoiceReminder: (data, b, appUrl) => {
    const n = nameOf(data, b)
    const link = invoiceLink(data, appUrl)
    const overdue = Number(data.daysOverdue) > 0
    const headline = overdue
      ? `Your payment is ${data.daysOverdue} day${Number(data.daysOverdue) === 1 ? '' : 's'} past due`
      : 'Friendly reminder: your invoice is due soon'
    return {
      subject: overdue
        ? `Payment Reminder — Invoice #${data.invoiceNumber} ($${data.amountDue} past due)`
        : `Payment Reminder — Invoice #${data.invoiceNumber} ($${data.amountDue} due ${data.dueDate})`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1></div>
        <div class="content">
          <p>Hello ${escHtml(data.contactName)},</p>
          <div class="highlight"><p style="margin:0;"><strong>${escHtml(headline)}</strong></p></div>
          <p>This is a reminder that invoice <strong>#${escHtml(data.invoiceNumber)}</strong> for
            <strong>$${escHtml(data.amountDue)}</strong> is ${overdue ? 'past due' : `due on ${escHtml(data.dueDate)}`}.</p>
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button">View and pay — $${escHtml(data.amountDue)}</a></p>` : ''}
          <p><small>If you've already paid, thank you — please disregard this notice. Otherwise, please contact our office with any questions or to set up a payment plan.</small></p>
        </div>
        <div class="footer">${escHtml(n)}</div>
      </div></body></html>
    `,
      text: `Hello ${data.contactName}, ${headline}. Invoice #${data.invoiceNumber} for $${data.amountDue}. ${link ? `View and pay: ${link}` : ''}`,
    }
  },

  // Autopay (care_autopay): the card on file was not charged. Plain words, what happens next, and how to pay another way.
  homecareAutopayFailed: (data, b, appUrl) => {
    const n = nameOf(data, b)
    const link = invoiceLink(data, appUrl)
    const next = data.retryOn ? `We will try the card again on ${data.retryOn}.` : 'We will not try this card again.'
    return {
      subject: `We could not take your card payment — Invoice #${data.invoiceNumber}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1></div>
        <div class="content">
          <p>Hello ${escHtml(data.contactName)},</p>
          <div class="highlight"><p style="margin:0;"><strong>Your automatic payment of $${escHtml(data.amountDue)} for invoice #${escHtml(data.invoiceNumber)} did not go through.</strong></p></div>
          <p>The reason: ${escHtml(data.reason)}.</p>
          <p>${escHtml(next)} You can also pay now, with this or another card.</p>
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button">Pay $${escHtml(data.amountDue)} now</a></p>` : ''}
          <p><small>If you have already paid, thank you — please disregard this notice. Questions? Contact our office.</small></p>
        </div>
        <div class="footer">${escHtml(n)}</div>
      </div></body></html>
    `,
      text: `Hello ${data.contactName}, your automatic payment of $${data.amountDue} for invoice #${data.invoiceNumber} did not go through. The reason: ${data.reason}. ${next} ${link ? `Pay now: ${link}` : 'Please contact our office to pay another way.'}`,
    }
  },

  homecareFamilyPortalWelcome: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Welcome to ${n} Family Portal`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Family Care Portal</p></div>
        <div class="content">
          <h2>Welcome, ${escHtml(data.familyName)}!</h2>
          <p>You've been given access to the family portal for <strong>${escHtml(data.clientName)}</strong>.</p>
          <div class="highlight">
            <p><strong>Your Login:</strong></p>
            <p style="margin:4px 0;">Email: ${escHtml(data.email)}</p>
            <p style="margin:4px 0;">Temporary Password: <code style="background:#e5e7eb;padding:2px 6px;border-radius:3px;">${escHtml(data.tempPassword)}</code></p>
          </div>
          <p style="text-align:center;"><a href="${escHtml(data.portalUrl)}" class="button">Log In to Portal</a></p>
          <p><small>Please change your password after your first login. This link is confidential.</small></p>
        </div>
        <div class="footer">
          ${escHtml(n)} &mdash; HIPAA-compliant care portal<br>
          <small>This message may contain Protected Health Information (PHI). If you are not the intended recipient, please delete this email and notify the sender immediately.</small>
        </div>
      </div></body></html>
    `,
      text: `Welcome ${data.familyName}! Log in to the ${n} family portal for ${data.clientName}: ${data.portalUrl} | Email: ${data.email} | Temp password: ${data.tempPassword}`,
    }
  },

  homecareFamilyPasswordReset: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Password Reset - ${n} Family Portal`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Family Care Portal</p></div>
        <div class="content">
          <h2>Password Reset</h2>
          <p>Hi ${escHtml(data.familyName)},</p>
          <p>We received a request to reset your family portal password. Click below to set a new password.</p>
          <p style="text-align:center;"><a href="${escHtml(data.resetUrl)}" class="button">Reset Password</a></p>
          <p><small>This link expires in 1 hour. If you did not request this, you can safely ignore it.</small></p>
        </div>
        <div class="footer">${escHtml(n)} &mdash; HIPAA-compliant care portal</div>
      </div></body></html>
    `,
      text: `Hi ${data.familyName}, reset your ${n} family portal password: ${data.resetUrl}`,
    }
  },

  homecarePasswordReset: (data, b) => {
    const n = nameOf(data, b)
    return {
      subject: `Password Reset - ${n}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(n)}</h1><p style="margin:4px 0 0;opacity:0.9;">Password Reset</p></div>
        <div class="content">
          <h2>Reset Your Password</h2>
          <p>Hi ${escHtml(data.userName)},</p>
          <p>We received a request to reset your password. Click below to set a new one.</p>
          <p style="text-align:center;"><a href="${escHtml(data.resetUrl)}" class="button">Reset Password</a></p>
          <p><small>This link expires in 1 hour. If you did not request this, you can safely ignore it.</small></p>
        </div>
        <div class="footer">${escHtml(n)}</div>
      </div></body></html>
    `,
      text: `Hi ${data.userName}, reset your ${n} password: ${data.resetUrl}`,
    }
  },
}

/** The template's own names → the registered ones (callers moving from `send(to, 'portalInvite', …)`). */
export const HOMECARE_TEMPLATE_NAMES: Record<string, string> = {
  documentSignatureRequest: 'homecareDocumentSignatureRequest',
  portalInvite: 'homecarePortalInvite',
  portalSetupInvite: 'homecarePortalSetupInvite',
  clientPortalPasswordReset: 'homecareClientPortalPasswordReset',
  familyPasswordSetByAdmin: 'homecareFamilyPasswordSetByAdmin',
  invoiceEmail: 'homecareInvoiceEmail',
  invoiceReminder: 'homecareInvoiceReminder',
  autopayFailed: 'homecareAutopayFailed',
  familyPortalWelcome: 'homecareFamilyPortalWelcome',
  familyPasswordReset: 'homecareFamilyPasswordReset',
  passwordReset: 'homecarePasswordReset',
}

/**
 * Home care's email API (the template's `emailService`) on the app's email service. `send` takes the template's own
 * name or the registered one. Requires homecareTemplates to be registered (core/index.ts does it once).
 */
export function homecareEmail(email: Pick<EmailService, 'send' | 'sendRaw' | 'provider'>) {
  const send = (to: string, templateName: string, data: Record<string, unknown>) =>
    email.send(to, HOMECARE_TEMPLATE_NAMES[templateName] ?? templateName, data)
  const named = (name: string) => (to: string, data: Record<string, unknown>) => send(to, name, data)
  return {
    send,
    sendRaw: email.sendRaw,
    PROVIDER: email.provider,
    isConfigured: email.provider !== 'console',
    sendPortalInvite: named('portalInvite'),
    sendDocumentSignatureRequest: named('documentSignatureRequest'),
    sendPortalSetupInvite: named('portalSetupInvite'),
    sendInvoiceEmail: named('invoiceEmail'),
    sendInvoiceReminder: named('invoiceReminder'),
    sendAutopayFailed: named('autopayFailed'),
    sendFamilyPortalWelcome: named('familyPortalWelcome'),
    sendFamilyPasswordReset: named('familyPasswordReset'),
    sendFamilyPasswordSetByAdmin: named('familyPasswordSetByAdmin'),
    sendClientPortalPasswordReset: named('clientPortalPasswordReset'),
    sendPasswordReset: named('passwordReset'),
  }
}

export type HomecareEmail = ReturnType<typeof homecareEmail>
