// Long-term care insurance (item 3, care_ltc_billing): the client's policy and claim numbers, and a CLAIM PACKET — one PDF per
// invoice billed to a long-term-care payer — that the insurer asks for with a claim: a cover sheet (who, which policy and claim,
// which period, what is owed), every service by date with the caregiver and times, and the days that went over the policy's
// daily maximum. It reads the invoice as it is; nothing is changed or recalculated, so the invoice engine's guards stand.
//
// Not here: sending the packet to the insurer (the office downloads it and sends it), an insurer's own claim form, and
// splitting an invoice between the insurer and the family (the family's share is the office's to invoice).
import PDFDocument from 'pdfkit'
import { and, eq } from 'drizzle-orm'
import { clientLtcPolicy, clients } from '../../../db/schema/index.ts'
import { LTC_PAYER_TYPE, ltcInvoices, packetHeader, packetLines } from '../../../data/homecareLtc.ts'
import type { CrmDeps } from '../../deps.ts'
import { lineQuantity } from './invoiceEngine.ts'

export const LTC_FEATURE = 'care_ltc_billing'
export { LTC_PAYER_TYPE }
const POLICY_FIELDS = ['insuredName', 'policyNumber', 'claimNumber', 'notes'] as const

const money = (n: number) => `$${n.toFixed(2)}`
const usDate = (ymd: string | null | undefined) => (ymd ? `${ymd.slice(5, 7)}/${ymd.slice(8, 10)}/${ymd.slice(0, 4)}` : '')
const time12 = (hm: string | null | undefined) => {
  if (!hm) return ''
  const [h, m] = hm.split(':').map(Number)
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const address = (...p: Array<string | null | undefined>) => p.filter(Boolean).join(', ')

export interface DayTotal { date: string; total: number; over: number }
/** Each service day's total, and how much of it is above the policy's daily maximum (0 when there is none). Pure. */
export function dayTotals(lines: Array<{ serviceDate: string | null; amount: unknown }>, dailyMax: number | null): DayTotal[] {
  const by = new Map<string, number>()
  for (const l of lines) if (l.serviceDate) by.set(l.serviceDate, Math.round(((by.get(l.serviceDate) ?? 0) + Number(l.amount || 0)) * 100) / 100)
  return [...by.entries()].sort().map(([date, total]) => ({ date, total, over: dailyMax && total > dailyMax ? Math.round((total - dailyMax) * 100) / 100 : 0 }))
}

export type Packet = { pdf: Buffer; fileName: string } | { problem: string; code: string; status: number }

export function createLtc(d: CrmDeps) {
  const policyOf = async (companyId: string, clientId: string) =>
    (await d.db.select().from(clientLtcPolicy).where(and(eq(clientLtcPolicy.companyId, companyId), eq(clientLtcPolicy.clientId, clientId))).limit(1))[0] ?? null

  async function getPolicy(companyId: string, clientId: string) {
    const [client] = await d.db.select({ id: clients.id }).from(clients).where(and(eq(clients.id, clientId), eq(clients.companyId, companyId))).limit(1)
    if (!client) return null
    const p = await policyOf(companyId, clientId)
    return { clientId, insuredName: p?.insuredName ?? null, policyNumber: p?.policyNumber ?? null, claimNumber: p?.claimNumber ?? null, dailyMax: p?.dailyMax != null ? Number(p.dailyMax) : null, notes: p?.notes ?? null }
  }

  /** Save the client's policy. Blank fields are cleared. Returns the saved policy, or the reason it was refused. */
  async function savePolicy(companyId: string, clientId: string, b: any, userId?: string | null): Promise<NonNullable<Awaited<ReturnType<typeof getPolicy>>> | { problem: string; status: number }> {
    if (!(await getPolicy(companyId, clientId))) return { problem: 'Client not found', status: 404 }
    const values: Record<string, any> = {}
    for (const k of POLICY_FIELDS) if (b?.[k] !== undefined) values[k] = b[k] === null ? null : String(b[k]).trim().slice(0, k === 'notes' ? 1000 : 120) || null
    if (b?.dailyMax !== undefined) {
      if (b.dailyMax === null || b.dailyMax === '') values.dailyMax = null
      else {
        const n = Number(b.dailyMax)
        if (!Number.isFinite(n) || n <= 0 || n > 100000) return { problem: 'The daily maximum must be an amount above zero.', status: 400 }
        values.dailyMax = n.toFixed(2)
      }
    }
    const existing = await policyOf(companyId, clientId)
    if (existing) await d.db.update(clientLtcPolicy).set({ ...values, updatedBy: userId || null, updatedAt: new Date() }).where(eq(clientLtcPolicy.id, existing.id))
    else await d.db.insert(clientLtcPolicy).values({ companyId, clientId, ...values, updatedBy: userId || null }).onConflictDoNothing()
    return (await getPolicy(companyId, clientId))!
  }

  /** The invoice's claim packet, or why it cannot be made. */
  async function claimPacket(companyId: string, invoiceId: string): Promise<Packet> {
    const head = await packetHeader(d.db, companyId, invoiceId)
    if (!head) return { problem: 'Invoice not found', code: 'not_found', status: 404 }
    if (head.payerType !== LTC_PAYER_TYPE) return { problem: 'This invoice is not billed to a long-term care insurance payer. Set the client\'s payer to one first.', code: 'not_ltc', status: 400 }
    if (!head.sentAt) return { problem: 'This invoice has not been sent yet — a claim packet is made from a sent invoice, so the figures cannot change under it.', code: 'draft', status: 400 }
    const policy = await getPolicy(companyId, head.clientId)
    if (!policy?.policyNumber) return { problem: 'Enter the client\'s policy number first (Long-term care billing › policy).', code: 'no_policy', status: 400 }
    const lines = await packetLines(d.db, companyId, invoiceId)
    const number = String(head.seqNumber ?? head.invoiceNumber)
    return { pdf: await render(head, policy, lines), fileName: `claim-packet-invoice-${number}.pdf` }
  }

  function render(head: any, policy: NonNullable<Awaited<ReturnType<typeof getPolicy>>>, lines: any[]): Promise<Buffer> {
    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({ margin: 54, compress: false })
      const chunks: Buffer[] = []
      doc.on('data', (c: Buffer) => chunks.push(c))
      doc.on('end', () => resolve(Buffer.concat(chunks)))
      doc.on('error', reject)
      const total = Number(head.total), paid = Number(head.amountPaid || 0), adjusted = Number(head.amountAdjusted || 0)
      const days = dayTotals(lines, policy.dailyMax)
      const over = days.reduce((a, x) => a + x.over, 0)
      const insured = policy.insuredName || `${head.clientFirst} ${head.clientLast}`
      const number = String(head.seqNumber ?? head.invoiceNumber)

      doc.fontSize(18).text(head.agencyName || 'Our agency')
      doc.fontSize(9).fillColor('#444').text(address(head.agencyAddress, head.agencyCity, head.agencyState, head.agencyZip))
      doc.text([head.agencyPhone, head.agencyEmail].filter(Boolean).join('  ·  '))
      doc.fillColor('#000').moveDown()
      doc.fontSize(15).text('Long-term care insurance — claim packet')
      doc.moveDown(0.5).fontSize(10)
      const row = (k: string, v: string | null | undefined) => { if (v) { doc.font('Helvetica-Bold').text(`${k}: `, { continued: true }).font('Helvetica').text(v) } }
      row('Insurer', head.payerName)
      row('Insurer address', address(head.payerAddress, head.payerCity, head.payerState, head.payerZip))
      row('Insurer ID', head.payerIdNumber)
      doc.moveDown(0.5)
      row('Insured', insured)
      row('Date of birth', usDate(head.clientDob))
      row('Address', address(head.clientAddress, head.clientCity, head.clientState, head.clientZip))
      row('Policy number', policy.policyNumber)
      row('Claim number', policy.claimNumber)
      if (policy.dailyMax) row('Policy daily maximum', money(policy.dailyMax))
      doc.moveDown(0.5)
      row('Invoice', `#${number}`)
      row('Dates of service', `${usDate(head.periodStart)} – ${usDate(head.periodEnd)}`)
      row('Total charges', money(total))
      row('Already paid', money(paid))
      if (adjusted) row('Written off', money(adjusted))
      row('Balance on the invoice', money(Math.max(0, total - paid - adjusted)))
      if (over > 0) row('Charges above the daily maximum', `${money(over)} (the policy does not pay these)`)
      doc.moveDown()
      doc.fontSize(9).fillColor('#444').text('The services below were provided to the insured by the caregivers named, on the dates and at the times shown, under the agency\'s care plan for the insured.')
      doc.fillColor('#000').moveDown(2)
      doc.text('Signed ______________________________   Date ______________', { align: 'left' })
      doc.fontSize(8).text(`For ${head.agencyName || 'the agency'}`)

      // Services
      doc.addPage()
      doc.fontSize(13).text('Services provided')
      doc.moveDown(0.5).fontSize(8)
      const col = [54, 108, 186, 296, 400, 450, 500]
      const header = ['Date', 'Time', 'Caregiver', 'Service', 'Hours', 'Rate', 'Amount']
      const putRow = (cells: string[], bold = false) => {
        const y = doc.y
        if (y > 720) { doc.addPage(); doc.fontSize(8) }
        const top = doc.y
        doc.font(bold ? 'Helvetica-Bold' : 'Helvetica')
        let tallest = 0
        cells.forEach((cell, i) => {
          const w = (col[i + 1] ?? 560) - col[i]! - 4
          doc.text(cell, col[i]!, top, { width: w, align: i >= 4 ? 'right' : 'left' })
          tallest = Math.max(tallest, doc.y)
        })
        doc.y = tallest + 3
      }
      putRow(header, true)
      const dayOf = new Map(days.map((x) => [x.date, x]))
      for (const [i, l] of lines.entries()) {
        const q = lineQuantity(l)
        const who = `${l.caregiverFirst ?? ''} ${l.caregiverLast ?? ''}`.trim()
        const times = l.startTime && l.endTime ? `${time12(l.startTime)} – ${time12(l.endTime)}` : ''
        putRow([usDate(l.serviceDate), times, who, String(l.description || ''), q.quantityLabel, q.rateLabel, money(Number(l.amount || 0))])
        const next = lines[i + 1]
        if (l.serviceDate && next?.serviceDate !== l.serviceDate) {
          const day = dayOf.get(l.serviceDate)
          if (day && day.over > 0) {
            if (doc.y > 720) { doc.addPage(); doc.fontSize(8) }
            doc.fillColor('#8a1c1c').font('Helvetica').text(`${usDate(day.date)}: ${money(day.total)} is ${money(day.over)} over the policy's daily maximum of ${money(policy.dailyMax!)}`, 54, doc.y, { width: 500 })
            doc.fillColor('#000'); doc.y += 3
          }
        }
      }
      doc.moveDown().fontSize(10).font('Helvetica-Bold').text(`Total charges ${money(total)}`, { align: 'right' })
      if (over > 0) doc.font('Helvetica').fontSize(9).text(`Charges above the daily maximum: ${money(over)} (the policy does not pay these).`, { align: 'right' })
      doc.end()
    })
  }

  return { getPolicy, savePolicy, claimPacket, invoices: (companyId: string) => ltcInvoices(d.db, companyId) }
}

export type Ltc = ReturnType<typeof createLtc>
