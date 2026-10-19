// Moved from templates/crm-bar/frontend/src/pages/bar/BarSchedulePage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, Dialog } from './registerUi';

/**
 * THE SCHEDULE (routes/barSchedule.ts). A manager (bar:update) builds the week — Monday to Sunday, the timesheet's
 * week — sees the gaps when the bar is open with nobody on, double-bookings, hours and overtime, and the labor
 * cost against what the same days sold the last four weeks, then publishes it. Everyone else sees only the
 * published week, and asks for a day off here. Hours actually worked come from the time clock (/crm/clock).
 */

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (d: string) => { const x = new Date(d + 'T12:00:00Z'); return `${DOW[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const shift = (d: string, n: number) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const clock12 = (t: string) => { const [h, m] = t.split(':').map(Number); const hr = h % 12 === 0 ? 12 : h % 12; return `${hr}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };

export default function BarSchedulePage() {
  const mayBuild = useMayWrite('bar:update');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Schedule</h1>
        <Link to="/crm/clock" className={`${BTN} ${OFF} inline-flex items-center`}>Time clock</Link>
      </div>
      {mayBuild ? <WeekBuilder /> : <PublishedWeeks />}
      <TimeOff />
    </div>
  );
}

function WeekBuilder() {
  const [day, setDay] = useState('');
  const [w, setW] = useState<any>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [edit, setEdit] = useState<any>(null);
  const load = useCallback(async () => {
    try { setW(await api.get(`/api/schedule/week${day ? `?day=${day}` : ''}`)); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the week.')); }
  }, [day]);
  useEffect(() => { load(); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setErr(''); try { await fn(); await load(); } catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(''); } };
  if (!w) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const offShifts = (w.shifts || []).filter((s: any) => s.onTimeOff);
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <button className={`${BTN} ${OFF} px-3`} aria-label="The week before" onClick={() => setDay(shift(w.weekStart, -7))}><ChevronLeft className="w-4 h-4" /></button>
        <p className="font-semibold text-gray-900 dark:text-slate-100">Week of {dayLabel(w.weekStart)}</p>
        <button className={`${BTN} ${OFF} px-3`} aria-label="The week after" onClick={() => setDay(shift(w.weekStart, 7))}><ChevronRight className="w-4 h-4" /></button>
        <span className={`text-sm ${MUTED}`}>{w.published ? `Published${w.unpublishedChanges ? ' · changed since — publish again' : ''}` : 'Not published yet'}</span>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className={CARD}><p className={LABEL}>Wages (planned)</p><p className="text-xl font-bold text-gray-900 dark:text-slate-100">{w.wagesCents === null ? 'Needs every rate' : money(w.wagesCents)}</p></div>
        <div className={CARD}><p className={LABEL}>Sales (same days, last 4 weeks)</p><p className="text-xl font-bold text-gray-900 dark:text-slate-100">{w.salesForecastCents === null ? `${w.forecastDays.known} of ${w.forecastDays.open} days known` : money(w.salesForecastCents)}</p></div>
        <div className={CARD}><p className={LABEL}>Labor</p><p className="text-xl font-bold text-gray-900 dark:text-slate-100">{w.laborPct === null ? '—' : `${w.laborPct}%`}</p></div>
        <div className={CARD}><p className={LABEL}>Gaps</p><p className="text-xl font-bold text-gray-900 dark:text-slate-100">{w.gaps.length}</p></div>
      </div>
      {(w.gaps.length > 0 || w.overlaps.length > 0 || offShifts.length > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100 p-4 text-sm space-y-1">
          {w.gaps.map((g: any, i: number) => <p key={'g' + i}>Nobody on {dayLabel(g.day)} {clock12(g.from)}–{clock12(g.to)}</p>)}
          {w.overlaps.map((o: any, i: number) => <p key={'o' + i}>{o.name} is booked twice on {dayLabel(o.day)}</p>)}
          {/* A shift on a day off that was approved: the cell went red, but the list read before publishing said nothing (Bar Run 1). Its hours and wages still count until it is moved. */}
          {offShifts.map((s: any) => <p key={'t' + s.id}>{s.name} has the day off on {dayLabel(s.day)} but is on {clock12(s.start)}–{clock12(s.end)}. Their hours and wages count until you move it.</p>)}
        </div>
      )}
      <div className={`${CARD} overflow-x-auto`}>
        <table className="w-full text-sm min-w-[720px]">
          <thead>
            <tr className="text-left text-gray-600 dark:text-slate-300">
              <th className="py-2 pr-2">Who</th>
              {w.days.map((d: string) => <th key={d} className="py-2 px-1">{dayLabel(d)}<span className={`block text-xs font-normal ${MUTED}`}>{w.bar[d].open ? `${clock12(w.bar[d].open)}–${clock12(w.bar[d].close)}` : 'Closed'}</span></th>)}
              <th className="py-2 px-1">Hours</th>
            </tr>
          </thead>
          <tbody>
            {w.people.map((p: any) => (
              <tr key={p.userId} className="border-t border-gray-200 dark:border-slate-800 align-top">
                <td className="py-2 pr-2 font-semibold text-gray-900 dark:text-slate-100">{p.name}</td>
                {w.days.map((d: string) => {
                  const mine = w.shifts.filter((s: any) => s.userId === p.userId && s.day === d);
                  const worked = w.actual[p.userId + '|' + d];
                  return (
                    <td key={d} className="py-2 px-1">
                      {mine.map((s: any) => (
                        <button key={s.id} className={`block w-full text-left rounded-lg px-2 py-1 mb-1 text-xs border ${s.onTimeOff ? 'border-red-400 bg-red-50 text-red-900 dark:border-red-700 dark:bg-red-950/40 dark:text-red-100' : 'border-gray-300 bg-white text-gray-900 hover:bg-gray-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:hover:bg-slate-800'}`} onClick={() => setEdit({ ...s })}>
                          {clock12(s.start)}–{clock12(s.end)}{s.position ? ` · ${s.position}` : ''}{s.onTimeOff ? ' · day off' : ''}
                        </button>
                      ))}
                      <button className={`text-xs underline ${MUTED}`} aria-label={`Add a shift for ${p.name} on ${dayLabel(d)}`} onClick={() => setEdit({ userId: p.userId, day: d, start: '16:00', end: 'close' })}><Plus className="w-3 h-3 inline" /></button>
                      {worked !== undefined && <span className={`block text-xs ${MUTED}`}>worked {worked} h</span>}
                    </td>
                  );
                })}
                <td className="py-2 px-1 text-gray-900 dark:text-slate-100">{p.hours}{p.overtime ? <span className="block text-xs font-semibold text-amber-800 dark:text-amber-200">{p.overtime} OT</span> : null}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="flex flex-wrap gap-2 justify-end">
        <button className={`${BTN} ${OFF}`} disabled={!!busy} onClick={() => act('copy', () => api.post('/api/schedule/copy', { fromDay: shift(w.weekStart, -7), toDay: w.weekStart }))}>Copy last week</button>
        <button className={`${BTN} ${ON}`} disabled={!!busy} onClick={() => act('publish', () => api.post('/api/schedule/publish', { day: w.weekStart }))}>Publish this week</button>
      </div>
      {w.timeOff.filter((t: any) => t.status === 'pending').length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Time off asked for</p>
          <ul className="space-y-2">
            {w.timeOff.filter((t: any) => t.status === 'pending').map((t: any) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 text-gray-900 dark:text-slate-100">
                <span>{t.name} · {dayLabel(t.day)}{t.note ? ` · ${t.note}` : ''}</span>
                <span className="flex gap-2">
                  <button className={`${BTN} ${ON} min-h-[40px]`} onClick={() => act(t.id, () => api.put(`/api/schedule/time-off/${t.id}`, { status: 'approved' }))}>Approve</button>
                  <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={() => act(t.id, () => api.put(`/api/schedule/time-off/${t.id}`, { status: 'denied' }))}>Deny</button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {edit && <ShiftDialog shift={edit} people={w.people} days={w.days} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function ShiftDialog({ shift: s0, people, days, onClose, onSaved }: { shift: any; people: any[]; days: string[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(s0);
  const [err, setErr] = useState('');
  const save = async () => {
    setErr('');
    try {
      const b = { userId: f.userId, day: f.day, start: f.start, end: f.end, position: f.position || null, note: f.note || null };
      if (f.id) await api.patch(`/api/schedule/shifts/${f.id}`, b); else await api.post('/api/schedule/shifts', b);
      onSaved();
    } catch (e) { setErr(errorText(e, 'The shift did not save.')); }
  };
  return (
    <Dialog title={f.id ? 'Edit the shift' : 'New shift'} onClose={onClose}>
      <div className="space-y-3">
        <div><label className={LABEL} htmlFor="sh-who">Who</label><select id="sh-who" className={`${INPUT} mt-1`} value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}>{people.map((p) => <option key={p.userId} value={p.userId}>{p.name}</option>)}</select></div>
        <div><label className={LABEL} htmlFor="sh-day">Day</label><select id="sh-day" className={`${INPUT} mt-1`} value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>{days.map((d) => <option key={d} value={d}>{dayLabel(d)}</option>)}</select></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={LABEL} htmlFor="sh-start">Start (16:00 or "open")</label><input id="sh-start" className={`${INPUT} mt-1`} value={f.start} onChange={(e) => setF({ ...f, start: e.target.value })} /></div>
          <div><label className={LABEL} htmlFor="sh-end">End (01:00 or "close")</label><input id="sh-end" className={`${INPUT} mt-1`} value={f.end} onChange={(e) => setF({ ...f, end: e.target.value })} /></div>
        </div>
        <div><label className={LABEL} htmlFor="sh-pos">Position</label><input id="sh-pos" className={`${INPUT} mt-1`} value={f.position || ''} onChange={(e) => setF({ ...f, position: e.target.value })} placeholder="Bar, Grill, Floor" maxLength={30} /></div>
        <FormError message={err} />
        <div className="flex flex-wrap justify-end gap-2">
          {f.id && <button className={`${BTN} ${DANGER}`} onClick={async () => { try { await api.delete(`/api/schedule/shifts/${f.id}`); onSaved(); } catch (e) { setErr(errorText(e, 'Could not delete it.')); } }}>Delete</button>}
          <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
          <button className={`${BTN} ${ON}`} onClick={save}>Save</button>
        </div>
      </div>
    </Dialog>
  );
}

function PublishedWeeks() {
  const [data, setData] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/schedule/published').then(setData).catch((e) => setErr(errorText(e, 'Could not load the schedule.'))); }, []);
  if (!data) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  return (
    <>
      {data.weeks.map((wk: any, i: number) => (
        <section key={wk.weekStart} className={CARD} aria-label={i === 0 ? 'This week' : 'Next week'}>
          <p className={`${LABEL} mb-2`}>{i === 0 ? 'This week' : 'Next week'} · from {dayLabel(wk.weekStart)}</p>
          {!wk.published && <p className={`text-sm ${MUTED}`}>Not published yet.</p>}
          {wk.published && wk.days.map((d: string) => {
            const today = wk.shifts.filter((s: any) => s.day === d);
            return (
              <div key={d} className={`py-2 border-t border-gray-200 dark:border-slate-800 ${d === data.today ? 'font-semibold' : ''}`}>
                <p className="text-sm text-gray-900 dark:text-slate-100">{dayLabel(d)}{d === data.today ? ' · today' : ''}</p>
                {today.length === 0 ? <p className={`text-xs ${MUTED}`}>Nobody scheduled</p> : today.map((s: any, n: number) => <p key={n} className="text-sm text-gray-900 dark:text-slate-100">{s.name}: {clock12(s.start)}–{clock12(s.end)}{s.position ? ` · ${s.position}` : ''}</p>)}
              </div>
            );
          })}
        </section>
      ))}
    </>
  );
}

function TimeOff() {
  const [mine, setMine] = useState<any[] | null>(null);
  const [day, setDay] = useState('');
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const load = useCallback(async () => { try { setMine((await api.get('/api/schedule/time-off/mine')).requests); } catch (e) { setErr(errorText(e, 'Could not load your time off.')); } }, []);
  useEffect(() => { load(); }, [load]);
  return (
    <div className={CARD}>
      <p className={`${LABEL} mb-2`}>My time off</p>
      <form className="flex flex-wrap items-end gap-2" onSubmit={async (e) => { e.preventDefault(); setErr(''); try { await api.post('/api/schedule/time-off', { day, note }); setDay(''); setNote(''); load(); } catch (ex) { setErr(errorText(ex, 'That did not go through.')); } }}>
        <div><label className={LABEL} htmlFor="to-day">Day</label><input id="to-day" type="date" className={`${INPUT} mt-1`} value={day} onChange={(e) => setDay(e.target.value)} /></div>
        <div className="flex-1 min-w-[160px]"><label className={LABEL} htmlFor="to-note">Why (optional)</label><input id="to-note" className={`${INPUT} mt-1`} value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></div>
        <button type="submit" className={`${BTN} ${ON}`} disabled={!day}>Ask for it</button>
      </form>
      <FormError message={err} className="mt-2" />
      <ul className="mt-3 space-y-1 text-sm">
        {mine?.map((r) => <li key={r.id} className="text-gray-900 dark:text-slate-100">{dayLabel(r.day)} · {r.status === 'pending' ? 'asked' : r.status}{r.note ? ` · ${r.note}` : ''}</li>)}
      </ul>
    </div>
  );
}
