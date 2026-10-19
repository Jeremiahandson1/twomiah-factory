// Incident case file PDFs (migration 0019). Moved from templates/crm-homecare/backend/src/services/incidentPdf.ts
// (ported there from CVHC services/incidentPdfService.js):
//   · renderIncidentReportPdf  — one incident, printable report for the file
//   · renderResponsePacketPdf  — the payer response packet: cover letter, incident report + investigation, optional
//     visit-schedule exhibit, caregiver background check, training record / signed acknowledgement, schedule-status
//     statement
//
// Every statement in the packet is derived from stored data (incident fields, schedules, time entries,
// background_checks, training_records). Nothing is asserted that the CRM can't show — the schedule statement says
// "removed" only when caregiver_removed_from is set, and presence is never inferred from clock-ins.
//
// Changes: the letterhead is the signed-in person's `company` row (the template read its database's only agency);
// loadIncidentCase is on the factory and takes the company, its SQL in server/data/homecareIncidents.ts (scoped to the
// company, camelCase rows — so the renderers read camelCase: incidentNumber, clientFirst, incidentDateS …). The
// renderers are otherwise unchanged and pure.
import PDFDocument from 'pdfkit'
import { eq } from 'drizzle-orm'
import { company } from '../../../db/schema/index.ts'
import {
  incidentForCase, incidentInvestigationEntries, incidentAttachmentIndex, memberScheduledVisits,
  caregiverBackgroundCheckHistory, caregiverTrainingHistory, lastCaregiverClockInDate, otherMembersServedByCaregiver,
} from '../../../data/homecareIncidents.ts'
import type { Q } from '../../../data/homecareCore.ts'
import type { CrmDeps } from '../../deps.ts'
import type { AgencyTime } from './agencyTime.ts'
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, RELEVANT_TRAINING_RE,
} from './incidentOptions.ts'

const TEAL = '#2ABBA7', INK = '#111827', MUTED = '#6B7280', RULE = '#E5E7EB', SHADE = '#F3F4F6', GOLD = '#A87B26'

// Same calendar day three months earlier ("past 3 months" as a payer means it).
export const threeMonthsBefore = (ymd: string): string => {
  const [y, m, d] = String(ymd).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  dt.setUTCMonth(dt.getUTCMonth() - 3)
  return dt.toISOString().slice(0, 10)
}

export interface Agency { name: string; address: string; city: string; state: string; zip: string; phone: string; email: string; logo: Buffer | null }

const dataUriToBuffer = (uri: unknown): Buffer | null => {
  const m = /^data:[^;]+;base64,(.+)$/s.exec(String(uri || ''))
  return m ? Buffer.from(m[1], 'base64') : null
}

export type IncidentCase = {
  agency: Agency
  incident: any
  notes: any[]
  attachments: any[]
  visits: any[]
  backgroundCheck: any
  earlierBackgroundChecks: any[]
  trainings: any[]
  lastCaregiverVisit: string | null
  otherMembers: any[]
}

