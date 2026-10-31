// Retention over several return windows, for the salon and for each stylist, sliceable by service (salon parity row 14; server
// crm/salon/returnWindows.ts, GET/PUT /api/salon-reports/return-windows). The owner picks the windows and may keep them for the salon.
import { useEffect, useState } from 'react'
import { api, usePermissions } from '../../../shared'
import { useToast } from '../../../shared'
import { inputCls } from '@twomiah/tenant-ui/src/invoicing/ui'

interface WindowRate { days: number; counted: number; returned: number; ratePercent: number | null }
interface Result {
  truncated: boolean; windowDays: number[]; clients: number; windows: WindowRate[]
  stylists: Array<{ id: string | null; name: string; clients: number; windows: WindowRate[] }>
}
const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const cell = (w: WindowRate) => (w.ratePercent == null ? '—' : `${w.ratePercent}%`)
const note = (w: WindowRate) => `${w.returned} of ${w.counted}`

export function ReturnWindowsSection({ from, to }: { from: string; to: string }) {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayKeep = known && can('company:update')
  const [data, setData] = useState<Result | null>(null)
  const [windows, setWindows] = useState('')          // what is typed; empty = the salon's saved windows
  const [service, setService] = useState('')
  const [services, setServices] = useState<Array<{ id: string; name: string }>>([])
  const [error, setError] = useState('')
  useEffect(() => { api.get('/api/service-menu').then((r: any) => setServices((r.data || []).map((s: any) => ({ id: s.id, name: s.name })))).catch(() => setServices([])) }, [])
  useEffect(() => {
    let live = true
    const qs = new URLSearchParams({ from, to })
    if (windows.trim()) qs.set('windows', windows.trim())
    if (service) qs.set('serviceId', service)
    setError('')
    api.get(`/api/salon-reports/return-windows?${qs}`)
      .then((r: Result) => { if (live) { setData(r); if (!windows.trim()) setWindows(r.windowDays.join(', ')) } })
      .catch((e: any) => { if (live) { setData(null); setError(e?.data?.fields?.from || e?.message || 'The report could not be loaded.') } })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, windows, service])

  const keep = async () => {
    try { const r = await api.put('/api/salon-reports/return-windows', { windows: windows.split(/[,\s]+/).filter(Boolean).map(Number) }); toast.success(`Saved: ${r.windows.join(', ')} days`) }
    catch (e: any) { toast.error(e?.data?.fields?.windows || e?.message || 'The windows were not saved.') }
  }

  return (
    <section className={box} aria-label="Return windows">
      <h2 className="text-lg font-semibold text-gray-900 dark:text-white">Clients who came back, by return window</h2>
      <p className={hint}>Of the clients whose first visit in this period was in the group chosen, the share who came in again within each number of days. A client is counted in a window only once the whole window has passed since that visit.</p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        <label className="text-sm font-medium text-gray-900 dark:text-slate-100">Windows, in days
          <input value={windows} onChange={(e) => setWindows(e.target.value)} className={inputCls + ' mt-1 w-44'} placeholder="30, 60, 90, 120" aria-describedby="rw-help" />
        </label>
        <label className="text-sm font-medium text-gray-900 dark:text-slate-100">First visit was
          <select value={service} onChange={(e) => setService(e.target.value)} className={inputCls + ' mt-1'}>
            <option value="">Any service</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {mayKeep && <button type="button" onClick={keep} className="rounded-lg border px-3 py-2 text-sm hover:bg-gray-50 dark:hover:bg-slate-800">Keep these windows</button>}
      </div>
      <p id="rw-help" className="mt-1 text-xs text-gray-600 dark:text-slate-400">Up to six windows, from 7 to 365 days, separated by commas.</p>
      {error && <p role="alert" className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}
      {data && (
        <div className="mt-3 overflow-x-auto">
          {data.truncated && <p role="alert" className="mb-2 text-sm text-amber-800 dark:text-amber-200">This period has more visits than a report can read, so only the earliest are counted.</p>}
          {data.clients === 0 ? <p className={hint}>No clients in this group had a visit in this period.</p> : (
            <table className="min-w-full text-sm">
              <thead className="text-left text-gray-700 dark:text-slate-300">
                <tr><th className="py-1 pr-4">Stylist of that visit</th><th className="py-1 pr-4 text-right">Clients</th>{data.windowDays.map((d) => <th key={d} className="py-1 pr-4 text-right">Back in {d} days</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-gray-100 text-gray-900 dark:divide-slate-800 dark:text-slate-100">
                <tr className="font-semibold"><td className="py-1.5 pr-4">Whole salon</td><td className="py-1.5 pr-4 text-right">{data.clients}</td>{data.windows.map((w) => <td key={w.days} className="py-1.5 pr-4 text-right">{cell(w)} <span className="block text-xs font-normal text-gray-600 dark:text-slate-400">{note(w)}</span></td>)}</tr>
                {data.stylists.map((s) => (
                  <tr key={s.id ?? s.name}><td className="py-1.5 pr-4">{s.name}</td><td className="py-1.5 pr-4 text-right">{s.clients}</td>{s.windows.map((w) => <td key={w.days} className="py-1.5 pr-4 text-right">{cell(w)} <span className="block text-xs text-gray-600 dark:text-slate-400">{note(w)}</span></td>)}</tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </section>
  )
}
