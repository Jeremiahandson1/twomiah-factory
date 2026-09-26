// Schedule — the owner builds the week. One row per person, one column per
// day of the workweek (the same week payroll uses). It says what it sees:
// hours the bar is open with nobody on, projected overtime, double-bookings,
// people scheduled on a day they have off, and what the week will cost
// against the sales it usually does. Staff see it on the bar screens once
// it's published; later edits wait for the next Publish.
import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Plus, X } from 'lucide-react'
import { api } from '../api/client'
import { Label, Hint } from '../components/Field'

interface SShift { id: string; pinId: string; name: string; day: string; start: string; end: string; position: string | null; note: string | null; hours: number; onTimeOff: boolean }
interface Person { pinId: string; name: string; hourlyCents: number | null; isActive: boolean; hours: number; overtime: number; wagesCents: number | null }
interface TimeOff { id: string; pinId: string; name: string; day: string; note: string | null; status: string }
interface Week {
  weekStart: string; days: string[]; tz: string; bar: Record<string, { open: string | null; close: string | null }>
  people: Person[]; shifts: SShift[]; timeOff: TimeOff[]; gaps: Array<{ day: string; from: string; to: string; minutes: number }>
  overlaps: Array<{ name: string; day: string }>; wagesCents: number | null; salesForecast: Record<string, number | null>; salesForecastCents: number | null; forecastDays: { known: number; open: number }; laborPct: number | null
  actual: Record<string, number>; published: { at: string; by: string } | null; unpublishedChanges: boolean
  pendingTimeOff: Array<{ id: string; day: string; note: string | null; name: string }>
}

