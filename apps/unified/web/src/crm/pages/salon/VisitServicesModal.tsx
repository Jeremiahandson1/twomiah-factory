// Change a booked visit's services (salon parity row 8; Fresha, Square; visit_editing, not ready): add, remove, re-time and re-assign
// a service; each its own start (so two can run at the same time), and the stylist the client asked for (the heart). The server checks
// it exactly as it checks a new visit (PUT /api/appointments/:id/services) and says in words what clashes.
import { useEffect, useState } from 'react'
import { X, Heart } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite } from '../../../shared'
import { fetchStaff, staffName, type StaffMember } from './staff'

export type Row = { serviceId: string; stylistId: string; startOffsetMin: number; durationMin: number; requestedStylist: boolean }
type Option = { id: string; name?: string; durationMin?: number }

/** The rows as the server takes them. A blank stylist is the visit's. */
export const itemsBody = (rows: Row[]) => rows.filter((r) => r.serviceId).map((r) => ({
  serviceId: r.serviceId, ...(r.stylistId ? { stylistId: r.stylistId } : {}), startOffsetMin: r.startOffsetMin, durationMin: r.durationMin, requestedStylist: r.requestedStylist,
}))

export function VisitServicesModal({ appt, onSave, onClose }: { appt: { id: string; items?: Array<{ serviceId?: string | null; stylistId?: string | null; startOffsetMin: number; durationMin: number; requestedStylist?: boolean }>; serviceId?: string | null; stylistId?: string | null; startTime: string; endTime?: string | null }; onSave: () => void; onClose: () => void }) {
  const toast = useToast()
  const mayMove = useMayWrite('schedule:update')
  const [services, setServices] = useState<Option[]>([])
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [saving, setSaving] = useState(false)
  const first: Row[] = appt.items && appt.items.length
    ? appt.items.map((i) => ({ serviceId: String(i.serviceId || ''), stylistId: String(i.stylistId || ''), startOffsetMin: i.startOffsetMin, durationMin: i.durationMin, requestedStylist: !!i.requestedStylist }))
    : [{ serviceId: String(appt.serviceId || ''), stylistId: String(appt.stylistId || ''), startOffsetMin: 0, durationMin: Math.max(15, Math.round((new Date(appt.endTime || appt.startTime).getTime() - new Date(appt.startTime).getTime()) / 60000)), requestedStylist: false }]
  const [rows, setRows] = useState<Row[]>(first)
  useEffect(() => {
    api.get('/api/service-menu').then((r: any) => setServices(r?.data || [])).catch(() => setServices([]))
    fetchStaff().then(setStaff).catch(() => setStaff([]))
  }, [])
  const set = (i: number, patch: Partial<Row>) => setRows((l) => l.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const end = Math.max(0, ...rows.map((r) => r.startOffsetMin + r.durationMin))
  const save = async () => {
    if (!mayMove) return
    if (rows.filter((r) => r.serviceId).length < 2) { toast.error('A visit with several services needs at least two.'); return }
    setSaving(true)
    try { await api.put(`/api/appointments/${appt.id}/services`, { items: itemsBody(rows) }); toast.success('Services changed'); onSave() }
    catch (e: any) { toast.error(e?.message || 'Could not change the services') } finally { setSaving(false) }
  }
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div role="dialog" aria-modal="true" aria-label="Edit services" className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6 dark:bg-slate-900" data-testid="visit-services">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-bold text-gray-900 dark:text-slate-100">Edit services</h2>
            <button aria-label="Close" onClick={onClose} className="p-1 text-gray-400"><X className="w-5 h-5" /></button>
          </div>
          <div className="space-y-2">
            {rows.map((r, i) => (
              <div key={i} className="grid grid-cols-[1.4fr_1fr_5rem_5rem_auto_auto] items-center gap-2">
                <select aria-label={`Service ${i + 1}`} value={r.serviceId} onChange={(e) => { const sv = services.find((x) => x.id === e.target.value); set(i, { serviceId: e.target.value, ...(sv?.durationMin ? { durationMin: sv.durationMin } : {}) }) }} className="px-2 py-1.5 border rounded-lg text-sm">
                  <option value="">Choose a service…</option>
                  {services.map((sv) => <option key={sv.id} value={sv.id}>{sv.name || 'Untitled'}</option>)}
                </select>
                <select aria-label={`Stylist for service ${i + 1}`} value={r.stylistId} onChange={(e) => set(i, { stylistId: e.target.value })} className="px-2 py-1.5 border rounded-lg text-sm">
                  <option value="">The visit's stylist</option>
                  {staff.map((u) => <option key={u.id} value={u.id}>{staffName(u)}</option>)}
                </select>
                <input aria-label={`Service ${i + 1} starts (minutes in)`} type="number" min={0} step={5} value={String(r.startOffsetMin)} onChange={(e) => set(i, { startOffsetMin: Math.max(0, Number(e.target.value) || 0) })} className="px-2 py-1.5 border rounded-lg text-sm" title="Minutes after the visit starts" />
                <input aria-label={`Service ${i + 1} minutes`} type="number" min={5} step={5} value={String(r.durationMin)} onChange={(e) => set(i, { durationMin: Math.max(1, Number(e.target.value) || 0) })} className="px-2 py-1.5 border rounded-lg text-sm" />
                <button type="button" aria-pressed={r.requestedStylist} aria-label={`The client asked for this stylist (service ${i + 1})`} onClick={() => set(i, { requestedStylist: !r.requestedStylist })} className={`p-1 ${r.requestedStylist ? 'text-rose-600' : 'text-gray-400'}`}><Heart className="w-4 h-4" fill={r.requestedStylist ? 'currentColor' : 'none'} /></button>
                <button type="button" aria-label={`Remove service ${i + 1}`} onClick={() => setRows((l) => l.filter((_, j) => j !== i))} className="p-1 text-gray-400"><X className="w-4 h-4" /></button>
              </div>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => setRows((l) => [...l, { serviceId: '', stylistId: '', startOffsetMin: end, durationMin: 30, requestedStylist: false }])} className="text-sm text-teal-700 hover:underline dark:text-teal-300">+ Add a service</button>
            <span className="text-xs text-gray-500 dark:text-slate-400">The visit runs {end} minutes. Two services may start at the same minute with different stylists.</span>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-lg">Cancel</button>
            <button type="button" disabled={saving || !mayMove} onClick={save} className="px-4 py-2 bg-teal-700 text-white rounded-lg disabled:opacity-50">{saving ? 'Saving…' : 'Save services'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
