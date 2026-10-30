// The inspection report as a page (the private link) and as a PDF (the download), from the one ReportView. Server-rendered,
// so every value is escaped on the way out (core/sanitize.ts escapeHtml); the page loads nothing but its own photos and
// the company's logo (its Content-Security-Policy is set by the route).
import PDFDocument from 'pdfkit'
import sharp from 'sharp'
import { escapeHtml as esc } from '../../../core/sanitize.ts'
import { dayOf, gpsOf, inkOn, stampOf, type ReportPhoto, type ReportView } from './view.ts'

/** The company's logo as an <img> source, only where it is the company's own file or an https address. */
const logoSrc = (logo: string | null): string | null => (logo && (logo.startsWith('/media/') || /^https:\/\//.test(logo)) ? logo : null)

export function renderReportHtml(view: ReportView, opts: { photoSrc: (p: ReportPhoto) => string; pdfHref: string }): string {
  const { brand, job, timeZone } = view
  const ink = inkOn(brand.color)
  const logo = logoSrc(brand.logo)
  const fact = (label: string, value: string | null) => (value ? `<div><dt>${esc(label)}</dt><dd>${esc(value)}</dd></div>` : '')
  const facts = [
    fact('Property', job.address), fact('Homeowner', job.homeowner), fact('Job', job.number),
    fact('Inspected', dayOf(job.inspectionDate, timeZone)), fact('Date of loss', dayOf(job.dateOfLoss, 'UTC')),
    fact('Insurance company', job.insuranceCompany), fact('Claim number', job.claimNumber),
  ].join('')
  const photo = (p: ReportPhoto) => {
    const gps = gpsOf(p)
    const when = stampOf(p.takenAt, timeZone)
    const map = gps ? `<a href="https://www.google.com/maps?q=${encodeURIComponent(`${p.latitude},${p.longitude}`)}" target="_blank" rel="noopener noreferrer">GPS ${esc(gps)}</a>` : ''
    return `<figure><img loading="lazy" src="${esc(opts.photoSrc(p))}" alt="${esc(p.caption || `${p.photoType} photo`)}">`
      + `<figcaption>${p.caption ? `<strong>${esc(p.caption)}</strong>` : ''}`
      + `<span class="meta">${[when ? esc(when) : '', map, p.by ? `Photographed by ${esc(p.by)}` : ''].filter(Boolean).join(' · ')}</span></figcaption></figure>`
  }
  const sections = view.sections.map((s) => `<section><h2>${esc(s.title)}</h2>${s.notes ? `<p class="notes">${esc(s.notes)}</p>` : ''}`
    + (s.photos.length ? `<div class="grid">${s.photos.map(photo).join('')}</div>` : '<p class="none">No photos in this section.</p>') + '</section>').join('')
  const contact = [brand.phone, brand.email, brand.address, brand.license ? `License ${brand.license}` : ''].filter(Boolean).map(esc).join(' · ')
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(view.title)} — ${esc(brand.name)}</title>
<style>
:root{--brand:${esc(brand.color)};--on-brand:${ink}}
*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111827;background:#f3f4f6}
.band{background:var(--brand);color:var(--on-brand);display:flex;align-items:center;justify-content:space-between;gap:12px;padding:14px 20px}
.brand{display:flex;align-items:center;gap:12px;font-weight:700;font-size:1.15rem}.brand img{height:44px;width:auto;max-width:140px;object-fit:contain;background:#fff;border-radius:6px;padding:3px}
.dl{color:var(--on-brand);border:2px solid currentColor;border-radius:8px;padding:8px 14px;text-decoration:none;font-weight:600;white-space:nowrap}
main{max-width:920px;margin:0 auto;padding:24px 16px 48px}.sheet{background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
h1{margin:0 0 4px;font-size:1.6rem}.sub{margin:0 0 16px;color:#4b5563}h2{margin:28px 0 8px;font-size:1.2rem;padding-bottom:6px;border-bottom:3px solid var(--brand)}
dl.facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px 20px;margin:0 0 16px}dl.facts dt{font-size:.75rem;text-transform:uppercase;letter-spacing:.04em;color:#6b7280}dl.facts dd{margin:0;font-weight:600}
.intro,.notes{white-space:pre-wrap;margin:8px 0}.none{color:#6b7280}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px;margin-top:12px}figure{margin:0;break-inside:avoid}
figure img{display:block;width:100%;height:220px;object-fit:cover;border-radius:8px;background:#e5e7eb}figcaption{font-size:.9rem;margin-top:6px}figcaption strong{display:block}
.meta{display:block;color:#4b5563;font-size:.8rem}.meta a{color:inherit}
footer{margin-top:28px;padding-top:12px;border-top:1px solid #e5e7eb;color:#4b5563;font-size:.85rem}
@media print{body{background:#fff}.dl{display:none}.sheet{box-shadow:none;padding:0}}
</style></head><body>
<header class="band"><div class="brand">${logo ? `<img src="${esc(logo)}" alt="">` : ''}<span>${esc(brand.name)}</span></div><a class="dl" href="${esc(opts.pdfHref)}">Download PDF</a></header>
<main><div class="sheet"><h1>${esc(view.title)}</h1><p class="sub">Prepared ${esc(dayOf(view.updatedAt, timeZone))}</p>
${facts ? `<dl class="facts">${facts}</dl>` : ''}${view.intro ? `<p class="intro">${esc(view.intro)}</p>` : ''}
${sections || '<p class="none">No photos have been added to this report yet.</p>'}
<footer>${esc(brand.name)}${contact ? ` · ${contact}` : ''}</footer></div></main></body></html>`
}

/** A stored photo as a JPEG the PDF can place (WebP and GIF are not PDF images), turned upright and no larger than it needs. */
async function forPdf(bytes: Buffer, max = 900): Promise<Buffer | null> {
  try { return await sharp(bytes).rotate().resize({ width: max, height: max, fit: 'inside', withoutEnlargement: true }).flatten({ background: '#ffffff' }).jpeg({ quality: 72 }).toBuffer() } catch { return null }
}

/**
 * The PDF. `readImage` gives a stored file's bytes by its /media address (null when it cannot be read), so the route
 * decides what may be read; nothing here reaches the network.
 */
export async function renderReportPdf(view: ReportView, readImage: (mediaUrl: string) => Promise<Buffer | null>): Promise<Buffer> {
  const { brand, job, timeZone } = view
  const LEFT = 48, WIDTH = 516, BOTTOM = 792 - 56
  const doc = new PDFDocument({ size: 'LETTER', margin: LEFT, bufferPages: true, info: { Title: view.title, Author: brand.name } })
  const chunks: Buffer[] = []
  doc.on('data', (c: Buffer) => chunks.push(c))
  const finished = new Promise<Buffer>((resolve, reject) => { doc.on('end', () => resolve(Buffer.concat(chunks))); doc.on('error', reject) })
  const ink = inkOn(brand.color)

  // The company's band: logo (its own file only) and name.
  doc.rect(0, 0, 612, 76).fill(brand.color)
  let textX = LEFT
  const logoBytes = brand.logo && brand.logo.startsWith('/media/') ? await readImage(brand.logo) : null
  const logo = logoBytes ? await sharp(logoBytes).resize({ height: 80, fit: 'inside', withoutEnlargement: true }).png().toBuffer().catch(() => null) : null
  if (logo) { doc.image(logo, LEFT, 14, { fit: [120, 48] }); textX = LEFT + 132 }
  doc.fillColor(ink).font('Helvetica-Bold').fontSize(18).text(brand.name, textX, 28, { width: WIDTH - (textX - LEFT), lineBreak: false, ellipsis: true })

  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(20).text(view.title, LEFT, 100, { width: WIDTH })
  doc.font('Helvetica').fontSize(10).fillColor('#4b5563').text(`Prepared ${dayOf(view.updatedAt, timeZone)}`, LEFT, doc.y + 2)
  doc.moveDown(0.8)
  const facts: Array<[string, string | null]> = [
    ['Property', job.address], ['Homeowner', job.homeowner], ['Job', job.number], ['Inspected', dayOf(job.inspectionDate, timeZone)],
    ['Date of loss', dayOf(job.dateOfLoss, 'UTC')], ['Insurance company', job.insuranceCompany], ['Claim number', job.claimNumber],
  ]
  for (const [label, value] of facts) {
    if (!value) continue
    doc.font('Helvetica-Bold').fontSize(10).fillColor('#111827').text(`${label}: `, LEFT, doc.y, { continued: true, width: WIDTH })
    doc.font('Helvetica').text(value)
  }
  if (view.intro) { doc.moveDown(0.6); doc.font('Helvetica').fontSize(11).fillColor('#111827').text(view.intro, LEFT, doc.y, { width: WIDTH }) }

  const CELL = 250, GAP = 16, IMG_H = 150, CAP_H = 36
  const ROW_H = IMG_H + 6 + CAP_H + 10
  for (const s of view.sections) {
    // A heading is never left alone at the foot of a page: it moves with its notes and its first row of photos.
    doc.font('Helvetica').fontSize(10.5)
    const need = 40 + (s.notes ? doc.heightOfString(s.notes, { width: WIDTH }) + 8 : 0) + (s.photos.length ? ROW_H : 20)
    if (doc.y + need > BOTTOM) doc.addPage()
    doc.moveDown(1)
    const hy = doc.y
    doc.font('Helvetica-Bold').fontSize(14).fillColor('#111827').text(s.title, LEFT, hy, { width: WIDTH })
    doc.rect(LEFT, doc.y + 2, WIDTH, 2).fill(brand.color)
    doc.y += 10
    if (s.notes) { doc.font('Helvetica').fontSize(10.5).fillColor('#111827').text(s.notes, LEFT, doc.y, { width: WIDTH }); doc.moveDown(0.4) }
    if (!s.photos.length) { doc.font('Helvetica-Oblique').fontSize(10).fillColor('#6b7280').text('No photos in this section.', LEFT, doc.y, { width: WIDTH }); continue }
    for (let i = 0; i < s.photos.length; i += 2) {
      const rowH = ROW_H
      if (doc.y + rowH > BOTTOM) doc.addPage()
      const y = doc.y
      for (let k = 0; k < 2 && i + k < s.photos.length; k++) {
        const p = s.photos[i + k]
        const x = LEFT + k * (CELL + GAP)
        const raw = await readImage(p.url)
        const img = raw ? await forPdf(raw) : null
        if (img) doc.image(img, x, y, { fit: [CELL, IMG_H], align: 'left', valign: 'top' })
        else { doc.rect(x, y, CELL, IMG_H).fill('#e5e7eb'); doc.fillColor('#6b7280').font('Helvetica').fontSize(10).text('Photo not available', x, y + IMG_H / 2 - 5, { width: CELL, align: 'center', lineBreak: false }) }
        let ty = y + IMG_H + 6
        if (p.caption) { doc.font('Helvetica-Bold').fontSize(9.5).fillColor('#111827').text(p.caption, x, ty, { width: CELL, height: 13, ellipsis: true, lineBreak: false }); ty += 13 }
        const when = stampOf(p.takenAt, timeZone)
        const gps = gpsOf(p)
        const meta = [when, gps ? `GPS ${gps}` : '', p.by ? `by ${p.by}` : ''].filter(Boolean).join('  |  ')
        if (meta) doc.font('Helvetica').fontSize(8).fillColor('#4b5563').text(meta, x, ty, { width: CELL, height: 22, ellipsis: true })
      }
      doc.x = LEFT
      doc.y = y + rowH
    }
  }

  // Footer on every page. The text sits inside the bottom margin, so the margin is lowered for it (else pdfkit starts a page).
  const footer = [brand.name, brand.phone, brand.email, brand.license ? `License ${brand.license}` : ''].filter(Boolean).join('  |  ')
  const range = doc.bufferedPageRange()
  for (let i = 0; i < range.count; i++) {
    doc.switchToPage(range.start + i)
    doc.page.margins.bottom = 0
    doc.font('Helvetica').fontSize(8).fillColor('#6b7280').text(`${footer}   Page ${i + 1} of ${range.count}`, LEFT, 792 - 36, { width: WIDTH, align: 'center', lineBreak: false })
  }
  doc.end()
  return finished
}
