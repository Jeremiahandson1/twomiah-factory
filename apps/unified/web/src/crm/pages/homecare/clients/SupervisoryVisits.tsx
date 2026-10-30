// Supervisory visits (item 11, care_supervisory_visits): a check-in on each client's care every 60 or 90 days. The agency
// picks the rule here; the list shows who is overdue, who is due soon and who is fine, and "Record a visit" is the form.
//   GET /api/supervisory-visits → { ruleDays, today, clients: [{ clientId, firstName, lastName, intervalDays, ownInterval,
//        lastVisit, dueDate, status: 'overdue'|'due_soon'|'ok', daysOverdue, daysUntilDue }] }
//   PUT /api/supervisory-visits/rule { days }              PUT /api/supervisory-visits/client/:id/interval { days|null }
//   GET|POST /api/supervisory-visits/client/:id            (server/crm/homecare/clients/supervisoryVisits.ts)
import { useCallback, useEffect, useState } from 'react'
import { usePrompt, useToast } from '../../../../shared'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { formatAgencyDate } from '../lib/agencyClock'
import { useMay } from '../lib/useMay'

interface Row {
  clientId: string; firstName: string; lastName: string; intervalDays: number; ownInterval: boolean
  lastVisit: string | null; dueDate: string; status: 'overdue' | 'due_soon' | 'ok'; daysOverdue: number; daysUntilDue: number
}
interface Reply { ruleDays: number; today: string; clients: Row[] }
interface Visit {
  id: string; visitDate: string; visitType: string; clientFeedback: string | null; carePlanFollowed: boolean | null
  caregiverFeedback: string | null; concerns: string | null; followUpNotes: string | null; supervisorName?: string; caregiverName?: string
}
interface Person { id: string; firstName: string | null; lastName: string | null }

