// A material order as a document: the one view the printable PDF, the email to the supplier and (later) a supplier's own API
// all read, so they cannot disagree about what was ordered. Prices are in it only when the caller may see them (margin:read):
// what a line costs the business is not shown to a seat that cannot see what the business paid (T42).
import PDFDocument from 'pdfkit'
import { and, eq } from 'drizzle-orm'
import { companyTimeZone, markerDay, storeDateString } from '@twomiah/tenant-backend'
import { company, contact, job } from '../../../db/schema/index.ts'

export interface OrderDocLine { description: string; qty: number; unit: string; unitPrice: number | null; total: number | null }
export interface OrderDocument {
  id: string
  /** PO number if the roofer gave one, else the job's number: what the supplier is told the order is. */
  reference: string
  poNumber: string | null
  supplierOrderNumber: string | null
  status: string
  supplier: string
  company: { name: string; address: string; phone: string; email: string }
  job: { number: string; address: string }
  customerName: string | null
  deliverTo: string | null
  /** YYYY-MM-DD, or null. */
  deliveryDay: string | null
  orderDay: string | null
  contact: { name: string | null; phone: string | null; email: string | null }
  notes: string | null
  lines: OrderDocLine[]
  /** Null when prices are withheld or none of the lines has one. */
  total: number | null
  showPrices: boolean
  printedDay: string
}

const num = (v: unknown) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const cents = (n: number) => Math.round(n * 100)

export async function buildOrderDocument(db: any, companyId: string, order: any, opts: { showPrices: boolean }): Promise<OrderDocument> {
  const [co] = await db.select().from(company).where(eq(company.id, companyId)).limit(1)
  const [jb] = await db.select().from(job).where(and(eq(job.id, order.jobId), eq(job.companyId, companyId))).limit(1)
  const [cu] = jb?.contactId ? await db.select({ name: contact.name }).from(contact).where(and(eq(contact.id, jb.contactId), eq(contact.companyId, companyId))).limit(1) : []
  const tz = await companyTimeZone(db, companyId)
  const rawLines: any[] = Array.isArray(order.lineItems) ? order.lineItems : []
  const priced = rawLines.some((l) => l.unitPrice != null && num(l.unitPrice) > 0)
  const lines: OrderDocLine[] = rawLines.map((l) => ({
    description: String(l.description ?? ''), qty: num(l.qty ?? l.quantity), unit: String(l.unit ?? 'ea'),
    unitPrice: opts.showPrices && priced ? num(l.unitPrice) : null,
    // Cents, then back: a total never carries the float dust of qty × price.
    total: opts.showPrices && priced ? cents(num(l.qty ?? l.quantity) * num(l.unitPrice)) / 100 : null,
  }))
  const addr = (x: any) => [x?.address, [x?.city, x?.state].filter(Boolean).join(', '), x?.zip].filter(Boolean).join(', ')
  return {
    id: order.id, reference: order.poNumber || jb?.number || order.id,
    poNumber: order.poNumber ?? null, supplierOrderNumber: order.supplierOrderNumber ?? null, status: order.orderStatus, supplier: order.supplier,
    company: { name: co?.name ?? '', address: addr(co), phone: co?.phone ?? '', email: co?.email ?? '' },
    job: { number: jb?.number ?? '', address: addr(jb) },
    customerName: cu?.name ?? null,
    deliverTo: order.deliveryAddress ?? null,
    deliveryDay: order.deliveryDate ? markerDay(order.deliveryDate) : null,
    orderDay: order.orderDate ? markerDay(order.orderDate) : null,
    contact: { name: order.contactName ?? null, phone: order.contactPhone ?? null, email: order.contactEmail ?? null },
    notes: order.notes ?? null,
    lines,
    total: opts.showPrices && priced ? lines.reduce((s, l) => s + cents(l.total ?? 0), 0) / 100 : null,
    showPrices: opts.showPrices && priced,
    printedDay: storeDateString(new Date(), tz),
  }
}

/** "2026-11-05" as "Nov 5, 2026". */
export const dayWords = (day: string | null) => {
  if (!day) return ''
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })
}
export const moneyText = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** The file name a downloaded order carries. */
export const orderFileName = (doc: Pick<OrderDocument, 'reference'>) => `material-order-${String(doc.reference).replace(/[^A-Za-z0-9._-]+/g, '-')}.pdf`

