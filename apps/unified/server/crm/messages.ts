// The CRM's email messages (invoices, quotes, payments, jobs, the daily digest, the customer portal, stock and
// service-agreement notices), moved from templates/crm/backend/src/services/email.ts. The company's name and colour
// come from the brand the email service reads when it sends (core/email.ts), not from build placeholders; the links
// from the app's address. Registered once when the CRM module is built.
import { baseStyles, escHtml, type Template, type EmailService } from '../core/email.ts'

/**
 * Where an invoice's button goes: a payment link a caller made (home care's), else the invoice's own private link
 * (/d/<token>, packages/tenant-backend portal/documentLinks.ts) — where the customer sees it and pays it, or is told how
 * to pay. The invoice email carried no link at all unless a caller passed a payment link (live, 2026-10-22).
 */
const invoiceLink = (data: any, appUrl: string): string =>
  data.paymentLink ? String(data.paymentLink) : data.documentPath ? appUrl + String(data.documentPath) : ''

export const crmTemplates: Record<string, Template> = {
  /** A reply typed by the business (Settings › Inbox): its subject and words as written. */
  raw: (data) => ({
    subject: String(data.subject ?? ''),
    html: data.html || '<pre style="font-family:inherit;white-space:pre-wrap;margin:0">' + escHtml(data.text) + '</pre>',
    text: String(data.text ?? ''),
  }),

  welcome: (data, b, appUrl) => ({
    subject: `Welcome to ${b.companyName}!`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">Welcome to ${escHtml(b.companyName)}!</h1></div>
        <div class="content">
          <h2>Hi ${data.firstName},</h2>
          <p>Your account for <strong>${data.companyName}</strong> is ready.</p>
          <p style="text-align:center;"><a href="${appUrl}/login" class="button">Get Started</a></p>
          <p>Here's what you can do:</p>
          <ul>
            <li>Manage projects and jobs</li>
            <li>Track contacts and clients</li>
            <li>Create quotes and invoices</li>
            <li>Daily logs and inspections</li>
          </ul>
        </div>
        <div class="footer">&copy; ${new Date().getFullYear()} ${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Welcome ${data.firstName}! Your account for ${data.companyName} is ready. Login: ${appUrl}/login`,
  }),

  // Consumer financing's application link (server/crm/financing/service.ts send), with the lender's required disclosure.
  financingApplication: (data, b) => ({
    subject: `Pay over time: apply for financing with ${data.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(data.companyName)}</h1></div>
        <div class="content">
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>You can apply to pay for your ${escHtml(data.amount)} job over time with ${escHtml(data.lender)}. Checking your options won't affect your credit score.</p>
          <p style="text-align:center;"><a href="${escHtml(data.url)}" class="button">Apply with ${escHtml(data.lender)}</a></p>
          <p style="font-size:12px;color:#6b7280;">${escHtml(data.disclosure)}</p>
        </div>
        <div class="footer">${escHtml(data.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName},

You can apply to pay for your ${data.amount} job over time with ${data.lender}. Checking your options won't affect your credit score.

Apply: ${data.url}

${data.disclosure}`,
  }),

  invoiceSent: (data, b, appUrl) => { const link = invoiceLink(data, appUrl); return {
    subject: `Invoice ${data.invoiceNumber} from ${data.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1></div>
        <div class="content">
          <h2>Invoice ${data.invoiceNumber}</h2>
          <p>Hi ${data.contactName},</p>
          <div class="amount">$${Number(data.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <div class="highlight">
            <p><strong>Invoice #:</strong> ${data.invoiceNumber}</p>
            <p><strong>Due Date:</strong> ${data.dueDate}</p>
            <p><strong>Balance:</strong> $${Number(data.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button">View and pay invoice</a></p><p style="font-size:13px;color:#6b7280;text-align:center;">The full invoice, and how to pay it, are at this link.</p>` : ''}
        </div>
        <div class="footer">${data.companyName}<br>${data.companyEmail || ''}</div>
      </div></body></html>
    `,
    text: `Invoice ${data.invoiceNumber} from ${data.companyName}\n\nAmount: $${data.total}\nDue: ${data.dueDate}${link ? `\n\nView and pay: ${link}` : ''}`,
  } },

  invoiceReminder: (data, b, appUrl) => { const link = invoiceLink(data, appUrl); return {
    subject: `Reminder: Invoice ${data.invoiceNumber} due ${data.dueDate}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1></div>
        <div class="content">
          <h2>Payment Reminder</h2>
          <p>Hi ${data.contactName},</p>
          <p>This is a friendly reminder that invoice ${data.invoiceNumber} is due on <strong>${data.dueDate}</strong>.</p>
          <div class="amount">$${Number(data.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button">View and pay invoice</a></p>` : ''}
        </div>
        <div class="footer">${data.companyName}</div>
      </div></body></html>
    `,
    text: `Reminder: Invoice ${data.invoiceNumber} for $${data.balance} is due ${data.dueDate}.${link ? ` View and pay: ${link}` : ''}`,
  } },

  invoiceOverdue: (data, b, appUrl) => { const link = invoiceLink(data, appUrl); return {
    subject: `Overdue: Invoice ${data.invoiceNumber} - ${data.daysOverdue} days past due`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header" style="background:#dc2626;"><h1 style="margin:0;">Payment Overdue</h1></div>
        <div class="content">
          <p>Hi ${data.contactName},</p>
          <p>Invoice ${data.invoiceNumber} is <strong>${data.daysOverdue} days overdue</strong>.</p>
          <div class="amount" style="color:#dc2626;">$${Number(data.balance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</div>
          <p>Please remit payment as soon as possible.</p>
          ${link ? `<p style="text-align:center;"><a href="${escHtml(link)}" class="button" style="background:#dc2626;">View and pay invoice</a></p>` : ''}
        </div>
        <div class="footer">${data.companyName}</div>
      </div></body></html>
    `,
    text: `OVERDUE: Invoice ${data.invoiceNumber} is ${data.daysOverdue} days past due. Balance: $${data.balance}${link ? `\nView and pay: ${link}` : ''}`,
  } },

  paymentReceived: (data, b, appUrl) => ({
    subject: `Payment received - Invoice ${data.invoiceNumber}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header" style="background:#16a34a;"><h1 style="margin:0;">Payment Received</h1></div>
        <div class="content">
          <p>Hi ${data.contactName},</p>
          <p>Thank you! We received your payment.</p>
          <div class="highlight">
            <p><strong>Amount:</strong> $${Number(data.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
            <p><strong>Invoice:</strong> ${data.invoiceNumber}</p>
            <p><strong>Remaining Balance:</strong> $${Number(data.remainingBalance).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
        </div>
        <div class="footer">${data.companyName}</div>
      </div></body></html>
    `,
    text: `Payment of $${data.amount} received for invoice ${data.invoiceNumber}. Remaining: $${data.remainingBalance}`,
  }),

  /**
   * The receipt for a paid sale at the salon (salon parity row 11): what was bought, what was paid, the tip so far, and — when the salon allows
   * it — a button to add a tip afterwards (data.tipPath, the sale's private tip page). Everything typed by a person is escaped.
   */
  saleReceipt: (data, b, appUrl) => {
    const m = (v: unknown) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const lines = (Array.isArray(data.lines) ? data.lines : []) as Array<{ description: string; total: number }>
    const link = data.tipPath ? appUrl + String(data.tipPath) : ''
    const rows = lines.map((l) => `<tr><td>${escHtml(l.description)}</td><td style="text-align:right;">${m(l.total)}</td></tr>`).join('')
    return {
      subject: `Your receipt from ${b.companyName} - ${data.invoiceNumber}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">Receipt</h1></div>
        <div class="content">
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>Thank you for visiting ${escHtml(b.companyName)}.</p>
          <table style="width:100%;border-collapse:collapse;">${rows}
            <tr><td><strong>Total</strong></td><td style="text-align:right;"><strong>${m(data.total)}</strong></td></tr>
            ${Number(data.tip) > 0 ? `<tr><td>Tip</td><td style="text-align:right;">${m(data.tip)}</td></tr>` : ''}
          </table>
          <p>Invoice ${escHtml(data.invoiceNumber)}</p>
          ${link ? `<p>Want to leave a tip for the team? <a href="${escHtml(link)}" style="display:inline-block;padding:10px 18px;background:#0f766e;color:#fff;border-radius:8px;text-decoration:none;">Add a tip</a></p>` : ''}
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>`,
      text: `Receipt ${data.invoiceNumber} from ${b.companyName}\n${lines.map((l) => `${l.description}: ${m(l.total)}`).join('\n')}\nTotal: ${m(data.total)}${Number(data.tip) > 0 ? `\nTip: ${m(data.tip)}` : ''}${link ? `\n\nAdd a tip for the team: ${link}` : ''}`,
    }
  },

  /**
   * The quote, as the customer receives it. (E2E run 1, 10/14: it arrived as "Quote from …: undefined", with no
   * number, no lines and no way to approve.) Everything here was typed by a person — escaped. The internal cost of a
   * line is never passed in. The button opens the quote's own private link (data.documentPath, /d/<token>), where the
   * customer approves or declines it — every quote, portal or not (2026-10-22: it went only to customers whose client
   * portal was on, so everyone else had no way to accept). Without a link (a caller that made none) they are told how.
   */

  quoteSent: (data, b, appUrl) => {
    const money = (v: unknown) => '$' + Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    const title = data.quoteName ? escHtml(data.quoteName) : 'Your quote'
    const lines = Array.isArray(data.lineItems) ? (data.lineItems as any[]) : []
    const rows = lines.map((l) => `<tr><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;">${escHtml(l.description)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${escHtml(Number(l.quantity || 0))}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(l.unitPrice)}</td><td style="padding:6px 8px;border-bottom:1px solid #e5e7eb;text-align:right;">${money(l.total)}</td></tr>`).join('')
    const discount = Number(data.discount || 0), tax = Number(data.taxAmount || 0)
    const approveUrl = data.documentPath ? appUrl + data.documentPath : ''
    const howToAccept = data.companyPhone
      ? `To accept, reply to this email or call us on ${escHtml(data.companyPhone)}.`
      : 'To accept, reply to this email.'
    return {
      subject: `Quote ${data.quoteNumber} from ${data.companyName}${data.quoteName ? ': ' + data.quoteName : ''}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(data.companyName)}</h1></div>
        <div class="content">
          <h2 style="margin-bottom:4px;">${title}</h2>
          <p style="margin-top:0;color:#6b7280;">Quote ${escHtml(data.quoteNumber)}</p>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>Thank you for the opportunity to provide this quote.</p>
          ${rows ? `<table style="width:100%;border-collapse:collapse;font-size:14px;margin:16px 0;">
            <tr style="background:#f3f4f6;"><th style="padding:6px 8px;text-align:left;">Item</th><th style="padding:6px 8px;text-align:right;">Qty</th><th style="padding:6px 8px;text-align:right;">Price</th><th style="padding:6px 8px;text-align:right;">Total</th></tr>
            ${rows}
          </table>` : ''}
          <table style="width:100%;font-size:14px;margin:8px 0 16px;">
            ${data.subtotal != null ? `<tr><td style="text-align:right;padding:2px 8px;">Subtotal</td><td style="text-align:right;width:120px;">${money(data.subtotal)}</td></tr>` : ''}
            ${discount ? `<tr><td style="text-align:right;padding:2px 8px;">Discount</td><td style="text-align:right;">−${money(discount)}</td></tr>` : ''}
            ${tax ? `<tr><td style="text-align:right;padding:2px 8px;">Tax${data.taxRate ? ' (' + escHtml(Number(data.taxRate)) + '%)' : ''}</td><td style="text-align:right;">${money(tax)}</td></tr>` : ''}
            <tr><td style="text-align:right;padding:6px 8px;font-weight:700;">Total</td><td style="text-align:right;font-weight:700;">${money(data.total)}</td></tr>
          </table>
          ${data.expiryDate ? `<p><strong>Valid until:</strong> ${escHtml(data.expiryDate)}</p>` : ''}
          ${approveUrl
            ? `<p style="text-align:center;"><a href="${escHtml(approveUrl)}" class="button">Review and approve</a></p><p style="font-size:13px;color:#6b7280;text-align:center;">You can approve or decline it at this link.</p>`
            : `<p>${howToAccept}</p>`}
        </div>
        <div class="footer">${escHtml(data.companyName)}</div>
      </div></body></html>
    `,
      text: `Quote ${data.quoteNumber} from ${data.companyName}${data.quoteName ? ': ' + data.quoteName : ''}\n\n`
        + lines.map((l) => `${l.description} — ${Number(l.quantity || 0)} × ${money(l.unitPrice)} = ${money(l.total)}`).join('\n')
        + `\n\nTotal: ${money(data.total)}${data.expiryDate ? '\nValid until: ' + data.expiryDate : ''}\n\n`
        + (approveUrl ? `Review and approve: ${approveUrl}` : howToAccept),
    }
  },

  quoteApproved: (data, b, appUrl) => ({
    subject: `Quote ${data.quoteNumber} has been approved!`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header" style="background:#16a34a;"><h1 style="margin:0;">Quote Approved!</h1></div>
        <div class="content">
          <p>${data.contactName} has approved quote <strong>${data.quoteNumber}</strong>.</p>
          <div class="highlight">
            <p><strong>Project:</strong> ${data.projectName || 'N/A'}</p>
            <p><strong>Amount:</strong> $${Number(data.total).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </div>
          <p style="text-align:center;"><a href="${appUrl}/quotes/${data.quoteId}" class="button">View Quote</a></p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Quote ${data.quoteNumber} approved by ${data.contactName}. Amount: $${data.total}`,
  }),

  jobAssigned: (data, b, appUrl) => ({
    subject: `New job assigned: ${data.jobTitle}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">Job Assigned</h1></div>
        <div class="content">
          <h2>${data.jobTitle}</h2>
          <p>Hi ${data.assigneeName},</p>
          <p>You've been assigned a new job.</p>
          <div class="highlight">
            <p><strong>Job #:</strong> ${data.jobNumber}</p>
            <p><strong>Scheduled:</strong> ${data.scheduledDate}</p>
            <p><strong>Location:</strong> ${data.address || 'See job details'}</p>
            ${data.description ? `<p><strong>Notes:</strong> ${data.description}</p>` : ''}
          </div>
          <p style="text-align:center;"><a href="${appUrl}/jobs/${data.jobId}" class="button">View Job</a></p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `New job assigned: ${data.jobTitle}\n\nJob #: ${data.jobNumber}\nScheduled: ${data.scheduledDate}\nLocation: ${data.address || 'See details'}`,
  }),

  jobStatusChanged: (data, b, appUrl) => ({
    subject: `Job ${data.jobNumber} is now ${data.newStatus}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">Job Update</h1></div>
        <div class="content">
          <h2>${data.jobTitle}</h2>
          <p>Job status has been updated.</p>
          <div class="highlight">
            <p><strong>Status:</strong> ${data.oldStatus} -> <strong>${data.newStatus}</strong></p>
            ${data.updatedBy ? `<p><strong>Updated by:</strong> ${data.updatedBy}</p>` : ''}
          </div>
          <p style="text-align:center;"><a href="${appUrl}/jobs/${data.jobId}" class="button">View Job</a></p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Job ${data.jobNumber} status changed: ${data.oldStatus} -> ${data.newStatus}`,
  }),

  dailyDigest: (data, b, appUrl) => ({
    subject: `Daily Summary - ${data.date}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">Daily Summary</h1></div>
        <div class="content">
          <p>Hi ${data.userName},</p>
          <p>Here's your summary for ${data.date}:</p>
          <div class="highlight">
            <p><strong>Jobs Today:</strong> ${data.jobsToday || 0}</p>
            <p><strong>Overdue Invoices:</strong> ${data.overdueInvoices || 0}</p>
            <p><strong>Pending Quotes:</strong> ${data.pendingQuotes || 0}</p>
            <p><strong>New Leads:</strong> ${data.newLeads || 0}</p>
          </div>
          ${data.upcomingJobs?.length ? `
            <h3>Upcoming Jobs</h3>
            <ul>${data.upcomingJobs.map((j: any) => `<li>${j.title} - ${j.date}</li>`).join('')}</ul>
          ` : ''}
          <p style="text-align:center;"><a href="${appUrl}" class="button">Open Dashboard</a></p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Daily Summary for ${data.date}\n\nJobs: ${data.jobsToday}\nOverdue Invoices: ${data.overdueInvoices}\nPending Quotes: ${data.pendingQuotes}`,
  }),

  portalInvite: (data, b, appUrl) => {
    const role = (data.role || 'client').toLowerCase()
    const isSub = role === 'subcontractor' || role === 'vendor' || role === 'supplier'
    const isArchitect = role === 'architect' || role === 'consultant' || role === 'inspector'
    const portalLabel = isSub
      ? 'Subcontractor Portal'
      : isArchitect
        ? `${role.charAt(0).toUpperCase()}${role.slice(1)} Portal`
        : 'Customer Portal'
    const headline = isSub
      ? 'Your Subcontractor Portal'
      : isArchitect
        ? 'Your Collaborator Portal'
        : 'Your Customer Portal'
    const intro = isSub
      ? 'View your assigned jobs, sign lien waivers, and download shared documents.'
      : isArchitect
        ? 'Review submittals, respond to RFIs, and access project documents.'
        : 'You can now view your projects, quotes, and invoices online.'
    const bullets = isSub
      ? ['View jobs assigned to you', 'Sign lien waivers', 'Download shared documents', 'Message the project team']
      : isArchitect
        ? ['Respond to RFIs assigned to you', 'Approve or request revisions on submittals', 'Review change orders', 'Access shared project documents']
        : ['View project progress', 'Review and approve quotes', 'View and download invoices', 'Track payment history']

    return {
      subject: `${portalLabel}: ${data.companyName}`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1></div>
        <div class="content">
          <h2>${headline}</h2>
          <p>Hi ${data.contactName},</p>
          <p>${intro}</p>
          <p style="text-align:center;"><a href="${data.portalUrl}" class="button">Access Your Portal</a></p>
          <div class="highlight">
            <p>With your portal you can:</p>
            <ul style="margin:0;padding-left:20px;">
              ${bullets.map((b) => `<li>${b}</li>`).join('')}
            </ul>
          </div>
          <p><small>This link is unique to you. Do not share it with others.</small></p>
        </div>
        <div class="footer">${data.companyName}</div>
      </div></body></html>
    `,
      text: `Hi ${data.contactName}, access your ${portalLabel.toLowerCase()} for ${data.companyName}: ${data.portalUrl}`,
    }
  },

  collaboratorAction: (data, b, appUrl) => ({
    subject: `${data.actorName} ${data.summary.toLowerCase().startsWith(data.actorName.toLowerCase()) ? '' : '— '}${data.summary}`.slice(0, 120),
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1></div>
        <div class="content">
          <h2>Collaborator Activity</h2>
          <p>${data.adminName ? `Hi ${data.adminName},` : 'Hi,'}</p>
          <p><strong>${data.actorName}</strong> (${data.actorRole}) ${data.summary}${data.projectName ? ` on project <strong>${data.projectName}</strong>` : ''}.</p>
          <p style="text-align:center;"><a href="${appUrl}/crm" class="button">Open CRM</a></p>
        </div>
        <div class="footer">&copy; ${new Date().getFullYear()} ${data.companyName}</div>
      </div></body></html>
    `,
    text: `${data.actorName} (${data.actorRole}) ${data.summary}${data.projectName ? ` on ${data.projectName}` : ''}.`,
  }),

  // The daily low-stock email (crm/lowStockDigest.ts, inventory/lowStock.ts): everything at or under its reorder point, once a day.
  inventoryLowStockDigest: (data, b, appUrl) => {
    const items: Array<{ name: string; sku: string; unit: string; quantity: number; reorderPoint: number }> = data.items || []
    const left = (i: { quantity: number }) => i.quantity <= 0 ? 'none left' : `${i.quantity} left`
    return {
      subject: items.length === 1 ? `Low stock: ${items[0].name}` : `Low stock: ${items.length} items to reorder`,
      html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>${items.length === 1 ? 'One item is' : `${items.length} items are`} running low</h2>
          <p>These are at or below the reorder point you set, fewest left first. You get this once a day, and not on a day when nothing is low.</p>
          <ul style="line-height:1.7;padding-left:18px;">${items.map((i) => `<li><strong>${escHtml(i.name)}</strong> (${escHtml(i.sku)}): <strong>${left(i)}</strong>, reorder at ${i.reorderPoint}</li>`).join('')}</ul>
          <p style="text-align:center;"><a href="${appUrl}/crm/inventory" class="button">View Inventory</a></p>
        </div>
        <div class="footer">&copy; ${new Date().getFullYear()} ${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
      text: `${items.length === 1 ? 'One item is' : `${items.length} items are`} running low (reorder point in brackets):\n${items.map((i) => `- ${i.name} (${i.sku}): ${left(i)} (${i.reorderPoint})`).join('\n')}\nView inventory at ${appUrl}/crm/inventory`,
    }
  },

  // Sent before an auto-renew service agreement renews (the agreements worker, 30 days ahead for yearly terms,
  // 14 for 3–11 months; month-to-month agreements get none). Says what renews, when, for how much, and how to cancel.
  agreementRenewalNotice: (data, b, appUrl) => ({
    subject: `Your ${data.agreementName} renews on ${data.renewalDate}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${data.companyName}</h1></div>
        <div class="content">
          <h2>Your agreement renews soon</h2>
          <p>Hi ${data.contactName},</p>
          <p>Your <strong>${data.agreementName}</strong> (${data.agreementNumber}) is set to renew automatically on <strong>${data.renewalDate}</strong> for another term, through ${data.newEndDate}.</p>
          <div class="highlight">
            <p style="margin:0;"><strong>Amount:</strong> $${Number(data.amount).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${data.billingFrequency}</p>
          </div>
          <p>No action is needed to keep your service. If you don't want it to renew, reply to this email or contact us${data.companyPhone ? ` at ${data.companyPhone}` : ''}${data.companyEmail ? `${data.companyPhone ? ' or' : ' at'} ${data.companyEmail}` : ''} before ${data.renewalDate}.</p>
        </div>
        <div class="footer">${data.companyName}<br>${data.companyEmail || ''}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, your ${data.agreementName} (${data.agreementNumber}) renews automatically on ${data.renewalDate} through ${data.newEndDate} at $${data.amount} ${data.billingFrequency}. To cancel, reply to this email or contact ${data.companyName}${data.companyPhone ? ` at ${data.companyPhone}` : ''} before ${data.renewalDate}.`,
  }),

  // The private-events module's notes to a client (server/crm/restaurant): a line, one button, the venue's name.
  // data: { companyName, contactName, headline, body, button, path } — path is the link's address on this app.
  eventNote: (data, b, appUrl) => ({
    subject: String(data.subject ?? data.headline ?? ''),
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(data.companyName)}</h1></div>
        <div class="content">
          <p>Hi ${escHtml(data.contactName)},</p>
          <p><strong>${escHtml(data.headline)}</strong></p>
          <p style="white-space:pre-wrap;">${escHtml(data.body)}</p>
          ${data.path ? `<p style="text-align:center;"><a href="${appUrl}${escHtml(data.path)}" class="button">${escHtml(data.button || 'Open')}</a></p>` : ''}
        </div>
        <div class="footer">${escHtml(data.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, ${data.headline}\n\n${data.body}${data.path ? `\n\n${appUrl}${data.path}` : ''}`,
  }),
  // The reminder before a job the office booked (crm/field/jobReminders.ts). Every value is typed by staff, so each is escaped.
  jobReminder: (data, b) => ({
    subject: `Reminder: ${data.jobTitle || 'your visit'} on ${data.when}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(data.companyName)}</h1></div>
        <div class="content">
          <h2>Your upcoming visit</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>This is a reminder of your visit with ${escHtml(data.companyName)}.</p>
          <div class="highlight">
            <p><strong>What:</strong> ${escHtml(data.jobTitle)}</p>
            <p><strong>When:</strong> ${escHtml(data.when)}</p>
            ${data.address ? `<p><strong>Where:</strong> ${escHtml(data.address)}</p>` : ''}
            ${data.techName ? `<p><strong>Who:</strong> ${escHtml(data.techName)}</p>` : ''}
          </div>
          <p>If you need to change the time, reply to this email or call us.</p>
        </div>
        <div class="footer">${escHtml(data.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, a reminder of your visit with ${data.companyName}: ${data.jobTitle} on ${data.when}${data.address ? ` at ${data.address}` : ''}. If you need to change the time, reply to this email or call us.`,
  }),
  // The receipt for a no-show or late-cancellation fee charged to the card a client keeps on file (salon/cardOnFile.ts).
  cardFeeReceipt: (data, b) => ({
    subject: `Receipt: ${data.label} — ${b.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>Receipt</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>We charged a ${escHtml(String(data.label).toLowerCase())} of <strong>$${escHtml(data.amount)}</strong> to your ${escHtml(data.card)} for your appointment on ${escHtml(data.when)}.</p>
          <div class="highlight"><p style="margin:0;"><strong>Why:</strong> ${escHtml(data.reason)}</p></div>
          <p>If you think this is a mistake, please reply to this email or contact us and we will look into it.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, we charged a ${String(data.label).toLowerCase()} of $${data.amount} to your ${data.card} for your appointment on ${data.when}. Why: ${data.reason}. If you think this is a mistake, reply to this email or contact ${b.companyName}.`,
  }),
  // A membership period charged to the client's card on file (salon/membershipBilling.ts).
  membershipCharged: (data, b) => ({
    subject: `Receipt: ${data.plan} — ${b.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>Receipt</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>We charged <strong>$${escHtml(data.amount)}</strong> to your ${escHtml(data.card)} for your ${escHtml(data.plan)} membership (invoice ${escHtml(data.invoiceNumber)}).</p>
          <p>If you think this is a mistake, please reply to this email or contact us and we will look into it.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, we charged $${data.amount} to your ${data.card} for your ${data.plan} membership (invoice ${data.invoiceNumber}). If you think this is a mistake, reply to this email or contact ${b.companyName}.`,
  }),
  // The membership was paused because the card was declined on every try: a private link to give a new card.
  membershipPaused: (data, b) => ({
    subject: `Your membership is paused — ${b.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>Your membership is paused</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>We could not charge <strong>$${escHtml(data.amount)}</strong> to your ${escHtml(data.card)} for your ${escHtml(data.plan)} membership (invoice ${escHtml(data.invoiceNumber)}), so it is paused and visits cannot be taken from it until it is paid.</p>
          <p style="text-align:center;margin:24px 0;"><a href="${escHtml(data.link)}" style="background:#0f766e;color:#fff;padding:12px 24px;border-radius:6px;text-decoration:none;">Update my card</a></p>
          <p>Once a new card is saved we will charge the invoice and your membership starts again.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, we could not charge $${data.amount} to your ${data.card} for your ${data.plan} membership (invoice ${data.invoiceNumber}), so it is paused. Update your card here: ${data.link} — once it is saved we will charge the invoice and your membership starts again.`,
  }),
  // To the salon: a member's membership was paused for a declined card.
  membershipPausedSalon: (data, b) => ({
    subject: `Membership paused for a declined card — ${data.clientName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>A membership was paused</h2>
          <p>${escHtml(data.clientName)}'s ${escHtml(data.plan)} membership was paused after their card was declined on every try (invoice ${escHtml(data.invoiceNumber)}, $${escHtml(data.amount)}). They have been emailed a link to give a new card. Their visits are not taken from the membership until it is resumed.</p>
          <p>Open Memberships to resume it once it is sorted out.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `${data.clientName}'s ${data.plan} membership was paused after their card was declined on every try (invoice ${data.invoiceNumber}, $${data.amount}). They have been emailed a link to give a new card. Resume it in Memberships once it is sorted out.`,
  }),
  // To staff who hold the payments permission: a member's card was declined (every decline, not only the last).
  membershipDeclinedStaff: (data, b) => ({
    subject: `Card declined — ${data.clientName}'s ${data.plan} membership (try ${data.attempt} of ${data.tries})`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>A membership card was declined</h2>
          <p>${escHtml(data.clientName)}'s card was declined for <strong>$${escHtml(data.amount)}</strong> (${escHtml(data.plan)} membership, invoice ${escHtml(data.invoiceNumber)}). This was try ${escHtml(data.attempt)} of ${escHtml(data.tries)}.</p>
          <p>${escHtml(data.reason)} ${escHtml(data.backup)}</p>
          <div class="highlight"><p style="margin:0;">${escHtml(data.next)}</p></div>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `${data.clientName}'s card was declined for $${data.amount} (${data.plan} membership, invoice ${data.invoiceNumber}), try ${data.attempt} of ${data.tries}. ${data.reason} ${data.backup} ${data.next}`,
  }),
  // A membership charge that did not go through: what happened, and what happens next.
  membershipPaymentFailed: (data, b) => ({
    subject: `We could not charge your card — ${b.companyName}`,
    html: `
      <!DOCTYPE html><html><head><style>${baseStyles(b)}</style></head>
      <body><div class="container">
        <div class="header"><h1 style="margin:0;">${escHtml(b.companyName)}</h1></div>
        <div class="content">
          <h2>Your membership payment</h2>
          <p>Hi ${escHtml(data.contactName)},</p>
          <p>We tried to charge <strong>$${escHtml(data.amount)}</strong> to your ${escHtml(data.card)} for your ${escHtml(data.plan)} membership (invoice ${escHtml(data.invoiceNumber)}), but it did not go through.</p>
          <div class="highlight"><p style="margin:0;">${escHtml(data.next)}</p></div>
          <p>Please get in touch with us and we will sort it out.</p>
        </div>
        <div class="footer">${escHtml(b.companyName)}</div>
      </div></body></html>
    `,
    text: `Hi ${data.contactName}, we tried to charge $${data.amount} to your ${data.card} for your ${data.plan} membership (invoice ${data.invoiceNumber}), but it did not go through. ${data.next} Please contact ${b.companyName}.`,
  }),
}

/**
 * The named senders the CRM's shared modules call (emailService.sendInvoice and the rest), added to the app's one email
 * service rather than kept on a second object: a caller (or a test) that replaces a sender replaces it for everyone.
 */
export function crmEmail(email: EmailService) {
  const send = (name: string) => (to: string, data: Record<string, unknown>) => email.send(to, name, data)
  return Object.assign(email, {
    sendWelcome: send('welcome'),
    sendInvoice: send('invoiceSent'),
    sendInvoiceReminder: send('invoiceReminder'),
    sendInvoiceOverdue: send('invoiceOverdue'),
    sendPaymentReceived: send('paymentReceived'),
    sendQuote: send('quoteSent'),
    sendQuoteApproved: send('quoteApproved'),
    sendJobAssigned: send('jobAssigned'),
    sendJobStatusChanged: send('jobStatusChanged'),
    sendDailyDigest: send('dailyDigest'),
  })
}
export type CrmEmail = ReturnType<typeof crmEmail>
