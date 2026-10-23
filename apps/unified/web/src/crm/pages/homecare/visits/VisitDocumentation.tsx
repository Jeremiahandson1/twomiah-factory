// Moved from templates/crm-homecare/frontend/src/components/admin/VisitDocumentation.tsx (ported there from the CVHC home
// care CRM) — office-entered care notes for each scheduled visit. Built for clients whose caregiver doesn't use the app:
// visits come from the schedule, so a cancelled visit never appears and a date can't be typed in. Tick visits to bill
// them: "Create invoice" builds a draft invoice from exactly those visits through billing's POST
// /api/billing/invoices/from-visits (the same engine as Billing → Invoice from visits; it re-checks each visit against
// the schedule and refuses one an invoice already bills).
//
// Server: GET /api/clients (the picker: the office's { data } list, asked for every active client), GET
// /api/visit-docs/clients/:id?from&to → { client { name, payer }, tasks [{ id, taskName }], visits [{ visitDate,
// startTime, endTime, minutes, caregiverId, caregiverName, scheduleId, doc, punch { clockOutNote, tasks }, invoiced
// { invoiceNumber } }], invoices [{ id, invoiceNumber, start, end, total, paymentStatus }] }; PUT …/visits (the saved
// doc, enteredByName); POST …/visits/bulk → { written, skipped }; GET …/notes.pdf
// (server/crm/homecare/visits/visitDocumentation.ts) and POST /api/billing/invoices/from-visits (the invoice row:
// invoiceNumber, total).
//
// Changes from the template: no token (the app's client; the PDF through downloadBlob / saveBlob); every field camelCase
// (visit_date → visitDate, caregiver_name → caregiverName, clock_out_note → clockOutNote, task_name → taskName,
// invoice_number → invoiceNumber, payment_status → paymentStatus, entered_by_name → enteredByName, updated_at →
// updatedAt); the client picker reads the list reply; dates through lib/date; every colour a frame token (the open
// row is the info pair, the result line the success / danger pair); buttons are hc-btn.
import { Fragment, useCallback, useEffect, useState } from 'react'
import { api, rows, downloadBlob, saveBlob, errorMessage, listAll } from '../lib/http'
import { formatDate, toLocalYMD } from '../lib/date'
import VisitPhotoGallery from './VisitPhotoGallery'
import { useMay } from '../lib/useMay'
import { money as formatMoney } from '@twomiah/tenant-ui/src/money'

/** A row of GET /api/clients (the office's list). */
interface ClientRow { id: string; firstName: string | null; lastName: string | null; isActive?: boolean | null }

interface DocTask { taskId: string; taskName: string; done: boolean; status?: string; notes?: string | null; recordedBy?: 'caregiver' | 'office' }
interface SavedDoc { id: string; note: string | null; tasks: DocTask[] | null; updatedAt?: string | null; enteredByName?: string | null }
interface PunchTask { taskId: string; taskName: string | null; status: string; notes: string | null }
interface Visit {
  visitDate: string
  startTime: string
  endTime: string
  minutes: number | string | null
  caregiverId: string
  caregiverName: string | null
  scheduleId: string | null
  doc: SavedDoc | null
  punch: { timeEntryId: string; clockIn: string | null; clockOut: string | null; clockOutNote: string | null; tasks: PunchTask[] } | null
  invoiced: { invoiceId: string; invoiceNumber: string; byPeriod?: boolean } | null
}
interface Invoice { id: string; invoiceNumber: string; start: string; end: string; total: string | number; paymentStatus: string | null }
interface VisitDocs {
  client: { id: string; name: string; payer: string | null }
  tasks: { id: string; taskName: string; category: string | null }[]
  visits: Visit[]
  invoices: Invoice[]
}

