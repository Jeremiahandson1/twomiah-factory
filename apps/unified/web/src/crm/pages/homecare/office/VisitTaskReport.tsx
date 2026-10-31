// Was every task done on every visit? (care_required_tasks) — and the client-signature rule (care_visit_signature).
//   GET /api/evv-task-report?from=&to=&clientId=&caregiverId=&onlyGaps=true[&format=csv]   (server/crm/homecare/visits/taskReport.ts)
//   GET|PUT /api/visit-signature/settings                                                  (server/crm/homecare/visits/visitSignature.ts)
// Each finished visit shows its assigned tasks (a Tuesday task only on a Tuesday visit) as done, skipped with a reason, or not
// recorded, and whether the client signed. The same list downloads as a spreadsheet file.
import { useCallback, useEffect, useState } from 'react'
import { useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll, downloadFile, saveBlob } from '../lib/http'
import { formatDate, formatTime } from '../lib/datetime'
import { agencyToday } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface Person { id: string; firstName: string; lastName: string }
interface Task { taskId: string; taskName: string; required: boolean; state: string; stateLabel: string; reason: string | null }
interface Visit {
  timeEntryId: string; visitDate: string; startTime: string; endTime: string | null; clientName: string; caregiverName: string
  tasks: Task[]; assigned: number; accounted: number; missing: number; complete: boolean; signature: 'signed' | 'reason' | 'none'; signatureReason: string | null
}
interface Report { from: string; to: string; visits: Visit[]; truncated: boolean; summary: { visits: number; visitsComplete: number; visitsWithGaps: number; tasksAssigned: number; tasksAccountedFor: number; tasksNotRecorded: number } }

const inp = 'rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const monthStart = () => agencyToday().slice(0, 8) + '01'

