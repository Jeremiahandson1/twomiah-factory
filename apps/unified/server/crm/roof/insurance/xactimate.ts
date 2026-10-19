// The Xactimate-format scope document and its CSV, built from a claim, its job, the measurement and the supplements.
// Moved from templates/crm-roof/backend/src/services/xactimate.ts.
//
// Changes from the template:
//   · the job's property address is the CRM's `address` (docs/UNIFIED_ROOF_PLAN.md decision 2);
//   · the files go to the store the caller hands in (the CRM's private bucket) under the same keys
//     (insurance/<company>/<claim>/xactimate-…), and the links returned are the insurance module's own signed-in file
//     route (/api/insurance/claims/<claim>/files/<name>) — the template's /media/insurance/… route is not in this app;
//   · dates print as a person reads them: the date of loss is a calendar day (stored at UTC midnight), so it prints in
//     UTC; the report date is today in the company's own time zone. The template printed both in the server's zone,
//     which put a 1 May loss on 30 April anywhere west of UTC.
import PDFDocument from 'pdfkit'
import { money } from '@twomiah/tenant-backend'

export interface XactLineItem {
  code: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  total: number
}

// ── Xactimate line item codes & regional pricing ──────

const REGION_PRICING: Record<string, Record<string, number>> = {
  midwest: { 'RFG 220': 85, 'RFG 240': 185, 'RFG 252': 22, 'RFG 300': 3.50, 'RFG 180': 95, 'RFG 350': 6.50, 'WTR 052': 8.50 },
  southeast: { 'RFG 220': 80, 'RFG 240': 175, 'RFG 252': 20, 'RFG 300': 3.25, 'RFG 180': 90, 'RFG 350': 6.00, 'WTR 052': 8.00 },
  northeast: { 'RFG 220': 95, 'RFG 240': 210, 'RFG 252': 25, 'RFG 300': 4.00, 'RFG 180': 105, 'RFG 350': 7.50, 'WTR 052': 9.50 },
  west: { 'RFG 220': 90, 'RFG 240': 200, 'RFG 252': 24, 'RFG 300': 3.75, 'RFG 180': 100, 'RFG 350': 7.00, 'WTR 052': 9.00 },
}

const STATE_TO_REGION: Record<string, string> = {
  AL: 'southeast', AR: 'southeast', FL: 'southeast', GA: 'southeast', KY: 'southeast',
  LA: 'southeast', MS: 'southeast', NC: 'southeast', SC: 'southeast', TN: 'southeast', VA: 'southeast',
  CT: 'northeast', DC: 'northeast', DE: 'northeast', MA: 'northeast', MD: 'northeast',
  ME: 'northeast', NH: 'northeast', NJ: 'northeast', NY: 'northeast', PA: 'northeast',
  RI: 'northeast', VT: 'northeast',
  AZ: 'west', CA: 'west', CO: 'west', HI: 'west', ID: 'west', MT: 'west',
  NM: 'west', NV: 'west', OR: 'west', UT: 'west', WA: 'west', WY: 'west',
  // Everything else is midwest
}

export function getXactimatePricing(lineItemCode: string, state: string): number {
  const region = STATE_TO_REGION[state?.toUpperCase()] || 'midwest'
  const prices = REGION_PRICING[region] || REGION_PRICING.midwest
  return prices[lineItemCode] || 0
}

/** The main scope: seven lines, every quantity derived from the roof's squares. */
export function generateLineItems(totalSquares: number, state: string): XactLineItem[] {
  const wasteAdjustedSquares = Math.round((totalSquares * 1.1) * 100) / 100 // 10% waste factor
  const perimeterLF = Math.round(Math.sqrt(totalSquares * 100) * 4) // rough perimeter estimate
  const ridgeLF = Math.round(perimeterLF * 0.25) // ~25% of perimeter is ridge
  const eaveLF = Math.round(perimeterLF * 0.5) // ~50% is eave
  const iceWaterSQ = Math.round((eaveLF * 3 / 100) * 100) / 100 // 3ft width along eave
  const flashingLF = Math.round(perimeterLF * 0.15) // ~15% needs flashing

  const line = (code: string, description: string, qty: number, unit: string): XactLineItem =>
    ({ code, description, qty, unit, unitPrice: getXactimatePricing(code, state), total: 0 })
  const items: XactLineItem[] = [
    line('RFG 220', 'Remove asphalt shingles - comp.', totalSquares, 'SQ'),
    line('RFG 240', 'Asphalt shingles - 30 yr - comp.', wasteAdjustedSquares, 'SQ'),
    line('RFG 252', 'Roofing felt - 30 lb', totalSquares, 'SQ'),
    line('RFG 300', 'Drip edge', perimeterLF, 'LF'),
    line('RFG 180', 'Ice & water shield', iceWaterSQ, 'SQ'),
    line('RFG 350', 'Ridge cap shingles', ridgeLF, 'LF'),
    line('WTR 052', 'Flashing - step/counter', flashingLF, 'LF'),
  ]
  items.forEach((item) => { item.total = Math.round(item.qty * item.unitPrice * 100) / 100 })
  return items
}

