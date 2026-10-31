// Moved from templates/crm-homecare/frontend/src/pages/PtoPage.tsx.
/**
 * PTO Management Page — Care Agency tier
 * Caregiver time-off requests. Uses the /api/pto route, which backs the caregiver_time_off table.
 *
 * Its calls, as the unified server answers them (server/crm/homecare/payroll/pto.ts):
 *   GET  /api/pto               → list reply (rows camelCase, now with caregiverName); care-payroll:read for the office.
 *   POST /api/pto               { caregiverId, type, startDate, endDate, reason } → the new row; care-payroll:create.
 *   POST /api/pto/:id/approve | /deny → the row; care-payroll:update.
 *   GET  /api/caregivers        → list reply, for the caregiver picker (care-hr:read or care-schedule:read).
 * The template read the token from localStorage and ignored every refusal; here the session is the app's and a refusal
 * is shown.
 */
import { useState, useEffect, type FormEvent } from 'react'
import { CalendarDays, Plus, Check, X } from 'lucide-react'
import { formatDate } from '../lib/date'
import { api, rows, errorMessage, listAll } from '../lib/http'
import { useMayWrite, useToast, PageLoading } from '../../../../shared'

// Each status as an ink on its own ground, light and dark.
const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-200',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  denied: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
}
const STATUS_OTHER = 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-300'

const TYPE_LABELS: Record<string, string> = {
  pto: 'PTO',
  vacation: 'Vacation',
  sick: 'Sick Leave',
}

type PtoType = 'pto' | 'vacation' | 'sick'

interface PtoRequest {
  id: string
  caregiverId: string | null
  caregiverName: string | null
  type: string
  startDate: string | null
  endDate: string | null
  reason: string | null
  status: string | null
}

interface CaregiverOption { id: string; firstName: string | null; lastName: string | null }

const inputCls = 'w-full border rounded-lg px-3 py-2 bg-white text-gray-900 dark:bg-slate-800 dark:text-slate-100 dark:border-slate-600'

