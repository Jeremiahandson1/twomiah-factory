import PDFDocument from 'pdfkit'

function buildPDF(title: string, doc: PDFKit.PDFDocument, data: any, company: any) {
  const companyName = company?.name || company?.companyName || 'Company'

  doc.fontSize(20).text(companyName, { align: 'left' })
  doc.fontSize(14).text(title, { align: 'left' })
  doc.moveDown()

  // Format dates instead of dumping a raw JS Date string, and cap the status. (R2-03)
  const fmtDate = (d: any) => { if (!d) return ''; const dt = new Date(d); return isNaN(dt.getTime()) ? String(d) : dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) }
  if (data.number) doc.fontSize(10).text(`Number: ${data.number}`)
  if (data.date || data.createdAt) doc.text(`Date: ${fmtDate(data.date || data.createdAt)}`)
  if (data.dueDate) doc.text(`Due Date: ${fmtDate(data.dueDate)}`)
  // Don't print internal "draft" status on the customer's copy. (CC-34)
  if (data.status && data.status !== 'draft') doc.text(`Status: ${String(data.status).charAt(0).toUpperCase()}${String(data.status).slice(1)}`)
  doc.moveDown()

  const contact = data.contact
  if (contact) {
    const contactName = contact.name || `${contact.firstName || ''} ${contact.lastName || ''}`.trim()
    doc.text('Bill To:')
    if (contactName) doc.text(contactName)
    const addrLines = [contact.address, [contact.city, contact.state].filter(Boolean).join(', '), contact.zip].filter(Boolean)
    for (const line of addrLines) doc.text(String(line))
    if (contact.email) doc.text(contact.email)
    if (contact.phone) doc.text(contact.phone)
    doc.moveDown()
  }

  const items = data.lineItems || data.items || []
  if (items.length > 0) {
    // Fixed column x-positions. The old `continued` layout drew Qty/Price/Total on top of
    // each other (all within a ~7pt band). Page body is x=72..540. (CC-34)
    const colDesc = 72, colQty = 300, colPrice = 372, colTotal = 456
    const wDesc = 210, wQty = 60, wPrice = 78, wTotal = 84
    const headY = doc.y
    doc.fontSize(10).font('Helvetica-Bold')
    doc.text('Description', colDesc, headY, { width: wDesc })
    doc.text('Qty', colQty, headY, { width: wQty, align: 'right' })
    doc.text('Price', colPrice, headY, { width: wPrice, align: 'right' })
    doc.text('Total', colTotal, headY, { width: wTotal, align: 'right' })
    doc.font('Helvetica')
    doc.moveDown(0.5)

    for (const item of items) {
      const qty = Number(item.quantity ?? 1)
      const price = Number(item.unitPrice ?? item.price ?? 0)
      const lineTotal = Number(item.total ?? qty * price)
      const rowY = doc.y
      doc.text(String(item.description || item.name || ''), colDesc, rowY, { width: wDesc })
      const rowEnd = doc.y
      doc.text(String(qty), colQty, rowY, { width: wQty, align: 'right' })
      doc.text(`$${price.toFixed(2)}`, colPrice, rowY, { width: wPrice, align: 'right' })
      doc.text(`$${lineTotal.toFixed(2)}`, colTotal, rowY, { width: wTotal, align: 'right' })
      doc.y = Math.max(rowY + 14, rowEnd) // advance past the tallest cell in the row
    }
    doc.moveDown()
  }

  // Full money breakdown, not just a bare Total. (R2-03)
  doc.fontSize(10)
  if (data.subtotal != null) doc.text(`Subtotal: $${Number(data.subtotal).toFixed(2)}`, { align: 'right' })
  if (Number(data.discount) > 0) doc.text(`Discount: -$${Number(data.discount).toFixed(2)}`, { align: 'right' })
  if (Number(data.taxAmount) > 0) doc.text(`Tax: $${Number(data.taxAmount).toFixed(2)}`, { align: 'right' })
  if (data.total != null) doc.fontSize(12).text(`Total: $${Number(data.total).toFixed(2)}`, { align: 'right' })
  if (Number(data.amountPaid) > 0) {
    doc.fontSize(10).text(`Paid: -$${Number(data.amountPaid).toFixed(2)}`, { align: 'right' })
    doc.fontSize(12).text(`Balance Due: $${(Number(data.total) - Number(data.amountPaid)).toFixed(2)}`, { align: 'right' })
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