// ─────────────────────────────── DATA ───────────────────────────────
export function createIncidentPdf(d: CrmDeps, deps: { time: AgencyTime }) {
  /** One of the company's incidents with everything its PDFs print, or null. `q` may be a transaction handle. */
  async function loadIncidentCase(companyId: string, incidentId: string, q: Q & { select: (...a: any[]) => any } = d.db): Promise<IncidentCase | null> {
    const tz = await deps.time.timezone(companyId, q)
    const [ag] = await q.select({
      name: company.name, address: company.address, city: company.city, state: company.state, zip: company.zip,
      phone: company.phone, email: company.email, logo: company.logo,
    }).from(company).where(eq(company.id, companyId)).limit(1)
    const logoBuf = /^data:image\/(png|jpe?g);base64,/i.test(String(ag?.logo || '')) ? dataUriToBuffer(ag.logo) : null
    const agency: Agency = {
      name: ag?.name || 'the agency', address: ag?.address || '', city: ag?.city || '', state: ag?.state || '',
      zip: ag?.zip || '', phone: ag?.phone || '', email: ag?.email || '', logo: logoBuf,
    }

    const incident = await incidentForCase(q, companyId, incidentId, tz)
    if (!incident) return null

    const yearStart = `${String(incident.incidentDateS || incident.todayS).slice(0, 4)}-01-01`
    const [notes, attachments, visits] = await Promise.all([
      incidentInvestigationEntries(q, companyId, incidentId),
      incidentAttachmentIndex(q, companyId, incidentId),
      // Scheduled visits at the member's home from Jan 1 of the incident year through today.
      incident.clientId ? memberScheduledVisits(q, companyId, incident.clientId, yearStart, incident.todayS) : Promise.resolve([]),
    ])

    let backgroundCheck: any = null, earlierBackgroundChecks: any[] = [], trainings: any[] = [], lastCaregiverVisit: string | null = null, otherMembers: any[] = []
    if (incident.caregiverId) {
      const [bgc, tr, last] = await Promise.all([
        caregiverBackgroundCheckHistory(q, companyId, incident.caregiverId),
        caregiverTrainingHistory(q, companyId, incident.caregiverId),
        incident.clientId ? lastCaregiverClockInDate(q, companyId, incident.clientId, incident.caregiverId, tz) : Promise.resolve(null),
      ])
      // Most recent check first; earlier COMPLETED checks follow it (e.g. the check at hire).
      backgroundCheck = bgc[0] || null
      earlierBackgroundChecks = bgc.slice(1).filter((b) => b.status === 'completed')
      trainings = tr
      lastCaregiverVisit = last

      // Other members of the SAME payer this caregiver served in the three months before the concern was reported.
      if (incident.clientId) {
        const to = incident.reportedDateS || incident.todayS
        const from = threeMonthsBefore(to)
        otherMembers = await otherMembersServedByCaregiver(q, companyId, { caregiverId: incident.caregiverId, clientId: incident.clientId, from, to, tz })
      }
    }

    return { agency, incident, notes, attachments, visits, backgroundCheck, earlierBackgroundChecks, trainings, lastCaregiverVisit, otherMembers }
  }

  return { loadIncidentCase }
}

// ─────────────────────────────── FORMAT ───────────────────────────────
const longDate = (ymd?: string | null) => {
  if (!ymd) return ''
  const d = new Date(`${ymd}T12:00:00Z`)
  return isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', day: 'numeric', year: 'numeric' })
}
const shortDate = (ymd?: string | null) => {
  if (!ymd) return ''
  const [y, m, d] = String(ymd).split('-')
  return y && m && d ? `${Number(m)}/${Number(d)}/${y}` : String(ymd)
}
const text = (v: unknown) => (v === null || v === undefined || String(v).trim() === '') ? '' : String(v)
const dash = (v: unknown) => text(v) || '—'
const label = (map: Record<string, string>, v: unknown): string => (v ? map[String(v)] : '') || text(v)
const personName = (first: unknown, last: unknown) => `${text(first)} ${text(last)}`.replace(/\s+/g, ' ').trim()
const memberIdLine = (i: any) => {
  const ids: string[] = []
  if (i.medicaidId) ids.push(`Medicaid ID ${i.medicaidId}`)
  if (i.mcoMemberId) ids.push(`Member ID ${i.mcoMemberId}`)
  return ids.join('  ·  ')
}
const agencyLine = (a: Agency) => [
  text(a.address), [text(a.city), [text(a.state), text(a.zip)].filter(Boolean).join(' ')].filter(Boolean).join(', '), text(a.phone), text(a.email),
].filter(Boolean).join('  ·  ')

