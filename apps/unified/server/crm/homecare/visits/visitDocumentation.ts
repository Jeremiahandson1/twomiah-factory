// /api/visit-docs — office-entered care notes, one per scheduled visit (office only). Moved from
// templates/crm-homecare/backend/src/routes/visitDocumentation.ts (ported there from the CVHC home care CRM,
// routes/visitDocumentationRoutes.js); its SQL is in server/data/homecareVisits.ts, the visit record rules in
// core/visitRecord.ts.
//
// Built for clients whose caregiver doesn't use the app, so the only record of a visit is the schedule: visits come
// from the shared engine, never from free-typed dates, and cancelled occurrences never appear. A visit is client + date
// + scheduled start + caregiver.
//
// It was requireAdmin: OFFICE_EVV. Changes: every read and write is the company's (a client of another company is a
// 404); replies are camelCase (RULEBOOK §2: visitDate, startTime, caregiverId, doc, punch.clockIn …).
import { Hono } from 'hono'
import { and, asc, eq } from 'drizzle-orm'
import { clientTaskTemplates, company } from '../../../db/schema/index.ts'
import type { AppEnv } from '../../../http/env.ts'
import { fail, one } from '../../../http/reply.ts'
import type { CrmDeps } from '../../deps.ts'
import type { HomecareCore } from '../core/index.ts'
import { hms, DATE_RE } from '../core/scheduleOccurrences.ts'
import { visitKey, matchPunch, clockOutNote, mergeTasks } from '../core/visitRecord.ts'
import { renderPdf, pdfFileName } from '../core/carePdf.ts'
import {
  visitDocClient, notesPdfClient, visitDocsInRange, visitDocById, invoiceLinesInRange, invoicesCoveringRange,
  upsertVisitDoc, upsertVisitDocs,
} from '../../../data/homecareVisits.ts'
import { OFFICE_EVV, who } from './shared.ts'

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

const validRange = (from?: string, to?: string): boolean => !!from && !!to && DATE_RE.test(from) && DATE_RE.test(to) && from <= to

/**
 * A saved note's tasks as they stand now: the caregiver's recorded statuses win over the saved snapshot (a note saved
 * before the caregiver recorded a refusal still shows the refusal).
 */
function effectiveTasks(doc: any, active: { id: string; taskName: string }[], rec: Map<string, { status: string; notes: string | null }> | undefined) {
  const saved: any[] = Array.isArray(doc?.tasks) ? doc.tasks : []
  if (!saved.length && !rec?.size) return saved
  const savedBy = new Map(saved.map((t) => [t.taskId, t]))
  return mergeTasks(active, rec, (id) => !!savedBy.get(id)?.done,
    saved.filter((t) => !active.some((a) => a.id === t.taskId)))
}

// One visit's block: date / time / caregiver, its task checklist and its note.
function drawVisitBlock(doc: PDFKit.PDFDocument, v: any, L: number, R: number, ensure: (h: number) => void) {
  const tasks = Array.isArray(v.doc?.tasks) ? v.doc.tasks : []
  const noteText = v.doc?.note || ''
  ensure(34 + tasks.length * 12 + (noteText ? doc.heightOfString(noteText, { width: R - L - 12 }) + 8 : 14))
  doc.fillColor('#111827').font('Helvetica-Bold').fontSize(10)
    .text(`${fmtDate(v.visitDate)}   ${fmtTime12(v.startTime)} – ${fmtTime12(v.endTime)}   ·   ${v.caregiverName || ''}`, L, doc.y)
  doc.font('Helvetica').fontSize(9).fillColor('#111827')
  for (const t of tasks) {
    // A refused or skipped task says so, with the caregiver's note — an empty box would read as "forgot".
    const mark = t.status === 'refused' ? '[R]' : t.status === 'skipped' ? '[S]' : t.done ? '[X]' : '[  ]'
    const why = (t.status === 'refused' || t.status === 'skipped') ? ` (${t.status}${t.notes ? `: ${t.notes}` : ''})` : ''
    doc.text(`${mark}  ${t.taskName}${why}`, L + 12, doc.y)
  }
  if (noteText) doc.moveDown(0.2).text(noteText, L + 12, doc.y, { width: R - L - 12, lineGap: 1.5 })
  else if (!tasks.length) doc.fillColor('#6B7280').text('No note recorded for this visit.', L + 12, doc.y)
  doc.moveDown(0.5)
  doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#E5E7EB').stroke()
  doc.moveDown(0.5)
}

