// Incident case file PDFs (migration 0019), ported from CVHC services/incidentPdfService.js:
//   · renderIncidentReportPdf  — one incident, printable report for the file
//   · renderResponsePacketPdf  — the payer response packet: cover letter, incident report +
//     investigation, optional visit-schedule exhibit, caregiver background check, training record /
//     signed acknowledgement, schedule-status statement
//
// Every statement in the packet is derived from stored data (incident fields, schedules, time
// entries, background_checks, training_records). Nothing is asserted that the CRM can't show — the
// schedule statement says "removed" only when caregiver_removed_from is set, and presence is never
// inferred from clock-ins (a caregiver who works without clocking in has no record).
//
// The letterhead is the agency's own record (agencies row): name, address, phone, email, logo.
// DATE columns are selected as text (to_char) so no server time zone can shift a day.
import PDFDocument from 'pdfkit'
import { sql } from 'drizzle-orm'
import {
  INCIDENT_TYPES, SEVERITIES, INCIDENT_STATUSES, DISPOSITIONS, MANDATORY_REPORT_STATUSES,
  ENTRY_TYPES, ATTACHMENT_CATEGORIES, TRAINING_ACK_METHODS, RELEVANT_TRAINING_RE,
} from '../config/incidentOptions.ts'
import { occurrencesCte } from './scheduleOccurrences.ts'
import { agencyTimezone, localDate, type Q } from './agencyTime.ts'
import { rowsOf } from '../helpers/scheduleRows.ts'

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