export async function renderOrderPdf(doc: OrderDocument, statusLabel: string): Promise<Buffer> {
  const LEFT = 54, WIDTH = 504, BOTTOM = 792 - 54
  const pdf = new PDFDocument({ size: 'LETTER', margin: LEFT, bufferPages: true, info: { Title: `Material order ${doc.reference}`, Author: doc.company.name } })
  const chunks: Buffer[] = []
  pdf.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => { pdf.on('end', () => resolve(Buffer.concat(chunks))); pdf.on('error', reject) })

  pdf.font('Helvetica-Bold').fontSize(18).fillColor('#111827').text(doc.company.name || 'Material order', LEFT, LEFT, { width: WIDTH })
  pdf.font('Helvetica').fontSize(9).fillColor('#4b5563')
  for (const line of [doc.company.address, [doc.company.phone, doc.company.email].filter(Boolean).join(' · ')]) if (line) pdf.text(line, LEFT, pdf.y, { width: WIDTH })
  pdf.moveDown(0.8)
  pdf.font('Helvetica-Bold').fontSize(20).fillColor('#111827').text('MATERIAL ORDER', LEFT, pdf.y, { width: WIDTH })
  pdf.font('Helvetica').fontSize(10).fillColor('#4b5563').text(`${statusLabel} · printed ${dayWords(doc.printedDay)}`, LEFT, pdf.y + 2, { width: WIDTH })
  pdf.moveDown(0.8)

  const facts: Array<[string, string | null]> = [
    ['PO number', doc.poNumber], ['Supplier', doc.supplier], ['Supplier order #', doc.supplierOrderNumber],
    ['Job', [doc.job.number, doc.customerName].filter(Boolean).join(' · ') || null], ['Deliver to', doc.deliverTo || doc.job.address || null],
    ['Delivery date', doc.deliveryDay ? dayWords(doc.deliveryDay) : null], ['Ordered', doc.orderDay ? dayWords(doc.orderDay) : null],
    ['Point of contact', [doc.contact.name, doc.contact.phone, doc.contact.email].filter(Boolean).join(' · ') || null],
  ]
  for (const [label, value] of facts) {
    if (!value) continue
    const y = pdf.y
    pdf.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(label, LEFT, y, { width: 120 })
    pdf.font('Helvetica').text(value, LEFT + 126, y, { width: WIDTH - 126 })
    pdf.y = Math.max(pdf.y, y + 14)
  }
  pdf.moveDown(0.8)

  const COL = doc.showPrices ? { qty: LEFT, unit: LEFT + 56, desc: LEFT + 116, price: LEFT + 360, total: LEFT + 436 } : { qty: LEFT, unit: LEFT + 56, desc: LEFT + 116, price: 0, total: 0 }
  const descW = doc.showPrices ? 236 : WIDTH - 116
  const head = () => {
    const y = pdf.y
    pdf.rect(LEFT, y - 3, WIDTH, 18).fill('#f3f4f6')
    pdf.fillColor('#111827').font('Helvetica-Bold').fontSize(9)
    pdf.text('Qty', COL.qty + 4, y, { width: 48 }); pdf.text('Unit', COL.unit, y, { width: 56 }); pdf.text('Material', COL.desc, y, { width: descW })
    if (doc.showPrices) { pdf.text('Unit price', COL.price, y, { width: 72, align: 'right' }); pdf.text('Total', COL.total, y, { width: 68, align: 'right' }) }
    pdf.y = y + 20
    pdf.font('Helvetica').fontSize(10)
  }
  head()
  for (const l of doc.lines) {
    const y = pdf.y
    const h = pdf.heightOfString(l.description, { width: descW })
    if (y + h > BOTTOM) { pdf.addPage(); head() }
    const top = pdf.y
    pdf.fillColor('#111827').text(String(l.qty), COL.qty + 4, top, { width: 48 }); pdf.text(l.unit, COL.unit, top, { width: 56 }); pdf.text(l.description, COL.desc, top, { width: descW })
    const end = pdf.y
    if (doc.showPrices) { pdf.text(l.unitPrice == null ? '' : moneyText(l.unitPrice), COL.price, top, { width: 72, align: 'right' }); pdf.text(l.total == null ? '' : moneyText(l.total), COL.total, top, { width: 68, align: 'right' }) }
    pdf.y = Math.max(end, top + 14) + 2
  }
  if (doc.showPrices && doc.total != null) {
    pdf.moveDown(0.4)
    const y = pdf.y
    pdf.font('Helvetica-Bold').text('Total', COL.price, y, { width: 72, align: 'right' }); pdf.text(moneyText(doc.total), COL.total, y, { width: 68, align: 'right' })
    pdf.font('Helvetica')
  }
  if (doc.notes) {
    pdf.moveDown(1)
    pdf.font('Helvetica-Bold').fontSize(10).text('Notes', LEFT, pdf.y, { width: WIDTH })
    pdf.font('Helvetica').text(doc.notes, LEFT, pdf.y, { width: WIDTH })
  }
  const pages = pdf.bufferedPageRange()
  for (let i = 0; i < pages.count; i++) {
    pdf.switchToPage(i)
    pdf.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`${doc.company.name} · material order ${doc.reference} · page ${i + 1} of ${pages.count}`, LEFT, 792 - 40, { width: WIDTH, align: 'center', lineBreak: false })
  }
  pdf.end()
  return finished
}