export function createVisitDocumentationRoutes(core: HomecareCore, d: CrmDeps) {
  const { db } = d
  const { requirePermission } = d.permissions
  const { visitRecord } = core
  const app = new Hono<AppEnv>()
  app.use('*', requirePermission(OFFICE_EVV))

  /** Each visit's punch (matched once) and that punch's recorded task statuses. */
  async function punchesFor(companyId: string, clientId: string, from: string, to: string, visits: any[]) {
    const punches = await visitRecord.clientPunches(companyId, clientId, from, to)
    const taken = new Set<string>()
    const byVisit = new Map<string, any>()
    for (const v of visits) {
      const p = matchPunch(v, punches, taken)
      if (p) { taken.add(p.id); byVisit.set(visitKey(v), p) }
    }
    const recorded = await visitRecord.recordedTasks(companyId, [...byVisit.values()].map((p) => p.id))
    return { byVisit, recorded }
  }

  /** The client's active care tasks — the checklist a note ticks (the care-task module's client_task_templates). */
  function careTasks(companyId: string, clientId: string): Promise<{ id: string; taskName: string; category: string | null }[]> {
    return db.select({ id: clientTaskTemplates.id, taskName: clientTaskTemplates.taskName, category: clientTaskTemplates.category })
      .from(clientTaskTemplates)
      .where(and(eq(clientTaskTemplates.companyId, companyId), eq(clientTaskTemplates.clientId, clientId), eq(clientTaskTemplates.isActive, true)))
      .orderBy(asc(clientTaskTemplates.sortOrder), asc(clientTaskTemplates.createdAt))
  }

  // GET /clients/:clientId?from&to — every scheduled visit with its note (if any) and whether an invoice covers it.
  app.get('/clients/:clientId', async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')
    const { from, to } = c.req.query()
    if (!validRange(from, to)) return fail(c, 400, 'from and to (YYYY-MM-DD) are required')
    const client = await visitDocClient(db, companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')

    const [visits, docs, lines, invoices, tasks] = await Promise.all([
      visitRecord.scheduledVisits(companyId, clientId, from, to),
      visitDocsInRange(db, companyId, clientId, from, to),
      invoiceLinesInRange(db, companyId, clientId, from, to),
      invoicesCoveringRange(db, companyId, clientId, from, to),
      careTasks(companyId, clientId),
    ])

    const docByKey = new Map(docs.map((x: any) => [visitKey(x), x]))
    const lineByDay = new Map(lines.map((l: any) => [`${l.visitDate}|${l.caregiverId}`, l]))
    const { byVisit, recorded } = await punchesFor(companyId, clientId, from, to, visits)
    const taskName = new Map(tasks.map((t) => [t.id, t.taskName]))
    return one(c, {
      client: { id: client.id, name: `${client.firstName} ${client.lastName}`, payer: client.referralSourceName || (client.isPrivatePay ? 'Private pay' : null) },
      tasks,
      visits: visits.map((v: any) => {
        const line: any = lineByDay.get(`${v.visitDate}|${v.caregiverId}`)
        const covering = invoices.find((i: any) => i.start <= v.visitDate && i.end >= v.visitDate)
        const p = byVisit.get(visitKey(v))
        const rec = p ? recorded.get(p.id) : undefined
        const saved: any = docByKey.get(visitKey(v))
        return {
          ...v,
          doc: saved ? { ...saved, tasks: effectiveTasks(saved, tasks, rec) } : null,
          // What the caregiver recorded on the visit's punch: clock times, clock-out note, task statuses.
          punch: p ? {
            timeEntryId: p.id, clockIn: p.clockIn, clockOut: p.clockOut, clockOutNote: clockOutNote(p.notes),
            tasks: rec ? [...rec.entries()].map(([taskId, r]) => ({ taskId, taskName: taskName.get(taskId) || null, status: r.status, notes: r.notes })) : [],
          } : null,
          invoiced: line ? { invoiceId: line.invoiceId, invoiceNumber: line.invoiceNumber }
            : covering ? { invoiceId: covering.id, invoiceNumber: covering.invoiceNumber, byPeriod: true } : null,
        }
      }),
      invoices,
    })
  })

  // PUT /clients/:clientId/visits { visitDate, startTime, caregiverId, tasks, note } — save one visit's note. The visit
  // must be a real scheduled occurrence; its end time and schedule come from the schedule, not the request.
  app.put('/clients/:clientId/visits', async (c) => {
    const { companyId, me } = who(c)
    const clientId = c.req.param('clientId')
    const { visitDate, startTime, caregiverId, tasks, note } = await c.req.json().catch(() => ({})) as any
    if (!DATE_RE.test(visitDate || '') || !TIME_RE.test(startTime || '') || !caregiverId) {
      return fail(c, 400, 'visitDate, startTime and caregiverId are required')
    }
    const cleanTasks = (Array.isArray(tasks) ? tasks : [])
      .filter((t: any) => t && t.taskId && t.taskName)
      .map((t: any) => ({ taskId: String(t.taskId), taskName: String(t.taskName).slice(0, 200), done: !!t.done }))
    const cleanNote = typeof note === 'string' ? note.trim() : ''
    const visit = (await visitRecord.scheduledVisits(companyId, clientId, visitDate, visitDate))
      .find((v: any) => hms(v.startTime) === hms(startTime) && v.caregiverId === caregiverId)
    if (!visit) return fail(c, 404, 'No scheduled visit for that client, date, time and caregiver.')
    // A task the caregiver recorded on the visit keeps the caregiver's status; the office's ticks apply to the rest
    // (core/visitRecord.ts mergeTasks).
    const { byVisit, recorded } = await punchesFor(companyId, clientId, visitDate, visitDate, [visit])
    const p = byVisit.get(visitKey(visit))
    const active = await careTasks(companyId, clientId)
    const officeBy = new Map(cleanTasks.map((t: any) => [t.taskId, t.done]))
    const mergedTasks = mergeTasks(active, p ? recorded.get(p.id) : undefined, (id) => officeBy.get(id) ?? false,
      cleanTasks.filter((t: any) => !active.some((a) => a.id === t.taskId)))

    const id = await upsertVisitDoc(db, companyId, {
      clientId, caregiverId, visitDate, startTime: hms(startTime)!, endTime: visit.endTime, scheduleId: visit.scheduleId,
      tasks: JSON.stringify(mergedTasks), note: cleanNote || null, enteredById: me,
    })
    const row = await visitDocById(db, companyId, id)
    await core.notify.recordAudit(companyId, me, 'UPSERT', 'visit_documentation', id, null, row)
    return one(c, row)
  })

  // POST /clients/:clientId/visits/bulk { from, to, note, onlyMissing } — write the same note to each scheduled visit in
  // the range. Each visit's tasks carry what the caregiver RECORDED on that visit (completed / skipped / refused, with
  // the note) — never overwritten; only tasks the caregiver left unrecorded are ticked done. onlyMissing (default true)
  // never touches a visit that already has documentation, so real entries can't be overwritten.
  app.post('/clients/:clientId/visits/bulk', async (c) => {
    const { companyId, me } = who(c)
    const clientId = c.req.param('clientId')
    const { from, to, note, onlyMissing } = await c.req.json().catch(() => ({})) as any
    if (!validRange(from, to)) return fail(c, 400, 'from and to (YYYY-MM-DD) are required')
    const cleanNote = typeof note === 'string' ? note.trim() : ''
    if (!cleanNote) return fail(c, 400, 'A note is required.')
    if (!(await visitDocClient(db, companyId, clientId))) return fail(c, 404, 'Client not found')
    const skipExisting = onlyMissing !== false

    const [visits, taskRows, existing] = await Promise.all([
      visitRecord.scheduledVisits(companyId, clientId, from, to),
      careTasks(companyId, clientId),
      visitDocsInRange(db, companyId, clientId, from, to, false),
    ])
    const have = new Set(existing.map(visitKey))
    const targets = visits.filter((v: any) => !(skipExisting && have.has(visitKey(v))))
    if (targets.length === 0) return one(c, { written: 0, skipped: visits.length })
    const { byVisit, recorded } = await punchesFor(companyId, clientId, from, to, visits)
    const tasksFor = (v: any) => {
      const p = byVisit.get(visitKey(v))
      return JSON.stringify(mergeTasks(taskRows, p ? recorded.get(p.id) : undefined, () => true))
    }

    await upsertVisitDocs(db, companyId, targets.map((v: any) => ({
      clientId, caregiverId: v.caregiverId, visitDate: v.visitDate, startTime: v.startTime, endTime: v.endTime,
      scheduleId: v.scheduleId, tasks: tasksFor(v), note: cleanNote, enteredById: me,
    })))
    await core.notify.recordAudit(companyId, me, 'BULK_FILL', 'visit_documentation', clientId, null,
      { from, to, written: targets.length, skipped: visits.length - targets.length, note: cleanNote })
    return one(c, { written: targets.length, skipped: visits.length - targets.length })
  })

  // GET /clients/:clientId/notes.pdf?from&to — the care notes on their own, every scheduled visit in the range; a visit
  // with no note is listed and says so, so a gap is visible.
  app.get('/clients/:clientId/notes.pdf', async (c) => {
    const { companyId } = who(c)
    const clientId = c.req.param('clientId')
    const { from, to } = c.req.query()
    if (!validRange(from, to)) return fail(c, 400, 'from and to (YYYY-MM-DD) are required')
    const client = await notesPdfClient(db, companyId, clientId)
    if (!client) return fail(c, 404, 'Client not found')
    const [agency] = await db.select({ name: company.name }).from(company).where(eq(company.id, companyId)).limit(1)
    const visits = await visitRecord.scheduledVisits(companyId, clientId, from, to)
    const docs = await visitDocsInRange(db, companyId, clientId, from, to, false)
    const docByKey = new Map(docs.map((x: any) => [visitKey(x), x]))
    const { byVisit, recorded } = await punchesFor(companyId, clientId, from, to, visits)
    const active = await careTasks(companyId, clientId)
    const rows = visits.map((v: any) => {
      const saved: any = docByKey.get(visitKey(v)) || null
      const p = byVisit.get(visitKey(v))
      return { ...v, doc: saved ? { ...saved, tasks: effectiveTasks(saved, active, p ? recorded.get(p.id) : undefined) } : null }
    })

    const pdf = await renderPdf((doc) => {
      const L = 54, R = 558
      const ensure = (h: number) => { if (doc.y + h > 720) doc.addPage() }
      const documented = rows.filter((r: any) => r.doc).length
      doc.fillColor('#1D4ED8').font('Helvetica-Bold').fontSize(18).text('Care Notes', L, 54)
      if (agency?.name) doc.fillColor('#4B5563').font('Helvetica').fontSize(9).text(agency.name)
      doc.moveDown(0.5)
      doc.fillColor('#111827').font('Helvetica-Bold').fontSize(13).text(`${client.firstName} ${client.lastName}`)
      const small: string[] = []
      if (client.dob) small.push(`DOB: ${fmtDate(client.dob)}`)
      if (client.payerName) small.push(client.payerName)
      if (client.address) small.push(`${client.address}${client.city ? `, ${client.city}` : ''}${client.state ? `, ${client.state}` : ''} ${client.zip || ''}`.trim())
      doc.font('Helvetica').fontSize(9).fillColor('#4B5563').text(small.join('  ·  '))
      doc.text(`${fmtDate(from!)} – ${fmtDate(to!)}  ·  ${rows.length} visit${rows.length === 1 ? '' : 's'}  ·  ${documented} documented`)
      doc.moveDown(0.4)
      doc.moveTo(L, doc.y).lineTo(R, doc.y).strokeColor('#BFDBFE').stroke()
      doc.moveDown(0.5)
      if (rows.length === 0) doc.fillColor('#4B5563').font('Helvetica').fontSize(10).text('No scheduled visits in this date range.', L, doc.y)
      for (const v of rows) drawVisitBlock(doc, v, L, R, ensure)
      doc.fontSize(7.5).fillColor('#6B7280')
        .text('This document contains Protected Health Information — handle per HIPAA.', L, Math.max(doc.y + 10, 730), { width: R - L, align: 'center' })
    })
    const fname = pdfFileName(`care-notes-${client.lastName}-${client.firstName}-${from}-to-${to}.pdf`)
    return new Response(new Uint8Array(pdf), { status: 200, headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `attachment; filename="${fname}"` } })
  })

  return app
}
