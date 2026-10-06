// Xactimate-compatible scope document and CSV export generator
import PDFDocument from 'pdfkit'
import { uploadFile } from './storage.ts'
import { money } from '../shared/invoicing/money.ts'

// ── Xactimate line item codes & regional pricing ──────

interface XactLineItem {
  code: string
  description: string
  qty: number
  unit: string
  unitPrice: number
  total: number
}

const REGION_PRICING: Record<string, Record<string, number>> = {
  // Midwest states
  midwest: {
    'RFG 220': 85,    // Remove asphalt shingles per SQ
    'RFG 240': 185,   // Asphalt shingles 30yr per SQ
    'RFG 252': 22,    // Roofing felt 30lb per SQ
    'RFG 300': 3.50,  // Drip edge per LF
    'RFG 180': 95,    // Ice & water shield per SQ
    'RFG 350': 6.50,  // Ridge cap per LF
    'WTR 052': 8.50,  // Flashing per LF
  },
  southeast: {
    'RFG 220': 80,
    'RFG 240': 175,
    'RFG 252': 20,
    'RFG 300': 3.25,
    'RFG 180': 90,
    'RFG 350': 6.00,
    'WTR 052': 8.00,
  },
  northeast: {
    'RFG 220': 95,
    'RFG 240': 210,
    'RFG 252': 25,
    'RFG 300': 4.00,
    'RFG 180': 105,
    'RFG 350': 7.50,
    'WTR 052': 9.50,
  },
  west: {
    'RFG 220': 90,
    'RFG 240': 200,
    'RFG 252': 24,
    'RFG 300': 3.75,
    'RFG 180': 100,
    'RFG 350': 7.00,
    'WTR 052': 9.00,
  },
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

function generateLineItems(totalSquares: number, state: string): XactLineItem[] {
  const wasteAdjustedSquares = Math.round((totalSquares * 1.1) * 100) / 100 // 10% waste factor
  const perimeterLF = Math.round(Math.sqrt(totalSquares * 100) * 4) // rough perimeter estimate
  const ridgeLF = Math.round(perimeterLF * 0.25) // ~25% of perimeter is ridge
  const eaveLF = Math.round(perimeterLF * 0.5) // ~50% is eave
  const iceWaterSQ = Math.round((eaveLF * 3 / 100) * 100) / 100 // 3ft width along eave
  const flashingLF = Math.round(perimeterLF * 0.15) // ~15% needs flashing

  const items: XactLineItem[] = [
    {
      code: 'RFG 220',
      description: 'Remove asphalt shingles - comp.',
      qty: totalSquares,
      unit: 'SQ',
      unitPrice: getXactimatePricing('RFG 220', state),
      total: 0,
    },
    {
      code: 'RFG 240',
      description: 'Asphalt shingles - 30 yr - comp.',
      qty: wasteAdjustedSquares,
      unit: 'SQ',
      unitPrice: getXactimatePricing('RFG 240', state),
      total: 0,
    },
    {
      code: 'RFG 252',
      description: 'Roofing felt - 30 lb',
      qty: totalSquares,
      unit: 'SQ',
      unitPrice: getXactimatePricing('RFG 252', state),
      total: 0,
    },
    {
      code: 'RFG 300',
      description: 'Drip edge',
      qty: perimeterLF,
      unit: 'LF',
      unitPrice: getXactimatePricing('RFG 300', state),
      total: 0,
    },
    {
      code: 'RFG 180',
      description: 'Ice & water shield',
      qty: iceWaterSQ,
      unit: 'SQ',
      unitPrice: getXactimatePricing('RFG 180', state),
      total: 0,
    },
    {
      code: 'RFG 350',
      description: 'Ridge cap shingles',
      qty: ridgeLF,
      unit: 'LF',
      unitPrice: getXactimatePricing('RFG 350', state),
      total: 0,
    },
    {
      code: 'WTR 052',
      description: 'Flashing - step/counter',
      qty: flashingLF,
      unit: 'LF',
      unitPrice: getXactimatePricing('WTR 052', state),
      total: 0,
    },
  ]

  items.forEach(item => { item.total = Math.round(item.qty * item.unitPrice * 100) / 100 })
  return items
}

function generateCSV(lineItems: XactLineItem[], supplementItems: XactLineItem[]): string {
  const rows = ['Code,Description,Qty,Unit,Unit Price,Total']
  for (const item of lineItems) {
    rows.push(`${item.code},"${item.description}",${item.qty},${item.unit},${item.unitPrice.toFixed(2)},${item.total.toFixed(2)}`)
  }
  for (const item of supplementItems) {
    rows.push(`SUP-${item.code},"${item.description}",${item.qty},${item.unit},${item.unitPrice.toFixed(2)},${item.total.toFixed(2)}`)
  }
  return rows.join('\n')
}

function generatePDF(
  claim: any, job: any, comp: any, measurement: any,
  lineItems: XactLineItem[], supplementItems: XactLineItem[],
  totals: { subtotal: number; overhead: number; profit: number; tax: number; rcvTotal: number; depreciation: number; acvTotal: number; deductible: number; netClaim: number }
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
    doc.text(`Date of Loss: ${claim.dateOfLoss ? new Date(claim.dateOfLoss).toLocaleDateString() : 'N/A'}        Cause: ${(claim.causeOfLoss || 'N/A').replace('_', ' ')}`)
    doc.text(`Property: ${job.propertyAddress}, ${job.city}, ${job.state} ${job.zip}`)
    doc.text(`Report Date: ${new Date().toLocaleDateString()}`)
    if (comp) {
      doc.text(`Contractor: ${comp.name}    Phone: ${comp.phone || 'N/A'}    Email: ${comp.email || 'N/A'}`)
    }
    doc.moveDown(0.5)

    // Divider
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.5)

    // Measurements
    const totalSquares = measurement?.totalSquares || job.totalSquares || 0
    const totalArea = measurement?.totalArea || (Number(totalSquares) * 100)
    const segments: any[] = measurement?.segments || []

    doc.font('Helvetica-Bold').text('MEASUREMENTS')
    doc.font('Helvetica')
    doc.text(`Total Roof Area: ${Number(totalArea).toLocaleString()} sq ft`)
    doc.text(`Total Squares: ${totalSquares} (waste-adjusted: ${(Number(totalSquares) * 1.1).toFixed(1)})`)
    doc.text(`Stories: ${job.stories || 'N/A'}    Roof Type: ${job.roofType || 'N/A'}`)

    if (segments.length > 0) {
      doc.moveDown(0.3)
      doc.font('Helvetica-Bold').fontSize(8).text('ROOF SEGMENTS:', { underline: true })
      doc.font('Helvetica').fontSize(8)
      for (const seg of segments) {
        doc.text(`  ${seg.name}: ${Number(seg.area).toLocaleString()} sqft  |  Pitch: ${seg.pitch}  |  Azimuth: ${seg.azimuthDegrees || 'N/A'}°`)
      }
    }
    doc.moveDown(0.5)
    doc.moveTo(50, doc.y).lineTo(562, doc.y).stroke()
    doc.moveDown(0.5)

    // Line items table
    doc.font('Helvetica-Bold').fontSize(9).text('SCOPE OF WORK — LINE ITEMS')
    doc.moveDown(0.3)

    // Table header
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
    const allItems = [...lineItems, ...supplementItems.map(i => ({ ...i, code: `SUP-${i.code}` }))]
    for (const item of allItems) {
      const y = doc.y
      if (y > 700) { doc.addPage(); }
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
      doc.text(`$${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`, totRight, y, { width: tw, align: 'right' })
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
 * WHICH SUPPLEMENTS GO IN, AND AT WHAT AMOUNTS. (T41)
 *
 * T41 reported that this export "carries drafts and requested amounts instead of approved amounts".
 * That was true, and it was also DELIBERATE: roof T18 D3 settled that this document is the ASK, not
 * the settlement — so a draft or a submitted supplement belongs in it, and the figure to print is
 * what is being asked for. Silently flipping that would have undone a decision made for a reason,
 * and left a contractor unable to produce the document they actually send to the carrier.
 *
 * But the request behind the report was real: once the carrier has responded, a contractor needs the
 * scope AS APPROVED, and asking for that got them the ask — overstating the settlement. One document
 * was serving two jobs. So the basis is explicit and the default is unchanged:
 *
 *   'ask'      (default) every supplement handed in (the caller has already dropped denied ones),
 *                        at the amounts requested. T18 D3 stands.
 *   'approved'           only supplements the carrier approved, reconciled to approved_amount.
 *
 * In 'approved' mode a supplement's line items are printed AS REQUESTED and the difference between
 * them and approved_amount is added as ONE explicit adjustment line. An approved amount is a lump
 * sum: spreading it across the lines pro rata would invent per-line detail the carrier never sent,
 * whereas an adjustment line is honest and checks against the carrier's letter.
 *
 * Pure and exported so it can be tested: the document builder around it writes a PDF to R2, which a
 * test sandbox has no credentials for, so the decision this function makes is the testable part.
 */
/**
 * IS THIS SUPPLEMENT IN THE DOCUMENT? One predicate, because the count disagreed with the document.
 * (T58c)
 *
 *   Owner: "supplementsIncluded still reports 8 instead of 2."
 *
 * It did. buildSupplementItems below skips drafts on BOTH bases — a draft has not been sent to
 * anybody, so it is in neither the ask nor the settlement — but the count at the end of
 * generateXactimateScopeDocument was written as `!approvedOnly || status === 'approved'`, and on the
 * 'ask' basis `!approvedOnly` is true, so it counted everything the query returned. Eight supplements
 * announced on a document built from two.
 *
 * That is the shape of fault this campaign keeps producing: the rule written twice, in two places,
 * and the second copy disagreeing. So the rule is a function now and both callers use it — the
 * count cannot drift from the contents again.
 *
 * A supplement with no line items is excluded too, because it contributes nothing to the scope and
 * announcing it would overstate the document just as surely.
 */
export function supplementIsIncluded(sup: any, basis: XactBasis = 'ask'): boolean {
  if (!sup) return false
  if (sup.status === 'draft') return false
  if (basis === 'approved' && sup.status !== 'approved') return false
  const items = Array.isArray(sup.lineItems) ? sup.lineItems : null
  return !!items && items.length > 0
}

export function buildSupplementItems(supplements: any[], basis: XactBasis = 'ask'): XactLineItem[] {
  const approvedOnly = basis === 'approved'
  const out: XactLineItem[] = []
  for (const sup of supplements || []) {
    /**
     * A DRAFT WAS NEVER SENT TO ANYBODY, so it is in neither document. (T41)
     *
     *   "Xactimate export carries the wrong supplements: it includes three never-submitted drafts
     *    ($450) and SUP-001 at its requested $200 instead of the approved $1,100, so the scope
     *    reads RCV $780 against an approved $1,100."
     *
     * The second half of that is what the `basis` argument fixed. This is the first half, and it
     * applies to BOTH bases — not only the approved one. The 'ask' document is defined as "the scope
     * sent to the carrier"; a draft is the office still writing one, so putting it in the ask
     * overstates what was actually asked for and hands the carrier a document the contractor cannot
     * stand behind. Submitted, approved and denied have all been sent; draft has not.
     */
    // The three conditions above now live in supplementIsIncluded, so the COUNT reported at the end
    // of the document is computed from the same rule rather than a second copy of it. (T58c)
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

export async function generateXactimateScopeDocument(
  claim: any, job: any, comp: any, measurement: any, supplements: any[],
  /** 'ask' (default, the document sent to the carrier) or 'approved' (the settled scope). (T41) */
  basis: XactBasis = 'ask',
) {
  const totalSquares = Number(measurement?.totalSquares || job.totalSquares || 0)
  const state = job.state || 'TX'

  // Generate main scope line items
  const lineItems = generateLineItems(totalSquares, state)

  /**
   * Collect supplement line items — see buildSupplementItems for which, and at what amounts.
   */
  const approvedOnly = basis === 'approved'
  const supplementItems = buildSupplementItems(supplements, basis)

  // Calculate totals
  const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0) +
    supplementItems.reduce((sum, i) => sum + i.total, 0)
  const overhead = subtotal * 0.10
  const profit = subtotal * 0.10
  const tax = 0 // typically no tax on insurance scope
  const rcvTotal = subtotal + overhead + profit + tax
  const depreciation = claim.depreciationHeld ? Number(claim.depreciationHeld) : (rcvTotal - (claim.acv ? Number(claim.acv) : rcvTotal * 0.8))
  const acvTotal = rcvTotal - Math.max(0, depreciation)
  const deductible = Number(claim.deductible || 0)
  const netClaim = acvTotal - deductible

  const totals = {
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

  // The two bases are two different documents and must not overwrite each other's file: a contractor
  // who generates the approved scope still needs the ask they sent. The 'ask' keys keep their
  // original names so links already stored on existing claims keep resolving. (T41)
  const suffix = approvedOnly ? '-approved' : ''

  // Generate CSV
  const csvContent = generateCSV(lineItems, supplementItems)
  const csvBuffer = Buffer.from(csvContent, 'utf-8')
  const csvKey = `insurance/${claim.companyId}/${claim.id}/xactimate-export${suffix}.csv`
  const csvUrl = await uploadFile(csvKey, csvBuffer, 'text/csv')

  // Generate PDF
  const pdfBuffer = await generatePDF(claim, job, comp, measurement, lineItems, supplementItems, totals)
  const pdfKey = `insurance/${claim.companyId}/${claim.id}/xactimate-scope${suffix}.pdf`
  const pdfUrl = await uploadFile(pdfKey, pdfBuffer, 'application/pdf')

  return {
    pdfUrl,
    csvUrl,
    lineItems,
    supplementItems,
    totals,
    // So the screen can say which document it just built, and the activity log can record it.
    basis,
    // The same predicate buildSupplementItems applies — see supplementIsIncluded. This used to read
    // `!approvedOnly || s.status === 'approved'`, which on the ask basis counted every row the query
    // returned, drafts included: 8 announced on a document built from 2. (T58c)
    supplementsIncluded: (supplements || []).filter((s: any) => supplementIsIncluded(s, basis)).length,
  }
}
