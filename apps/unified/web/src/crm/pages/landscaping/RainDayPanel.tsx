// Rain day: push a day's jobs (or one route's) a day or a week, and text the customers. Preview first — nothing moves or sends
// until "Push" — then the result says what moved, what could not and who was texted. Gated as the dispatch board's bulk move is
// (jobs:update + jobs:dispatch; the texts also need sms:send), the same asks as POST /api/recurring-routes/rain-day.
import { useEffect, useState } from 'react'
import { CloudRain, Loader2, Undo2, CloudSun } from 'lucide-react'
import { api } from '../../../api'
import { useToast, useMayWrite, useConfirm, useAuth } from '../../../shared'

interface Plan {
  dryRun: boolean; background?: boolean; toDate: string; throughDate?: string | null; moved: number; wouldMove: number; skippedSunday?: boolean
  jobs: Array<{ id: string; number: string; title: string; scheduledTime: string | null }>
  blocked: Array<{ id: string; number: string; title: string; reason: string }>
  overlaps: Array<{ id: string; number: string; title: string; other: string; time: string }>
  texts: null | { queued: number; willText: number; sendAt: string | null; preview: Array<{ name: string; body: string }>; skipped: Array<{ contactId: string; name: string; reason: string }>; jobsWithoutCustomer: number }
}
const DEFAULT_TEXT = "Hi {firstName}, this is {company}. Rain is keeping our crews off the job on {oldDay}, so we've moved {visits} to {newDay}. Reply here if that doesn't work for you."
const today = () => new Date().toLocaleDateString('en-CA')
const errorText = (e: unknown, fallback: string) => (e as any)?.response?.data?.error || (e as any)?.message || fallback
const dayWords = (ymd: string) => new Date(`${ymd}T00:00:00Z`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone: 'UTC' })

interface Run { id: string; status: string; fromDate: string; throughDate: string | null; toDate: string | null; shiftDays: number | null; moved: number; error: string | null; undoneAt: string | null; canUndo: boolean }
interface ForecastDay { date: string; summary: string; precipChance: number; rainInches: number; snowInches: number; wet: boolean; visits: number }

