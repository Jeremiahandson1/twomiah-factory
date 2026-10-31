// Hours & Time Off (server crm/field/availabilityRoutes.ts, /api/availability): when each tech works and when they are away.
// A tech with no shifts is available any time, as before. Shifts are windows on a weekday (ServiceTitan's shift types):
// several a day is a split shift, "on call" is drawn apart on the Dispatch Board and offered after regular hours by Find
// a time, an overnight shift ends on the next day, and a shift with a first and last day is a pattern that runs only
// between them. Shifts copy from one person to others; several people's clear at once. Time off can go on the
// timesheet. Giving a job to someone who is off or outside their hours asks "Book anyway?" first.
import { useCallback, useEffect, useState } from 'react'
import { CalendarOff, Copy, Loader2, Plus, Trash2 } from 'lucide-react'
import { ConfirmModal, Modal } from '@twomiah/tenant-ui/src/invoicing/ui'
import { api } from '../../api'
import { useToast, usePermissions } from '../../shared'

type ShiftKind = 'regular' | 'on_call'
interface Shift { weekday: number; startsAt: string; endsAt: string; kind: ShiftKind; endsNextDay: boolean; from: string | null; to: string | null }
interface Off { id: string; from: string; to: string; startTime: string | null; endTime: string | null; note: string | null; timesheet: boolean }
interface Entry { personId: string; shifts: Shift[]; timeOff: Off[] }
interface Person { id: string; name: string; kind: 'user' | 'member' }

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const ORDER = [1, 2, 3, 4, 5, 6, 0]
const KINDS: Array<{ value: ShiftKind; label: string }> = [{ value: 'regular', label: 'Regular' }, { value: 'on_call', label: 'On call' }]
const box = 'rounded-xl border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900'
const input = 'rounded-lg border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100'
const btn = 'rounded-lg bg-blue-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-800 disabled:opacity-50'
const quiet = 'inline-flex items-center gap-1 rounded-lg border border-gray-300 px-2.5 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-slate-200 dark:hover:bg-slate-800'
const day = (iso: string) => new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const when = (o: Off) => `${day(o.from)}${o.to !== o.from ? ` – ${day(o.to)}` : ''}${o.startTime ? `, ${o.startTime}–${o.endTime}` : ', all day'}`
const clock = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''} ${h < 12 ? 'am' : 'pm'}` }
/** "Mon 8 am–4 pm", "Fri 10 pm–6 am (overnight)", "Sat 9 am–1 pm, on call, Dec 5 – Dec 19" */
const shiftWords = (s: Shift) => `${DAYS[s.weekday].slice(0, 3)} ${clock(s.startsAt)}–${clock(s.endsAt)}${s.endsNextDay ? ' (overnight)' : ''}${s.kind === 'on_call' ? ', on call' : ''}${s.from || s.to ? `, ${s.from ? day(s.from) : 'always'} – ${s.to ? day(s.to) : 'onwards'}` : ''}`
const blank = (weekday = 1): Shift => ({ weekday, startsAt: '08:00', endsAt: '16:00', kind: 'regular', endsNextDay: false, from: null, to: null })
const sortShifts = (list: Shift[]) => [...list].sort((a, b) => ORDER.indexOf(a.weekday) - ORDER.indexOf(b.weekday) || a.startsAt.localeCompare(b.startsAt))

function PersonCard({ person, entry, people, onChanged, mayEdit, picked, onPick }: { person: Person; entry?: Entry; people: Person[]; onChanged: () => void; mayEdit: boolean; picked: boolean; onPick: (v: boolean) => void }) {
  const toast = useToast()
  const [shifts, setShifts] = useState<Shift[]>(() => sortShifts(entry?.shifts ?? []))
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [off, setOff] = useState({ from: '', to: '', part: false, startTime: '12:00', endTime: '14:00', note: '', timesheet: false })
  const [copyOpen, setCopyOpen] = useState(false)
  const [copyTo, setCopyTo] = useState<string[]>([])
  const [removeOff, setRemoveOff] = useState<Off | null>(null)
  useEffect(() => { setShifts(sortShifts(entry?.shifts ?? [])); setDirty(false) }, [entry]) // eslint-disable-line react-hooks/exhaustive-deps

  const fail = (e: unknown, fallback: string) => toast.error(e instanceof Error && e.message ? e.message : fallback)
  const edit = (i: number, patch: Partial<Shift>) => { setShifts((list) => list.map((s, j) => (j === i ? { ...s, ...patch } : s))); setDirty(true) }
  const remove = (i: number) => { setShifts((list) => list.filter((_, j) => j !== i)); setDirty(true) }
  const add = () => { setShifts((list) => [...list, blank(list.length ? list[list.length - 1].weekday : 1)]); setDirty(true) }
  const saveShifts = async () => {
    setBusy(true)
    try {
      await api.put(`/api/availability/hours/${person.id}`, { shifts: shifts.map((s) => ({ ...s, from: s.from || null, to: s.to || null })) })
      toast.success(shifts.length ? `${person.name}'s shifts saved` : `${person.name} is available any time`); setDirty(false); onChanged()
    } catch (e) { fail(e, 'The shifts could not be saved') } finally { setBusy(false) }
  }
  const copy = async () => {
    setBusy(true)
    try {
      const r: any = await api.post('/api/availability/hours/copy', { fromPersonId: person.id, toPersonIds: copyTo })
      toast.success(r?.message || 'Shifts copied'); setCopyOpen(false); setCopyTo([]); onChanged()
    } catch (e) { fail(e, 'The shifts could not be copied') } finally { setBusy(false) }
  }
  const addOff = async () => {
    setBusy(true)
    try {
      const r: any = await api.post('/api/availability/time-off', {
        personId: person.id, from: off.from, to: off.to || off.from,
        ...(off.part ? { startTime: off.startTime, endTime: off.endTime } : {}), note: off.note || null,
        ...(off.timesheet && person.kind === 'user' ? { timesheet: true } : {}),
      })
      setOff({ ...off, from: '', to: '', note: '' })
      toast.success(r?.timesheetEntries ? `Time off added, ${r.timesheetEntries} timesheet ${r.timesheetEntries === 1 ? 'entry' : 'entries'} made` : 'Time off added'); onChanged()
    } catch (e) { fail(e, 'The time off could not be added') } finally { setBusy(false) }
  }
  const doRemoveOff = async () => {
    const o = removeOff; setRemoveOff(null)
    if (!o) return
    try { await api.delete(`/api/availability/time-off/${o.id}`); toast.success('Time off removed'); onChanged() } catch (e) { fail(e, 'Could not remove it') }
  }
  const set = !!entry?.shifts.length
  const others = people.filter((p) => p.id !== person.id)

  return (
    <section className={box} aria-label={person.name} data-person={person.id}>
      <div className="flex flex-wrap items-center gap-2">
        {mayEdit && <input type="checkbox" aria-label={`Select ${person.name}`} checked={picked} onChange={(e) => onPick(e.target.checked)} />}
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{person.name}</h2>
        <p className="text-xs text-gray-600 dark:text-slate-300">{set ? `${entry!.shifts.length} shift${entry!.shifts.length === 1 ? '' : 's'} a week.` : 'No shifts set — available any time.'}</p>
        {mayEdit && set && others.length > 0 && (
          <button type="button" className={`${quiet} ml-auto`} onClick={() => setCopyOpen(true)} data-copy-from={person.id}><Copy className="h-3.5 w-3.5" />Copy shifts to…</button>
        )}
      </div>

      <div className="mt-3 overflow-x-auto">
        {shifts.length > 0 && (
          <table className="w-full text-sm text-gray-900 dark:text-slate-100" data-shifts={person.id}>
            <thead><tr className="text-left text-xs text-gray-600 dark:text-slate-300"><th className="py-1 pr-2 font-medium">Day</th><th className="py-1 pr-2 font-medium">From</th><th className="py-1 pr-2 font-medium">To</th><th className="py-1 pr-2 font-medium">Kind</th><th className="py-1 pr-2 font-medium">Overnight</th><th className="py-1 pr-2 font-medium">First day</th><th className="py-1 pr-2 font-medium">Last day</th><th /></tr></thead>
            <tbody>
              {shifts.map((s, i) => (
                <tr key={i} className="border-t border-gray-100 dark:border-slate-800">
                  <td className="py-1 pr-2"><select aria-label="Day" disabled={!mayEdit} className={input} value={s.weekday} onChange={(e) => edit(i, { weekday: Number(e.target.value) })}>{ORDER.map((wd) => <option key={wd} value={wd}>{DAYS[wd]}</option>)}</select></td>
                  <td className="py-1 pr-2"><input aria-label="Starts" type="time" disabled={!mayEdit} className={input} value={s.startsAt} onChange={(e) => edit(i, { startsAt: e.target.value })} /></td>
                  <td className="py-1 pr-2"><input aria-label="Ends" type="time" disabled={!mayEdit} className={input} value={s.endsAt} onChange={(e) => edit(i, { endsAt: e.target.value })} /></td>
                  <td className="py-1 pr-2"><select aria-label="Kind" disabled={!mayEdit} className={input} value={s.kind} onChange={(e) => edit(i, { kind: e.target.value as ShiftKind })}>{KINDS.map((k) => <option key={k.value} value={k.value}>{k.label}</option>)}</select></td>
                  <td className="py-1 pr-2 text-center"><input aria-label="Ends the next day" type="checkbox" disabled={!mayEdit} checked={s.endsNextDay} onChange={(e) => edit(i, { endsNextDay: e.target.checked })} /></td>
                  <td className="py-1 pr-2"><input aria-label="First day" type="date" disabled={!mayEdit} className={input} value={s.from || ''} onChange={(e) => edit(i, { from: e.target.value || null })} /></td>
                  <td className="py-1 pr-2"><input aria-label="Last day" type="date" disabled={!mayEdit} className={input} value={s.to || ''} min={s.from || undefined} onChange={(e) => edit(i, { to: e.target.value || null })} /></td>
                  <td className="py-1">{mayEdit && <button type="button" aria-label={`Remove shift ${shiftWords(s)}`} onClick={() => remove(i)} className="text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {!shifts.length && <p className="text-sm text-gray-600 dark:text-slate-300">{mayEdit ? 'Add a shift to set when they work.' : 'No shifts.'}</p>}
      </div>
      {mayEdit && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button type="button" className={quiet} onClick={add} data-add-shift={person.id}><Plus className="h-3.5 w-3.5" />Add shift</button>
          <button type="button" className={btn} disabled={busy || !dirty} onClick={saveShifts}>Save shifts</button>
          <p className="text-xs text-gray-600 dark:text-slate-300">Two shifts on one day is a split shift. An overnight shift ends on the next day. A first or last day makes a pattern that runs only between them. Remove every shift to go back to “available any time”.</p>
        </div>
      )}

      <h3 className="mt-5 text-sm font-semibold text-gray-900 dark:text-slate-100">Time off</h3>
      {entry?.timeOff.length ? (
        <ul className="mt-1 divide-y divide-gray-100 text-sm dark:divide-slate-800">
          {entry.timeOff.map((o) => (
            <li key={o.id} className="flex items-center justify-between gap-2 py-1.5 text-gray-900 dark:text-slate-100">
              <span>{when(o)}{o.note ? <span className="text-gray-600 dark:text-slate-300"> · {o.note}</span> : null}{o.timesheet ? <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700 dark:bg-slate-800 dark:text-slate-300">On the timesheet</span> : null}</span>
              {mayEdit && <button type="button" aria-label={`Remove time off ${when(o)}`} onClick={() => setRemoveOff(o)} className="text-red-700 dark:text-red-300"><Trash2 className="h-4 w-4" /></button>}
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
          {person.kind === 'user' && <label className="flex items-center gap-1 text-gray-800 dark:text-slate-200" title="A timesheet entry a day, for the day's regular hours (or part of a day, that long), not billable, waiting for approval"><input type="checkbox" checked={off.timesheet} onChange={(e) => setOff({ ...off, timesheet: e.target.checked })} />Put it on the timesheet</label>}
          <button type="button" className={btn} disabled={busy || !off.from} onClick={addOff}>Add time off</button>
        </div>
      )}

      <Modal isOpen={copyOpen} onClose={() => setCopyOpen(false)} title={`Copy ${person.name}'s shifts`} size="md">
        <p className="text-sm text-gray-700 dark:text-slate-300">Their {shifts.length} shift{shifts.length === 1 ? '' : 's'} replace whatever these people have now.</p>
        <ul className="mt-3 max-h-64 space-y-1 overflow-y-auto text-sm text-gray-900 dark:text-slate-100">
          {others.map((p) => (
            <li key={p.id}><label className="flex items-center gap-2"><input type="checkbox" checked={copyTo.includes(p.id)} onChange={(e) => setCopyTo(e.target.checked ? [...copyTo, p.id] : copyTo.filter((x) => x !== p.id))} />{p.name}</label></li>
          ))}
        </ul>
        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={quiet} onClick={() => setCopyOpen(false)}>Cancel</button>
          <button type="button" className={btn} disabled={busy || !copyTo.length} onClick={copy}>Copy to {copyTo.length || ''} {copyTo.length === 1 ? 'person' : 'people'}</button>
        </div>
      </Modal>
      <ConfirmModal isOpen={!!removeOff} onClose={() => setRemoveOff(null)} onConfirm={doRemoveOff} title="Remove time off"
        message={removeOff ? `Remove ${person.name}'s time off, ${when(removeOff)}?${removeOff.timesheet ? ' Its timesheet entries go with it, except any already approved.' : ''}` : ''} confirmText="Remove" />
    </section>
  )
}

export default function AvailabilityPage() {
  const toast = useToast()
  const { can, known } = usePermissions()
  const mayEdit = !known || can('jobs:dispatch')
  const [people, setPeople] = useState<Person[] | null>(null)
  const [entries, setEntries] = useState<Entry[]>([])
  const [error, setError] = useState('')
  const [picked, setPicked] = useState<string[]>([])
  const [clearOpen, setClearOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [team, mine] = await Promise.all([api.get('/api/team/assignable'), api.get('/api/availability')])
      setPeople((team?.data ?? []).map((t: any) => ({ id: t.id, name: t.name || `${t.firstName ?? ''} ${t.lastName ?? ''}`.trim() || 'Unnamed', kind: t.kind === 'member' ? 'member' : 'user' })))
      setEntries(mine?.people ?? [])
    } catch (e) { setError(e instanceof Error && e.message ? e.message : 'Hours and time off could not be loaded.') }
  }, [])
  useEffect(() => { void load() }, [load])

  const clearPicked = async () => {
    setClearOpen(false)
    try {
      const r: any = await api.post('/api/availability/hours/clear', { personIds: picked })
      toast.success(r?.message || 'Shifts cleared'); setPicked([]); void load()
    } catch (e) { toast.error(e instanceof Error && e.message ? e.message : 'The shifts could not be cleared') }
  }

  if (error) return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-800 dark:bg-red-950/40 dark:text-red-200">{error}</div>
  if (!people) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-gray-500 dark:text-slate-300" /></div>

  return (
    <div className="space-y-4">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-bold text-gray-900 dark:text-slate-100"><CalendarOff className="h-6 w-6" aria-hidden />Hours &amp; Time Off</h1>
        <p className="text-sm text-gray-600 dark:text-slate-300">Set each tech's shifts and time off. The Dispatch Board draws them on a time axis, Find a time offers slots inside them, and giving a job to someone who is off asks you to confirm first.</p>
      </div>
      {mayEdit && people.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm text-gray-700 dark:text-slate-300">
          <button type="button" className={quiet} onClick={() => setPicked(picked.length === people.length ? [] : people.map((p) => p.id))}>{picked.length === people.length ? 'Select nobody' : 'Select everyone'}</button>
          <button type="button" className={`${quiet} text-red-700 dark:text-red-300`} disabled={!picked.length} onClick={() => setClearOpen(true)} data-clear-shifts=""><Trash2 className="h-3.5 w-3.5" />Clear shifts for {picked.length || ''} selected</button>
        </div>
      )}
      {people.length === 0 ? <p className="text-sm text-gray-700 dark:text-slate-300">Add your team first, then set their shifts here.</p>
        : people.map((p) => <PersonCard key={p.id} person={p} people={people} entry={entries.find((e) => e.personId === p.id)} onChanged={load} mayEdit={mayEdit} picked={picked.includes(p.id)} onPick={(v) => setPicked(v ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />)}
      <ConfirmModal isOpen={clearOpen} onClose={() => setClearOpen(false)} onConfirm={clearPicked} title="Clear shifts"
        message={`Clear every shift for ${picked.length} ${picked.length === 1 ? 'person' : 'people'}? They become available any time. Time off stays.`} confirmText="Clear shifts" />
    </div>
  )
}
