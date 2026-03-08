import PDFDocument from 'pdfkit'

function buildPDF(title: string, doc: PDFKit.PDFDocument, data: any, company: any) {
  const companyName = company?.name || company?.companyName || 'Company'

  doc.fontSize(20).text(companyName, { align: 'left' })
  doc.fontSize(14).text(title, { align: 'left' })
  doc.moveDown()

  if (data.number) doc.fontSize(10).text(`Number: ${data.number}`)
  if (data.date) doc.text(`Date: ${data.date}`)
  if (data.dueDate) doc.text(`Due Date: ${data.dueDate}`)
  if (data.status) doc.text(`Status: ${data.status}`)
  doc.moveDown()

  const contact = data.contact
  if (contact) {
    doc.text(`Bill To: ${contact.firstName || ''} ${contact.lastName || ''}`.trim())
    if (contact.email) doc.text(contact.email)
    if (contact.phone) doc.text(contact.phone)
    doc.moveDown()
  }

  const items = data.lineItems || data.items || []
  if (items.length > 0) {
    doc.fontSize(10).text('Description', 72, doc.y, { continued: true, width: 250 })
    doc.text('Qty', { continued: true, width: 50, align: 'right' })
    doc.text('Price', { continued: true, width: 80, align: 'right' })
    doc.text('Total', { width: 80, align: 'right' })
    doc.moveDown(0.5)

    for (const item of items) {
      const qty = item.quantity || 1
      const price = Number(item.unitPrice || item.price || 0)
      const total = qty * price
      doc.text(item.description || item.name || '', 72, doc.y, { continued: true, width: 250 })
      doc.text(String(qty), { continued: true, width: 50, align: 'right' })
      doc.text(`$${price.toFixed(2)}`, { continued: true, width: 80, align: 'right' })
      doc.text(`$${total.toFixed(2)}`, { width: 80, align: 'right' })
    }
    doc.moveDown()
  }

  if (data.total != null) {
    doc.fontSize(12).text(`Total: $${Number(data.total).toFixed(2)}`, { align: 'right' })
  }
}

export async function generateInvoicePDF(invoice: any, company: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    buildPDF('INVOICE', doc, invoice, company)
    doc.end()
  })
}

export async function generateQuotePDF(quote: any, company: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    buildPDF('QUOTE', doc, quote, company)
    doc.end()
  })
}