const money = (c: number | null) => (c === null ? '—' : '$' + Math.round(c / 100).toLocaleString('en-US'))
const clock = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); const hr = h % 12 === 0 ? 12 : h % 12; return (m ? `${hr}:${String(m).padStart(2, '0')}` : `${hr}`) + (h < 12 ? ' AM' : ' PM') }
const dayLabel = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric', timeZone: 'UTC' })
const addDays = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10) }
const todayLocal = () => { const d = new Date(); const p = (n: number) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` }
type Msg = { ok: boolean; text: string } | null
const Note = ({ m }: { m: Msg }) => (m ? <div className={'text-sm rounded-lg px-3 py-2 mb-3 border ' + (m.ok ? 'text-emerald-800 bg-emerald-50 border-emerald-200' : 'text-red-700 bg-red-50 border-red-200')} role="status">{m.text}</div> : null)
const POSITIONS = ['Bar', 'Grill', 'Floor', 'Door', 'Dish']

function Editor({ week, shift, preset, onClose, onSaved }: { week: Week; shift: SShift | null; preset: { pinId: string; day: string } | null; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ pinId: shift?.pinId || preset?.pinId || week.people[0]?.pinId || '', day: shift?.day || preset?.day || week.days[0], start: shift?.start || '16:00', end: shift?.end || 'close', position: shift?.position || 'Bar', note: shift?.note || '' })
  const [msg, setMsg] = useState<Msg>(null)
  const bar = week.bar[f.day]
  const save = async () => {
    setMsg(null)
    try {
      const b = { pinId: f.pinId, day: f.day, start: f.start, end: f.end, position: f.position, note: f.note }
      if (shift) await api.patch(`/api/admin/staff-hours/schedule/shifts/${shift.id}`, b); else await api.post('/api/admin/staff-hours/schedule/shifts', b)
      onSaved(); onClose()
    } catch (e: any) { setMsg({ ok: false, text: e.message }) }
  }
  const del = async () => { try { await api.delete(`/api/admin/staff-hours/schedule/shifts/${shift!.id}`); onSaved(); onClose() } catch (e: any) { setMsg({ ok: false, text: e.message }) } }
  const quick = (start: string, end: string) => setF({ ...f, start, end })
  return (
    <aside className="card card-padding" aria-labelledby="ed-h">
      <div className="flex justify-between items-start gap-3 mb-3">
        <h2 id="ed-h" className="text-xl text-ink">{shift ? 'Change a shift' : 'Add a shift'}</h2>
        <button type="button" onClick={onClose} className="btn-secondary btn-sm inline-flex items-center" aria-label="Close"><X className="w-4 h-4" /></button>
      </div>
      <Note m={msg} />
      <div className="grid grid-cols-2 gap-3">
        <div><Label htmlFor="ed-who">Who</Label><select id="ed-who" className="input" value={f.pinId} onChange={(e) => setF({ ...f, pinId: e.target.value })}>{week.people.filter((p) => p.isActive).map((p) => <option key={p.pinId} value={p.pinId}>{p.name}</option>)}</select></div>
        <div><Label htmlFor="ed-day">Day</Label><select id="ed-day" className="input" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{week.days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}</select></div>
        <div className="col-span-2 flex flex-wrap gap-2" role="group" aria-label="Common shifts">
          {bar.open && <button type="button" className="btn-secondary btn-sm" onClick={() => quick('open', '16:00')}>Open to 4 PM</button>}
          {bar.close && <button type="button" className="btn-secondary btn-sm" onClick={() => quick('16:00', 'close')}>4 PM to close</button>}
          {bar.open && bar.close && <button type="button" className="btn-secondary btn-sm" onClick={() => quick('open', 'close')}>Open to close</button>}
          {!bar.open && <span className="text-sm text-muted">The bar is closed this day.</span>}
        </div>
        <div><Label htmlFor="ed-start">Start</Label><input id="ed-start" className="input" value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} placeholder="16:00 or open" /></div>
        <div><Label htmlFor="ed-end">End</Label><input id="ed-end" className="input" value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} placeholder="01:00 or close" /></div>
        <div><Label htmlFor="ed-pos">Position</Label><input id="ed-pos" className="input" list="ed-positions" value={f.position} onChange={(e) => setF({ ...f, position: e.target.value })} /><datalist id="ed-positions">{POSITIONS.map((p) => <option key={p} value={p} />)}</datalist></div>
        <div><Label htmlFor="ed-note">Note</Label><input id="ed-note" className="input" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Packers game" /></div>
      </div>
      <Hint>Times are 24-hour (16:00 is 4 PM). "open" and "close" use that day's bar hours{bar.open ? ` (${clock(bar.open)} to ${clock(bar.close)})` : ''}. An end before the start runs past midnight.</Hint>
      <div className="flex gap-2 mt-3">
        <button type="button" className="btn-primary btn-md" onClick={save}>Save</button>
        {shift && <button type="button" className="btn-secondary btn-md text-red-700" onClick={del}>Remove</button>}
      </div>
    </aside>
  )
}

export function SchedulePage() {
  const [day, setDay] = useState<string>(todayLocal())
  const [w, setW] = useState<Week | null>(null)
  const [open, setOpen] = useState<{ shift: SShift | null; preset: { pinId: string; day: string } | null } | null>(null)
  const [msg, setMsg] = useState<Msg>(null)
  const [confirmReplace, setConfirmReplace] = useState(false)
  const load = (d = day) => api.get<Week>(`/api/admin/staff-hours/schedule?day=${d}`).then(setW).catch((e) => setMsg({ ok: false, text: e.message }))
  useEffect(() => { load(day) }, [day])
  if (!w) return <div className="p-8 max-w-6xl mx-auto"><Note m={msg} />Loading…</div>
  const today = todayLocal()
  const act = async (fn: () => Promise<any>, ok: (r: any) => string) => { setMsg(null); try { const r = await fn(); setMsg({ ok: true, text: ok(r) }); load() } catch (e: any) { if (e.status === 409 && /Replace/.test(e.message)) setConfirmReplace(true); setMsg({ ok: false, text: e.message }) } }
  const copy = (replace: boolean) => act(() => api.post('/api/admin/staff-hours/schedule/copy', { from: addDays(w.weekStart, -7), to: w.weekStart, replace }), (r) => { setConfirmReplace(false); return `Copied ${r.shifts} shifts from last week. Nothing is published until you publish.` })
  const publish = () => act(() => api.post('/api/admin/staff-hours/schedule/publish', { day: w.weekStart }), (r) => `Published: ${r.shifts} shifts. Staff see it on the bar screens (Register → Schedule).`)
  const decide = (id: string, status: 'approved' | 'denied') => act(() => api.post(`/api/admin/staff-hours/schedule/time-off/${id}`, { status }), () => (status === 'approved' ? 'Approved.' : 'Denied.'))
  const off = new Set(w.timeOff.filter((t) => t.status === 'approved').map((t) => t.pinId + '|' + t.day))
  const totalHours = w.people.reduce((n, p) => n + p.hours, 0), totalOt = w.people.reduce((n, p) => n + p.overtime, 0)
  const warnings: string[] = [
    ...w.gaps.map((g) => `Nobody on ${dayLabel(g.day)} ${clock(g.from)} to ${clock(g.to)}.`),
    ...w.overlaps.map((o) => `${o.name} is double-booked on ${dayLabel(o.day)}.`),
    ...w.shifts.filter((s) => s.onTimeOff).map((s) => `${s.name} has ${dayLabel(s.day)} off (approved) but is scheduled.`),
    ...w.people.filter((p) => p.overtime > 0).map((p) => `${p.name} is scheduled ${p.hours} hours: ${p.overtime} would be overtime.`),
  ]
  return (
    <div className="p-8 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
        <div>
          <h1 className="text-3xl text-ink">Schedule</h1>
          <p className="text-muted text-sm mt-1">Week of {dayLabel(w.weekStart)} · {w.published ? `published ${new Date(w.published.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${w.unpublishedChanges ? ' · changes since then are not published' : ''}` : 'not published'}</p>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" className="btn-secondary btn-md inline-flex items-center gap-1" onClick={() => setDay(addDays(w.weekStart, -7))}><ChevronLeft className="w-4 h-4" />Previous</button>
          <button type="button" className="btn-secondary btn-md inline-flex items-center gap-1" onClick={() => setDay(addDays(w.weekStart, 7))}>Next<ChevronRight className="w-4 h-4" /></button>
          <button type="button" className="btn-secondary btn-md" onClick={() => copy(false)}>Copy last week</button>
          <button type="button" className="btn-primary btn-md" onClick={publish} disabled={!!w.published && !w.unpublishedChanges}>{w.published ? (w.unpublishedChanges ? 'Publish changes' : 'Published') : 'Publish'}</button>
        </div>
      </div>
      <Note m={msg} />
      {confirmReplace && <div className="flex gap-2 mb-4"><button type="button" className="btn-secondary btn-md text-red-700" onClick={() => copy(true)}>Yes, replace this week with last week</button><button type="button" className="btn-secondary btn-md" onClick={() => setConfirmReplace(false)}>No</button></div>}

      <div className="grid sm:grid-cols-4 gap-3 mb-4">
        {[['Scheduled', `${totalHours.toFixed(1)} h`, totalOt ? `${totalOt.toFixed(1)} h overtime` : 'no overtime'], ['Wages', money(w.wagesCents), w.wagesCents === null ? 'set rates under Staff hours' : 'projected, before taxes'], ['Sales, usually', money(w.salesForecastCents), w.salesForecastCents === null ? `not enough history yet (${w.forecastDays.known} of ${w.forecastDays.open} open days)` : 'same weekdays, last 4 weeks'], ['Labor', w.laborPct === null ? '—' : w.laborPct.toFixed(1) + '%', 'projected, of sales']].map(([a, b, cc]) => (
          <div key={a} className="card card-padding"><div className="text-xs text-muted uppercase tracking-wide">{a}</div><div className="text-2xl text-ink tabular-nums">{b}</div><div className="text-xs text-muted">{cc}</div></div>
        ))}
      </div>

      {w.pendingTimeOff.length > 0 && (
        <section className="card card-padding mb-4" aria-labelledby="to-h">
          <h2 id="to-h" className="text-sm font-semibold uppercase tracking-wide text-muted mb-2">Asked for a day off</h2>
          <ul className="divide-y divide-line text-sm">{w.pendingTimeOff.map((t) => (
            <li key={t.id} className="py-2 flex flex-wrap items-center justify-between gap-2"><span><strong className="text-ink">{t.name}</strong> · {dayLabel(t.day)}{t.note ? ` · ${t.note}` : ''}</span>
              <span className="flex gap-2"><button type="button" className="btn-primary btn-sm" onClick={() => decide(t.id, 'approved')}>Approve</button><button type="button" className="btn-secondary btn-sm" onClick={() => decide(t.id, 'denied')}>Deny</button></span></li>
          ))}</ul>
        </section>
      )}
      {warnings.length > 0 && (
        <section className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 mb-4" aria-labelledby="wa-h">
          <h2 id="wa-h" className="text-sm font-semibold text-amber-900 mb-1">Before you publish</h2>
          <ul className="text-sm text-amber-900 list-disc pl-5">{warnings.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </section>
      )}

      <div className={open ? 'grid xl:grid-cols-[1fr_380px] gap-4 items-start' : ''}>
        <div className="card overflow-x-auto">
          <table className="w-full text-sm min-w-[860px]">
            <thead>
              <tr className="border-b border-line">
                <th className="p-2 text-left text-muted">Person</th>
                {w.days.map((d) => (
                  <th key={d} className={'p-2 text-left align-top ' + (d === today ? 'bg-paper' : '')}>
                    <div className="text-ink">{dayLabel(d)}</div>
                    <div className="text-xs text-muted font-normal">{w.bar[d].open ? `${clock(w.bar[d].open)}–${clock(w.bar[d].close)}` : 'Closed'}</div>
                    {w.salesForecast[d] !== null && <div className="text-xs text-muted font-normal">usually {money(w.salesForecast[d])}</div>}
                  </th>
                ))}
                <th className="p-2 text-right text-muted">Hours</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {w.people.map((p) => (
                <tr key={p.pinId}>
                  <th scope="row" className="p-2 text-left text-ink font-normal whitespace-nowrap">{p.name}</th>
                  {w.days.map((d) => {
                    const mine = w.shifts.filter((s) => s.pinId === p.pinId && s.day === d)
                    const worked = w.actual[p.pinId + '|' + d]
                    return (
                      <td key={d} className={'p-1.5 align-top ' + (d === today ? 'bg-paper' : '')}>
                        {off.has(p.pinId + '|' + d) && <div className="text-xs text-sky-800 mb-1">day off</div>}
                        {mine.map((s) => (
                          <button key={s.id} type="button" onClick={() => setOpen({ shift: s, preset: null })} className={'block w-full text-left rounded-md border px-2 py-1 mb-1 ' + (s.onTimeOff ? 'border-red-300 bg-red-50' : 'border-line bg-white hover:bg-paper')}>
                            <span className="block text-ink whitespace-nowrap">{clock(s.start)}–{clock(s.end)}</span>
                            <span className="block text-xs text-muted">{s.position || ''}{s.note ? ` · ${s.note}` : ''}</span>
                          </button>
                        ))}
                        {worked !== undefined && d <= today && <div className="text-xs text-emerald-800">worked {worked.toFixed(1)} h</div>}
                        {p.isActive && <button type="button" className="text-muted hover:text-ink rounded p-1" aria-label={`Add a shift for ${p.name} on ${dayLabel(d)}`} onClick={() => setOpen({ shift: null, preset: { pinId: p.pinId, day: d } })}><Plus className="w-4 h-4" /></button>}
                      </td>
                    )
                  })}
                  <td className={'p-2 text-right tabular-nums whitespace-nowrap ' + (p.overtime > 0 ? 'text-amber-700 font-semibold' : '')}>{p.hours.toFixed(1)}{p.overtime > 0 && <div className="text-xs">{p.overtime.toFixed(1)} OT</div>}</td>
                </tr>
              ))}
              {!w.people.length && <tr><td colSpan={9} className="p-6 text-center text-muted">Nobody to schedule yet. Give each person their own PIN and tick "Clocks in" under Staff hours.</td></tr>}
            </tbody>
          </table>
        </div>
        {open && <Editor key={(open.shift?.id || '') + (open.preset?.pinId || '') + (open.preset?.day || '')} week={w} shift={open.shift} preset={open.preset} onClose={() => setOpen(null)} onSaved={() => load()} />}
      </div>
      <p className="text-xs text-muted mt-3">The week is the same workweek payroll uses (set under Staff hours). "Worked" is from the time clock.</p>
    </div>
  )
}
