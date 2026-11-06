// Time off, closed dates and hours away (salon parity row 3; server crm/salon/timeOff.ts under /api/book-blocks; feature book_grid).
// A stylist asks for her own time off and a manager approves it; a manager also sets the days the whole salon is closed. Both come off the
// Book and out of online booking, and making or approving one lists the appointments already booked inside it. The hours section shows
// paid and unpaid time away per stylist.
import { useCallback, useEffect, useState } from 'react'
import { Loader2, CalendarOff, Check, X, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useConfirm, usePermissions } from '../../../shared'
import { whenDateTime, companyMoment, companyDayKey } from '@twomiah/tenant-ui/src/time/companyClock'
import { fetchStaff, staffName, type StaffMember } from './staff'

type Off = { id: string; stylistId: string | null; stylistFirstName: string | null; stylistLastName: string | null; startTime: string; endTime: string; status: 'pending' | 'approved' | 'denied'; paid: boolean; reason: string | null; decisionNote: string | null }
type Closed = { id: string; name: string; startDate: string; endDate: string }
type Affected = { id: string; startTime: string; clientName: string | null; serviceName: string | null }
type Hours = { stylists: Array<{ id: string | null; name: string; paidMinutes: number; unpaidMinutes: number }>; totals: { paidMinutes: number; unpaidMinutes: number } }

const box = 'rounded-xl border border-gray-200 bg-white p-5 dark:border-slate-700 dark:bg-slate-900'
const hint = 'mt-1 text-sm text-gray-600 dark:text-slate-300'
const field = 'mt-1 block w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-900'
const PILL: Record<Off['status'], string> = {
  pending: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200',
  approved: 'bg-green-100 text-green-900 dark:bg-green-950/50 dark:text-green-200',
  denied: 'bg-gray-200 text-gray-800 dark:bg-slate-700 dark:text-slate-200',
}
const hoursText = (min: number) => `${Math.floor(min / 60)}h${min % 60 ? ` ${min % 60}m` : ''}`