export default function RainDayPanel({ onDone }: { onDone: () => void }) {
  const toast = useToast()
  const confirm = useConfirm()
  // Rows 16, 17 and 29 (rain_day_tools, not ready): without the switch the panel is exactly as before.
  const tools = useAuth().hasFeature('rain_day_tools')
  const mayPush = useMayWrite('jobs:update') && useMayWrite('jobs:dispatch')
  const mayText = useMayWrite('sms:send')
  const [open, setOpen] = useState(false)
  const [routes, setRoutes] = useState<Array<{ id: string; name: string; dayName?: string }>>([])
  const [date, setDate] = useState(today())
  const [routeId, setRouteId] = useState('')
  const [shift, setShift] = useState('day')
  const [notify, setNotify] = useState(false)
  const [message, setMessage] = useState('')
  const [plan, setPlan] = useState<Plan | null>(null)
  // A run of days ("through Friday"), or one day moved TO a chosen date (row 16); the recent runs to undo (row 29); the week's weather (row 17).
  const [through, setThrough] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [runs, setRuns] = useState<Run[]>([])
  const [forecast, setForecast] = useState<ForecastDay[] | null>(null)
  const [forecastNote, setForecastNote] = useState('')
  const [busy, setBusy] = useState(false)
  // The business's switch, kept on the server (GET/PUT /api/recurring-routes/rain-day/settings). Null until it has loaded.
  const [skipSundays, setSkipSundays] = useState<boolean | null>(null)

  useEffect(() => {
    if (!open || skipSundays !== null) return
    api.get('/api/recurring-routes/rain-day/settings').then((r: any) => setSkipSundays(((r?.data ?? r) as any)?.skipSundays !== false)).catch(() => setSkipSundays(true))
  }, [open, skipSundays])
  const changeSkipSundays = async (next: boolean) => {
    const was = skipSundays
    setSkipSundays(next); setPlan(null)
    try { await api.put('/api/recurring-routes/rain-day/settings', { skipSundays: next }) }
    catch (e) { setSkipSundays(was); toast.error(errorText(e, 'Could not save that')) }
  }

  const loadRuns = () => api.get('/api/recurring-routes/rain-day/runs').then((r: any) => setRuns(Array.isArray(r?.data) ? r.data : [])).catch(() => setRuns([]))
  useEffect(() => {
    if (!open || !tools) return
    loadRuns()
    if (forecast === null) api.get('/api/recurring-routes/rain-day/forecast').then((r: any) => { setForecast(Array.isArray(r?.data) ? r.data : []); setForecastNote('') }).catch((e) => { setForecast([]); setForecastNote(errorText(e, 'The forecast could not be loaded.')) })
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps
  const undo = async (run: Run) => {
    if (!(await confirm(`The ${run.moved} ${run.moved === 1 ? 'visit goes' : 'visits go'} back to ${dayWords(run.fromDate)}${run.throughDate ? ` – ${dayWords(run.throughDate)}` : ''}. Any that were started or moved again since stay where they are, and texts not yet sent are cancelled.`, { title: 'Undo this rain day?', confirmText: 'Undo' }))) return
    try {
      const r: any = await api.post(`/api/recurring-routes/rain-day/runs/${run.id}/undo`, {})
      const out = r?.data ?? r
      toast.success(`${out.back} ${out.back === 1 ? 'visit' : 'visits'} put back${out.stayed?.length ? `; ${out.stayed.length} stayed (changed since)` : ''}${out.textsCancelled ? `; ${out.textsCancelled} ${out.textsCancelled === 1 ? 'text' : 'texts'} cancelled` : ''}`)
      loadRuns(); onDone()
    } catch (e) { toast.error(errorText(e, 'Could not undo it')) }
  }

  useEffect(() => {
    if (!open || routes.length) return
    api.get('/api/recurring-routes').then((r: any) => setRoutes(Array.isArray(r?.data) ? r.data : [])).catch(() => setRoutes([]))
  }, [open, routes.length])

  if (!mayPush) return null
  const body = (dryRun: boolean) => ({
    date, ...(shift === 'date' ? { toDate: moveTo } : { shift, ...(through ? { throughDate: through } : {}) }),
    routeId: routeId || undefined, notify: notify && mayText, message: message.trim() || undefined, dryRun,
  })
  const run = async (dryRun: boolean) => {
    setBusy(true)
    try {
      const r = await api.post('/api/recurring-routes/rain-day', body(dryRun)) as any
      const out = (r?.data ?? r) as Plan
      setPlan(out)
      if (!dryRun) {
        // A big push runs in the background and emails when it is done (Yardbook); the runs list shows it running.
        if (out.background) toast.success(`Moving ${out.wouldMove} jobs in the background — you'll get an email when it's done`)
        else toast.success(out.moved ? `Pushed ${out.moved} ${out.moved === 1 ? 'job' : 'jobs'}${out.throughDate ? '' : ` to ${dayWords(out.toDate)}`}` : 'Nothing was moved')
        loadRuns(); onDone()
      }
    } catch (e) { toast.error(errorText(e, 'Could not do the rain day')) }
    finally { setBusy(false) }
  }

  return (
    <div className="mt-4 rounded-lg border border-gray-200 p-3 dark:border-slate-700">
      <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-semibold" aria-expanded={open}>
        <CloudRain className="w-4 h-4" /> Rain day
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          <p className="text-xs text-gray-500 dark:text-slate-400">Push a day's open jobs forward and let customers know. Jobs already started or finished stay put; each job keeps its time, so the crew's order does not change.</p>
          {tools && forecast && forecast.length > 0 && (
            <div>
              <p className="text-xs font-medium flex items-center gap-1"><CloudSun className="w-4 h-4" /> The week's weather (US Weather Service)</p>
              <div className="mt-1 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-7">
                {forecast.map((f) => (
                  <div key={f.date} className={`rounded border p-2 text-xs ${f.wet ? 'border-blue-400 bg-blue-50 dark:border-blue-700 dark:bg-blue-950/40' : 'border-gray-200 dark:border-slate-700'}`}>
                    <p className="font-semibold">{dayWords(f.date).split(',')[0]}</p>
                    <p className="text-gray-600 dark:text-slate-300">{f.summary}</p>
                    <p>{f.precipChance}% · {f.snowInches > 0 ? `${f.snowInches} in snow` : `${f.rainInches} in`}</p>
                    <p className="text-gray-500 dark:text-slate-400">{f.visits} {f.visits === 1 ? 'visit' : 'visits'}</p>
                    {f.wet && f.visits > 0 && f.date >= today() && <button type="button" className="mt-1 text-blue-700 underline dark:text-blue-300" onClick={() => { setDate(f.date); setThrough(''); setPlan(null) }}>Push this day</button>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {tools && forecastNote && <p className="text-xs text-gray-500 dark:text-slate-400">{forecastNote}</p>}
          <div className="grid gap-2 md:grid-cols-3">
            <div><label htmlFor="rain-date" className="block text-xs font-medium">Day it rained</label><input id="rain-date" type="date" className="input" value={date} min={today()} onChange={(e) => { setDate(e.target.value); setPlan(null) }} /></div>
            <div><label htmlFor="rain-route" className="block text-xs font-medium">Which jobs</label>
              <select id="rain-route" className="input" value={routeId} onChange={(e) => { setRouteId(e.target.value); setPlan(null) }}>
                <option value="">Everything that day</option>
                {routes.map((r) => <option key={r.id} value={r.id}>{r.name}{r.dayName ? ` (${r.dayName})` : ''}</option>)}
              </select></div>
            <div><label htmlFor="rain-shift" className="block text-xs font-medium">Push forward</label>
              <select id="rain-shift" className="input" value={shift} onChange={(e) => { setShift(e.target.value); setPlan(null) }}>
                <option value="day">One day</option><option value="2">Two days</option><option value="3">Three days</option><option value="week">One week</option>{tools ? <option value="date">To a date…</option> : null}
              </select></div>
          </div>
          {tools && <div className="grid gap-2 md:grid-cols-3">
            {shift === 'date'
              ? <div><label htmlFor="rain-to" className="block text-xs font-medium">Move them to</label><input id="rain-to" type="date" className="input" value={moveTo} min={date} onChange={(e) => { setMoveTo(e.target.value); setPlan(null) }} /></div>
              : <div><label htmlFor="rain-through" className="block text-xs font-medium">Through (optional)</label><input id="rain-through" type="date" className="input" value={through} min={date} onChange={(e) => { setThrough(e.target.value); setPlan(null) }} /><p className="text-xs text-gray-500 dark:text-slate-400">Push every day up to this one by the same amount — e.g. the rest of the week.</p></div>}
          </div>}
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={skipSundays !== false} disabled={skipSundays === null} onChange={(e) => changeSkipSundays(e.target.checked)} /> Skip Sundays when moving visits <span className="text-xs text-gray-500 dark:text-slate-400">(a push that would land on a Sunday goes to Monday)</span></label>
          {mayText && (
            <div>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={notify} onChange={(e) => { setNotify(e.target.checked); setPlan(null) }} /> Text the customers</label>
              {notify && (
                <>
                  <textarea aria-label="Text to customers" className="input mt-2 w-full" rows={3} placeholder={DEFAULT_TEXT} value={message} onChange={(e) => { setMessage(e.target.value); setPlan(null) }} />
                  <p className="text-xs text-gray-500 dark:text-slate-400">Sent from your business number, between 8:00 and 20:00 your time — later at night waits for the morning. Words in braces fill in: {'{firstName} {company} {oldDay} {newDay} {visits}'}.</p>
                </>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <button onClick={() => run(true)} disabled={busy} className="btn-secondary text-sm flex items-center gap-1 disabled:opacity-50">{busy ? <Loader2 className="w-4 h-4 animate-spin" /> : null} Preview</button>
            {plan && plan.dryRun && plan.wouldMove > 0 && <button onClick={() => run(false)} disabled={busy || (shift === 'date' && !moveTo)} className="btn-primary text-sm disabled:opacity-50">Push {plan.wouldMove} {plan.wouldMove === 1 ? 'job' : 'jobs'}{plan.throughDate ? '' : ` to ${dayWords(plan.toDate)}`}</button>}
          </div>
          {plan && (
            <div className="text-sm space-y-2">
              {plan.skippedSunday && <p className="text-xs text-gray-600 dark:text-slate-300">That would have been a Sunday, so the jobs go to {dayWords(plan.toDate)}.</p>}
              {plan.dryRun && plan.wouldMove === 0 && <p>No open jobs on that day{plan.blocked.length ? ', other than the ones below' : ''}.</p>}
              {plan.jobs.length > 0 && <ul className="divide-y dark:divide-slate-700">{plan.jobs.map((j: any) => <li key={j.id} className="py-1">{plan.throughDate ? `${dayWords(j.from).split(',')[0]} → ${dayWords(j.to).split(',')[0]} · ` : ''}{j.scheduledTime ? `${j.scheduledTime} · ` : ''}{j.title} <span className="text-xs text-gray-500">{j.number}</span></li>)}</ul>}
              {plan.blocked.length > 0 && <div className="text-amber-700 dark:text-amber-400"><p className="font-medium">Left where they are:</p>{plan.blocked.map((b) => <p key={b.id} className="text-xs">{b.title} — {b.reason}</p>)}</div>}
              {plan.overlaps.length > 0 && <p className="text-xs text-amber-700 dark:text-amber-400">{plan.overlaps.length} {plan.overlaps.length === 1 ? 'job lands' : 'jobs land'} at the same time as another job for the same person on {dayWords(plan.toDate)}.</p>}
              {plan.texts && (
                <div className="text-xs text-gray-600 dark:text-slate-300">
                  <p>{plan.dryRun ? `Will text ${plan.texts.willText} ${plan.texts.willText === 1 ? 'customer' : 'customers'}` : `Queued ${plan.texts.queued} ${plan.texts.queued === 1 ? 'text' : 'texts'} — you can cancel them from the customer's scheduled texts`}.</p>
                  {plan.texts.preview[0] && <p className="mt-1 italic">“{plan.texts.preview[0].body}”</p>}
                  {plan.texts.skipped.length > 0 && <p className="mt-1">Not texted: {plan.texts.skipped.map((s) => `${s.name} (${s.reason === 'opted_out' ? 'opted out' : 'no phone number'})`).join(', ')}.</p>}
                </div>
              )}
            </div>
          )}
          {tools && runs.length > 0 && (
            <div className="border-t pt-2 dark:border-slate-700">
              <p className="text-xs font-medium">Recent rain days</p>
              <ul className="mt-1 space-y-1 text-xs">
                {runs.slice(0, 5).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-2">
                    <span>{dayWords(r.fromDate)}{r.throughDate ? ` – ${dayWords(r.throughDate)}` : ''} → {r.toDate ? dayWords(r.toDate) : r.shiftDays === 7 ? 'a week later' : `${r.shiftDays} ${r.shiftDays === 1 ? 'day' : 'days'} later`}</span>
                    <span className="text-gray-500 dark:text-slate-400">{r.status === 'running' ? 'running…' : r.status === 'failed' ? `did not finish${r.error ? ` (${r.error})` : ''}` : r.status === 'undone' ? 'undone' : `${r.moved} moved`}</span>
                    {r.canUndo && <button type="button" className="inline-flex items-center gap-1 text-blue-700 underline dark:text-blue-300" onClick={() => undo(r)}><Undo2 className="w-3 h-3" /> Undo</button>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
