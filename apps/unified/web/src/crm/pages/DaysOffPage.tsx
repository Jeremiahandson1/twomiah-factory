// Settings › Days off — the business's holidays and other whole days it is closed (parity tier 2, 11/10: Buildertrend's workday
// exceptions, ServiceTitan's holidays). One list for every trade (server crm/field/daysOffRoutes.ts): online booking offers no
// time on them, a job booked on one warns "The business is closed …" (book anyway is allowed), Find a time skips them, the
// Dispatch Board says so, and a maintenance plan's visit that lands on one goes on the next open day. A person's own time off is
// kept apart (Hours & Time Off; Bookings › Days off for a person).
import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Loader2, Plus, X } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'
import { whenDate, companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { usualHolidays } from './usualHolidays'

interface DayOff { id: string; date: string; reason: string | null }

export default function DaysOffPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('jobs:dispatch')
  const [rows, setRows] = useState<DayOff[] | null>(null)
  const [error, setError] = useState('')
  const [date, setDate] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const today = companyTodayKey()
  const year = Number(today.slice(0, 4))

  const load = useCallback(() => {
    api.get('/api/days-off').then((r: any) => setRows(Array.isArray(r?.data) ? r.data : [])).catch((e: Error) => setError(e.message || 'The days off could not be loaded.'))
  }, [])
  useEffect(() => { load() }, [load])

  const add = async (list: Array<{ date: string; reason: string | null }>, said: string) => {
    setBusy(true); setError('')
    try {
      for (const d of list) await api.post('/api/days-off', d)
      toast.success(said); setDate(''); setReason(''); load()
    } catch (e: any) { setError(e?.message || 'That day off could not be saved.') } finally { setBusy(false) }
  }
  const remove = async (d: DayOff) => {
    setBusy(true); setError('')
    try { await api.delete(`/api/days-off/${d.id}`); toast.success(`${whenDate(d.date)} is a working day again`); load() }
    catch (e: any) { setError(e?.message || 'That day off could not be removed.') } finally { setBusy(false) }
  }

  if (!rows && !error) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>
  const have = new Set((rows || []).map((r) => r.date))
  const nextYear = (y: number) => usualHolidays(y).filter((h) => h.date >= today && !have.has(h.date))
  const offer = nextYear(year).length ? year : year + 1
  const missing = nextYear(offer)

  return (
    <div className="mx-auto max-w-3xl space-y-6 p-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-slate-100"><CalendarOff className="h-6 w-6" aria-hidden />Days off</h1>
        <p className="mt-1 text-sm text-gray-600 dark:text-slate-400">Holidays and other days the whole business is closed. Online booking offers no time on them, a job booked on one asks you to check first, and a maintenance plan's visit that falls on one moves to the next open day. A person's own time off is set under Hours &amp; Time Off.</p>
      </div>
      {error && <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>}
      {mayEdit && (
        <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900" aria-label="Add a day off">
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm text-gray-800 dark:text-slate-200">Day<input type="date" className="input ml-2" value={date} min={today} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="flex-1 text-sm text-gray-800 dark:text-slate-200">What it is (optional)<input className="input ml-2 w-full max-w-xs" maxLength={200} placeholder="e.g. Thanksgiving" value={reason} onChange={(e) => setReason(e.target.value)} /></label>
            <button type="button" className="btn btn-primary inline-flex items-center gap-1" disabled={busy || !date} onClick={() => void add([{ date, reason: reason.trim() || null }], `Closed on ${whenDate(date)}`)}><Plus className="h-4 w-4" aria-hidden />Add day off</button>
          </div>
          {missing.length > 0 && (
            <button type="button" className="btn-secondary text-sm" disabled={busy} onClick={() => void add(missing, `${missing.length} holiday${missing.length === 1 ? '' : 's'} added for ${offer}`)}>
              Add the usual holidays for {offer} ({missing.map((h) => h.reason).join(', ')})
            </button>
          )}
        </section>
      )}
      <section className="rounded-xl border border-gray-200 bg-white dark:border-slate-700 dark:bg-slate-900" aria-label="Coming days off">
        <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900 dark:border-slate-700 dark:text-slate-100">Coming up</h2>
        {!(rows || []).length
          ? <p className="px-4 py-6 text-sm text-gray-600 dark:text-slate-400">No days off set. The business is open every day its hours say.</p>
          : <ul className="divide-y divide-gray-100 dark:divide-slate-800">
              {rows!.map((d) => (
                <li key={d.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm text-gray-800 dark:text-slate-200">
                  <span><strong>{whenDate(d.date, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</strong>{d.reason ? ` · ${d.reason}` : ''}</span>
                  {mayEdit && <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/40" disabled={busy} onClick={() => void remove(d)}><X className="h-4 w-4" aria-hidden />Remove</button>}
                </li>
              ))}
            </ul>}
      </section>
    </div>
  )
}
