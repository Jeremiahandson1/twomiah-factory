// Invoice and quote PDFs, moved from templates/crm*/backend/src/services/pdf.ts.
import PDFDocument from 'pdfkit'
import { PDFDocument as MergeDocument } from 'pdf-lib'
import { money, groupBySection, hasStructure } from '@twomiah/tenant-backend'

function buildPDF(title: string, doc: PDFKit.PDFDocument, data: any, company: any) {
  const companyName = company?.name || company?.companyName || 'Company'
  const pd = title === 'QUOTE' ? data.proposalDocument : null
  const printSections = (placement: string) => {
    for (const sec of (pd?.sections || []).filter((x: any) => x.placement === placement)) {
      doc.moveDown(0.4).fontSize(12).font('Helvetica-Bold').text(String(sec.title), 72, doc.y, { width: 468 })
      doc.font('Helvetica').fontSize(10).text(String(sec.body), 72, doc.y, { width: 468 })
      doc.moveDown(0.6)
    }
  }
  // The proposal's cover page, then About Us (proposal pages: tenant-backend invoicing/quoteDocument.ts).
  if (pd && (pd.coverTitle || pd.coverSubtitle || data.coverPhoto)) {
    doc.fontSize(12).fillColor('#555').text(companyName, 72, 110, { width: 468, align: 'center' })
    if (data.coverPhoto) { try { doc.image(data.coverPhoto, 106, doc.y + 20, { fit: [400, 260], align: 'center' }); doc.y += 290 } catch { /* an unreadable picture leaves the cover without it */ } }
    doc.fillColor('black').fontSize(28).font('Helvetica-Bold').text(String(pd.coverTitle || data.name || 'Proposal'), 72, data.coverPhoto ? doc.y : 260, { width: 468, align: 'center' })
    if (pd.coverSubtitle) doc.moveDown(0.5).fontSize(14).font('Helvetica').fillColor('#555').text(String(pd.coverSubtitle), 72, doc.y, { width: 468, align: 'center' })
    doc.fillColor('black').font('Helvetica')
    doc.addPage()
  }
  if (pd?.aboutUs) {
    doc.fontSize(14).font('Helvetica-Bold').text(`About ${companyName}`, 72, doc.y, { width: 468 })
    doc.font('Helvetica').fontSize(10).text(String(pd.aboutUs), 72, doc.y + 4, { width: 468 })
    doc.moveDown()
  }
  printSections('top')

  doc.fontSize(20).text(companyName, { align: 'left' })
  // Who the business IS — address, phone, email, website. The whole company row already reaches this
  // function; only the name was ever printed, so an invoice went out with no way to contact the business
  // that sent it, while other documents from the same tenant (the vet's rabies certificate) printed the
  // full header. Every line is conditional, so a tenant that has filled in nothing looks as it did before.
  // (Vet T12 M10 — the same file in seven CRMs.)
  doc.fontSize(9).fillColor('#555')
  const cityLine = [company?.city, company?.state].filter(Boolean).join(', ')
  for (const line of [
    company?.address,
    [cityLine, company?.zip].filter(Boolean).join(' '),
    [company?.phone, company?.email].filter(Boolean).join(' · '),
    company?.website,
  ]) if (line) doc.text(String(line))
  doc.fillColor('black').fontSize(14).text(title, { align: 'left' })
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

    const drawLine = (item: any) => {
      const qty = Number(item.quantity ?? 1)
      const price = Number(item.unitPrice ?? item.price ?? 0)
      const lineTotal = Number(item.total ?? qty * price)
      const rowY = doc.y
      // An allowance is said to be one: the customer is choosing against that figure, not buying it as priced.
      doc.text(`${String(item.description || item.name || '')}${item.allowance ? ' (allowance)' : ''}`, colDesc, rowY, { width: wDesc })
      const rowEnd = doc.y
      doc.text(String(qty), colQty, rowY, { width: wQty, align: 'right' })
      doc.text(`${money(price)}`, colPrice, rowY, { width: wPrice, align: 'right' })
      doc.text(`${money(lineTotal)}`, colTotal, rowY, { width: wTotal, align: 'right' })
      doc.y = Math.max(rowY + 14, rowEnd) // advance past the tallest cell in the row
    }
    if (hasStructure(items)) {
      // Phases: each section's name, its lines, then its subtotal (tenant-backend invoicing/quoteSections.ts).
      for (const g of groupBySection(items)) {
        if (g.name) { doc.moveDown(0.3); doc.font('Helvetica-Bold').text(g.name, colDesc, doc.y, { width: 468 }); doc.font('Helvetica') }
        for (const item of g.lines) drawLine(item)
        if (g.name) {
          const y = doc.y
          doc.font('Helvetica-Bold').text(`${g.name} subtotal`, colDesc, y, { width: 360, align: 'right' })
          doc.text(money(g.subtotal), colTotal, y, { width: wTotal, align: 'right' })
          doc.font('Helvetica')
          doc.y = Math.max(y + 14, doc.y)
        }
      }
    } else {
      for (const item of items) drawLine(item)
    }
    doc.moveDown()
  }

  // A quote whose customer has yet to choose (Good / Better / Best, tenant-backend invoicing/quoteOptions.ts): the lines above
  // are in every option; each option follows with its own lines and what the whole job comes to with it.
  const options: any[] = Array.isArray(data.options) ? data.options : []
  printSections('before_options')
  // Everything that follows the money: the sections after the options, the terms with the customer's initials, the signatures,
  // and the names of the files attached (their pages follow this one).
  const closing = () => {
    printSections('after_options')
    printSections('before_terms')
    if (title !== 'QUOTE') return
    const clauses: any[] = pd?.clauses || []
    if (clauses.length || data.terms) {
      doc.moveDown().fontSize(12).font('Helvetica-Bold').text('Terms', 72, doc.y, { width: 468 })
      doc.font('Helvetica').fontSize(10)
      if (data.terms) doc.text(String(data.terms), 72, doc.y, { width: 468 })
      clauses.forEach((cl: any, i: number) => {
        const y = doc.y + 4
        doc.text(`${i + 1}. ${cl.text}`, 72, y, { width: 400 })
        const end = doc.y
        doc.font('Helvetica-Bold').text(cl.initials ? `Initials: ${cl.initials}` : 'Initials: ______', 480, y, { width: 60 })
        doc.font('Helvetica')
        doc.y = Math.max(end, y + 12)
      })
    }
    if (pd?.attachmentNames?.length) {
      doc.moveDown().fontSize(10).font('Helvetica-Bold').text('Attached', 72, doc.y, { width: 468 })
      doc.font('Helvetica')
      for (const n of pd.attachmentNames) doc.text(`• ${n}`, 84, doc.y, { width: 456 })
    }
    const sign = (label: string, name: string | null, image: string | null, at: any) => {
      doc.moveDown().fontSize(10).font('Helvetica-Bold').text(label, 72, doc.y, { width: 468 })
      doc.font('Helvetica')
      if (image && /^data:image\/(png|jpeg);base64,/.test(image)) { try { doc.image(Buffer.from(image.split(',')[1], 'base64'), 72, doc.y + 2, { fit: [180, 60] }); doc.y += 66 } catch { /* an unreadable image leaves the name */ } }
      if (name) doc.text(`${name}${at ? `, ${fmtDate(at)}` : ''}`, 72, doc.y, { width: 468 })
    }
    if (data.signature) sign('Signed by the customer', data.signedBy || null, data.signature, data.signedAt)
    if (data.cosignature) sign(`Cosigned${pd?.cosigner?.role ? ` (${pd.cosigner.role})` : ''}`, data.cosignature.name || null, data.cosignature.signature || null, data.cosignature.signedAt)
    else if (pd?.cosigner && data.signature) doc.moveDown().text(`Cosigner: ${pd.cosigner.name}${pd.cosigner.role ? ` (${pd.cosigner.role})` : ''}`, 72, doc.y, { width: 468 })
  }
  if (options.length) {
    doc.fontSize(12).font('Helvetica-Bold').text('Options — choose one', 72, doc.y, { width: 468 })
    doc.font('Helvetica').fontSize(10)
    if (items.length) doc.fillColor('#555').text('The lines above are included with every option.', { width: 468 }).fillColor('black')
    doc.moveDown(0.5)
    for (const op of options) {
      const y = doc.y
      doc.font('Helvetica-Bold').text(`${op.name}${op.recommended ? ' (recommended)' : ''}`, 72, y, { width: 360 })
      const nameEnd = doc.y
      doc.text(money(Number(op.price)), 456, y, { width: 84, align: 'right' })
      doc.font('Helvetica')
      doc.y = Math.max(nameEnd, y + 14)
      const detail = [op.brand, op.warranty ? `Warranty: ${op.warranty}` : ''].filter(Boolean).join(' · ')
      if (detail) doc.fillColor('#555').text(detail, 72, doc.y, { width: 468 }).fillColor('black')
      if (op.description) doc.text(String(op.description), 72, doc.y, { width: 468 })
      for (const l of op.lines || []) doc.text(`• ${l.description}${Number(l.quantity) !== 1 ? ` (${Number(l.quantity)})` : ''}`, 84, doc.y, { width: 456 })
      // The option's own discount, taken off its price above; and the add-ons that belong to it alone.
      if (Number(op.discount) > 0) doc.fillColor('#555').text(`Discount on this option: -${money(Number(op.discount))}`, 72, doc.y, { width: 468 }).fillColor('black')
      const upgrades: any[] = Array.isArray(op.upgrades) ? op.upgrades : []
      if (upgrades.length) {
        doc.fillColor('#555').text('Optional upgrades, offered once this option is chosen:', 72, doc.y, { width: 468 }).fillColor('black')
        for (const u of upgrades) doc.text(`+ ${u.description}${Number(u.quantity) !== 1 ? ` (${Number(u.quantity)})` : ''}: ${money(Number(u.total ?? Number(u.quantity) * Number(u.unitPrice)))}`, 84, doc.y, { width: 456 })
      }
      if (Number(op.deposit) > 0) doc.fillColor('#555').text(`Deposit on approval: ${money(Number(op.deposit))}`, 72, doc.y, { width: 468 }).fillColor('black')
      doc.moveDown(0.6)
    }
    const lowest = Math.min(...options.map((op) => Number(op.price)))
    doc.fontSize(12).text(`Total: from ${money(lowest)}, depending on the option chosen`, 72, doc.y, { width: 468, align: 'right' })
    closing()
    return
  }

  // Full money breakdown, not just a bare Total. (R2-03)
  doc.fontSize(10)
  if (data.subtotal != null) doc.text(`Subtotal: ${money(Number(data.subtotal))}`, { align: 'right' })
  if (Number(data.discount) > 0) doc.text(`Discount: -${money(Number(data.discount))}`, { align: 'right' })
  if (Number(data.taxAmount) > 0) doc.text(`Tax: ${money(Number(data.taxAmount))}`, { align: 'right' })
  if (data.total != null) doc.fontSize(12).text(`Total: ${money(Number(data.total))}`, { align: 'right' })
  if (Number(data.amountPaid) > 0) {
    doc.fontSize(10).text(`Paid: -${Number(data.amountPaid).toFixed(2)}`, { align: 'right' })
    if (Number(data.amountRefunded) > 0) doc.fontSize(10).text(`Refunded: ${Number(data.amountRefunded).toFixed(2)}`, { align: 'right' })
    doc.fontSize(12).text(`Balance Due: ${money((Number(data.total) - Number(data.amountPaid)))}`, { align: 'right' })
  }
  closing()
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

/** The PDFs attached to a proposal, their pages following the proposal's own. One that cannot be read is left out. */
async function withAttachedPdfs(main: Buffer, files: Buffer[]): Promise<Buffer> {
  const merged = await MergeDocument.load(main)
  for (const bytes of files) {
    try {
      const other = await MergeDocument.load(bytes, { ignoreEncryption: true })
      for (const page of await merged.copyPages(other, other.getPageIndices())) merged.addPage(page)
    } catch { /* an attachment that is not a readable PDF is skipped */ }
  }
  return Buffer.from(await merged.save())
}

export async function generateQuotePDF(quote: any, company: any): Promise<Buffer> {
  const made = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ margin: 72 })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    buildPDF('QUOTE', doc, quote, company)
    doc.end()
  })
  return Array.isArray(quote?.attachmentFiles) && quote.attachmentFiles.length ? withAttachedPdfs(made, quote.attachmentFiles) : made
}
