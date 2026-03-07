import PDFDocument from 'pdfkit'

function buildInvoicePDF(doc: PDFKit.PDFDocument, invoice: any, agency: any, client: any) {
  const agencyName = agency?.name || '{{COMPANY_NAME}}'

  // Header
  doc.fontSize(20).text(agencyName, { align: 'left' })
  doc.fontSize(14).text('INVOICE', { align: 'left' })
  doc.moveDown()

  // Invoice details
  doc.fontSize(10)
  if (invoice.invoiceNumber) doc.text(`Invoice #: ${invoice.invoiceNumber}`)
  if (invoice.billingPeriodStart && invoice.billingPeriodEnd) {
    doc.text(`Billing Period: ${invoice.billingPeriodStart} - ${invoice.billingPeriodEnd}`)
  }
  if (invoice.paymentDueDate) doc.text(`Due Date: ${invoice.paymentDueDate}`)
  if (invoice.paymentStatus) doc.text(`Status: ${invoice.paymentStatus}`)
  doc.moveDown()

  // Client info
  if (client) {
    doc.text(`Bill To: ${client.firstName || ''} ${client.lastName || ''}`.trim())
    if (client.address) doc.text(client.address)
    if (client.city || client.state || client.zip) {
      doc.text(`${client.city || ''}, ${client.state || ''} ${client.zip || ''}`.trim())
    }
    if (client.email) doc.text(client.email)
    doc.moveDown()
  }

  // Line items
  const items = invoice.lineItems || []
  if (items.length > 0) {
    doc.fontSize(10).text('Description', 72, doc.y, { continued: true, width: 250 })
    doc.text('Hours', { continued: true, width: 50, align: 'right' })
    doc.text('Rate', { continued: true, width: 80, align: 'right' })
    doc.text('Amount', { width: 80, align: 'right' })
    doc.moveDown(0.5)

    // Separator line
    doc.moveTo(72, doc.y).lineTo(522, doc.y).stroke()
    doc.moveDown(0.5)

    for (const item of items) {
      const hours = Number(item.hours || 0)
      const rate = Number(item.rate || 0)
      const amount = Number(item.amount || 0)
      doc.text(item.description || '', 72, doc.y, { continued: true, width: 250 })
      doc.text(hours.toFixed(1), { continued: true, width: 50, align: 'right' })
      doc.text(`$${rate.toFixed(2)}`, { continued: true, width: 80, align: 'right' })
      doc.text(`$${amount.toFixed(2)}`, { width: 80, align: 'right' })
    }
    doc.moveDown()
  }

  // Totals
  doc.moveTo(72, doc.y).lineTo(522, doc.y).stroke()
  doc.moveDown(0.5)

  if (invoice.subtotal != null) {
    doc.fontSize(10).text(`Subtotal: $${Number(invoice.subtotal).toFixed(2)}`, { align: 'right' })
  }
  if (invoice.tax != null && Number(invoice.tax) > 0) {
    doc.text(`Tax: $${Number(invoice.tax).toFixed(2)}`, { align: 'right' })
  }
  if (invoice.total != null) {
    doc.fontSize(12).text(`Total: $${Number(invoice.total).toFixed(2)}`, { align: 'right' })
  }

  // Footer
  doc.moveDown(2)
  doc.fontSize(8).fillColor('#888')
  doc.text('Thank you for choosing ' + agencyName, { align: 'center' })
}

export async function generateInvoicePDF(invoice: any, agency: any, client: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    buildInvoicePDF(doc, invoice, agency, client)
    doc.end()
  })
}
