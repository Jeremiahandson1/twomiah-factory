// /api/visit-docs — office-entered care notes, one per scheduled visit (office only).
//
// Built for clients whose caregiver doesn't use the app, so the only record of a visit is the
// schedule: visits come from the shared engine, never from free-typed dates, and cancelled
// occurrences never appear. A visit is client + date + scheduled start + caregiver. Ported from the
// CVHC home care CRM (routes/visitDocumentationRoutes.js): the list, saving one note, bulk-filling
// the visits that have none, and the care-notes PDF.
//
// (CVHC's invoice-from-picked-visits and the invoice + notes packet belong to the billing area.)
import { Hono } from 'hono'
import { sql } from 'drizzle-orm'
import { createId } from '@paralleldrive/cuid2'
import PDFDocument from 'pdfkit'
import { db } from '../../db/index.ts'
import { authenticate, requireAdmin } from '../middleware/auth.ts'
import { rows, one, userIdOf } from '../helpers/scheduleRows.ts'
import { occurrencesCte, hms, DATE_RE } from '../services/scheduleOccurrences.ts'
import { recordAudit } from '../services/visitNotify.ts'

const app = new Hono()
app.use('*', authenticate)
app.use('*', requireAdmin)

const TIME_RE = /^\d{2}:\d{2}(:\d{2})?$/

