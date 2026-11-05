// The files a home care report is downloaded as — CSV and PDF — shared by Reports & Analytics (reports.ts), the margin and
// turnover reports (marginReports.ts) and the report builder (reportBuilder.ts), so every report downloads the same way.
import type { Context } from 'hono'
import PDFDocument from 'pdfkit'

export const csvCell = (v: any) => {
  if (v == null) return ''
  const s = v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
export type Col = { key: string; label: string }
export const toCSV = (data: any[], columns: Col[]) =>
  columns.map((col) => csvCell(col.label)).join(',') + '\n' +
  data.map((r) => columns.map((col) => csvCell(r[col.key])).join(',')).join('\n') + '\n'
export const csvReply = (c: Context, filename: string, body: string) =>
  c.body(body, 200, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${filename}"` })
/** A rendered report file (planning/reportRenderers.ts) as the download reply. */
export const fileReply = (c: Context, f: { body: Buffer; contentType: string; fileName: string }) =>
  c.body(new Uint8Array(f.body), 200, { 'Content-Type': f.contentType, 'Content-Disposition': `attachment; filename="${f.fileName}"` })
export const pdfReply = (c: Context, filename: string, buf: Buffer) =>
  c.body(new Uint8Array(buf), 200, { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${filename}"` })
export function renderPdf(build: (doc: PDFKit.PDFDocument) => void, opts: any = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER', ...opts })
    const chunks: Buffer[] = []
    doc.on('data', (b: Buffer) => chunks.push(b))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try { build(doc); doc.end() } catch (e) { reject(e) }
  })
}
export const slug = (s: string) => s.replace(/[^A-Za-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'agency'
/** A camelCase key as a column heading: payableHours → PAYABLE HOURS. */
export const heading = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').toUpperCase()
/** A CSV column's title, for a spreadsheet: "clockedHours" → "Clocked Hours" (the export's titles were the code's keys). */
export const columnTitle = (key: string) => key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').replace(/\b\w/g, (ch) => ch.toUpperCase())

/** Cents as the report prints them: $1,234.56; a missing figure as a dash. */
export const centsText = (cents: number | null | undefined) => (cents == null ? '—' : `${cents < 0 ? '-' : ''}$${(Math.abs(cents) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`)
/** Cents as a CSV number: 1234.56 (a spreadsheet adds it up). */
export const centsNumber = (cents: number | null | undefined) => (cents == null ? '' : (cents / 100).toFixed(2))

/**
 * A simple tabular PDF: the agency's letterhead, a title and period line, the summary lines, then one table (a header row and
 * rows that wrap over pages). Columns are { key, label, width? } in points; the sum of widths fits the page (512).
 */
export function tablePdf(o: { agency: string; title: string; period: string; summary?: string[]; columns: (Col & { width?: number })[]; rows: any[]; footnote?: string }): Promise<Buffer> {
  return renderPdf((doc) => {
    doc.rect(0, 0, doc.page.width, 80).fill('#0F766E')
    doc.fillColor('#fff').fontSize(20).font('Helvetica-Bold').text(o.agency, 50, 22)
    doc.fontSize(12).font('Helvetica').text(`${o.title}  •  ${o.period}`, 50, 50)
    doc.fillColor('#111827')
    let y = 100
    for (const line of o.summary ?? []) { doc.fontSize(11).font('Helvetica').text(line, 50, y); y += 16 }
    y += 8
    const given = o.columns.reduce((t, c) => t + (c.width ?? 0), 0)
    const free = o.columns.filter((c) => !c.width).length
    const each = free ? Math.max(40, Math.floor((512 - given) / free)) : 0
    const widths = o.columns.map((c) => c.width ?? each)
    const header = () => {
      doc.rect(50, y, 512, 18).fill('#0F766E')
      let x = 53
      doc.fontSize(8).font('Helvetica-Bold')
      o.columns.forEach((c, i) => { doc.fillColor('#fff').text(c.label, x, y + 5, { width: widths[i] - 4, ellipsis: true, lineBreak: false }); x += widths[i] })
      y += 20
    }
    header()
    if (!o.rows.length) { doc.fontSize(11).fillColor('#6B7280').font('Helvetica').text('Nothing in this period.', 50, y + 4); y += 20 }
    o.rows.forEach((row, idx) => {
      if (y > 720) { doc.addPage(); y = 50; header() }
      if (idx % 2 === 0) doc.rect(50, y, 512, 16).fill('#F3F4F6')
      let x = 53
      doc.fontSize(8).font('Helvetica').fillColor('#111827')
      o.columns.forEach((c, i) => {
        const v = row[c.key]
        doc.text(v === null || v === undefined || v === '' ? '—' : String(v), x, y + 4, { width: widths[i] - 4, ellipsis: true, lineBreak: false })
        x += widths[i]
      })
      y += 18
    })
    if (o.footnote) { doc.fontSize(8).fillColor('#6B7280').font('Helvetica').text(o.footnote, 50, y + 10, { width: 512 }) }
  }, { bufferPages: true })
}