const BADGE: Record<Row['status'], { label: string; cls: string }> = {
  overdue: { label: 'Overdue', cls: 'bg-red-100 text-red-900 dark:bg-red-950 dark:text-red-200' },
  due_soon: { label: 'Due soon', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200' },
  ok: { label: 'On track', cls: 'bg-emerald-100 text-emerald-900 dark:bg-emerald-950 dark:text-emerald-200' },
}
const inp = 'w-full rounded-md border px-2 py-1.5 text-sm border-gray-300 bg-white text-gray-900 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100'
const blank = { visitDate: '', visitType: 'home', caregiverId: '', clientFeedback: '', carePlanFollowed: '', caregiverFeedback: '', concerns: '', followUpNotes: '' }

export default function SupervisoryVisits() {
  const may = useMay('care-clients')
  const toast = useToast()
  const prompt = usePrompt()
  const [data, setData] = useState<Reply | null>(null)
  const [loading, setLoading] = useState(true)
  const [caregivers, setCaregivers] = useState<Person[]>([])
  const [recording, setRecording] = useState<Row | null>(null)
  const [form, setForm] = useState(blank)
  const [saving, setSaving] = useState(false)
  const [history, setHistory] = useState<{ row: Row; visits: Visit[] } | null>(null)

  const load = useCallback(async () => {
    try { setData(await api.get('/api/supervisory-visits') as Reply) }
    catch (e) { toast.error(errorMessage(e, 'Could not load supervisory visits')) }
    finally { setLoading(false) }
  }, [toast])
  useEffect(() => { load() }, [load])
  useEffect(() => { listAll('/api/caregivers').then((r) => setCaregivers(rows<Person>(r))).catch(() => { /* the form works without the list */ }) }, [])

  const setRule = async (days: number) => {
    try { await api.put('/api/supervisory-visits/rule', { days }); toast.success(`Supervisory visits are every ${days} days`); load() }
    catch (e) { toast.error(errorMessage(e)) }
  }
  const setInterval_ = async (r: Row) => {
    const answer = await prompt(`Days between supervisory visits for ${r.firstName} ${r.lastName}. Leave blank for the agency's ${data?.ruleDays} days, or 0 if none are needed.`, { title: 'Change days', confirmText: 'Save' })
    if (answer === null || answer === undefined) return
    try {
      await api.put(`/api/supervisory-visits/client/${r.clientId}/interval`, { days: answer.trim() === '' ? null : Number(answer) })
      load()
    } catch (e) { toast.error(errorMessage(e)) }
  }
  const save = async () => {
    if (!recording) return
    setSaving(true)
    try {
      await api.post(`/api/supervisory-visits/client/${recording.clientId}`, {
        ...form, visitDate: form.visitDate || undefined, caregiverId: form.caregiverId || undefined,
        carePlanFollowed: form.carePlanFollowed === '' ? undefined : form.carePlanFollowed === 'yes',
      })
      toast.success('Visit recorded')
      setRecording(null); setForm(blank); load()
    } catch (e) { toast.error(errorMessage(e)) }
    finally { setSaving(false) }
  }
  const openHistory = async (r: Row) => {
    try { setHistory({ row: r, visits: rows<Visit>(await api.get(`/api/supervisory-visits/client/${r.clientId}`)) }) }
    catch (e) { toast.error(errorMessage(e)) }
  }

  if (loading) return <div className="p-4 text-sm text-gray-600 dark:text-slate-400">Loading…</div>
  const list = data?.clients ?? []
  const count = (s: Row['status']) => list.filter((r) => r.status === s).length

  return (
    <div className="p-4 max-w-5xl mx-auto text-gray-900 dark:text-slate-100">
      <h1 className="text-xl font-bold mb-1">Supervisory visits</h1>
      <p className="text-sm mb-3 text-gray-600 dark:text-slate-400">A check-in on each client&apos;s care, on a regular schedule. The next one is due this many days after the last.</p>

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <label className="text-sm font-semibold" htmlFor="sv-rule">Our rule</label>
        <select id="sv-rule" className={`${inp} !w-auto`} value={data?.ruleDays ?? 90} disabled={!may.update} onChange={(e) => setRule(Number(e.target.value))}>
          <option value={60}>Every 60 days</option><option value={90}>Every 90 days</option>
        </select>
        <span className="text-sm"><b>{count('overdue')}</b> overdue · <b>{count('due_soon')}</b> due within 14 days · <b>{count('ok')}</b> on track</span>
      </div>

      {list.length === 0 ? (
        <div className="rounded-lg p-6 text-center text-sm bg-gray-50 text-gray-600 dark:bg-slate-800 dark:text-slate-400">No clients need supervisory visits.</div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="w-full text-sm">
            <thead><tr className="text-left bg-gray-50 dark:bg-slate-800"><th className="px-3 py-2">Client</th><th>Last visit</th><th>Next due</th><th>Every</th><th>Status</th><th /></tr></thead>
            <tbody>
              {list.map((r) => (
                <tr key={r.clientId} className="border-t border-gray-100 dark:border-slate-700">
                  <td className="px-3 py-2 font-semibold">{r.firstName} {r.lastName}</td>
                  <td>{r.lastVisit ? formatAgencyDate(r.lastVisit) : 'None yet'}</td>
                  <td>{formatAgencyDate(r.dueDate)}</td>
                  <td>{r.intervalDays} days{r.ownInterval ? ' (theirs)' : ''}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${BADGE[r.status].cls}`}>{BADGE[r.status].label}</span>
                    <span className="ml-2 text-xs text-gray-600 dark:text-slate-400">{r.status === 'overdue' ? `${r.daysOverdue} days late` : `in ${r.daysUntilDue} days`}</span>
                  </td>
                  <td className="py-1 pr-2 text-right whitespace-nowrap">
                    {may.create && <button type="button" className="hc-btn hc-btn-sm hc-btn-primary mr-1" onClick={() => { setRecording(r); setForm(blank) }}>Record a visit</button>}
                    <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary mr-1" onClick={() => openHistory(r)}>History</button>
                    {may.update && <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => setInterval_(r)}>Change days</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {recording && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setRecording(null) }}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl p-5 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
            <h2 className="m-0 mb-3 text-lg font-semibold">Supervisory visit: {recording.firstName} {recording.lastName}</h2>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <label className="text-sm">Date<input type="date" className={inp} value={form.visitDate} onChange={(e) => setForm({ ...form, visitDate: e.target.value })} /><span className="text-xs text-gray-600 dark:text-slate-400">Blank = today</span></label>
              <label className="text-sm">How<select className={inp} value={form.visitType} onChange={(e) => setForm({ ...form, visitType: e.target.value })}><option value="home">In the home</option><option value="phone">By phone</option></select></label>
            </div>
            <label className="block text-sm mb-2">Caregiver this visit looked at (optional)
              <select className={inp} value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })}>
                <option value="">— none —</option>{caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
              </select>
            </label>
            <label className="block text-sm mb-2">What did the client say?<textarea className={inp} rows={2} value={form.clientFeedback} onChange={(e) => setForm({ ...form, clientFeedback: e.target.value })} /></label>
            <label className="block text-sm mb-2">Is the care plan being followed?
              <select className={inp} value={form.carePlanFollowed} onChange={(e) => setForm({ ...form, carePlanFollowed: e.target.value })}><option value="">Not sure / not checked</option><option value="yes">Yes</option><option value="no">No</option></select>
            </label>
            <label className="block text-sm mb-2">How is the caregiver doing?<textarea className={inp} rows={2} value={form.caregiverFeedback} onChange={(e) => setForm({ ...form, caregiverFeedback: e.target.value })} /></label>
            <label className="block text-sm mb-2">Any concerns?<textarea className={inp} rows={2} value={form.concerns} onChange={(e) => setForm({ ...form, concerns: e.target.value })} /></label>
            <label className="block text-sm mb-3">What needs to happen next?<textarea className={inp} rows={2} value={form.followUpNotes} onChange={(e) => setForm({ ...form, followUpNotes: e.target.value })} /></label>
            <div className="flex justify-end gap-2">
              <button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setRecording(null)}>Cancel</button>
              <button type="button" className="hc-btn hc-btn-primary hc-btn-sm" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save visit'}</button>
            </div>
          </div>
        </div>
      )}

      {history && (
        <div className="fixed inset-0 z-[2400] flex items-center justify-center p-4 bg-black/50" onClick={(e) => { if (e.target === e.currentTarget) setHistory(null) }}>
          <div className="w-full max-w-lg max-h-[90vh] overflow-auto rounded-xl p-5 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100">
            <h2 className="m-0 mb-3 text-lg font-semibold">Past visits: {history.row.firstName} {history.row.lastName}</h2>
            {history.visits.length === 0 ? <p className="text-sm text-gray-600 dark:text-slate-400">None recorded yet.</p> : history.visits.map((v) => (
              <div key={v.id} className="mb-3 rounded-lg border p-3 text-sm border-gray-200 dark:border-slate-700">
                <div className="font-semibold">{formatAgencyDate(v.visitDate)} · {v.visitType === 'phone' ? 'By phone' : 'In the home'}{v.supervisorName ? ` · ${v.supervisorName}` : ''}</div>
                {v.caregiverName && <div>Caregiver: {v.caregiverName}</div>}
                {v.clientFeedback && <div>Client said: {v.clientFeedback}</div>}
                {v.carePlanFollowed !== null && <div>Care plan followed: {v.carePlanFollowed ? 'Yes' : 'No'}</div>}
                {v.caregiverFeedback && <div>Caregiver: {v.caregiverFeedback}</div>}
                {v.concerns && <div>Concerns: {v.concerns}</div>}
                {v.followUpNotes && <div>Next: {v.followUpNotes}</div>}
              </div>
            ))}
            <div className="flex justify-end"><button type="button" className="hc-btn hc-btn-secondary hc-btn-sm" onClick={() => setHistory(null)}>Close</button></div>
          </div>
        </div>
      )}
    </div>
  )
}
