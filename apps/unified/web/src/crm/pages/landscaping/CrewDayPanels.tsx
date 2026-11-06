// The office's side of the crew's phone day, on the Route Board (landscaping parity rows 12 and 15):
//   · Couldn't do — every visit a crew marked as not done (reason, their note, whether it needs rebooking): Rebook it to a day, or
//     Close it (the visit is cancelled). GET /api/crew-day/skips, POST …/skips/:id/rebook | /close   (jobs:dispatch; visit_skip)
//   · Crew Score (LMN) — each crew lead's finished visits in a range: budget hours against hours worked, and the score (budget ÷
//     actual × 100; over 100 is under budget). GET /api/crew-day/score?from&to   (jobs:dispatch; crew_timers)
// Both not ready (hidden features); each shows only where its switch is on and the seat may dispatch.
import { useCallback, useEffect, useState } from 'react'
import { Ban, Gauge, Loader2 } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite, useAuth } from '../../../shared'
import { whenDate, companyTodayKey } from '@twomiah/tenant-ui/src/time/companyClock'

const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
// A visit's day is a calendar day (a midnight marker), printed as the day it names; today is the company's.
const dayWords = (v: string | null | undefined) => whenDate(v, { weekday: 'short', month: 'short', day: 'numeric' })
/** The company's day `n` days from today, as YYYY-MM-DD. */
const dayKey = (n = 0) => { const t = Date.parse(`${companyTodayKey()}T00:00:00Z`) + n * 86_400_000; return new Date(t).toISOString().slice(0, 10) }
const hours = (h: number) => `${Math.round(h * 10) / 10} h`

export function CouldNotDoPanel({ onChanged }: { onChanged: () => void }) {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const mayAct = useMayWrite('jobs:dispatch')
  const on = hasFeature('visit_skip') && mayAct
  const [rows, setRows] = useState<any[] | null>(null)
  const [dates, setDates] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState<string | null>(null)
  const load = useCallback(async () => {
    try { const r: any = await api.get('/api/crew-day/skips'); setRows(Array.isArray(r?.data) ? r.data : []) } catch (e) { toast.error(errorText(e, 'Could not load the visits not done')); setRows([]) }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) load() }, [on, load])
  if (!on) return null
  const act = async (row: any, how: 'rebook' | 'close') => {
    const date = dates[row.id]
    if (how === 'rebook' && !date) { toast.error('Pick the day to rebook it to.'); return }
    setBusy(row.id)
    try {
      await api.post(`/api/crew-day/skips/${row.id}/${how}`, how === 'rebook' ? { date } : {})
      toast.success(how === 'rebook' ? `Rebooked to ${dayWords(date)}` : 'Closed — the visit is cancelled')
      await load(); onChanged()
    } catch (e) { toast.error(errorText(e, 'That did not save')) } finally { setBusy(null) }
  }
  return (
    <section className="bg-white border dark:border-slate-700 rounded-lg p-5 dark:bg-slate-900" aria-labelledby="couldnt-do-title">
      <h2 id="couldnt-do-title" className="font-semibold mb-1 flex items-center gap-2"><Ban className="w-5 h-5" /> Couldn't do</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">Visits your crews marked as not done from their phones. Rebook each one to a day, or close it.</p>
      {!rows ? <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" />
        : !rows.length ? <p className="text-sm text-gray-500 dark:text-slate-400">Nothing waiting. Every visit marked as not done has been dealt with.</p>
        : (
          <ul className="divide-y dark:divide-slate-800">
            {rows.map((r) => (
              <li key={r.id} className="py-3 flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-[14rem]">
                  <p className="font-medium text-gray-900 dark:text-white">{r.contactName || r.jobTitle} <span className="text-gray-500 dark:text-slate-400 font-normal">· {r.jobNumber} · was {dayWords(r.scheduledDate)}</span></p>
                  <p className="text-sm text-gray-700 dark:text-slate-300">{r.reasonLabel}{r.note ? ` — ${r.note}` : ''}{r.by ? ` (${r.by})` : ''}</p>
                  {!r.rebook ? <p className="text-xs text-amber-700 dark:text-amber-300">The crew said it does not need rebooking.</p> : null}
                </div>
                <label className="text-sm flex items-center gap-2">Rebook to
                  <input type="date" className="input py-1" aria-label={`Rebook ${r.contactName || r.jobTitle} to`} value={dates[r.id] || ''} min={dayKey()} onChange={(e) => setDates((d) => ({ ...d, [r.id]: e.target.value }))} />
                </label>
                <button type="button" className="btn-primary" disabled={busy === r.id} onClick={() => act(r, 'rebook')}>Rebook</button>
                <button type="button" className="btn-secondary" disabled={busy === r.id} onClick={() => act(r, 'close')}>Close</button>
              </li>
            ))}
          </ul>
        )}
    </section>
  )
}