const todayStr = () => toLocalYMD(new Date())
const daysAgo = (n: number) => { const d = new Date(); d.setDate(d.getDate() - n); return toLocalYMD(d) }
const fmtDate = (s: string) => { const [y, m, d] = String(s).slice(0, 10).split('-'); return `${Number(m)}/${Number(d)}/${y}` }
const weekday = (s: string) => formatDate(s, { weekday: 'short' })
const fmtTime = (t: string) => {
  const [h, m] = String(t).split(':').map(Number)
  return `${h === 0 ? 12 : h > 12 ? h - 12 : h}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`
}
const vkey = (v: { visitDate: string; startTime: string; caregiverId: string }) => `${v.visitDate}|${v.startTime}|${v.caregiverId}`
const money = (n: unknown) => `${formatMoney((Number(n) || 0))}`
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`
// A person's name the way every other screen prints it: "Pat Example".
const fullName = (c: { firstName?: string | null; lastName?: string | null }) => [c?.firstName, c?.lastName].filter(Boolean).join(' ')
// What the caregiver recorded on the visit, in words. Refused and skipped are facts from the visit.
const STATUS_LABEL: Record<string, string> = { completed: 'Done', refused: 'Refused', skipped: 'Skipped' }

const OPEN_ROW = { background: 'var(--hc-info-bg)', color: 'var(--hc-ink)' }
const CAREGIVER_STATUS_INK = 'var(--hc-warning-ink)'

const VisitDocumentation = () => {
  // Notes are evv:delete (visits/visitDocumentation.ts), the invoice is care-billing:create (billing/invoices.ts) — lib/useMay.ts.
  const may = useMay('evv')
  const mayBill = useMay('care-billing')
  const [clients, setClients] = useState<ClientRow[]>([])
  const [clientId, setClientId] = useState('')
  const [from, setFrom] = useState(daysAgo(30))
  const [to, setTo] = useState(todayStr())
  const [data, setData] = useState<VisitDocs | null>(null)
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<{ type: 'error' | 'success'; text: string } | null>(null)
  const [openKey, setOpenKey] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ tasks: DocTask[]; note: string }>({ tasks: [], note: '' })
  const [saving, setSaving] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkNote, setBulkNote] = useState('Personal care provided. Walked hallways with assistance. Vacuumed and dusted.')
  const [bulkBusy, setBulkBusy] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    // The office's client list is paged: ask for every active client in one page.
    listAll('/api/clients', { isActive: 'true' })
      .then((reply) => {
        setClients(rows<ClientRow>(reply)
          .filter((c) => c.isActive !== false)
          .sort((a, b) => fullName(a).localeCompare(fullName(b))))
      })
      .catch(() => setClients([]))
  }, [])

  // keepMessage: a reload right after saving must not wipe the result the user is waiting to read.
  const load = useCallback(async (keepMessage?: boolean) => {
    if (!clientId || !from || !to) return
    setLoading(true)
    if (keepMessage !== true) setMessage(null)
    try {
      setData(await api.get(`/api/visit-docs/clients/${clientId}`, { from, to }))
    } catch (e) {
      setData(null)
      setMessage({ type: 'error', text: `Could not load visits: ${errorMessage(e, 'Request failed')}` })
    } finally { setLoading(false) }
  }, [clientId, from, to])

  useEffect(() => { load() }, [load])
  // A new client or date range starts with nothing ticked.
  useEffect(() => { setSelected(new Set()) }, [clientId, from, to])

  const visits = data?.visits || []
  const billable = visits.filter((v) => !v.invoiced)
  const pickedVisits = visits.filter((v) => selected.has(vkey(v)))
  const pickedUndocumented = pickedVisits.filter((v) => !v.doc).length
  const toggle = (v: Visit) => setSelected((s) => {
    const n = new Set(s); const k = vkey(v)
    if (n.has(k)) n.delete(k); else n.add(k)
    return n
  })

  const createInvoice = async () => {
    if (!pickedVisits.length || creating) return
    setCreating(true); setMessage(null)
    try {
      const body: { invoiceNumber?: string; total?: string | number } = await api.post('/api/billing/invoices/from-visits', {
        clientId, visits: pickedVisits.map((v) => ({ visitDate: v.visitDate, startTime: v.startTime, caregiverId: v.caregiverId })),
      })
      setSelected(new Set())
      setMessage({ type: 'success', text: `Created draft invoice ${body?.invoiceNumber || ''} — ${money(body?.total || 0)}. Send it from Billing when it's ready.` })
      await load(true)
    } catch (e) {
      setMessage({ type: 'error', text: `Invoice not created: ${errorMessage(e, 'Request failed')}` })
    } finally { setCreating(false) }
  }

  const openVisit = (v: Visit) => {
    const k = vkey(v)
    if (openKey === k) { setOpenKey(null); return }
    const saved = v.doc?.tasks || []
    const recorded = v.punch?.tasks || []
    // A task the caregiver recorded on this visit (done / refused / skipped) shows that status and cannot be changed
    // here. The rest: a new note starts ticked (done every visit), a saved note shows what was saved.
    const tasks: DocTask[] = (data?.tasks || []).map((t) => {
      const r = recorded.find((x) => x.taskId === t.id)
      if (r) return { taskId: t.id, taskName: t.taskName, done: r.status === 'completed', status: r.status, notes: r.notes, recordedBy: 'caregiver' }
      const s = saved.find((x) => x.taskId === t.id)
      return { taskId: t.id, taskName: t.taskName, done: v.doc ? !!s?.done : true }
    })
    for (const s of saved) if (!tasks.some((t) => t.taskId === s.taskId)) tasks.push(s)
    setDraft({ tasks, note: v.doc?.note || '' })
    setOpenKey(k)
  }

  const saveVisit = async (v: Visit) => {
    setSaving(true); setMessage(null)
    try {
      const doc: SavedDoc = await api.put(`/api/visit-docs/clients/${clientId}/visits`, {
        visitDate: v.visitDate, startTime: v.startTime, caregiverId: v.caregiverId, tasks: draft.tasks, note: draft.note,
      })
      setData((d) => d ? { ...d, visits: d.visits.map((x) => (vkey(x) === vkey(v) ? { ...x, doc } : x)) } : d)
      setOpenKey(null)
      setMessage({ type: 'success', text: `Saved note for ${fmtDate(v.visitDate)}.` })
    } catch (e) {
      setMessage({ type: 'error', text: `Save failed: ${errorMessage(e, 'Request failed')}` })
    } finally { setSaving(false) }
  }

  // Writes the same note to visits that have none. Tasks the caregiver recorded keep their status; the rest are ticked
  // done. Visits that already have a note are left alone.
  const bulkFill = async () => {
    setBulkBusy(true); setMessage(null)
    try {
      const body: { written: number; skipped: number } = await api.post(`/api/visit-docs/clients/${clientId}/visits/bulk`, { from, to, note: bulkNote, onlyMissing: true })
      setBulkOpen(false)
      setMessage({ type: 'success', text: `Filled ${body.written} visit${body.written === 1 ? '' : 's'}${body.skipped ? `, left ${body.skipped} that already had a note` : ''}. Edit any day that was different.` })
      await load(true)
    } catch (e) {
      setMessage({ type: 'error', text: `Bulk fill failed: ${errorMessage(e, 'Request failed')}` })
    } finally { setBulkBusy(false) }
  }

  // The care notes on their own, for the date range on screen.
  const downloadNotes = async () => {
    try {
      const blob = await downloadBlob(`/api/visit-docs/clients/${clientId}/notes.pdf?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`)
      saveBlob(blob, `care-notes-${data?.client?.name?.replace(/\s+/g, '-') || 'client'}-${from}-to-${to}.pdf`)
    } catch (e) { setMessage({ type: 'error', text: `Care notes PDF failed: ${errorMessage(e, 'Download failed')}` }) }
  }

  const documented = visits.filter((v) => v.doc).length
  const missing = visits.filter((v) => !v.doc).length
  const muted = { color: 'var(--hc-ink-soft)' }

  return (
    <div className="container">
      <div className="page-header">
        <h2>📝 Visit Documentation</h2>
      </div>
      <p style={{ ...muted, marginTop: 0, marginBottom: '1rem' }}>
        Enter the care note for each scheduled visit, then tick visits to put on an invoice. Print the notes for a date range for a payer, a chart or the client's file.
      </p>

      <div className="hc-card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div className="form-group" style={{ minWidth: 220, flex: '1 1 220px', marginBottom: 0 }}>
          <label>Client</label>
          <select value={clientId} onChange={(e) => { setClientId(e.target.value); setOpenKey(null) }}>
            <option value="">Select a client…</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{fullName(c)}</option>)}
          </select>
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>From</label>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
        </div>
        <div className="form-group" style={{ marginBottom: 0 }}>
          <label>To</label>
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {message && (
        <div role={message.type === 'error' ? 'alert' : 'status'} style={{ margin: '0.75rem 0', padding: '0.6rem 0.9rem', borderRadius: 6, whiteSpace: 'pre-wrap',
          background: message.type === 'error' ? 'var(--hc-danger-bg)' : 'var(--hc-success-bg)', color: message.type === 'error' ? 'var(--hc-danger-ink)' : 'var(--hc-success-ink)' }}>
          {message.text}
        </div>
      )}

      {!clientId && <div className="hc-card" style={muted}>Pick a client to see their scheduled visits.</div>}
      {clientId && loading && <div className="hc-card">Loading visits…</div>}

      {clientId && !loading && data && (
        <>
          <div className="hc-card" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <div><strong>{data.client.name}</strong>{data.client.payer ? ` · ${data.client.payer}` : ''}</div>
            <div>{plural(visits.length, 'visit')} · {documented} with notes</div>
            {may.delete && <button className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!missing}
              onClick={() => setBulkOpen(true)}
              title="Write one note to every visit that has no note yet; tasks the caregiver recorded keep their status">
              Fill notes for visits without one ({missing})
            </button>}
            <button className="hc-btn hc-btn-sm hc-btn-secondary" style={{ marginLeft: 'auto' }} onClick={downloadNotes}
              title="Print the care notes for this date range">
              📄 Print care notes ({from} – {to})
            </button>
          </div>

          {mayBill.create && <div className="hc-card" style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!billable.length}
              onClick={() => setSelected(new Set(billable.map(vkey)))}>Select all not invoiced ({billable.length})</button>
            <button className="hc-btn hc-btn-sm hc-btn-secondary" disabled={!selected.size} onClick={() => setSelected(new Set())}>Clear</button>
            <span style={muted}>
              {selected.size
                ? <>{selected.size} selected{pickedUndocumented ? <span style={{ color: CAREGIVER_STATUS_INK }}> · {pickedUndocumented} without a note</span> : null}</>
                : 'Tick visits to invoice'}
            </span>
            <button className="hc-btn hc-btn-primary" style={{ marginLeft: 'auto' }} disabled={!selected.size || creating} onClick={createInvoice}>
              {creating ? 'Creating…' : `Create invoice from ${selected.size || ''} selected`}
            </button>
          </div>}

          {bulkOpen && (
            <div className="hc-card" style={{ border: '1px solid var(--hc-info-line)', background: 'var(--hc-info-bg)', color: 'var(--hc-ink)' }}>
              <strong>Fill {plural(missing, 'visit')} without a note</strong>
              <p style={{ margin: '0.4rem 0', ...muted }}>
                This note is written to each of those visits. A task the caregiver recorded on the visit (done, refused or skipped) keeps what they recorded; the other care tasks are ticked done. Visits that already have a note are left alone. Edit any day that was different afterwards.
              </p>
              <textarea rows={3} className="w-full rounded-md border p-2 border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100" value={bulkNote} onChange={(e) => setBulkNote(e.target.value)} />
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                <button className="hc-btn hc-btn-primary hc-btn-sm" disabled={bulkBusy || !bulkNote.trim()} onClick={bulkFill}>
                  {bulkBusy ? 'Filling…' : `Fill ${plural(missing, 'visit')}`}
                </button>
                <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setBulkOpen(false)}>Cancel</button>
              </div>
            </div>
          )}

          <div className="hc-card" style={{ overflowX: 'auto', padding: 0 }}>
            <table className="hc-table" style={{ width: '100%', borderCollapse: 'collapse', minWidth: 640 }}>
              <thead>
                <tr style={{ textAlign: 'left' }}>
                  <th style={{ padding: '0.5rem', width: 32 }}><span className="sr-only">Invoice this visit</span></th>
                  <th style={{ padding: '0.5rem' }}>Date</th>
                  <th style={{ padding: '0.5rem' }}>Time</th>
                  <th style={{ padding: '0.5rem' }}>Caregiver</th>
                  <th style={{ padding: '0.5rem' }}>Note</th>
                  <th style={{ padding: '0.5rem' }}>Invoice</th>
                  <th style={{ padding: '0.5rem' }}></th>
                </tr>
              </thead>
              <tbody>
                {visits.length === 0 && (
                  <tr><td colSpan={7} style={{ padding: '1rem', ...muted }}>No scheduled visits in this date range.</td></tr>
                )}
                {visits.map((v) => {
                  const k = vkey(v)
                  const odd = Number(v.minutes) > 480 // an unusually long visit — check the schedule
                  return (
                    <Fragment key={k}>
                      <tr style={{ borderTop: '1px solid var(--hc-line)', ...(openKey === k ? OPEN_ROW : {}) }}>
                        <td style={{ padding: '0.5rem' }}>
                          <input type="checkbox" disabled={!mayBill.create || !!v.invoiced} checked={selected.has(k)} onChange={() => toggle(v)}
                            aria-label={v.invoiced ? `Already on invoice ${v.invoiced.invoiceNumber}` : `Invoice the visit on ${fmtDate(v.visitDate)}`}
                            title={v.invoiced ? `Already on invoice ${v.invoiced.invoiceNumber}` : 'Include on the next invoice'} />
                        </td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{weekday(v.visitDate)} {fmtDate(v.visitDate)}</td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>
                          {fmtTime(v.startTime)} – {fmtTime(v.endTime)}
                          {odd && <span title="Unusually long — check the schedule" style={{ color: 'var(--hc-red-ink)', marginLeft: 6 }}>⚠ {(Number(v.minutes) / 60).toFixed(1)} h</span>}
                        </td>
                        <td style={{ padding: '0.5rem' }}>{v.caregiverName}</td>
                        <td style={{ padding: '0.5rem', maxWidth: 280 }}>
                          {v.doc
                            ? <span style={{ color: 'var(--hc-success-ink)' }}>✓ {v.doc.note ? (v.doc.note.length > 60 ? `${v.doc.note.slice(0, 60)}…` : v.doc.note) : 'Tasks only'}</span>
                            : <span style={muted}>No note</span>}
                          {v.punch?.clockOutNote && (
                            <div style={{ ...muted, fontSize: '0.85rem' }} title={v.punch.clockOutNote}>
                              Clock-out note: {v.punch.clockOutNote.length > 60 ? `${v.punch.clockOutNote.slice(0, 60)}…` : v.punch.clockOutNote}
                            </div>
                          )}
                          {(v.punch?.tasks || []).filter((t) => t.status !== 'completed').map((t) => (
                            <div key={t.taskId} style={{ color: CAREGIVER_STATUS_INK, fontSize: '0.85rem' }}>
                              {STATUS_LABEL[t.status] || t.status}: {t.taskName}{t.notes ? ` — ${t.notes}` : ''}
                            </div>
                          ))}
                        </td>
                        <td style={{ padding: '0.5rem', whiteSpace: 'nowrap' }}>{v.invoiced ? v.invoiced.invoiceNumber : '—'}</td>
                        <td style={{ padding: '0.5rem' }}>
                          {may.delete && <button className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => openVisit(v)}>{openKey === k ? 'Close' : v.doc ? 'Edit note' : 'Add note'}</button>}
                        </td>
                      </tr>
                      {openKey === k && (
                        <tr style={OPEN_ROW}>
                          <td colSpan={7} style={{ padding: '0.5rem 0.5rem 1rem' }}>
                            {draft.tasks.length === 0 && <div style={{ ...muted, marginBottom: 6 }}>This client has no care tasks set.</div>}
                            {draft.tasks.map((t, i) => t.recordedBy === 'caregiver' ? (
                              <div key={t.taskId} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0' }}
                                title="Recorded by the caregiver on this visit — change it on the visit's checklist, not here">
                                <input type="checkbox" checked={t.done} disabled readOnly aria-label={`${t.taskName}: ${STATUS_LABEL[t.status || ''] || t.status}`} />
                                <span>{t.taskName}</span>
                                <span style={{ fontWeight: 700, color: t.status === 'completed' ? 'var(--hc-success-ink)' : CAREGIVER_STATUS_INK }}>
                                  {STATUS_LABEL[t.status || ''] || t.status} (caregiver){t.notes ? ` — ${t.notes}` : ''}
                                </span>
                              </div>
                            ) : (
                              <label key={t.taskId} style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0', cursor: 'pointer' }}>
                                <input type="checkbox" checked={t.done}
                                  onChange={(e) => setDraft((d) => ({ ...d, tasks: d.tasks.map((x, j) => (j === i ? { ...x, done: e.target.checked } : x)) }))} />
                                {t.taskName}
                              </label>
                            ))}
                            <textarea rows={3} placeholder="What happened on this visit…"
                              className="mt-1.5 w-full rounded-md border p-2 border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100"
                              value={draft.note} onChange={(e) => setDraft((d) => ({ ...d, note: e.target.value }))} />
                            <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                              <button className="hc-btn hc-btn-primary hc-btn-sm" disabled={saving} onClick={() => saveVisit(v)}>{saving ? 'Saving…' : 'Save note'}</button>
                              <button className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setOpenKey(null)}>Cancel</button>
                              {v.doc?.updatedAt && <span style={{ ...muted, alignSelf: 'center', fontSize: '0.85rem' }}>
                                Saved by {v.doc.enteredByName || 'office'}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="hc-card">
            <h3 style={{ marginTop: 0 }}>Invoices in this date range</h3>
            {data.invoices.length === 0 ? <div style={muted}>None yet.</div> : (
              <div style={{ overflowX: 'auto' }}>
                <table className="hc-table" style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left' }}><th>Invoice</th><th>Period</th><th>Total</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.invoices.map((inv) => (
                      <tr key={inv.id} style={{ borderTop: '1px solid var(--hc-line)' }}>
                        <td style={{ padding: '0.4rem 0' }}>{inv.invoiceNumber}</td>
                        <td>{fmtDate(inv.start)} – {fmtDate(inv.end)}</td>
                        <td>{money(inv.total)}</td>
                        <td>{inv.paymentStatus}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          <div className="hc-card">
            <h3 style={{ marginTop: 0 }}>📷 Visit photos</h3>
            <VisitPhotoGallery clientId={clientId} />
          </div>
        </>
      )}
    </div>
  )
}

export default VisitDocumentation