// ─────────────────────────────── DATA ───────────────────────────────
export async function loadIncidentCase(q: Q, incidentId: string) {
  const tz = await agencyTimezone(q)
  const [ag] = await rowsOf(q, sql`SELECT name, legal_name, address, city, state, zip, phone, email, logo FROM agencies ORDER BY created_at LIMIT 1`)
  const logoBuf = /^data:image\/(png|jpe?g);base64,/i.test(String(ag?.logo || '')) ? dataUriToBuffer(ag.logo) : null
  const agency: Agency = {
    name: ag?.name || 'the agency', address: ag?.address || '', city: ag?.city || '', state: ag?.state || '',
    zip: ag?.zip || '', phone: ag?.phone || '', email: ag?.email || '', logo: logoBuf,
  }

  const [incident] = await rowsOf(q, sql`
    SELECT i.*,
           to_char(i.date, 'YYYY-MM-DD')                    AS incident_date_s,
           to_char(i.incident_time, 'FMHH12:MI AM')         AS incident_time_s,
           to_char(i.reported_date, 'YYYY-MM-DD')           AS reported_date_s,
           to_char(i.response_due_date, 'YYYY-MM-DD')       AS response_due_date_s,
           to_char(i.response_sent_date, 'YYYY-MM-DD')      AS response_sent_date_s,
           to_char(i.resolved_at, 'YYYY-MM-DD')             AS closed_date_s,
           to_char(i.caregiver_removed_from, 'YYYY-MM-DD')  AS caregiver_removed_from_s,
           to_char(i.caregiver_returned_on, 'YYYY-MM-DD')   AS caregiver_returned_on_s,
           to_char(i.training_ack_signed_at AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS training_ack_signed_s,
           c.first_name AS client_first, c.last_name AS client_last,
           to_char(c.date_of_birth, 'MM/DD/YYYY') AS client_dob,
           c.medicaid_id, c.mco_member_id, c.is_private_pay, c.referred_by_id AS client_payer_id,
           c.address AS client_address, c.city AS client_city, c.state AS client_state, c.zip AS client_zip,
           rs.name AS payer_name,
           u.first_name AS caregiver_first, u.last_name AS caregiver_last,
           ru.first_name AS entered_by_first, ru.last_name AS entered_by_last,
           to_char((NOW() AT TIME ZONE ${tz})::date, 'YYYY-MM-DD') AS today_s
      FROM incidents i
      LEFT JOIN clients c ON c.id = i.client_id
      LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
      LEFT JOIN users u  ON u.id  = i.caregiver_id
      LEFT JOIN users ru ON ru.id = i.reported_by_id
     WHERE i.id = ${incidentId}`)
  if (!incident) return null

  const yearStart = `${String(incident.incident_date_s || incident.today_s).slice(0, 4)}-01-01`
  const [notes, attachments, visits] = await Promise.all([
    rowsOf(q, sql`
      SELECT n.id, n.entry_type, n.summary, to_char(n.entry_date, 'YYYY-MM-DD') AS entry_date_s,
             u.first_name, u.last_name
        FROM incident_investigation_notes n
        LEFT JOIN users u ON u.id = n.created_by_id
       WHERE n.incident_id = ${incidentId}
       ORDER BY n.entry_date, n.created_at`),
    rowsOf(q, sql`
      SELECT id, category, file_name, mime_type, file_size, description
        FROM incident_attachments WHERE incident_id = ${incidentId} ORDER BY created_at`),
    // Scheduled visits at the member's home from Jan 1 of the incident year through today
    // (cancelled visits excluded; one-day changes of time or caregiver applied).
    incident.client_id ? rowsOf(q, sql`
      WITH ${occurrencesCte(yearStart, incident.today_s)}
      SELECT to_char(occ.occ_date, 'Dy YYYY-MM-DD') AS day_s,
             to_char(occ.start_time, 'FMHH12:MI AM') AS start_s,
             to_char(occ.end_time, 'FMHH12:MI AM')   AS end_s,
             u.first_name AS cg_first, u.last_name AS cg_last
        FROM occ
        LEFT JOIN users u ON u.id = occ.caregiver_id
       WHERE occ.client_id = ${incident.client_id}
       ORDER BY occ.occ_date, occ.start_time`) : Promise.resolve([]),
  ])

  let backgroundCheck: any = null, earlierBackgroundChecks: any[] = [], trainings: any[] = [], lastCaregiverVisit: string | null = null, otherMembers: any[] = []
  if (incident.caregiver_id) {
    const [bgc, tr, last] = await Promise.all([
      rowsOf(q, sql`
        SELECT check_type, provider, status, findings,
               to_char(initiated_date, 'YYYY-MM-DD') AS initiated_s,
               to_char(expiration_date, 'YYYY-MM-DD') AS expires_s,
               COALESCE(worcs_reference_number, reference_number) AS reference
          FROM background_checks
         WHERE caregiver_id = ${incident.caregiver_id}
         ORDER BY initiated_date DESC NULLS LAST, created_at DESC`),
      rowsOf(q, sql`
        SELECT training_name, provider, status,
               to_char(completed_date, 'YYYY-MM-DD') AS completed_s,
               to_char(expiry_date, 'YYYY-MM-DD') AS expires_s
          FROM training_records
         WHERE caregiver_id = ${incident.caregiver_id}
         ORDER BY completed_date DESC NULLS LAST, created_at DESC`),
      incident.client_id ? rowsOf(q, sql`
        SELECT to_char(MAX(${localDate(sql`start_time`, tz)}), 'YYYY-MM-DD') AS d
          FROM time_entries WHERE client_id = ${incident.client_id} AND caregiver_id = ${incident.caregiver_id}`) : Promise.resolve([]),
    ])
    // Most recent check first; earlier COMPLETED checks follow it (e.g. the check at hire).
    backgroundCheck = bgc[0] || null
    earlierBackgroundChecks = bgc.slice(1).filter((b) => b.status === 'completed')
    trainings = tr
    lastCaregiverVisit = last[0]?.d || null

    // Other members of the SAME payer this caregiver served in the three months before the concern
    // was reported. Counts scheduled visits AND clock-ins, because a visit worked without clocking
    // in still happened.
    if (incident.client_id) {
      const to = incident.reported_date_s || incident.today_s
      const from = threeMonthsBefore(to)
      otherMembers = await rowsOf(q, sql`
        WITH ${occurrencesCte(from, to)},
        sched AS (
          SELECT occ.client_id, COUNT(*)::int AS n, MIN(occ.occ_date) AS first_d, MAX(occ.occ_date) AS last_d
            FROM occ WHERE occ.caregiver_id = ${incident.caregiver_id} GROUP BY 1),
        punched AS (
          SELECT t.client_id, COUNT(*)::int AS n,
                 MIN(${localDate(sql`t.start_time`, tz)}) AS first_d,
                 MAX(${localDate(sql`t.start_time`, tz)}) AS last_d
            FROM time_entries t
           WHERE t.caregiver_id = ${incident.caregiver_id}
             AND ${localDate(sql`t.start_time`, tz)} BETWEEN ${from}::date AND ${to}::date
           GROUP BY 1)
        SELECT c.first_name, c.last_name, rs.name AS payer,
               COALESCE(s.n, 0) AS scheduled_visits, COALESCE(p.n, 0) AS clock_ins,
               to_char(LEAST(COALESCE(s.first_d, p.first_d), COALESCE(p.first_d, s.first_d)), 'MM/DD/YYYY') AS first_s,
               to_char(GREATEST(COALESCE(s.last_d, p.last_d), COALESCE(p.last_d, s.last_d)), 'MM/DD/YYYY') AS last_s
          FROM clients c
          LEFT JOIN sched s   ON s.client_id = c.id
          LEFT JOIN punched p ON p.client_id = c.id
          LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id
         WHERE c.id <> ${incident.client_id}
           AND (s.client_id IS NOT NULL OR p.client_id IS NOT NULL)
           -- Same payer as the member on this incident: by referral source / payer, or by the
           -- payer on their authorizations (some clients carry the payer only there).
           AND (
             c.referred_by_id = (SELECT referred_by_id FROM clients WHERE id = ${incident.client_id})
             OR EXISTS (SELECT 1 FROM authorizations a
                         WHERE a.client_id = c.id
                           AND a.payer_id = (SELECT referred_by_id FROM clients WHERE id = ${incident.client_id}))
           )
         ORDER BY c.last_name, c.first_name`)
    }
  }

  return { agency, incident, notes, attachments, visits, backgroundCheck, earlierBackgroundChecks, trainings, lastCaregiverVisit, otherMembers }
}