export function CrewScorePanel() {
  const toast = useToast()
  const { hasFeature } = useAuth()
  const mayDispatch = useMayWrite('jobs:dispatch')
  const on = hasFeature('crew_timers') && mayDispatch
  const [from, setFrom] = useState(() => dayKey(-6))
  const [to, setTo] = useState(() => dayKey())
  const [rows, setRows] = useState<any[] | null>(null)
  const load = useCallback(async () => {
    try { const r: any = await api.get(`/api/crew-day/score?from=${from}&to=${to}`); setRows(Array.isArray(r?.data) ? r.data : []) } catch (e) { toast.error(errorText(e, 'Could not load the Crew Score')); setRows([]) }
  }, [from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (on) load() }, [on, load])
  if (!on) return null
  return (
    <section className="bg-white border dark:border-slate-700 rounded-lg p-5 dark:bg-slate-900" aria-labelledby="crew-score-title">
      <h2 id="crew-score-title" className="font-semibold mb-1 flex items-center gap-2"><Gauge className="w-5 h-5" /> Crew Score</h2>
      <p className="text-sm text-gray-600 dark:text-slate-400 mb-3">Each crew's finished visits: the time allowed against the hours worked. Over 100 means under budget.</p>
      <div className="flex flex-wrap gap-3 mb-3 text-sm">
        <label className="flex items-center gap-2">From <input type="date" className="input py-1" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="flex items-center gap-2">To <input type="date" className="input py-1" value={to} onChange={(e) => setTo(e.target.value)} /></label>
      </div>
      {!rows ? <Loader2 className="w-5 h-5 animate-spin" aria-label="Loading" />
        : !rows.length ? <p className="text-sm text-gray-500 dark:text-slate-400">No finished visits in these days.</p>
        : (
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 dark:text-slate-400"><th className="py-1">Crew lead</th><th className="py-1 text-right">Visits</th><th className="py-1 text-right">Allowed</th><th className="py-1 text-right">Worked</th><th className="py-1 text-right">Score</th></tr></thead>
            <tbody>{rows.map((r) => (
              <tr key={r.leadId || 'none'} className="border-t dark:border-slate-800">
                <td className="py-2">{r.lead}</td>
                <td className="py-2 text-right">{r.visits}{r.scored < r.visits ? <span className="text-xs text-gray-500 dark:text-slate-400"> ({r.scored} scored)</span> : null}</td>
                <td className="py-2 text-right">{hours(r.budgetHours)}</td>
                <td className="py-2 text-right">{hours(r.actualHours)}</td>
                <td className={`py-2 text-right font-semibold ${r.score == null ? '' : r.score >= 100 ? 'text-green-700 dark:text-green-300' : 'text-red-700 dark:text-red-300'}`}>{r.score == null ? '—' : r.score}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">A visit is scored when it has time allowed and hours worked (the crew's clocks on the phone, else its start to finish).</p>
    </section>
  )
}