export default function TimeOffPage() {
  const toast = useToast()
  const confirm = useConfirm()
  const { can, known } = usePermissions()
  const [offs, setOffs] = useState<Off[] | null>(null)
  const [closed, setClosed] = useState<Closed[]>([])
  const [manager, setManager] = useState(false)
  const [staff, setStaff] = useState<StaffMember[]>([])
  const [hours, setHours] = useState<Hours | null>(null)
  const [moved, setMoved] = useState<{ title: string; list: Affected[] } | null>(null)
  const today = companyDayKey(new Date())
  // the request form
  const [who, setWho] = useState('')
  const [fromDay, setFromDay] = useState(today)
  const [fromTime, setFromTime] = useState('09:00')
  const [toDay, setToDay] = useState(today)
  const [toTime, setToTime] = useState('17:00')
  const [paid, setPaid] = useState(false)
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  // the closed-dates form
  const [cName, setCName] = useState('')
  const [cFrom, setCFrom] = useState(today)
  const [cTo, setCTo] = useState(today)

  const load = useCallback(async () => {
    const [o, c, a] = await Promise.all([
      api.get('/api/book-blocks/time-off').catch(() => ({ data: [] })),
      api.get(`/api/book-blocks/closed?from=${today}`).catch(() => ({ data: [] })),
      api.get('/api/book-blocks/time-off/access').catch(() => ({ mayDecide: false })),
    ])
    setOffs((o?.data ?? []) as Off[]); setClosed((c?.data ?? []) as Closed[]); setManager(!!a?.mayDecide)
    if (known && can('reports:read')) {
      const month = new Date(); const start = companyMoment(`${today.slice(0, 8)}01`, '00:00'); const end = new Date(month.getTime() + 62 * 86_400_000)
      api.get(`/api/book-blocks/hours?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`).then((h: Hours) => setHours(h)).catch(() => setHours(null))
    }
  }, [today, known])
  useEffect(() => { void load(); fetchStaff().then(setStaff).catch(() => setStaff([])) }, [load])

  const say = (title: string, list: Affected[] | undefined) => { if (list && list.length) setMoved({ title, list }) }
  const request = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      const made = await api.post('/api/book-blocks/time-off', {
        ...(who ? { stylistId: who } : {}), startTime: companyMoment(fromDay, fromTime).toISOString(), endTime: companyMoment(toDay, toTime).toISOString(),
        ...(manager ? { paid } : {}), reason: reason.trim() || null,
      })
      toast.success(made.status === 'pending' ? 'Time off requested — a manager will decide' : 'Time off added')
      setReason(''); say('Already booked inside this time off — move or cancel these', made.affected); await load()
    } catch (err: any) { toast.error(err?.message || 'Could not save the time off.') } finally { setSaving(false) }
  }
  const decide = async (o: Off, status: 'approved' | 'denied') => {
    try {
      const r = await api.put(`/api/book-blocks/time-off/${o.id}/decision`, { status })
      toast.success(status === 'approved' ? 'Approved' : 'Denied'); say('Already booked inside this time off — move or cancel these', r.affected); await load()
    } catch (err: any) { toast.error(err?.message || 'Could not save the decision.') }
  }
  const withdraw = async (o: Off) => {
    if (!(await confirm('Remove this time off request?', { title: 'Remove time off', confirmText: 'Remove it' }))) return
    try { await api.delete(`/api/book-blocks/time-off/${o.id}`); await load() } catch (err: any) { toast.error(err?.message || 'Could not remove it.') }
  }
  const addClosed = async (e: React.FormEvent) => {
    e.preventDefault(); setSaving(true)
    try {
      const made = await api.post('/api/book-blocks/closed', { name: cName, startDate: cFrom, endDate: cTo })
      toast.success('Closed dates added'); setCName(''); say('Already booked on the days you closed — move or cancel these', made.affected); await load()
    } catch (err: any) { toast.error(err?.message || 'Could not save the closed dates.') } finally { setSaving(false) }
  }
  const removeClosed = async (p: Closed) => {
    if (!(await confirm(`Remove "${p.name}"? Those days open up for booking again.`, { title: 'Remove closed dates', confirmText: 'Remove them' }))) return
    try { await api.delete(`/api/book-blocks/closed/${p.id}`); await load() } catch (err: any) { toast.error(err?.message || 'Could not remove them.') }
  }

  if (offs === null) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>
  const name = (o: Off) => [o.stylistFirstName, o.stylistLastName].filter(Boolean).join(' ') || 'Stylist'
  const day = (d: string) => whenDateTime(new Date(d), { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-white"><CalendarOff className="h-6 w-6 text-teal-700 dark:text-teal-300" aria-hidden="true" /> Time off</h1>
        <p className="mt-1 text-gray-600 dark:text-slate-300">Time off and closed days come off The Book and out of online booking once they are approved.</p>
      </div>

      {moved && (
        <section role="status" className="rounded-xl border border-amber-300 bg-amber-50 p-4 dark:border-amber-700 dark:bg-amber-950/40">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-amber-900 dark:text-amber-100">{moved.title}</p>
            <button type="button" aria-label="Dismiss" onClick={() => setMoved(null)} className="p-1 text-amber-900 dark:text-amber-100"><X className="h-4 w-4" aria-hidden="true" /></button>
          </div>
          <ul className="mt-2 space-y-1 text-sm text-amber-900 dark:text-amber-100">
            {moved.list.map((a) => <li key={a.id}>{day(a.startTime)} — {a.clientName || 'Walk-in'}{a.serviceName ? `, ${a.serviceName}` : ''}</li>)}
          </ul>
          <p className="mt-2 text-xs text-amber-900 dark:text-amber-200">They stay on The Book until you move them.</p>
        </section>
      )}

      <section className={box} aria-label="Ask for time off">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{manager ? 'Add time off' : 'Ask for time off'}</h2>
        <p className={hint}>{manager ? 'Time you add for someone is approved straight away.' : 'A manager approves it before it takes your chair off The Book.'}</p>
        <form onSubmit={request} className="mt-3 grid gap-3 sm:grid-cols-2">
          {manager && (
            <label className="text-sm font-medium text-gray-700 dark:text-slate-200 sm:col-span-2">Who
              <select value={who} onChange={(e) => setWho(e.target.value)} className={field} required>
                <option value="">Choose a stylist</option>
                {staff.map((s) => <option key={s.id} value={s.id}>{staffName(s)}</option>)}
              </select>
            </label>
          )}
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">From (day)<input type="date" value={fromDay} onChange={(e) => { setFromDay(e.target.value); if (toDay < e.target.value) setToDay(e.target.value) }} className={field} required /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">From (time)<input type="time" value={fromTime} onChange={(e) => setFromTime(e.target.value)} className={field} required /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Until (day)<input type="date" value={toDay} onChange={(e) => setToDay(e.target.value)} className={field} required /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Until (time)<input type="time" value={toTime} onChange={(e) => setToTime(e.target.value)} className={field} required /></label>
          <label className="text-sm font-medium text-gray-700 dark:text-slate-200 sm:col-span-2">Reason (only your team sees it)<input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className={field} placeholder="Vacation, appointment" /></label>
          {manager && <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> Paid time off</label>}
          <div className="sm:col-span-2"><button type="submit" disabled={saving} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">{saving ? 'Saving...' : manager ? 'Add time off' : 'Send request'}</button></div>
        </form>
      </section>

      <section className={box} aria-label="Time off">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">{manager ? 'Everyone’s time off' : 'Time off'}</h2>
        {offs.length === 0 && <p className={hint}>Nothing yet.</p>}
        <ul className="mt-3 divide-y divide-gray-100 dark:divide-slate-800">
          {offs.map((o) => (
            <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="min-w-[8rem] font-medium text-gray-900 dark:text-slate-100">{name(o)}</span>
              <span className="text-sm text-gray-700 dark:text-slate-200">{day(o.startTime)} – {day(o.endTime)}</span>
              <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${PILL[o.status]}`}>{o.status === 'pending' ? 'Waiting' : o.status === 'approved' ? 'Approved' : 'Denied'}</span>
              {o.status === 'approved' && <span className="text-xs text-gray-600 dark:text-slate-300">{o.paid ? 'Paid' : 'Unpaid'}</span>}
              {o.reason && <span className="text-sm text-gray-600 dark:text-slate-300">{o.reason}</span>}
              {o.decisionNote && <span className="text-sm italic text-gray-600 dark:text-slate-300">{o.decisionNote}</span>}
              <span className="ml-auto flex gap-1">
                {manager && o.status === 'pending' && <>
                  <button type="button" onClick={() => decide(o, 'approved')} className="inline-flex items-center gap-1 rounded-lg border border-green-300 px-2 py-1 text-sm text-green-800 hover:bg-green-50 dark:text-green-300"><Check className="h-4 w-4" aria-hidden="true" /> Approve</button>
                  <button type="button" onClick={() => decide(o, 'denied')} className="inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2 py-1 text-sm hover:bg-gray-50 dark:hover:bg-slate-800"><X className="h-4 w-4" aria-hidden="true" /> Deny</button>
                </>}
                {(manager || o.status === 'pending') && <button type="button" onClick={() => withdraw(o)} aria-label="Remove time off" className="p-1 text-red-700 hover:bg-red-50 dark:text-red-400"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
              </span>
            </li>
          ))}
        </ul>
      </section>

      <section className={box} aria-label="Closed dates">
        <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Days the salon is closed</h2>
        <p className={hint}>Holidays and shutdowns: every chair, and online booking, for whole days.</p>
        {closed.length === 0 && <p className={hint}>No closed dates coming up.</p>}
        <ul className="mt-3 space-y-1">
          {closed.map((p) => (
            <li key={p.id} className="flex items-center gap-2 text-sm text-gray-800 dark:text-slate-100">
              <span className="font-medium">{p.name}</span><span>{p.startDate === p.endDate ? p.startDate : `${p.startDate} to ${p.endDate}`}</span>
              {manager && <button type="button" onClick={() => removeClosed(p)} aria-label={`Remove ${p.name}`} className="ml-auto p-1 text-red-700 hover:bg-red-50 dark:text-red-400"><Trash2 className="h-4 w-4" aria-hidden="true" /></button>}
            </li>
          ))}
        </ul>
        {manager && (
          <form onSubmit={addClosed} className="mt-4 flex flex-wrap items-end gap-2">
            <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Name<input value={cName} onChange={(e) => setCName(e.target.value)} maxLength={80} className={field} placeholder="Thanksgiving" required /></label>
            <label className="text-sm font-medium text-gray-700 dark:text-slate-200">First day<input type="date" value={cFrom} onChange={(e) => { setCFrom(e.target.value); if (cTo < e.target.value) setCTo(e.target.value) }} className={field} required /></label>
            <label className="text-sm font-medium text-gray-700 dark:text-slate-200">Last day<input type="date" value={cTo} onChange={(e) => setCTo(e.target.value)} className={field} required /></label>
            <button type="submit" disabled={saving || !cName.trim()} className="rounded-lg bg-teal-700 px-4 py-2 text-sm text-white hover:bg-teal-800 disabled:opacity-50">Close these days</button>
          </form>
        )}
      </section>

      {hours && (
        <section className={box} aria-label="Hours away from the chair">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-slate-100">Hours away from the chair</h2>
          <p className={hint}>From the start of this month: approved time off and blocked time made from a paid or unpaid type. Blocks with no type are not counted.</p>
          {hours.stylists.length === 0 ? <p className={hint}>Nothing yet.</p> : (
            <table className="mt-3 w-full text-sm">
              <thead><tr className="text-left text-gray-600 dark:text-slate-300"><th className="py-1 font-medium">Stylist</th><th className="py-1 font-medium">Paid</th><th className="py-1 font-medium">Unpaid</th></tr></thead>
              <tbody>
                {hours.stylists.map((p) => <tr key={p.id ?? 'all'} className="border-t border-gray-100 dark:border-slate-800"><td className="py-1">{p.name}</td><td>{hoursText(p.paidMinutes)}</td><td>{hoursText(p.unpaidMinutes)}</td></tr>)}
                <tr className="border-t border-gray-300 font-medium dark:border-slate-600"><td className="py-1">Total</td><td>{hoursText(hours.totals.paidMinutes)}</td><td>{hoursText(hours.totals.unpaidMinutes)}</td></tr>
              </tbody>
            </table>
          )}
        </section>
      )}
    </div>
  )
}