export function generateCSV(lineItems: XactLineItem[], supplementItems: XactLineItem[]): string {
  const rows = ['Code,Description,Qty,Unit,Unit Price,Total']
  for (const item of lineItems) {
    rows.push(`${item.code},"${item.description}",${item.qty},${item.unit},${item.unitPrice.toFixed(2)},${item.total.toFixed(2)}`)
  }
  for (const item of supplementItems) {
    rows.push(`SUP-${item.code},"${item.description}",${item.qty},${item.unit},${item.unitPrice.toFixed(2)},${item.total.toFixed(2)}`)
  }
  return rows.join('\n')
}

export interface ScopeTotals {
  subtotal: number; overhead: number; profit: number; tax: number; rcvTotal: number
  depreciation: number; acvTotal: number; deductible: number; netClaim: number
}

/** A calendar day stored at UTC midnight, as a person reads it. */
const calendarDay = (d: any) => new Date(d).toLocaleDateString('en-US', { timeZone: 'UTC' })

function generatePDF(
  claim: any, job: any, comp: any, measurement: any,
  lineItems: XactLineItem[], supplementItems: XactLineItem[], totals: ScopeTotals, timeZone: string,
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 50, size: 'LETTER' })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)

    // ── HEADER ──
    doc.fontSize(18).font('Helvetica-Bold').text('SCOPE OF WORK', { align: 'center' })
    doc.fontSize(10).font('Helvetica').text('Xactimate-Format Scope Document', { align: 'center' })
    doc.moveDown(1)

    // Claim info
    doc.fontSize(9).font('Helvetica-Bold').text('CLAIM INFORMATION')
    doc.font('Helvetica').fontSize(9)
    doc.text(`Claim #: ${claim.claimNumber}        Insurance: ${claim.insuranceCompany}`)
    doc.text(`Adjuster: ${claim.adjusterName || 'N/A'}        Phone: ${claim.adjusterPhone || 'N/A'}`)
    doc.text(`Date of Loss: ${claim.dateOfLoss ? calendarDay(claim.dateOfLoss) : 'N/A'}        Cause: ${(claim.causeOfLoss || 'N/A').replace('_', ' ')}`)
    doc.text(`Property: ${job.address}, ${job.city}, ${job.state} ${job.zip}`)
    doc.text(`Report Date: ${new Date().toLocaleDateString('en-US', { timeZone })}`)
    if (comp) {
      doc.text(`Contractor: ${comp.name}    Phone: ${comp.phone || 'N/A'}    Email: ${comp.email || 'N/A'}`)
    }
    doc.moveDown(0.5)

    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.5)

    // Measurements
    const totalSquares = measurement?.totalSquares || job.totalSquares || 0
    const totalArea = measurement?.totalArea || (Number(totalSquares) * 100)
    const segments: any[] = Array.isArray(measurement?.segments) ? measurement.segments : []

    doc.font('Helvetica-Bold').text('MEASUREMENTS')
    doc.font('Helvetica')
    doc.text(`Total Roof Area: ${Number(totalArea).toLocaleString('en-US')} sq ft`)
    doc.text(`Total Squares: ${totalSquares} (waste-adjusted: ${(Number(totalSquares) * 1.1).toFixed(1)})`)
    doc.text(`Stories: ${job.stories || 'N/A'}    Roof Type: ${job.roofType || 'N/A'}`)

    if (segments.length > 0) {
      doc.moveDown(0.3)
      doc.font('Helvetica-Bold').fontSize(8).text('ROOF SEGMENTS:', { underline: true })
      doc.font('Helvetica').fontSize(8)
      for (const seg of segments) {
        doc.text(`  ${seg.name}: ${Number(seg.area).toLocaleString('en-US')} sqft  |  Pitch: ${seg.pitch}  |  Azimuth: ${seg.azimuthDegrees || 'N/A'}°`)
      }
    }
    doc.moveDown(0.5)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.5)

    // Line items table
    doc.font('Helvetica-Bold').fontSize(9).text('SCOPE OF WORK — LINE ITEMS')
    doc.moveDown(0.3)

    const tableTop = doc.y
    const col = { code: 50, desc: 110, qty: 340, unit: 385, price: 425, total: 490 }
    doc.fontSize(8).font('Helvetica-Bold')
    doc.text('Code', col.code, tableTop)
    doc.text('Description', col.desc, tableTop)
    doc.text('Qty', col.qty, tableTop, { width: 40, align: 'right' })
    doc.text('Unit', col.unit, tableTop, { width: 35, align: 'center' })
    doc.text('Unit $', col.price, tableTop, { width: 55, align: 'right' })
    doc.text('Total', col.total, tableTop, { width: 60, align: 'right' })
    doc.moveDown(0.3)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.2)

    doc.font('Helvetica').fontSize(8)
    const allItems = [...lineItems, ...supplementItems.map((i) => ({ ...i, code: `SUP-${i.code}` }))]
    for (const item of allItems) {
      if (doc.y > 700) doc.addPage()
      const ly = doc.y
      doc.text(item.code, col.code, ly)
      doc.text(item.description, col.desc, ly, { width: 220 })
      doc.text(String(item.qty), col.qty, ly, { width: 40, align: 'right' })
      doc.text(item.unit, col.unit, ly, { width: 35, align: 'center' })
      doc.text(`${money(item.unitPrice)}`, col.price, ly, { width: 55, align: 'right' })
      doc.text(`${money(item.total)}`, col.total, ly, { width: 60, align: 'right' })
      doc.moveDown(0.4)
    }

    doc.moveDown(0.3)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.5)

    // Totals
    doc.font('Helvetica-Bold').fontSize(9).text('TOTALS')
    doc.font('Helvetica').fontSize(9)
    const totLeft = 380
    const totRight = 490
    const tw = 60
    const printTotal = (label: string, amount: number) => {
      const y = doc.y
      doc.text(label, totLeft, y, { width: 100, align: 'right' })
      doc.text(`$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, totRight, y, { width: tw, align: 'right' })
      doc.moveDown(0.3)
    }

    printTotal('Subtotal:', totals.subtotal)
    printTotal('Overhead (10%):', totals.overhead)
    printTotal('Profit (10%):', totals.profit)
    printTotal('Tax:', totals.tax)
    doc.font('Helvetica-Bold')
    printTotal('RCV Total:', totals.rcvTotal)
    doc.font('Helvetica')
    printTotal('Depreciation:', totals.depreciation)
    printTotal('ACV Total:', totals.acvTotal)
    printTotal('Deductible:', totals.deductible)
    doc.font('Helvetica-Bold')
    printTotal('Net Claim:', totals.netClaim)

    doc.moveDown(1)
    doc.font('Helvetica').fontSize(7).fillColor('#999999')
    doc.text('Generated by Twomiah Roof CRM — Xactimate-compatible format', 50, doc.y, { align: 'center' })

    doc.end()
  })
}

/** Which document the scope is: the ask sent to the carrier, or the scope as settled. (T41) */
export type XactBasis = 'ask' | 'approved'

/**
 * IS THIS SUPPLEMENT IN THE DOCUMENT? One predicate, so the count reported beside the document is computed from the same
 * rule as its contents (T58c: "supplementsIncluded still reports 8 instead of 2").
 *
 * A draft was never sent to anybody, so it is in neither the ask nor the settlement (T41); the approved basis keeps
 * only what the carrier approved; a supplement with no line items contributes nothing and is not announced.
 */
export function supplementIsIncluded(sup: any, basis: XactBasis = 'ask'): boolean {
  if (!sup) return false
  if (sup.status === 'draft') return false
  if (basis === 'approved' && sup.status !== 'approved') return false
  const items = Array.isArray(sup.lineItems) ? sup.lineItems : null
  return !!items && items.length > 0
}

/**
 * WHICH SUPPLEMENTS GO IN, AND AT WHAT AMOUNTS. (T41; roof T18 D3)
 *
 *   'ask'      (default) every supplement handed in (the caller has already dropped denied ones), at the amounts
 *              requested — the document sent to the carrier.
 *   'approved' only supplements the carrier approved, reconciled to approved_amount with ONE explicit adjustment line:
 *              an approved amount is a lump sum, and spreading it across the lines would invent detail the carrier
 *              never sent.
 */
export function buildSupplementItems(supplements: any[], basis: XactBasis = 'ask'): XactLineItem[] {
  const approvedOnly = basis === 'approved'
  const out: XactLineItem[] = []
  for (const sup of supplements || []) {
    if (!supplementIsIncluded(sup, basis)) continue
    const items = Array.isArray(sup.lineItems) ? sup.lineItems : []
    let requested = 0
    for (const li of items) {
      const lineTotal = Number(li.total || 0)
      requested += lineTotal
      out.push({
        code: li.code || 'MISC',
        description: li.description,
        qty: Number(li.qty || 0),
        unit: li.unit || 'EA',
        unitPrice: Number(li.unitPrice || 0),
        total: lineTotal,
      })
    }
    if (approvedOnly && sup.approvedAmount != null && sup.approvedAmount !== '') {
      const approved = Number(sup.approvedAmount)
      const delta = Math.round((approved - requested) * 100) / 100
      if (Number.isFinite(delta) && Math.abs(delta) >= 0.005) {
        out.push({
          code: 'ADJ',
          description: `Approved adjustment — supplement ${sup.supplementNumber || sup.id}`,
          qty: 1,
          unit: 'EA',
          unitPrice: delta,
          total: delta,
        })
      }
    }
  }
  return out
}

/** The four documents a claim can have: the ask and the approved scope, each as a PDF and a CSV. */
export const SCOPE_FILES = ['xactimate-scope.pdf', 'xactimate-export.csv', 'xactimate-scope-approved.pdf', 'xactimate-export-approved.csv'] as const
export type ScopeFile = typeof SCOPE_FILES[number]
/** Where a claim's document is kept (the template's keys, unchanged, so a stored document moves across as it is). */
export const scopeKey = (companyId: string, claimId: string, file: ScopeFile) => `insurance/${companyId}/${claimId}/${file}`
/** The signed-in address the screen opens it at (server/crm/roof/insurance/insurance.ts GET /claims/:claimId/files/:file). */
export const scopeUrl = (claimId: string, file: ScopeFile) => `/api/insurance/claims/${claimId}/files/${file}`

export async function generateXactimateScopeDocument(
  claim: any, job: any, comp: any, measurement: any, supplements: any[],
  basis: XactBasis,
  out: { put: (key: string, body: Buffer, contentType: string) => Promise<unknown>; timeZone: string },
) {
  const totalSquares = Number(measurement?.totalSquares || job.totalSquares || 0)
  const state = job.state || 'TX'

  const lineItems = generateLineItems(totalSquares, state)
  const approvedOnly = basis === 'approved'
  const supplementItems = buildSupplementItems(supplements, basis)

  const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0) + supplementItems.reduce((sum, i) => sum + i.total, 0)
  const overhead = subtotal * 0.10
  const profit = subtotal * 0.10
  const tax = 0 // typically no tax on insurance scope
  const rcvTotal = subtotal + overhead + profit + tax
  const depreciation = claim.depreciationHeld ? Number(claim.depreciationHeld) : (rcvTotal - (claim.acv ? Number(claim.acv) : rcvTotal * 0.8))
  const acvTotal = rcvTotal - Math.max(0, depreciation)
  const deductible = Number(claim.deductible || 0)
  const netClaim = acvTotal - deductible

  const totals: ScopeTotals = {
    subtotal: Math.round(subtotal * 100) / 100,
    overhead: Math.round(overhead * 100) / 100,
    profit: Math.round(profit * 100) / 100,
    tax,
    rcvTotal: Math.round(rcvTotal * 100) / 100,
    depreciation: Math.round(depreciation * 100) / 100,
    acvTotal: Math.round(acvTotal * 100) / 100,
    deductible,
    netClaim: Math.round(netClaim * 100) / 100,
  }

  // The two bases are two documents and must not overwrite each other's file: a contractor who generates the approved
  // scope still needs the ask they sent. (T41)
  const csvFile: ScopeFile = approvedOnly ? 'xactimate-export-approved.csv' : 'xactimate-export.csv'
  const pdfFile: ScopeFile = approvedOnly ? 'xactimate-scope-approved.pdf' : 'xactimate-scope.pdf'

  await out.put(scopeKey(claim.companyId, claim.id, csvFile), Buffer.from(generateCSV(lineItems, supplementItems), 'utf-8'), 'text/csv')
  const pdfBuffer = await generatePDF(claim, job, comp, measurement, lineItems, supplementItems, totals, out.timeZone)
  await out.put(scopeKey(claim.companyId, claim.id, pdfFile), pdfBuffer, 'application/pdf')

  return {
    pdfUrl: scopeUrl(claim.id, pdfFile),
    csvUrl: scopeUrl(claim.id, csvFile),
    lineItems,
    supplementItems,
    totals,
    basis,
    supplementsIncluded: (supplements || []).filter((s: any) => supplementIsIncluded(s, basis)).length,
  }
}