export type IncidentCase = NonNullable<Awaited<ReturnType<typeof loadIncidentCase>>>

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
const label = (map: Record<string, string>, v: unknown) => (v && map[String(v)]) || text(v)
const personName = (first: unknown, last: unknown) => `${text(first)} ${text(last)}`.replace(/\s+/g, ' ').trim()
const memberIdLine = (i: any) => {
  const ids: string[] = []
  if (i.medicaid_id) ids.push(`Medicaid ID ${i.medicaid_id}`)
  if (i.mco_member_id) ids.push(`Member ID ${i.mco_member_id}`)
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
  const caregiver = personName(i.caregiver_first, i.caregiver_last)
  const member = personName(i.client_first, i.client_last)
  if (!i.caregiver_id) return 'No caregiver is named on this incident.'
  const parts: string[] = []
  if (i.caregiver_removed_from_s) {
    parts.push(`Effective ${longDate(i.caregiver_removed_from_s)}, ${agency.name} removed ${caregiver} from ${member}'s schedule pending investigation.`)
    if (i.caregiver_returned_on_s) parts.push(`The caregiver was returned to the member's schedule on ${longDate(i.caregiver_returned_on_s)}.`)
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
  const member = personName(i.client_first, i.client_last)
  const caregiver = personName(i.caregiver_first, i.caregiver_last)

  ui.h2('Incident')
  ui.kv([
    ['Incident number', i.incident_number],
    ['Status', label(INCIDENT_STATUSES, i.investigation_status)],
    ['Member', [member, i.client_dob ? `DOB ${i.client_dob}` : '', memberIdLine(i)].filter(Boolean).join('  ·  ')],
    ['Member address', [text(i.client_address), [text(i.client_city), [text(i.client_state), text(i.client_zip)].filter(Boolean).join(' ')].filter(Boolean).join(', ')].filter(Boolean).join(', ')],
    ['Payer', i.is_private_pay ? 'Private pay' : text(i.payer_name)],
    ['Type', label(INCIDENT_TYPES, i.incident_type)],
    ['Severity', label(SEVERITIES, i.severity)],
    ['Date of incident', [longDate(i.incident_date_s), i.incident_time_s].filter(Boolean).join(' at ')],
    ['Reported by', [text(i.reported_by), text(i.reporter_contact_name)].filter(Boolean).join(' — ')],
    ['Reporter contact', [text(i.reporter_phone), text(i.reporter_email)].filter(Boolean).join('  ·  ')],
    [`Date reported to ${agency.name}`, longDate(i.reported_date_s)],
    ['Caregiver involved', caregiver],
    ['Witnesses', i.witnesses],
    ['Injuries or damage', i.injuries_or_damage],
  ])

  ui.h2('Description')
  ui.p(dash(i.description))
  if (text(i.action_taken)) { ui.h2('Actions taken'); ui.p(i.action_taken) }

  ui.h2('Investigation')
  if (notes.length === 0) {
    ui.p('No investigation entries have been recorded.', { color: MUTED })
  } else {
    ui.table(
      [{ h: 'Date', w: 72 }, { h: 'Type', w: 92 }, { h: 'What happened', wrap: true }],
      notes.map((n: any) => [shortDate(n.entry_date_s), label(ENTRY_TYPES, n.entry_type), n.summary]),
      { rowH: 13 })
  }

  ui.h2('Findings and conclusion')
  ui.kv([
    ['Conclusion', label(DISPOSITIONS, i.disposition) || 'Not yet determined'],
    ['Date closed', longDate(i.closed_date_s)],
  ])
  ui.p(text(i.findings) || 'Findings have not been recorded.', { color: text(i.findings) ? INK : MUTED })

  if (!forPayer) {
    // Internal-only detail: mandatory-report decision, follow-up, schedule, attachment index.
    ui.h2('Mandatory reporting')
    ui.kv([
      ['Decision', label(MANDATORY_REPORT_STATUSES, i.mandatory_report_status) || 'Not recorded'],
      ['Details', i.mandatory_report_details],
    ])
    if (i.follow_up_required || text(i.follow_up_notes)) {
      ui.h2('Follow-up')
      ui.p(text(i.follow_up_notes) || 'Follow-up required.')
    }
    ui.h2('Caregiver schedule')
    ui.p(scheduleStatusSentence(data))
    if (attachments.length) {
      ui.h2('Attachments on file')
      ui.bullets(attachments.map((a: any) => `${a.file_name} (${label(ATTACHMENT_CATEGORIES, a.category)})${a.description ? ` — ${a.description}` : ''}`))
    }
  }
}

// ─────────────────────────────── INCIDENT REPORT ───────────────────────────────
export function renderIncidentReportPdf(doc: PDFKit.PDFDocument, data: IncidentCase) {
  const ui = makeLayout(doc, data.agency)
  const i = data.incident
  ui.letterhead(false)
  ui.title('Incident Report', dash(i.incident_number))
  incidentSections(ui, data, { forPayer: false })
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']])
  ui.footers(`${data.agency.name}  ·  Incident ${dash(i.incident_number)}`)
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
  const member = personName(i.client_first, i.client_last)
  const caregiver = personName(i.caregiver_first, i.caregiver_last)
  const payer = i.is_private_pay ? '' : text(i.payer_name)
  const org = payer || text(i.reported_by)
  const idLine = memberIdLine(i)
  const ackSigned = !!i.training_ack_signed_at
  const relevantTrainings = trainings.filter((t: any) => RELEVANT_TRAINING_RE.test(String(t.training_name || '')))

  const enclosures = ['Incident Report and Investigation Summary']
  if (includeSchedule && visits.length) enclosures.push('Exhibit A: Visit schedule for the member\'s home')
  if (i.caregiver_id) {
    enclosures.push('Caregiver background check record')
    enclosures.push(ackSigned ? 'Caregiver training acknowledgement (signed)' : 'Caregiver training record')
    enclosures.push('Statement regarding caregiver schedule status')
  }

  // ── Cover letter ──
  ui.letterhead(false)
  ui.p(longDate(i.today_s), { after: 0.7 })
  ui.p([text(i.reporter_contact_name) || 'Care Manager', org, 'Submitted via provider correspondence'].filter(Boolean).join('\n'), { after: 0.7 })
  ui.p(`RE: Response to Provider Concern — Member ${member}${idLine ? ` (${idLine})` : ''}\n${label(INCIDENT_TYPES, i.incident_type)} · ${A} Incident ${dash(i.incident_number)}`, { bold: true, after: 0.7 })
  ui.p(`Dear ${text(i.reporter_contact_name) || 'Care Manager'},`)
  ui.p(`Thank you for notifying ${A} of this concern${i.reported_date_s ? ` on ${longDate(i.reported_date_s)}` : ''}. This letter and its enclosures respond to your request.`)

  const conclusion = i.disposition
    ? ` ${A}'s investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ` as to ${A} staff` : ''}.`
    : ` ${A}'s investigation is ongoing.`
  ui.runIn('1. Incident report and investigation. ',
    `Enclosed is ${A} Incident Report and Investigation Summary ${dash(i.incident_number)}.${conclusion}${text(i.findings) ? ` ${String(i.findings).trim()}` : ''}`)

  if (i.caregiver_id) {
    const bgcText = backgroundCheck
      ? `Enclosed is the caregiver's background check record${backgroundCheck.provider ? ` (${backgroundCheck.provider})` : ''}${backgroundCheck.status ? `, status: ${String(backgroundCheck.status).replace(/_/g, ' ').toLowerCase()}` : ''}${backgroundCheck.initiated_s ? `, initiated ${longDate(backgroundCheck.initiated_s)}` : ''}.`
      : `${A} has no background check record on file in its system for this caregiver.`
    const earlierText = earlierChecks.map((b: any) =>
      ` ${A}'s records also show an earlier completed background check${b.initiated_s ? ` initiated ${longDate(b.initiated_s)}` : ''}.${text(b.findings) ? ` ${String(b.findings).trim()}` : ''}`).join('')
    const trText = ackSigned
      ? ` Also enclosed is the caregiver's signed acknowledgement covering medication handling and the misappropriation of client property, signed ${longDate(i.training_ack_signed_s)}.`
      : relevantTrainings.length
        ? ' Also enclosed is the caregiver\'s training record for medication handling and misappropriation.'
        : ` ${A} has no completed medication-handling or misappropriation training on file in its system for this caregiver.`
    ui.runIn('2. Background check and training. ', bgcText + earlierText + trText)
    ui.runIn('3. Caregiver schedule status. ', scheduleStatusSentence(data))
    let n = 4
    if (text(i.payer_response_notes)) {
      ui.runIn(`${n++}. Additional information. `, String(i.payer_response_notes).trim())
    }
    if (otherMembers.length) {
      const window = `${shortDate(threeMonthsBefore(i.reported_date_s || i.today_s))} – ${shortDate(i.reported_date_s || i.today_s)}`
      // Names and the period each member was assigned — what the payer asked for. Visit counts are
      // deliberately not printed; the visit schedule exhibit carries detail.
      ui.runIn(`${n++}. Other members served by this caregiver. `,
        `In the three months before this concern was reported (${window}), ${A}'s records show this caregiver was assigned to the following ${text(payer) || 'payer'} member(s):`)
      ui.bullets(otherMembers.map((m: any) => {
        const span = m.first_s && m.last_s ? ` — ${m.first_s === m.last_s ? m.first_s : `${m.first_s} to ${m.last_s}`}` : ''
        return `${personName(m.first_name, m.last_name)}${span}`
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
  ui.title('Incident Report and Investigation Summary', `${dash(i.incident_number)}  ·  Confidential — contains protected health information`)
  incidentSections(ui, data, { forPayer: true })
  ui.signatures([['Investigated by (signature)', 'Date'], ['Administrator (signature)', 'Date']])

  // ── Exhibit A: visit schedule ──
  if (includeSchedule && visits.length) {
    ui.newPage(true)
    ui.title('Exhibit A — Visit Schedule', `Member: ${member}${idLine ? `  ·  ${idLine}` : ''}`)
    // The range is stated from the first visit shown, not Jan 1: a deactivated pattern no longer
    // produces visits, so earlier months can be missing and the exhibit must not imply there were none.
    ui.p(`Each row is a visit on ${A}'s schedule for the member's home, ${longDate(String(visits[0].day_s).slice(-10))} through ${longDate(i.today_s)}, with the scheduled time (agency local time) and the assigned caregiver.`, { size: 9, color: MUTED })
    ui.table(
      [{ h: '#', w: 30 }, { h: 'Date', w: 110 }, { h: 'Scheduled time', w: 140 }, { h: 'Caregiver' }],
      visits.map((v: any, n: number) => [n + 1, v.day_s, `${v.start_s} – ${v.end_s}`, personName(v.cg_first, v.cg_last)]),
      { rowH: 12 })
  }

  if (i.caregiver_id) {
    // ── Background check ──
    ui.newPage(false)
    ui.title('Caregiver Background Check', `Caregiver: ${caregiver}`)
    if (backgroundCheck) {
      ui.kv([
        ['Caregiver', caregiver],
        ['Employer', [A, agency.city, agency.state].filter(Boolean).join(', ')],
        ['Check type', backgroundCheck.check_type === 'worcs' ? 'Wisconsin Department of Justice caregiver background check (WORCS)' : text(backgroundCheck.check_type).replace(/_/g, ' ')],
        ['Provider', backgroundCheck.provider],
        ['Status', text(backgroundCheck.status).replace(/_/g, ' ')],
        ['Date initiated', longDate(backgroundCheck.initiated_s)],
        ['Next recheck due', longDate(backgroundCheck.expires_s)],
        ['Reference number', backgroundCheck.reference],
        ['Findings', backgroundCheck.findings],
      ])
      for (const b of earlierChecks) {
        ui.h2(`Earlier background check${b.initiated_s ? ` — ${longDate(b.initiated_s)}` : ''}`)
        ui.kv([
          ['Provider', b.provider],
          ['Status', text(b.status).replace(/_/g, ' ')],
          ['Date initiated', longDate(b.initiated_s)],
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
        trainings.map((t: any) => [text(t.training_name), shortDate(t.completed_s) || '—', shortDate(t.expires_s) || '—', dash(t.provider)]),
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
        ['Signed by', i.training_ack_signer_name],
        ['Date signed', longDate(i.training_ack_signed_s)],
        ['Reviewed with', i.training_ack_supervisor],
        ['Method', label(TRAINING_ACK_METHODS, i.training_ack_method)],
      ])
      const sig = dataUriToBuffer(i.training_ack_signature)
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
    ui.title('Statement Regarding Caregiver Schedule Status', `Incident ${dash(i.incident_number)}`)
    ui.kv([['Member', [member, idLine].filter(Boolean).join('  ·  ')], ['Caregiver', caregiver]])
    ui.p(scheduleStatusSentence(data))
    if (i.disposition) ui.p(`${A}'s investigation concluded the concern was ${label(DISPOSITIONS, i.disposition).toLowerCase()}${i.disposition === 'unsubstantiated' ? ` as to ${A} staff` : ''}.`)
    ui.p(`I certify that this statement is true and accurate to the best of my knowledge, based on ${A}'s scheduling records.`)
    ui.signatures([['Signature', 'Date'], ['Printed name', 'Title']])
  }

  ui.footers(`${A}  ·  Response to ${org || 'payer'}  ·  ${dash(i.incident_number)}`)
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
