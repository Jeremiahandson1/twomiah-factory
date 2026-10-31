// Hours & Time Off (server crm/field/availabilityRoutes.ts, /api/availability): when each tech works and when they are away.
// A tech with no hours set is available any time, as before. The Dispatch Board shows who is off; giving a job to someone
// who is off or outside their hours asks "Book anyway?" first.
import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Loader2, Trash2 } from 'lucide-react'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

interface Hours { weekday: number; startsAt: string; endsAt: string }
interface Off { id: string; from: string; to: string; startTime: string | null; endTime: string | null; note: string | null }
interface Entry { personId: string; hours: Hours[]; timeOff: Off[] }
interface Person { id: string; name: string }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const box = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const btn = 'rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50'
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const when = (o: Off) => `${day(o.from)}${o.to !== o.from ? ` – ${day(o.to)}` : ''}${o.startTime ? `, ${o.startTime}–${o.endTime}` : ', all day'}`

function PersonCard({ person, entry, onChanged, mayEdit }: { person: Person; entry?: Entry; onChanged: () => void; mayEdit: boolean }) {
  const toast = useToast()
  const initial = (): Record<number, { on: boolean; startsAt: string; endsAt: string }> =>
    Object.fromEntries(DAYS.map((_, wd) => { const h = entry?.hours.find((x) => x.weekday === wd); return [wd, { on: !!h, startsAt: h?.startsAt ?? '08:00', endsAt: h?.endsAt ?? '16:00' }] }))
  const [week, setWeek] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState({ from: '', to: '', part: false, startTime: '12:00', endTime: '14:00', note: '' })
  useEffect(() => { setWeek(initial()) }, [entry]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, fallback: string) => toast.error(e instanceof Error && e.message ? e.message : fallback)
  const saveHours = async () => {
    setBusy(true)
    try {
      await api.put(`/api/availability/hours/${person.id}`, { days: DAYS.flatMap((_, wd) => (week[wd].on ? [{ weekday: wd, startsAt: week[wd].startsAt, endsAt: week[wd].endsAt }] : [])) })
      toast.success(`${person.name}'s hours saved`); onChanged()
    } catch (e) { fail(e, 'The hours could not be saved') } finally { setBusy(false) }
  }
  const addOff = async () => {
    setBusy(true)
    try {
      await api.post('/api/availability/time-off', {
        personId: person.id, from: off.from, to: off.to || off.from,
        ...(off.part ? { startTime: off.startTime, endTime: off.endTime } : {}), note: off.note || null,
      })
      setOff({ ...off, from: '', to: '', note: '' }); toast.success('Time off added'); onChanged()
    } catch (e) { fail(e, 'The time off could not be added') } finally { setBusy(false) }
  }
  const removeOff = async (id: string) => {
    try { await api.delete(`/api/availability/time-off/${id}`); onChanged() } catch (e) { fail(e, 'Could not remove it') }
  }
  const set = !!entry?.hours.length

  return (
    <section className={box} aria-label={person.name}>
      <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{person.name}</h2>
      <p className="text-xs text-gray-600 dark:text-slate-300">{set ? 'Has working hours.' : 'No hours set — available any time.'}</p>

      <div className="mt-3 grid gap-1">
        {ORDER.map((wd) => (
          <div key={wd} className="flex flex-wrap items-center gap-2 text-sm text-gray-900 dark:text-slate-100">
            <label className="flex w-32 items-center gap-2">
              <input type="checkbox" disabled={!mayEdit} checked={week[wd].on} onChange={(e) => setWeek({ ...week, [wd]: { ...week[wd], on: e.target.checked } })} />
              {DAYS[wd]}
            </label>
            {week[wd].on
              ? <>
                  <input aria-label={`${DAYS[wd]} start`} type="time" disabled={!mayEdit} className={input} value={week[wd].startsAt} onChange={(e) => setWeek({ ...week, [wd]: { ...week[wd], startsAt: e.target.value } })} />
                  <span>to</span>
                  <input aria-label={`${DAYS[wd]} end`} type="time" disabled={!mayEdit} className={input} value={week[wd].endsAt} onChange={(e) => setWeek({ ...week, [wd]: { ...week[wd], endsAt: e.target.value } })} />
                </>
              : <span className="text-gray-600 dark:text-slate-300">{DAYS.some((_, i) => week[i].on) ? 'Off' : ''}</span>}
          </div>
        ))}
      </div>
      {mayEdit && <button type="button" className={`${btn} mt-3`} disabled={busy} onClick={saveHours}>Save hours</button>}
      {mayEdit && <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">Untick every day to go back to “available any time”.</p>}

      <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-slate-100">Time off</h3>
      {entry?.timeOff.length ? (
        <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-slate-800">
          {entry.timeOff.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-gray-900 dark:text-slate-100">
              <span>{when(o)}{o.note ? <span className="text-gray-600 dark:text-slate-300"> · {o.note}</span> : null}</span>
              {mayEdit && <button type="button" aria-label={`Remove time off ${when(o)}`} onClick={() => removeOff(o.id)} className="text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>}
            </li>
          ))}
        </ul>
      ) : <p className="mt-1 text-sm text-gray-600 dark:text-slate-300">None coming up.</p>}

      {mayEdit && (
        <div className="mt-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="grid gap-1 text-gray-800 dark:text-slate-200">From<input type="date" className={input} value={off.from} onChange={(e) => setOff({ ...off, from: e.target.value })} /></label>
          {!off.part && <label className="grid gap-1 text-gray-800 dark:text-slate-200">To<input type="date" className={input} value={off.to} min={off.from} onChange={(e) => setOff({ ...off, to: e.target.value })} /></label>}
          <label className="flex items-center gap-1 text-gray-800 dark:text-slate-200"><input type="checkbox" checked={off.part} onChange={(e) => setOff({ ...off, part: e.target.checked })} />Part of a day</label>
          {off.part && <>
            <input aria-label="Away from" type="time" className={input} value={off.startTime} onChange={(e) => setOff({ ...off, startTime: e.target.value })} />
            <input aria-label="Away until" type="time" className={input} value={off.endTime} onChange={(e) => setOff({ ...off, endTime: e.target.value })} />
          </>}
          <input aria-label="Note" placeholder="Note (optional)" className={`${input} min-w-[10rem]`} value={off.note} onChange={(e) => setOff({ ...off, note: e.target.value })} />
          <button type="button" className={btn} disabled={busy || !off.from} onClick={addOff}>Add time off</button>
        </div>
      )}
    </section>
  )
}

export default function AvailabilityPage() {
  const { can, known } = usePermissions()
  const mayEdit = !known || can('jobs:dispatch')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    try {
      const [team, mine] = await Promise.all([api.get('/api/team/assignable'), api.get('/api/availability')])
      setPeople((team?.data ?? []).map((t: any) => ({ id: t.id, name: t.name || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() || 'Unnamed' })))
      setEntries(mine?.people ?? [])
    } catch (e) { setError(e instanceof Error && e.message ? e.message : 'Hours and time off could not be loaded.') }
  }, [])
  useEffect(() => { void load() }, [load])

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!people) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-slate-100"><CalendarOff className="h-6 w-6" aria-hidden />Hours &amp; Time Off</h1>
        <p className="text-sm text-gray-600 dark:text-slate-300">Set when each tech works and when they are away. The Dispatch Board shows who is off, and giving a job to someone who is off asks you to confirm first.</p>
      </div>
      {people.length === 0 ? <p className="text-sm text-gray-700 dark:text-slate-300">Add your team first, then set their hours here.</p>
        : people.map((p) => <PersonCard key={p.id} person={p} entry={entries.find((e) => e.personId === p.id)} onChanged={load} mayEdit={mayEdit} />)}
    </div>
  )
}