export default function PtoPage() {
  const toast = useToast()
  // POST /api/pto asks care-payroll:create OR my-pay:create (payroll/shared.ts payrollOrCaregiver).
  const mayRequestOffice = useMayWrite('care-payroll:create')
  const mayRequestOwn = useMayWrite('my-pay:create')
  const mayRequest = mayRequestOffice || mayRequestOwn
  const mayAnswer = useMayWrite('care-payroll:update')
  const [requests, setRequests] = useState<PtoRequest[]>([])
  const [caregivers, setCaregivers] = useState<CaregiverOption[]>([])
  const [loading, setLoading] = useState(true)
  const [showCreate, setShowCreate] = useState(false)
  const [form, setForm] = useState({ caregiverId: '', type: 'pto' as PtoType, startDate: '', endDate: '', reason: '' })

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [])

  const load = async () => {
    try {
      setRequests(rows<PtoRequest>(await api.get('/api/pto')))
    } catch (e) { toast.error(errorMessage(e, 'Could not load time-off requests')) } finally { setLoading(false) }
  }

  // The caregivers for the request form's picker; with none to offer (or no access to the list) the form asks for the ID,
  // as the template's always did.
  const openCreate = async () => {
    setShowCreate(true)
    if (caregivers.length) return
    try { setCaregivers(rows<CaregiverOption>(await listAll('/api/caregivers'))) } catch { /* the ID box stands in */ }
  }

  const create = async (e: FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/pto', form)
      setShowCreate(false)
      setForm({ caregiverId: '', type: 'pto', startDate: '', endDate: '', reason: '' })
      load()
    } catch (err) { toast.error(errorMessage(err, 'Could not save the request')) }
  }

  const act = async (id: string, action: 'approve' | 'deny') => {
    try {
      await api.post(`/api/pto/${encodeURIComponent(id)}/${action}`)
    } catch (e) { toast.error(errorMessage(e, 'Could not update the request')) }
    load()
  }

  if (loading) return <PageLoading what="time-off requests" />

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div><h1 className="text-2xl font-bold flex items-center gap-2"><CalendarDays className="w-6 h-6 text-teal-600 dark:text-teal-400" />PTO & Time Off</h1><p className="text-sm text-gray-600 mt-1 dark:text-slate-400">Caregiver time-off requests — PTO, vacation, sick leave</p></div>
        {mayRequest && <button onClick={openCreate} className="bg-teal-700 hover:bg-teal-800 text-white px-4 py-2 rounded-lg flex items-center gap-2"><Plus className="w-4 h-4" />Request Time Off</button>}
      </div>

      <div className="bg-white rounded-lg border overflow-x-auto dark:bg-slate-900 dark:border-slate-700">
        <table className="w-full">
          <thead className="bg-gray-50 border-b dark:bg-slate-800 dark:border-slate-700"><tr className="text-left text-xs font-semibold text-gray-600 uppercase dark:text-slate-300"><th className="px-4 py-3">Caregiver</th><th className="px-4 py-3">Type</th><th className="px-4 py-3">Start</th><th className="px-4 py-3">End</th><th className="px-4 py-3">Reason</th><th className="px-4 py-3">Status</th><th className="px-4 py-3">Actions</th></tr></thead>
          <tbody>
            {requests.length === 0 ? <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500 dark:text-slate-400">No time off requests yet.</td></tr> :
              requests.map((r) => (
                <tr key={r.id} className="border-b dark:border-slate-800">
                  <td className="px-4 py-3 text-sm">{r.caregiverName || <span className="font-mono text-xs">{(r.caregiverId || '').substring(0, 8)}…</span>}</td>
                  <td className="px-4 py-3 text-sm">{TYPE_LABELS[r.type] || r.type}</td>
                  <td className="px-4 py-3 text-sm">{r.startDate ? formatDate(r.startDate) : '—'}</td>
                  <td className="px-4 py-3 text-sm">{r.endDate ? formatDate(r.endDate) : '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600 max-w-xs truncate dark:text-slate-400">{r.reason || '—'}</td>
                  <td className="px-4 py-3"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[r.status || ''] || STATUS_OTHER}`}>{r.status || 'pending'}</span></td>
                  <td className="px-4 py-3">
                    {mayAnswer && r.status === 'pending' && (
                      <div className="flex gap-1">
                        <button onClick={() => act(r.id, 'approve')} className="text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/30 p-1 rounded" title="Approve"><Check className="w-4 h-4" /></button>
                        <button onClick={() => act(r.id, 'deny')} className="text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30 p-1 rounded" title="Deny"><X className="w-4 h-4" /></button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-[2000]">
          <div className="bg-white rounded-xl w-full max-w-lg p-6 dark:bg-slate-900">
            <h2 className="text-xl font-bold mb-4">Request Time Off</h2>
            <form onSubmit={create} className="space-y-3">
              {caregivers.length > 0 ? (
                <select required aria-label="Caregiver" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className={inputCls}>
                  <option value="">— Select caregiver —</option>
                  {caregivers.map((c) => <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>)}
                </select>
              ) : (
                <input required placeholder="Caregiver ID" value={form.caregiverId} onChange={(e) => setForm({ ...form, caregiverId: e.target.value })} className={inputCls} />
              )}
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value as PtoType })} className={inputCls}>
                <option value="pto">PTO</option><option value="vacation">Vacation</option><option value="sick">Sick Leave</option>
              </select>
              <div className="grid grid-cols-2 gap-3">
                <div><label className="text-xs text-gray-600 dark:text-slate-400">Start date</label><input required type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} className={inputCls} /></div>
                <div><label className="text-xs text-gray-600 dark:text-slate-400">End date</label><input required type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} className={inputCls} /></div>
              </div>
              <textarea placeholder="Reason (optional)" value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} rows={3} className={inputCls} />
              <div className="flex justify-end gap-2"><button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 border rounded-lg dark:border-slate-600">Cancel</button><button type="submit" className="px-4 py-2 bg-teal-700 hover:bg-teal-800 text-white rounded-lg">Submit</button></div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