function fmtTime12(t: string) {
  const [h, m] = String(t).split(':').map(Number)
  const dh = h === 0 ? 12 : h > 12 ? h - 12 : h
  return `${dh}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
function fmtDate(d: string) {
  const [y, m, day] = String(d).slice(0, 10).split('-')
  return `${Number(m)}/${Number(day)}/${y}`
}

// Scheduled (non-cancelled) visits for one client in a range, with the caregiver's name.
async function scheduledVisits(clientId: string, from: string, to: string) {
  return rows<any>(sql`WITH ${occurrencesCte(from, to)}
    SELECT to_char(o.occ_date, 'YYYY-MM-DD') AS visit_date, to_char(o.start_time, 'HH24:MI:SS') AS start_time,
           to_char(o.end_time, 'HH24:MI:SS') AS end_time, o.minutes, o.caregiver_id, o.schedule_id,
           u.first_name || ' ' || u.last_name AS caregiver_name
      FROM occ o LEFT JOIN users u ON u.id = o.caregiver_id
     WHERE o.client_id = ${clientId}
     ORDER BY o.occ_date, o.start_time`)
}

const visitKey = (v: any) => `${v.visit_date}|${hms(v.start_time)}|${v.caregiver_id}`

/**
 * The client's active care tasks — the checklist a note ticks. They come from the care-task module
 * (client_task_templates); a tenant whose database does not have that table yet simply has no
 * checklist, and notes still save.
 */
async function careTasks(clientId: string): Promise<{ id: string; task_name: string; category: string | null }[]> {
  const t = await one<any>(sql`SELECT to_regclass('public.client_task_templates') IS NOT NULL AS ok`)
  if (!t?.ok) return []
  return rows(sql`SELECT id, task_name, category FROM client_task_templates
    WHERE client_id = ${clientId} AND is_active = true ORDER BY sort_order, created_at`)
}

const validRange = (from?: string, to?: string) => !!from && !!to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to

const DOC_COLS = sql.raw(`vd.id, vd.client_id, vd.caregiver_id, to_char(vd.visit_date, 'YYYY-MM-DD') AS visit_date,
  to_char(vd.start_time, 'HH24:MI:SS') AS start_time, to_char(vd.end_time, 'HH24:MI:SS') AS end_time,
  vd.schedule_id, vd.tasks, vd.note, vd.entered_by_id, vd.created_at, vd.updated_at`)

// GET /api/visit-docs/clients/:clientId?from&to — every scheduled visit with its note (if any) and
// whether an invoice already covers it.
app.get('/clients/:clientId', async (c) => {
  const clientId = c.req.param('clientId')
  const { from, to } = c.req.query()
  if (!validRange(from, to)) return c.json({ error: 'from and to (YYYY-MM-DD) are required' }, 400)
  const client = await one<any>(sql`SELECT c.id, c.first_name, c.last_name, c.is_private_pay, rs.name AS referral_source_name
    FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id WHERE c.id = ${clientId}`)
  if (!client) return c.json({ error: 'Client not found' }, 404)

  const [visits, docs, lines, invoices, tasks] = await Promise.all([
    scheduledVisits(clientId, from, to),
    rows<any>(sql`SELECT ${DOC_COLS}, u.first_name || ' ' || u.last_name AS entered_by_name
      FROM visit_documentation vd LEFT JOIN users u ON u.id = vd.entered_by_id
      WHERE vd.client_id = ${clientId} AND vd.visit_date BETWEEN ${from}::date AND ${to}::date`),
    // Lines that name a visit's day and caregiver.
    rows<any>(sql`SELECT to_char(ili.service_date, 'YYYY-MM-DD') AS visit_date, ili.caregiver_id, i.invoice_number, i.id AS invoice_id
      FROM invoice_line_items ili JOIN invoices i ON i.id = ili.invoice_id
      WHERE i.client_id = ${clientId} AND ili.service_date BETWEEN ${from}::date AND ${to}::date`),
    // An invoice whose period covers a date bills that date even without a matching line.
    rows<any>(sql`SELECT id, invoice_number, to_char(billing_period_start, 'YYYY-MM-DD') AS start,
        to_char(billing_period_end, 'YYYY-MM-DD') AS "end", total, payment_status
      FROM invoices WHERE client_id = ${clientId} AND billing_period_start <= ${to}::date AND billing_period_end >= ${from}::date
      ORDER BY billing_period_start`),
    careTasks(clientId),
  ])

  const docByKey = new Map(docs.map((d) => [visitKey(d), d]))
  const lineByDay = new Map(lines.map((l) => [`${l.visit_date}|${l.caregiver_id}`, l]))
  return c.json({
    client: { id: client.id, name: `${client.first_name} ${client.last_name}`, payer: client.referral_source_name || (client.is_private_pay ? 'Private pay' : null) },
    tasks,
    visits: visits.map((v) => {
      const line = lineByDay.get(`${v.visit_date}|${v.caregiver_id}`)
      const covering = invoices.find((i) => i.start <= v.visit_date && i.end >= v.visit_date)
      return {
        ...v,
        doc: docByKey.get(visitKey(v)) || null,
        invoiced: line ? { invoiceId: line.invoice_id, invoiceNumber: line.invoice_number }
          : covering ? { invoiceId: covering.id, invoiceNumber: covering.invoice_number, byPeriod: true } : null,
      }
    }),
    invoices,
  })
})

// PUT /api/visit-docs/clients/:clientId/visits { visitDate, startTime, caregiverId, tasks, note } —
// save one visit's note. The visit must be a real scheduled occurrence; its end time and schedule
// come from the schedule, not the request.
app.put('/clients/:clientId/visits', async (c) => {
  const user = c.get('user') as any
  const clientId = c.req.param('clientId')
  const { visitDate, startTime, caregiverId, tasks, note } = await c.req.json().catch(() => ({})) as any
  if (!DATE_RE.test(visitDate || '') || !TIME_RE.test(startTime || '') || !caregiverId) {
    return c.json({ error: 'visitDate, startTime and caregiverId are required' }, 400)
  }
  const cleanTasks = (Array.isArray(tasks) ? tasks : [])
    .filter((t: any) => t && t.taskId && t.taskName)
    .map((t: any) => ({ taskId: String(t.taskId), taskName: String(t.taskName).slice(0, 200), done: !!t.done }))
  const cleanNote = typeof note === 'string' ? note.trim() : ''
  const visit = (await scheduledVisits(clientId, visitDate, visitDate))
    .find((v) => hms(v.start_time) === hms(startTime) && v.caregiver_id === caregiverId)
  if (!visit) return c.json({ error: 'No scheduled visit for that client, date, time and caregiver.' }, 404)

  const saved = await one<any>(sql`
    INSERT INTO visit_documentation (id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by_id, created_at, updated_at)
    VALUES (${createId()}, ${clientId}, ${caregiverId}, ${visitDate}::date, ${hms(startTime)}::time, ${visit.end_time}::time,
            ${visit.schedule_id}, ${JSON.stringify(cleanTasks)}::json, ${cleanNote || null}, ${userIdOf(user)}, NOW(), NOW())
    ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
      SET end_time = EXCLUDED.end_time, schedule_id = EXCLUDED.schedule_id, tasks = EXCLUDED.tasks,
          note = EXCLUDED.note, entered_by_id = EXCLUDED.entered_by_id, updated_at = NOW()
    RETURNING id`)
  const row = await one(sql`SELECT ${DOC_COLS}, u.first_name || ' ' || u.last_name AS entered_by_name
    FROM visit_documentation vd LEFT JOIN users u ON u.id = vd.entered_by_id WHERE vd.id = ${saved.id}`)
  await recordAudit(userIdOf(user), 'UPSERT', 'visit_documentation', saved.id, null, row)
  return c.json(row)
})

// POST /api/visit-docs/clients/:clientId/visits/bulk { from, to, note, onlyMissing } — write the same
// note, with every active care task ticked, to each scheduled visit in the range. onlyMissing
// (default true) never touches a visit that already has a note, so real entries can't be overwritten.
app.post('/clients/:clientId/visits/bulk', async (c) => {
  const user = c.get('user') as any
  const clientId = c.req.param('clientId')
  const { from, to, note, onlyMissing } = await c.req.json().catch(() => ({})) as any
  if (!validRange(from, to)) return c.json({ error: 'from and to (YYYY-MM-DD) are required' }, 400)
  const cleanNote = typeof note === 'string' ? note.trim() : ''
  if (!cleanNote) return c.json({ error: 'A note is required.' }, 400)
  const skipExisting = onlyMissing !== false

  const [visits, taskRows, existing] = await Promise.all([
    scheduledVisits(clientId, from, to),
    careTasks(clientId),
    rows<any>(sql`SELECT to_char(visit_date, 'YYYY-MM-DD') AS visit_date, to_char(start_time, 'HH24:MI:SS') AS start_time, caregiver_id
      FROM visit_documentation WHERE client_id = ${clientId} AND visit_date BETWEEN ${from}::date AND ${to}::date`),
  ])
  const have = new Set(existing.map(visitKey))
  const targets = visits.filter((v) => !(skipExisting && have.has(visitKey(v))))
  if (targets.length === 0) return c.json({ written: 0, skipped: visits.length })
  const tasks = JSON.stringify(taskRows.map((t) => ({ taskId: t.id, taskName: t.task_name, done: true })))

  await db.transaction(async (tx) => {
    for (const v of targets) {
      await tx.execute(sql`
        INSERT INTO visit_documentation (id, client_id, caregiver_id, visit_date, start_time, end_time, schedule_id, tasks, note, entered_by_id, created_at, updated_at)
        VALUES (${createId()}, ${clientId}, ${v.caregiver_id}, ${v.visit_date}::date, ${v.start_time}::time, ${v.end_time}::time,
                ${v.schedule_id}, ${tasks}::json, ${cleanNote}, ${userIdOf(user)}, NOW(), NOW())
        ON CONFLICT (client_id, visit_date, start_time, caregiver_id) DO UPDATE
          SET end_time = EXCLUDED.end_time, schedule_id = EXCLUDED.schedule_id, tasks = EXCLUDED.tasks,
              note = EXCLUDED.note, entered_by_id = EXCLUDED.entered_by_id, updated_at = NOW()`)
    }
  })
  await recordAudit(userIdOf(user), 'BULK_FILL', 'visit_documentation', clientId, null,
    { from, to, written: targets.length, skipped: visits.length - targets.length, note: cleanNote })
  return c.json({ written: targets.length, skipped: visits.length - targets.length })
})

// One visit's block: date / time / caregiver, its task checklist and its note.
function drawVisitBlock(doc: PDFKit.PDFDocument, v: any, L: number, R: number, ensure: (h: number) => void) {
  const tasks = Array.isArray(v.doc?.tasks) ? v.doc.tasks : []
  const noteText = v.doc?.note || ''
  ensure(34 + tasks.length * 12 + (noteText ? doc.heightOfString(noteText, { width: R - L - 12 }) + 8 : 14))
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
    .text(`${fmtDate(v.visit_date)}   ${fmtTime12(v.start_time)} – ${fmtTime12(v.end_time)}   ·   ${v.caregiver_name || ''}`, L, doc.y)
  doc.font('Helvetica').fontSize(9).fillColor('#111827')
  for (const t of tasks) doc.text(`${t.done ? '[X]' : '[  ]'}  ${t.taskName}`, L + 12, doc.y)
  if (noteText) doc.moveDown(0.2).text(noteText, L + 12, doc.y, { width: R - L - 12, lineGap: 1.5 })
  else if (!tasks.length) doc.fillColor('#6B7280').text('No note recorded for this visit.', L + 12, doc.y)
  doc.moveDown(0.5)
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#E5E7EB').stroke()
  doc.moveDown(0.5)
}

// GET /api/visit-docs/clients/:clientId/notes.pdf?from&to — the care notes on their own, every
// scheduled visit in the range; a visit with no note is listed and says so, so a gap is visible.
app.get('/clients/:clientId/notes.pdf', async (c) => {
  const clientId = c.req.param('clientId')
  const { from, to } = c.req.query()
  if (!validRange(from, to)) return c.json({ error: 'from and to (YYYY-MM-DD) are required' }, 400)
  const client = await one<any>(sql`SELECT c.first_name, c.last_name, to_char(c.date_of_birth, 'YYYY-MM-DD') AS dob,
      c.address, c.city, c.state, c.zip, rs.name AS payer_name
    FROM clients c LEFT JOIN referral_sources rs ON rs.id = c.referred_by_id WHERE c.id = ${clientId}`)
  if (!client) return c.json({ error: 'Client not found' }, 404)
  const agency = await one<any>(sql`SELECT name FROM agencies LIMIT 1`)
  const visits = await scheduledVisits(clientId, from, to)
  const docs = await rows<any>(sql`SELECT ${DOC_COLS} FROM visit_documentation vd
    WHERE vd.client_id = ${clientId} AND vd.visit_date BETWEEN ${from}::date AND ${to}::date`)
  const docByKey = new Map(docs.map((d) => [visitKey(d), d]))
  const list = visits.map((v) => ({ ...v, doc: docByKey.get(visitKey(v)) || null }))

  const pdf: Buffer = await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margin: 54 })
    const chunks: Buffer[] = []
    doc.on('data', (ch: Buffer) => chunks.push(ch))
    doc.on('end', () => resolve(Buffer.concat(chunks)))
    doc.on('error', reject)
    const L = 54, R = 558
    const ensure = (h: number) => { if (doc.y + h > 720) doc.addPage() }
    const documented = list.filter((r) => r.doc).length
    doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(18).text('Care Notes', L, 54)
    if (agency?.name) doc.fillColor('#4B5563').font('Helvetica').fontSize(9).text(agency.name)
    doc.moveDown(0.5)
    doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(`${client.first_name} ${client.last_name}`)
    const small: string[] = []
    if (client.dob) small.push(`DOB: ${fmtDate(client.dob)}`)
    if (client.payer_name) small.push(client.payer_name)
    if (client.address) small.push(`${client.address}${client.city ? `, ${client.city}` : ''}${client.state ? `, ${client.state}` : ''} ${client.zip || ''}`.trim())
    doc.font('Helvetica').fontSize(9).fillColor('#4B5563').text(small.join('  ·  '))
    doc.text(`${fmtDate(from!)} – ${fmtDate(to!)}  ·  ${list.length} visit${list.length === 1 ? '' : 's'}  ·  ${documented} documented`)
    doc.moveDown(0.4)
    doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#BFDBFE').stroke()
    doc.moveDown(0.5)
    if (list.length === 0) doc.fillColor('#4B5563').font('Helvetica').fontSize(10).text('No scheduled visits in this date range.', L, doc.y)
    for (const v of list) drawVisitBlock(doc, v, L, R, ensure)
    doc.fontSize(7.5).fillColor('#6B7280')
      .text('This document contains Protected Health Information — handle per HIPAA.', L, Math.max(doc.y + 10, 730), { width: R - L, align: 'center' })
    doc.end()
  })
  const fname = `care-notes-${client.last_name}-${client.first_name}-${from}-to-${to}.pdf`.replace(/[^a-zA-Z0-9._-]/g, '_')
  return new Response(pdf, { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` } })
})

export default app
