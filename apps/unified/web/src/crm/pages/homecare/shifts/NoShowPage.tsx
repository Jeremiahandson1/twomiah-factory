// Moved from templates/crm-homecare/frontend/src/pages/NoShowPage.tsx.
/**
 * No-Show Tracking Page — Care Agency tier
 * Track caregiver no-shows and client cancellations to spot patterns.
 *
 * SERVER MISMATCH (reported, not worked around): this page calls GET /api/no-show and POST /api/no-show, and neither
 * the unified server (server/crm/homecare/scheduling/noShow.ts) nor the template's backend (routes/noShow.ts) has a
 * route at the router's root — only /alerts, /stats, /config and /run-check. The template swallowed the refusal and
 * showed "No incidents logged."; here the refusal is shown.
 */
import { useState, useEffect, type FormEvent } from 'react'
import { AlertTriangle, Plus, Loader2 } from 'lucide-react'
import { formatDate } from '../lib/date'
import { api, rows, errorMessage } from '../lib/http'
import { useToast } from '../../../../shared'
import { SOLID } from './ui'

// Each reason as an ink on its own ground, light and dark.
const REASON_COLORS: Record<string, string> = {
  caregiver_no_show: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  caregiver_late: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  client_cancel: 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300',
  emergency: 'bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300',
}
const REASON_OTHER = 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'

interface Incident {
  id: string
  reportedAt: string | null
  caregiverId: string | null
  clientId: string | null
  reason: string | null
  notes: string | null
}

const inputCls = 'border rounded-lg px-3 py-2 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600'
const emptyForm = { scheduleId: '', caregiverId: '', clientId: '', reason: 'caregiver_no_show', notes: '', reportedAt: '' }

export default function NoShowPage() {
  const toast = useToast()
  const [incidents, setIncidents] = useState<Incident[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState(emptyForm)

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setIncidents(rows<Incident>(await api.get('/api/no-show')))
      setLoadError('')
    } catch (e) { setLoadError(errorMessage(e, 'Could not load incidents')) } finally { setLoading(false) }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/no-show', form)
      setShowCreate(false)
      setForm(emptyForm)
      load()
    } catch (err) { toast.error(errorMessage(err, 'Could not log the incident')) }
  }

  // Compute simple stats
  const byReason = incidents.reduce<Record<string, number>>((acc, i) => { const k = i.reason || ''; acc[k] = (acc[k] || 0) + 1; return acc }, {})

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="w-8 h-8 animate-spin text-teal-600 dark:text-teal-400" /></div>

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><AlertTriangle className="w-6 h-6 text-orange-500" />No-Show Tracking</h1><p className="text-sm text-gray-600 mt-1 dark:text-slate-400">Track missed visits to spot patterns and protect revenue</p></div>
        <button onClick={() => setShowCreate(true)} className="text-white px-4 py-2 rounded-lg flex items-center gap-2" style={{ background: SOLID.brand }}><Plus className="w-4 h-4" />Log Incident</button>
      </div>

      {loadError && (
        <div role="alert" className="mb-4 rounded-lg border px-4 py-3 text-sm font-semibold" style={{ background: 'var(--hc-danger-bg)', color: 'var(--hc-danger-ink)', borderColor: 'var(--hc-danger-line)' }}>
          Could not load incidents: {loadError}
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {Object.keys(REASON_COLORS).map((reason) => (
          <div key={reason} className="bg-white rounded-lg border p-4 dark:bg-slate-900 dark:border-slate-700">
            <div className="text-xs text-gray-600 uppercase dark:text-slate-400">{reason.replace(/_/g, ' ')}</div>
            <div className="text-2xl font-bold mt-1">{byReason[reason] || 0}</div>
          </div>
        ))}
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-800 dark:border-slate-700"><tr className="text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300"><th className="px-4 py-3">Date</th><th className="px-4 py-3">Caregiver</th><th className="px-4 py-3">Client</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Notes</th></tr></thead>
          <tbody>
            {incidents.length === 0 ? <tr><td colSpan={5} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No incidents logged.</td></tr> :
              incidents.map((i) => (
                <tr key={i.id} className="border-b dark:border-slate-800">
                  <td className="px-4 py-3 text-sm">{i.reportedAt ? formatDate(i.reportedAt) : '—'}</td>
                  <td className="px-4 py-3 font-mono text-xs">{(i.caregiverId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3 font-mono text-xs">{(i.clientId || '').substring(0, 8)}…</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${REASON_COLORS[i.reason || ''] || REASON_OTHER}`}>{(i.reason || '').replace(/_/g, ' ')}</span></td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate dark:text-slate-400">{i.notes || '—'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[2000]">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 dark:bg-slate-900">
            <h2 className="text-xl font-bold mb-4">Log No-Show Incident</h2>
            <form onSubmit={create} className="space-y-3">
              <input placeholder="Schedule ID (optional)" value={form.scheduleId} onChange={(e) => setForm({ ...form, scheduleId: e.target.value })} className={`w-full ${inputCls}`} />
              <div className="grid grid-cols-2 gap-3">
                <input placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className={inputCls} />
                <input placeholder="Client ID" value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} className={inputCls} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <input type="datetime-local" value={form.reportedAt} onChange={(e) => setForm({ ...form, reportedAt: e.target.value })} className={inputCls} />
                <select value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls}>
                  <option value="caregiver_no_show">Caregiver no-show</option>
                  <option value="caregiver_late">Caregiver late</option>
                  <option value="client_cancel">Client cancelled</option>
                  <option value="emergency">Emergency</option>
                </select>
              </div>
              <textarea placeholder="Notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={`w-full ${inputCls}`} />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg dark:border-slate-600">Cancel</button><button type="submit" className="px-4 py-2 text-white rounded-lg" style={{ background: SOLID.brand }}>Log Incident</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