// ─────────────────────────────── LAYOUT ───────────────────────────────
function makeLayout(doc: PDFKit.PDFDocument, agency: Agency) {
  const W = () => doc.page.width - doc.page.margins.left - doc.page.margins.right
  const L = () => doc.page.margins.left
  const bottom = () => doc.page.height - doc.page.margins.bottom

  const letterhead = (compact = false) => {
    const top = 40
    const logoW = agency.logo ? (compact ? 34 : 46) : 0
    if (agency.logo) {
      try { doc.image(agency.logo, L(), top, { width: logoW }) } catch { /* logo is decorative */ }
    }
    const x = L() + logoW + (logoW ? 12 : 0)
    doc.font('Helvetica-Bold').fontSize(compact ? 12 : 15).fillColor(GOLD).text(agency.name, x, top + (compact ? 3 : 6), { lineBreak: false })
    doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(agencyLine(agency), x, top + (compact ? 19 : 26), { lineBreak: false })
    const lineY = top + (compact ? 46 : 62)
    doc.moveTo(L(), lineY).lineTo(L() + W(), lineY).lineWidth(1.2).strokeColor(TEAL).stroke()
    doc.x = L(); doc.y = lineY + 16; doc.fillColor(INK)
  }
  const newPage = (compact = true) => { doc.addPage(); letterhead(compact) }
  const ensure = (h: number) => { if (doc.y + h > bottom()) newPage(true) }

  const title = (t: string, sub?: string) => {
    doc.font('Helvetica-Bold').fontSize(15).fillColor(INK).text(t, L(), doc.y, { width: W() })
    if (sub) doc.font('Helvetica').fontSize(9.5).fillColor(MUTED).text(sub, { width: W() })
    doc.moveDown(0.7).fillColor(INK)
  }
  const h2 = (t: string) => {
    ensure(42)
    doc.moveDown(0.4)
    doc.font('Helvetica-Bold').fontSize(10.5).fillColor(TEAL).text(t.toUpperCase(), L(), doc.y, { width: W(), characterSpacing: 0.4 })
    const y = doc.y + 2
    doc.moveTo(L(), y).lineTo(L() + W(), y).lineWidth(0.6).strokeColor(RULE).stroke()
    doc.y = y + 6; doc.fillColor(INK)
  }
  const p = (t: unknown, o: { bold?: boolean; size?: number; color?: string; after?: number } = {}) => {
    if (!text(t)) return
    ensure(22)
    doc.font(o.bold ? 'Helvetica-Bold' : 'Helvetica').fontSize(o.size || 10).fillColor(o.color || INK)
      .text(String(t), L(), doc.y, { width: W(), lineGap: 1.5 })
    doc.moveDown(o.after == null ? 0.5 : o.after)
  }
  const runIn = (head: string, body: string, after = 0.5) => {
    ensure(22)
    doc.fontSize(10).fillColor(INK).font('Helvetica-Bold').text(head, L(), doc.y, { width: W(), lineGap: 1.5, continued: true })
    doc.font('Helvetica').text(body, { width: W(), lineGap: 1.5 })
    doc.moveDown(after)
  }
  const bullets = (items: string[], numbered = false, size = 10) => {
    items.filter(text).forEach((it, i) => {
      ensure(18)
      const y = doc.y
      doc.font('Helvetica').fontSize(size).fillColor(INK).text(numbered ? `${i + 1}.` : '•', L() + 4, y, { width: 16 })
      doc.text(it, L() + 22, y, { width: W() - 22, lineGap: 1.5 })
      doc.moveDown(size < 10 ? 0.1 : 0.25)
    })
    doc.x = L()
    doc.moveDown(0.3)
  }
  const kv = (rows: Array<[string, unknown]>) => {
    const lw = 150
    rows.filter((r) => text(r[1])).forEach(([k, v], i) => {
      doc.font('Helvetica').fontSize(10)
      const h = Math.max(doc.heightOfString(String(v), { width: W() - lw - 12 }), 12) + 8
      ensure(h)
      const y = doc.y
      if (i % 2 === 0) doc.rect(L(), y, W(), h).fill(SHADE)
      doc.fillColor(MUTED).font('Helvetica-Bold').fontSize(9).text(k, L() + 6, y + 4, { width: lw - 8 })
      doc.fillColor(INK).font('Helvetica').fontSize(10).text(String(v), L() + lw + 6, y + 4, { width: W() - lw - 12 })
      doc.y = y + h
    })
    doc.x = L()
    doc.moveDown(0.5)
  }
  const table = (cols: Array<{ h: string; w?: number; wrap?: boolean }>, rows: unknown[][], o: { rowH?: number } = {}) => {
    const rowH = o.rowH || 13
    const fixed = cols.reduce((s, c) => s + (c.w || 0), 0)
    const flex = cols.filter((c) => !c.w).length
    const widths = cols.map((c) => c.w || (W() - fixed) / Math.max(flex, 1))
    const header = () => {
      const y = doc.y
      doc.rect(L(), y, W(), rowH + 3).fill(TEAL)
      let x = L()
      cols.forEach((c, j) => { doc.font('Helvetica-Bold').fontSize(8.5).fillColor('#fff').text(c.h, x + 5, y + 4, { width: widths[j] - 8, lineBreak: false }); x += widths[j] })
      doc.y = y + rowH + 3
    }
    ensure(rowH * 3)
    header()
    rows.forEach((r, i) => {
      doc.font('Helvetica').fontSize(8.5)
      const h = Math.max(rowH, ...r.map((cell, j) => cols[j].wrap ? doc.heightOfString(String(cell), { width: widths[j] - 8 }) + 5 : rowH))
      if (doc.y + h > bottom()) { newPage(true); header() }
      const y = doc.y
      if (i % 2 === 1) doc.rect(L(), y, W(), h).fill(SHADE)
      let x = L()
      r.forEach((cell, j) => {
        doc.font('Helvetica').fontSize(8.5).fillColor(INK)
          .text(String(cell), x + 5, y + 2.5, cols[j].wrap ? { width: widths[j] - 8 } : { width: widths[j] - 8, lineBreak: false })
        x += widths[j]
      })
      doc.y = y + h
    })
    doc.x = L()
    doc.moveDown(0.6)
  }
  const signatures = (pairs: Array<[string, string]>) => {
    ensure(38 * pairs.length + 10)
    doc.moveDown(0.5)
    pairs.forEach(([a, b]) => {
      const y = doc.y + 20
      doc.moveTo(L(), y).lineTo(L() + 250, y).lineWidth(0.6).strokeColor(INK).stroke()
      doc.moveTo(L() + 290, y).lineTo(L() + W(), y).stroke()
      doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text(a, L(), y + 3, { lineBreak: false })
      doc.text(b, L() + 290, y + 3, { lineBreak: false })
      doc.x = L(); doc.y = y + 18; doc.fillColor(INK)
    })
  }
  const footers = (caption: string) => {
    const range = doc.bufferedPageRange()
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i)
      const saved = doc.page.margins.bottom
      doc.page.margins.bottom = 0
      doc.font('Helvetica').fontSize(7.5).fillColor(MUTED)
        .text(`${caption}  ·  Confidential PHI  ·  Page ${i + 1} of ${range.count}`, L(), doc.page.height - 36, { width: W(), align: 'center', lineBreak: false })
      doc.page.margins.bottom = saved
    }
  }
  return { W, L, letterhead, newPage, ensure, title, h2, p, runIn, bullets, kv, table, signatures, footers }
}