export default function VisitTaskReport() {
  const may = useMay('care-clients')
  const toast = useToast()
  const [from, setFrom] = useState(monthStart())
  const [to, setTo] = useState(agencyToday())
  const [clientId, setClientId] = useState('')
  const [onlyGaps, setOnlyGaps] = useState(false)
  const [clients, setClients] = useState<Person[]>([])
  const [report, setReport] = useState<Report | null>(null)
  const [busy, setBusy] = useState(false)
  const [reportOff, setReportOff] = useState(false)
  const [sigRequired, setSigRequired] = useState<boolean | null>(null) // null = the signature feature is off for this agency

  const query = () => new URLSearchParams({ from, to, ...(clientId ? { clientId } : {}), ...(onlyGaps ? { onlyGaps: 'true' } : {}) }).toString()

  useEffect(() => {
    listAll('/api/clients').then((r) => setClients(rows<Person>(r))).catch(() => setClients([]))
    api.get('/api/visit-signature/settings').then((r: any) => setSigRequired(r?.required === true)).catch(() => setSigRequired(null))
  }, [])

  const run = useCallback(async () => {
    setBusy(true)
    try { setReport((await api.get(`/api/evv-task-report?${query()}`)) as Report); setReportOff(false) } catch (e) {
      setReport(null)
      // A refused answer means this agency has the signature rule but not the task report: say so quietly instead of an error.
      if ((e as { status?: number }).status === 403) setReportOff(true); else toast.error(errorMessage(e, 'Could not build the report'))
    } finally { setBusy(false) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, clientId, onlyGaps])
  useEffect(() => { run() }, [run])

  const download = async () => {
    try { const f = await downloadFile(`/api/evv-task-report?${query()}&format=csv`); saveBlob(f.blob, f.fileName || `visit-tasks-${from}-to-${to}.csv`) } catch (e) { toast.error(errorMessage(e, 'Download failed')) }
  }
  const saveRule = async (on: boolean) => {
    try { setSigRequired(((await api.put('/api/visit-signature/settings', { required: on })) as any).required === true); toast.success('Saved') } catch (e) { toast.error(errorMessage(e)) }
  }

  const s = report?.summary
  const sigText = (v: Visit) => (v.signature === 'signed' ? 'Signed' : v.signature === 'reason' ? `Not signed — ${v.signatureReason}` : 'No signature')

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Visit tasks and client signatures</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">For every finished visit: was each task assigned to it done, or skipped with a reason? A task set for certain days or for AM / PM counts only on the visits it belongs to.</p>

      {sigRequired !== null && (
        <label className="text-sm flex items-center gap-2 mb-4">
          <input type="checkbox" checked={sigRequired} disabled={!may.update} onChange={(e) => saveRule(e.target.checked)} />
          The client must sign (or the caregiver must say why they could not) before the caregiver can clock out
        </label>
      )}

      <div className="flex flex-wrap items-end gap-3 mb-3">
        <label className="text-sm">From<br /><input type="date" className={inp} value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="text-sm">To<br /><input type="date" className={inp} value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="text-sm">Client<br />
          <select className={inp} value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client">
            <option value="">All clients</option>
            {clients.map((c) => <option key={c.id} value={c.id}>{c.lastName}, {c.firstName}</option>)}
          </select>
        </label>
        <label className="text-sm flex items-center gap-2 pb-2"><input type="checkbox" checked={onlyGaps} onChange={(e) => setOnlyGaps(e.target.checked)} /> Only visits with a gap</label>
        <button type="button" className="hc-btn hc-btn-secondary" onClick={download} disabled={busy}>Download as a spreadsheet</button>
      </div>

      {s && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4" aria-label="Summary">
          {[['Visits', s.visits], ['Every task accounted for', s.visitsComplete], ['Visits with a gap', s.visitsWithGaps], ['Tasks not recorded', s.tasksNotRecorded]].map(([label, n]) => (
            <div key={String(label)} className="rounded-md border border-gray-200 dark:border-slate-700 p-3"><div className="text-2xl font-bold">{n}</div><div className="text-xs text-gray-600 dark:text-slate-400">{label}</div></div>
          ))}
        </div>
      )}
      {report?.truncated && <p className="text-sm mb-2" role="status">Only the first 2000 visits are shown. Pick a shorter period or one client.</p>}
      {reportOff && <p className="text-sm text-gray-600 dark:text-slate-400">The visit task report is not switched on for this agency.</p>}
      {busy && <p className="text-sm">Loading…</p>}
      {report && !busy && report.visits.length === 0 && <p className="text-sm text-gray-600 dark:text-slate-400">No finished visits in this period{onlyGaps ? ' with a gap' : ''}.</p>}

      <ul className="space-y-3">
        {(report?.visits || []).map((v) => (
          <li key={v.timeEntryId} className="rounded-md border border-gray-200 dark:border-slate-700 p-3">
            <div className="flex flex-wrap items-center gap-2">
              <div className="font-medium flex-1 min-w-[14rem]">{formatDate(v.visitDate, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} · {formatTime(v.startTime)}–{formatTime(v.endTime)} · {v.clientName}</div>
              <div className="text-xs text-gray-600 dark:text-slate-400">{v.caregiverName} · {sigText(v)}</div>
              <span className={`text-xs font-semibold rounded px-2 py-0.5 ${v.complete ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>
                {v.assigned === 0 ? 'No tasks assigned' : v.complete ? 'Every task accounted for' : `${v.missing} of ${v.assigned} not recorded`}
              </span>
            </div>
            {v.tasks.length > 0 && (
              <ul className="mt-2 text-sm divide-y divide-gray-100 dark:divide-slate-800">
                {v.tasks.map((t) => (
                  <li key={t.taskId} className="py-1 flex flex-wrap gap-2">
                    <span className="flex-1 min-w-[10rem]">{t.taskName}{t.required ? ' (required)' : ''}</span>
                    <span className={t.state === 'not_recorded' ? 'font-semibold text-amber-800 dark:text-amber-300' : ''}>{t.stateLabel}</span>
                    {t.reason && <span className="text-gray-600 dark:text-slate-400 w-full">“{t.reason}”</span>}
                  </li>
                ))}
              </ul>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
