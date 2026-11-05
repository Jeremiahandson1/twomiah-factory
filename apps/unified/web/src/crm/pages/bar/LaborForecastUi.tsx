import { useCallback, useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { api } from '../../../api';
import FormError, { errorText } from '../../ui/FormError';
import { BTN, ON, CARD, LABEL, INPUT, MUTED, money } from './registerUi';

/**
 * SALES FORECAST AND STAFFING, beside the week being built (feature bar_labor_forecast; server crm/bar/barLaborForecast.ts, GET
 * /api/schedule/labor-forecast). Sales by day and hour are the register's average for the same weekday and hour, with how many days
 * it was made from; with too few days it says so instead of giving a number. Booked events are listed apart. The staffing is the hours
 * per position that fit the target labor percent, against the hours on the schedule now. It schedules nobody.
 */
interface Position { position: string; suggestedHours: number | null; scheduledHours: number; differenceHours: number | null }
interface DayRow {
  day: string; open: boolean; scheduledHours: number; scheduledWagesCents: number | null; laborPct: number | null
  forecast: null | { samples: number; weeksLookedBack: number; totalCents: number | null; notEnoughHistory: boolean; reason: string | null; hours: Array<{ hour: number; cents: number }> }
  events: Array<{ id: string; name: string; startTime: string | null; endTime: string | null; guests: number | null; quotedCents: number | null }>
  staffing: null | { budgetCents: number; totalHours: number; positions: Position[] }
}
interface Forecast {
  weekStart: string; settings: { targetPct: number; weeks: number }; notes: string[]; days: DayRow[]
  totals: { salesCents: number | null; daysKnown: number; daysOpen: number; budgetCents: number | null; scheduledWagesCents: number | null; laborPct: number | null }
}

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const dayLabel = (d: string) => { const x = new Date(`${d}T12:00:00Z`); return `${DOW[x.getUTCDay()]} ${x.getUTCMonth() + 1}/${x.getUTCDate()}`; };
const hourLabel = (h: number) => `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'AM' : 'PM'}`;
const clock12 = (t: string | null) => { if (!t) return ''; const [h, m] = t.split(':').map(Number); return `${h % 12 === 0 ? 12 : h % 12}${m ? ':' + String(m).padStart(2, '0') : ''} ${h < 12 ? 'AM' : 'PM'}`; };
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;

export default function LaborForecast({ weekStart, version }: { weekStart: string; version: string }) {
  const [f, setF] = useState<Forecast | null>(null);
  const [err, setErr] = useState('');
  const [target, setTarget] = useState('');
  const [weeks, setWeeks] = useState('');
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const load = useCallback(() => api.get(`/api/schedule/labor-forecast?day=${weekStart}`).then((x: Forecast) => { setF(x); setTarget(String(x.settings.targetPct)); setWeeks(String(x.settings.weeks)); setErr(''); }).catch((e: unknown) => setErr(errorText(e, 'Could not work out the forecast.'))), [weekStart]);
  // The suggestion sits beside the schedule: it is read again whenever a shift is added, moved or removed.
  useEffect(() => { load(); }, [load, version]);
  const save = async () => {
    setBusy(true); setErr(''); setSaved(false);
    try { await api.put('/api/schedule/labor-forecast/settings', { targetPct: target, weeks: Number(weeks) }); setSaved(true); await load(); } catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
  };
  if (!f) return err ? <FormError message={err} /> : <Loader2 className="w-5 h-5 animate-spin text-gray-500" />;
  const t = f.totals;
  return (
    <section className={`${CARD} space-y-3`} aria-label="Sales forecast and staffing">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className={LABEL}>Sales forecast and staffing</p>
          <p className="text-sm text-gray-900 dark:text-slate-100">
            {t.salesCents === null
              ? `Not enough history for the whole week: ${t.daysKnown} of ${t.daysOpen} open days have a forecast.`
              : `${money(t.salesCents)} forecast for the week. At ${f.settings.targetPct}% labor that is ${money(t.budgetCents)} of wages; the schedule is ${t.scheduledWagesCents === null ? 'missing a pay rate' : `${money(t.scheduledWagesCents)}${t.laborPct !== null ? ` (${t.laborPct}%)` : ''}`}.`}
          </p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          <div><label className={LABEL} htmlFor="lftarget">Target labor %</label><input id="lftarget" inputMode="decimal" className={`${INPUT} w-24`} value={target} onChange={(e) => setTarget(e.target.value)} /></div>
          <div><label className={LABEL} htmlFor="lfweeks">Weeks back</label><input id="lfweeks" inputMode="numeric" className={`${INPUT} w-20`} value={weeks} onChange={(e) => setWeeks(e.target.value)} /></div>
          <button type="button" className={`${BTN} ${ON}`} disabled={busy} onClick={save}>{busy ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {saved && <p role="status" className="text-sm text-green-800 dark:text-green-300">Saved.</p>}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
        {f.days.map((d) => (
          <div key={d.day} className="rounded-xl border border-gray-200 dark:border-slate-800 p-3 space-y-2">
            <div className="flex items-baseline justify-between gap-2">
              <p className="font-semibold text-gray-900 dark:text-slate-100">{dayLabel(d.day)}</p>
              <p className="text-sm font-mono text-gray-900 dark:text-slate-100">{!d.open ? 'Closed' : d.forecast?.totalCents == null ? '—' : money(d.forecast.totalCents)}</p>
            </div>
            {d.open && d.forecast && (d.forecast.notEnoughHistory
              ? <p className="text-sm text-amber-900 dark:text-amber-200">{d.forecast.reason}</p>
              : <>
                <p className={`text-xs ${MUTED}`}>Average of the last {d.forecast.samples} {d.forecast.samples === 1 ? 'day' : 'same weekdays'} with sales (looking back {d.forecast.weeksLookedBack} weeks).</p>
                <ul className="space-y-0.5" aria-label={`Sales by hour on ${dayLabel(d.day)}`}>
                  {d.forecast.hours.map((h) => {
                    const peak = Math.max(1, ...d.forecast!.hours.map((x) => x.cents));
                    return (
                      <li key={h.hour} className="flex items-center gap-2 text-xs text-gray-900 dark:text-slate-100">
                        <span className="w-12 shrink-0">{hourLabel(h.hour)}</span>
                        <span className="h-2 rounded bg-orange-500/70" style={{ width: `${Math.max(2, Math.round((h.cents / peak) * 100))}%`, maxWidth: '60%' }} aria-hidden="true" />
                        <span className="font-mono">{money(h.cents)}</span>
                      </li>
                    );
                  })}
                </ul>
              </>)}
            {d.events.length > 0 && (
              <div className="text-xs text-gray-900 dark:text-slate-100">
                {d.events.map((e) => <p key={e.id}>Booked: {e.name}{e.startTime ? `, ${clock12(e.startTime)}${e.endTime ? `–${clock12(e.endTime)}` : ''}` : ''}{e.guests ? `, ${e.guests} guests` : ''}{e.quotedCents ? `, quoted ${money(e.quotedCents)}` : ''}</p>)}
                <p className={MUTED}>Events are not in the average above. Plan extra hands for them yourself.</p>
              </div>
            )}
            {d.staffing ? (
              <table className="w-full text-xs">
                <thead><tr className="text-left text-gray-600 dark:text-slate-300"><th className="py-1">Position</th><th className="py-1">Fits {f.settings.targetPct}%</th><th className="py-1">Scheduled</th><th className="py-1">Difference</th></tr></thead>
                <tbody>
                  {d.staffing.positions.map((p) => (
                    <tr key={p.position} className="border-t border-gray-100 dark:border-slate-800 text-gray-900 dark:text-slate-100">
                      <td className="py-1">{p.position}</td><td className="py-1">{p.suggestedHours === null ? '—' : `${p.suggestedHours} h`}</td><td className="py-1">{p.scheduledHours} h</td>
                      <td className={`py-1 ${p.differenceHours !== null && p.differenceHours > 0 ? 'text-amber-800 dark:text-amber-200 font-semibold' : ''}`}>{p.differenceHours === null ? '—' : `${signed(p.differenceHours)} h`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : d.open && d.forecast && !d.forecast.notEnoughHistory ? <p className={`text-xs ${MUTED}`}>No staffing suggestion yet: it needs shifts with a position and a pay rate from the weeks before.</p> : null}
            {d.open && d.forecast?.totalCents ? <p className={`text-xs ${MUTED}`}>Scheduled {d.scheduledHours} h{d.scheduledWagesCents !== null ? `, ${money(d.scheduledWagesCents)}` : ', a pay rate is missing'}{d.laborPct !== null ? `, ${d.laborPct}% of the forecast` : ''}.</p> : null}
          </div>
        ))}
      </div>
      {f.notes.map((n) => <p key={n} className={`text-xs ${MUTED}`}>{n}</p>)}
    </section>
  );
}
