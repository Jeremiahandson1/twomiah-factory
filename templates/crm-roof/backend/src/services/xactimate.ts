// Xactimate-compatible scope document and CSV export generator
import PDFDocument from 'pdfkit'
import { uploadFile } from './storage.ts'

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
      doc.text(`$${item.unitPrice.toFixed(2)}`, col.price, ly, { width: 55, align: 'right' })
      doc.text(`$${item.total.toFixed(2)}`, col.total, ly, { width: 60, align: 'right' })
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

export async function generateXactimateScopeDocument(
  claim: any, job: any, comp: any, measurement: any, supplements: any[]
) {
  const totalSquares = Number(measurement?.totalSquares || job.totalSquares || 0)
  const state = job.state || 'TX'

  // Generate main scope line items
  const lineItems = generateLineItems(totalSquares, state)

  // Collect supplement line items
  const supplementItems: XactLineItem[] = []
  for (const sup of supplements) {
    if (!sup.lineItems) continue
    const items = Array.isArray(sup.lineItems) ? sup.lineItems : []
    for (const li of items) {
      supplementItems.push({
        code: li.code || 'MISC',
        description: li.description,
        qty: Number(li.qty || 0),
        unit: li.unit || 'EA',
        unitPrice: Number(li.unitPrice || 0),
        total: Number(li.total || 0),
      })
    }
  }

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

  // Generate CSV
  const csvContent = generateCSV(lineItems, supplementItems)
  const csvBuffer = Buffer.from(csvContent, 'utf-8')
  const csvKey = `insurance/${claim.companyId}/${claim.id}/xactimate-export.csv`
  const csvUrl = await uploadFile(csvKey, csvBuffer, 'text/csv')

  // Generate PDF
  const pdfBuffer = await generatePDF(claim, job, comp, measurement, lineItems, supplementItems, totals)
  const pdfKey = `insurance/${claim.companyId}/${claim.id}/xactimate-scope.pdf`
  const pdfUrl = await uploadFile(pdfKey, pdfBuffer, 'application/pdf')

  return {
    pdfUrl,
    csvUrl,
    lineItems,
    supplementItems,
    totals,
  }
}