// Truthful schedule-status sentence, derived only from stored data.
export function scheduleStatusSentence(data: IncidentCase): string {
  const { incident: i, agency } = data
  const caregiver = personName(i.caregiverFirst, i.caregiverLast)
  const member = personName(i.clientFirst, i.clientLast)
  if (!i.caregiverId) return 'No caregiver is named on this incident.'
  const parts: string[] = []
  if (i.caregiverRemovedFromS) {
    parts.push(`Effective ${longDate(i.caregiverRemovedFromS)}, ${agency.name} removed ${caregiver} from ${member}'s schedule pending investigation.`)
    if (i.caregiverReturnedOnS) parts.push(`The caregiver was returned to the member's schedule on ${longDate(i.caregiverReturnedOnS)}.`)
  } else {
    parts.push(`${agency.name} did not remove ${caregiver} from ${member}'s schedule.`)
  }
  // No "most recent visit" claim from clock-ins: a caregiver who works without clocking in has no
  // record, so the last clock-in says nothing about whether they were in the home.
  return parts.join(' ')
}

type UI = ReturnType<typeof makeLayout>

function incidentSections(ui: UI, data: IncidentCase, { forPayer }: { forPayer: boolean }) {
  const { incident: i, notes, attachments, agency } = data
  const member = personName(i.clientFirst, i.clientLast)
  const caregiver = personName(i.caregiverFirst, i.caregiverLast)

  ui.h2('Incident')
  ui.kv([
    ['Incident number', i.incidentNumber],
    ['Status', label(INCIDENT_STATUSES, i.investigationStatus)],
    ['Member', [member, i.clientDob ? `DOB ${i.clientDob}` : '', memberIdLine(i)].filter(Boolean).join('  ·  ')],
    ['Member address', [text(i.clientAddress), [text(i.clientCity), [text(i.clientState), text(i.clientZip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')],
    ['Payer', i.isPrivatePay ? 'Private pay' : text(i.payerName)],
    ['Type', label(INCIDENT_TYPES, i.incidentType)],
    ['Severity', label(SEVERITIES, i.severity)],
    ['Date of incident', [longDate(i.incidentDateS), i.incidentTimeS].filter(Boolean).join(' at ')],
    ['Reported by', [text(i.reportedBy), text(i.reporterContactName)].filter(Boolean).join(' — ')],
    ['Reporter contact', [text(i.reporterPhone), text(i.reporterEmail)].filter(Boolean).join('  ·  ')],
    [`Date reported to ${agency.name}`, longDate(i.reportedDateS)],
    ['Caregiver involved', caregiver],
    ['Witnesses', i.witnesses],
    ['Injuries or damage', i.injuriesOrDamage],
  ])

  ui.h2('Description')
  ui.p(dash(i.description))
  if (text(i.actionTaken)) { ui.h2('Actions taken'); ui.p(i.actionTaken) }

  ui.h2('Investigation')
  if (notes.length === 0) {
    ui.p('No investigation entries have been recorded.', { color: MUTED })
  } else {
    ui.table(
      [{ h: 'Date', w: 72 }, { h: 'Type', w: 92 }, { h: 'What happened', wrap: true }],
      notes.map((n: any) => [shortDate(n.entryDateS), label(ENTRY_TYPES, n.entryType), n.summary]),
      { rowH: 13 })
  }

  ui.h2('Findings and conclusion')
  ui.kv([
    ['Conclusion', label(DISPOSITIONS, i.disposition) || 'Not yet determined'],
    ['Date closed', longDate(i.closedDateS)],
  ])
  ui.p(text(i.findings) || 'Findings have not been recorded.', { color: text(i.findings) ? INK : MUTED })

  if (!forPayer) {
    // Internal-only detail: mandatory-report decision, follow-up, schedule, attachment index.
    ui.h2('Mandatory reporting')
    ui.kv([
      ['Decision', label(MANDATORY_REPORT_STATUSES, i.mandatoryReportStatus) || 'Not recorded'],
      ['Details', i.mandatoryReportDetails],
    ])
    if (i.followUpRequired || text(i.followUpNotes)) {
      ui.h2('Follow-up')
      ui.p(text(i.followUpNotes) || 'Follow-up required.')
    }
    ui.h2('Caregiver schedule')
    ui.p(scheduleStatusSentence(data))
    if (attachments.length) {
      ui.h2('Attachments on file')
      ui.bullets(attachments.map((a: any) => `${a.fileName} (${label(ATTACHMENT_CATEGORIES, a.category)})${a.description ? ` — ${a.description}` : ''}`))
    }
  }
}

// ─────────────────────────────── INCIDENT REPORT ───────────────────────────────
export function renderIncidentReportPdf(doc: PDFKit.PDFDocument, data: IncidentCase) {
  const ui = makeLayout(doc, data.agency)
  const i = data.incident
  ui.letterhead(false)
  ui.title('Incident Report', dash(i.incidentNumber))
  incidentSections(ui, data, { forPayer: false })
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']])
  ui.footers(`${data.agency.name}  ·  Incident ${dash(i.incidentNumber)}`)
}

/** The packet's lines that depend on the agency's state. */
export const reportingLine = (state: string) => (String(state).trim().toUpperCase() === 'WI'
  ? 'Reporting. If a caregiver notices medications missing or disturbed, or a client raises a concern about medications, the caregiver reports it to the office the same day. Suspected exploitation of an elder adult at risk is reported under Wis. Stat. § 46.90.'
  : 'Reporting. If a caregiver notices medications missing or disturbed, or a client raises a concern about medications, the caregiver reports it to the office the same day. Suspected abuse, neglect or exploitation of a vulnerable adult is reported to the authority state law names.')

// ─────────────────────────────── RESPONSE PACKET ───────────────────────────────
// options.includeSchedule adds Exhibit A (scheduled visits at the member's home). Off by default:
// send only what was requested.
export function renderResponsePacketPdf(doc: PDFKit.PDFDocument, data: IncidentCase, options: { includeSchedule?: boolean } = {}) {
  const includeSchedule = !!options.includeSchedule
  const { agency } = data
  const A = agency.name
  const ui = makeLayout(doc, agency)
  const { incident: i, visits, backgroundCheck, trainings } = data
  const earlierChecks = data.earlierBackgroundChecks || []
  const otherMembers = data.otherMembers || []
  const member = personName(i.clientFirst, i.clientLast)
  const caregiver = personName(i.caregiverFirst, i.caregiverLast)
  const payer = i.isPrivatePay ? '' : text(i.payerName)
  const org = payer || text(i.reportedBy)
  const idLine = memberIdLine(i)
  const ackSigned = !!i.trainingAckSignedAt
  const relevantTrainings = trainings.filter((t: any) => RELEVANT_TRAINING_RE.test(String(t.trainingName || '')))

  const enclosures = ['Incident Report and Investigation Summary']
  if (includeSchedule && visits.length) enclosures.push('Exhibit A: Visit schedule for the member\'s home')
  if (i.caregiverId) {
    enclosures.push('Caregiver background check record')
    enclosures.push(ackSigned ? 'Caregiver training acknowledgement (signed)' : 'Caregiver training record')
    enclosures.push('Statement regarding caregiver schedule status')
  }

  // ── Cover letter ──
  ui.letterhead(false)
  ui.p(longDate(i.todayS), { after: 0.7 })
  ui.p([text(i.reporterContactName) || 'Care Manager', org, 'Submitted via provider correspondence'].filter(Boolean).join('\n'), { after: 0.7 })
  ui.p(`RE: Response to Provider Concern — Member ${member}${idLine ? ` (${idLine})` : ''}\n${label(INCIDENT_TYPES, i.incidentType)} · ${A} Incident ${dash(i.incidentNumber)}`, { bold: true, after: 0.7 })
  ui.p(`Dear ${text(i.reporterContactName) || 'Care Manager'},`)
  ui.p(`Thank you for notifying ${A} of this concern${i.reportedDateS ? ` on ${longDate(i.reportedDateS)}` : ''}. This letter and its enclosures respond to your request.`)

  const conclusion = i.disposition
    ? ` ${A}'s investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ` as to ${A} staff` : ''}.`
    : ` ${A}'s investigation is ongoing.`
  ui.runIn('1. Incident report and investigation. ',
    `Enclosed is ${A} Incident Report and Investigation Summary ${dash(i.incidentNumber)}.${conclusion}${text(i.findings) ? ` ${String(i.findings).trim()}` : ''}`)

  if (i.caregiverId) {
    const bgcText = backgroundCheck
      ? `Enclosed is the caregiver's background check record${backgroundCheck.provider ? ` (${backgroundCheck.provider})` : ''}${backgroundCheck.status ? `, status: ${String(backgroundCheck.status).replace(/_/g, ' ').toLowerCase()}` : ''}${backgroundCheck.initiatedS ? `, initiated ${longDate(backgroundCheck.initiatedS)}` : ''}.`
      : `${A} has no background check record on file in its system for this caregiver.`
    const earlierText = earlierChecks.map((b: any) =>
      ` ${A}'s records also show an earlier completed background check${b.initiatedS ? ` initiated ${longDate(b.initiatedS)}` : ''}.${text(b.findings) ? ` ${String(b.findings).trim()}` : ''}`).join('')
    const trText = ackSigned
      ? ` Also enclosed is the caregiver's signed acknowledgement covering medication handling and the misappropriation of client property, signed ${longDate(i.trainingAckSignedS)}.`
      : relevantTrainings.length
        ? ' Also enclosed is the caregiver\'s training record for medication handling and misappropriation.'
        : ` ${A} has no completed medication-handling or misappropriation training on file in its system for this caregiver.`
    ui.runIn('2. Background check and training. ', bgcText + earlierText + trText)
    ui.runIn('3. Caregiver schedule status. ', scheduleStatusSentence(data))
    let n = 4
    if (text(i.payerResponseNotes)) {
      ui.runIn(`${n++}. Additional information. `, String(i.payerResponseNotes).trim())
    }
    if (otherMembers.length) {
      const window = `${shortDate(threeMonthsBefore(i.reportedDateS || i.todayS))} – ${shortDate(i.reportedDateS || i.todayS)}`
      // Names and the period each member was assigned — what the payer asked for. Visit counts are
      // deliberately not printed; the visit schedule exhibit carries detail.
      ui.runIn(`${n++}. Other members served by this caregiver. `,
        `In the three months before this concern was reported (${window}), ${A}'s records show this caregiver was assigned to the following ${text(payer) || 'payer'} member(s):`)
      ui.bullets(otherMembers.map((m: any) => {
        const span = m.firstS && m.lastS ? ` — ${m.firstS === m.lastS ? m.firstS : `${m.firstS} to ${m.lastS}`}` : ''
        return `${personName(m.firstName, m.lastName)}${span}`
      }), false, 9.5)
    }
  }
  ui.p('Please contact me with any questions or if you need additional information.', { after: 0.4 })
  ui.p('Sincerely,', { after: 0 })
  ui.signatures([['Signature', 'Date'], ['Printed name', 'Title']])
  doc.moveDown(0.2)
  ui.p('Enclosures', { bold: true, size: 9, after: 0.15 })
  ui.bullets(enclosures, true, 8.5)

  // ── Incident report + investigation ──
  ui.newPage(false)
  ui.title('Incident Report and Investigation Summary', `${dash(i.incidentNumber)}  ·  Confidential — contains protected health information`)
  incidentSections(ui, data, { forPayer: true })
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']])

  // ── Exhibit A: visit schedule ──
  if (includeSchedule && visits.length) {
    ui.newPage(true)
    ui.title('Exhibit A — Visit Schedule', `Member: ${member}${idLine ? `  ·  ${idLine}` : ''}`)
    // The range is stated from the first visit shown, not Jan 1: a deactivated pattern no longer
    // produces visits, so earlier months can be missing and the exhibit must not imply there were none.
    ui.p(`Each row is a visit on ${A}'s schedule for the member's home, ${longDate(String(visits[0].dayS).slice(-10))} through ${longDate(i.todayS)}, with the scheduled time (agency local time) and the assigned caregiver.`, { size: 9, color: MUTED })
    ui.table(
      [{ h: '#', w: 30 }, { h: 'Date', w: 110 }, { h: 'Scheduled time', w: 140 }, { h: 'Caregiver' }],
      visits.map((v: any, n: number) => [n + 1, v.dayS, `${v.startS} – ${v.endS}`, personName(v.cgFirst, v.cgLast)]),
      { rowH: 12 })
  }

  if (i.caregiverId) {
    // ── Background check ──
    ui.newPage(false)
    ui.title('Caregiver Background Check', `Caregiver: ${caregiver}`)
    if (backgroundCheck) {
      ui.kv([
        ['Caregiver', caregiver],
        ['Employer', [A, agency.city, agency.state].filter(Boolean).join(', ')],
        ['Check type', backgroundCheck.checkType === 'worcs' ? 'Wisconsin Department of Justice caregiver background check (WORCS)' : text(backgroundCheck.checkType).replace(/_/g, ' ')],
        ['Provider', backgroundCheck.provider],
        ['Status', text(backgroundCheck.status).replace(/_/g, ' ')],
        ['Date initiated', longDate(backgroundCheck.initiatedS)],
        ['Next recheck due', longDate(backgroundCheck.expiresS)],
        ['Reference number', backgroundCheck.reference],
        ['Findings', backgroundCheck.findings],
      ])
      for (const b of earlierChecks) {
        ui.h2(`Earlier background check${b.initiatedS ? ` — ${longDate(b.initiatedS)}` : ''}`)
        ui.kv([
          ['Provider', b.provider],
          ['Status', text(b.status).replace(/_/g, ' ')],
          ['Date initiated', longDate(b.initiatedS)],
          ['Reference number', b.reference],
          ['Notes', b.findings],
        ])
      }
      ui.p(`Details above are from ${A}'s background check records for this caregiver.`, { size: 9.5, color: MUTED })
    } else {
      ui.p(`${A} has no background check record on file in its system for this caregiver.`)
    }
    ui.signatures([['Verified against personnel file by (signature)', 'Date']])

    // ── Training ──
    ui.newPage(false)
    ui.title('Caregiver Training: Medication Handling and Misappropriation', `Caregiver: ${caregiver}`)
    if (trainings.length) {
      ui.h2('Training record on file')
      ui.table(
        [{ h: 'Training', wrap: true }, { h: 'Completed', w: 80 }, { h: 'Expires', w: 80 }, { h: 'Provider', w: 130, wrap: true }],
        trainings.map((t: any) => [text(t.trainingName), shortDate(t.completedS) || '—', shortDate(t.expiresS) || '—', dash(t.provider)]),
        { rowH: 13 })
    }
    ui.h2('Acknowledgement')
    ui.bullets([
      `Medication reminders versus administration. ${A} caregivers may remind a client that a medication is due. ${A} caregivers do not administer medications, do not set up or count doses, do not store medications, and never remove medications from a client's home.`,
      'Controlled medications. Caregivers do not touch, move, or handle a client\'s controlled medications. If a client asks for help with one, the caregiver declines and tells the office the same day.',
      `Client Funds, Property & Misappropriation policy. ${A} has zero tolerance for taking, borrowing, holding, or removing any client property, including medications, even if the client offers.`,
      reportingLine(agency.state),
      `Electronic Visit Verification. Every visit is clocked in and out on the ${A} app so ${A}'s records show exactly when a caregiver was and was not in a client's home.`,
    ], true, 9.5)
    if (ackSigned) {
      ui.kv([
        ['Signed by', i.trainingAckSignerName],
        ['Date signed', longDate(i.trainingAckSignedS)],
        ['Reviewed with', i.trainingAckSupervisor],
        ['Method', label(TRAINING_ACK_METHODS, i.trainingAckMethod)],
      ])
      const sig = dataUriToBuffer(i.trainingAckSignature)
      if (sig) {
        ui.ensure(90)
        doc.font('Helvetica').fontSize(8.5).fillColor(MUTED).text('Caregiver signature', ui.L(), doc.y)
        try { doc.image(sig, ui.L(), doc.y + 2, { fit: [240, 70] }) } catch { /* unreadable image */ }
        doc.y += 78; doc.x = ui.L()
      }
    } else {
      ui.p('I reviewed the content above with my supervisor. I understand it and I agree to follow it.')
      ui.signatures([['Caregiver signature', 'Date'], ['Supervisor signature and title', 'Date']])
    }

    // ── Schedule statement ──
    ui.newPage(false)
    ui.title('Statement Regarding Caregiver Schedule Status', `Incident ${dash(i.incidentNumber)}`)
    ui.kv([['Member', [member, idLine].filter(Boolean).join('  ·  ')], ['Caregiver', caregiver]])
    ui.p(scheduleStatusSentence(data))
    if (i.disposition) ui.p(`${A}'s investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ` as to ${A} staff` : ''}.`)
    ui.p(`I certify that this statement is true and accurate to the best of my knowledge, based on ${A}'s scheduling records.`)
    ui.signatures([['Signature', 'Date'], ['Printed name', 'Title']])
  }

  ui.footers(`${A}  ·  Response to ${org || 'payer'}  ·  ${dash(i.incidentNumber)}`)
}

/** Render to a Buffer. */
export function incidentPdfBuffer(data: IncidentCase, kind: 'report' | 'packet', options: { includeSchedule?: boolean } = {}): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 62, left: 54, right: 54 }, bufferPages: true })
    const chunks: Buffer[] = []
    doc.on('data', (chunk: Buffer) => chunks.push(chunk))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    try {
      if (kind === 'packet') renderResponsePacketPdf(doc, data, options)
      else renderIncidentReportPdf(doc, data)
      doc.end()
    } catch (e) { reject(e) }
  })
}
