import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Loader2, Undo2, Check } from 'lucide-react';
import api from '../../services/api';
import FormError, { errorText } from '../../components/ui/FormError';
import { BTN, ON, OFF, CARD, LABEL, MUTED, useLive } from './registerUi';

/**
 * THE GRILL SCREEN — the wall tablet by the charbroiler. Every food order from the register, in the order it
 * came in, with where it goes ("Bar seat 6 · Mike", "Booth 2"), how long it has waited, and the cue that paces
 * it so the plate comes together hot ("Cheddarburger on now · Fries in 6"). Bump when it's up; recall a mis-tap.
 *
 * The server works out the pacing, the cues and the waiting/late states (services/barKitchen.ts with
 * barPacing.ts) and this screen only counts its clocks forward between refreshes. Any signed-in device with
 * bar:register can be the grill screen — if the tablet dies, open /crm/grill on another one.
 */

interface Item { key: string; name: string; variation: string | null; qty: number; note: string | null; seat: number | null; prepSeconds: number; startAt: number }
interface Ticket { id: string; label: string; source: string; note: string | null; firedAt: number; recalled: boolean; readyAt: number; cue: { text: string; state: 'start' | 'wait' | 'plate' }; age: 'fresh' | 'warn' | 'late'; items: Item[] }
interface State { serverNow: number; warnSeconds: number; lateSeconds: number; open: Ticket[]; bumped: Array<{ id: string; label: string; bumpedAt: number }>; startNow: Array<{ name: string; qty: number }>; allDay: Array<{ name: string; qty: number }> }

// The state is shown as a word as well as a colour, never colour alone.
const AGE: Record<Ticket['age'], { word: string; cls: string }> = {
  fresh: { word: 'New', cls: 'border-gray-300 dark:border-slate-700' },
  warn: { word: 'Waiting', cls: 'border-amber-500 dark:border-amber-400' },
  late: { word: 'Late', cls: 'border-red-600 dark:border-red-400' },
};
const AGE_BADGE: Record<Ticket['age'], string> = {
  fresh: 'bg-gray-100 text-gray-800 dark:bg-slate-800 dark:text-slate-100',
  warn: 'bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100',
  late: 'bg-red-100 text-red-900 dark:bg-red-900/50 dark:text-red-100',
};

function mmss(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function GrillPage() {
  const [state, setState] = useState<State | null>(null);
  const [skew, setSkew] = useState(0);         // server clock − this device's clock
  const [now, setNow] = useState(Date.now());
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');

  const load = useCallback(async () => {
    try {
      const s: State = await api.get('/api/grill/state');
      setState(s); setSkew(s.serverNow - Date.now()); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not reach the server. Retrying…')); }
  }, []);
  useEffect(() => { load(); }, [load]);
  useLive('bar:kitchen', load, 10000);
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr('');
    try { await fn(); await load(); } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); } finally { setBusy(''); }
  };

  if (!state) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const at = now + skew;

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Grill</h1>
        <Link to="/crm/register" className={`${BTN} ${OFF} inline-flex items-center`}>Register</Link>
      </div>
      <FormError message={err} />

      {(state.startNow.length > 0 || state.allDay.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className={CARD}>
            <p className={LABEL}>On now</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100 mt-1">{state.startNow.length ? state.startNow.map((x) => `${x.qty} ${x.name}`).join(' · ') : 'Nothing to start'}</p>
          </div>
          <div className={CARD}>
            <p className={LABEL}>All day</p>
            <p className="text-lg font-semibold text-gray-900 dark:text-slate-100 mt-1">{state.allDay.map((x) => `${x.qty} ${x.name}`).join(' · ')}</p>
          </div>
        </div>
      )}

      {state.open.length === 0 && <div className={`${CARD} text-center py-12`}><p className={`text-lg ${MUTED}`}>No tickets. All caught up.</p></div>}

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
        {state.open.map((t) => {
          const waited = at - t.firedAt;
          // The age between refreshes, counted here with the server's thresholds.
          const age: Ticket['age'] = waited >= state.lateSeconds * 1000 ? 'late' : waited >= state.warnSeconds * 1000 ? 'warn' : t.age;
          return (
            <article key={t.id} className={`bg-white dark:bg-slate-900 rounded-2xl border-2 p-4 ${AGE[age].cls}`} aria-label={`Ticket for ${t.label}`}>
              <header className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-lg font-bold text-gray-900 dark:text-slate-100 truncate">{t.label}</p>
                  <p className={`text-xs ${MUTED}`}>{t.source === 'web' ? 'Website' : t.source === 'table' ? 'Table' : 'Bar'}{t.recalled ? ' · recalled' : ''}</p>
                </div>
                <span className={`text-sm font-semibold px-2 py-1 rounded-lg ${AGE_BADGE[age]}`}>{AGE[age].word} {mmss(waited)}</span>
              </header>
              <ul className="mt-3 space-y-1">
                {t.items.map((i) => {
                  const due = i.startAt - at;
                  return (
                    <li key={i.key} className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-lg font-semibold text-gray-900 dark:text-slate-100">{i.qty > 1 ? `${i.qty} × ` : ''}{i.name}{i.variation ? ` (${i.variation})` : ''}</p>
                        {(i.note || i.seat) && <p className="text-sm text-gray-800 dark:text-slate-200">{[i.seat ? `Seat ${i.seat}` : null, i.note].filter(Boolean).join(' · ')}</p>}
                      </div>
                      <span className={`text-sm whitespace-nowrap ${MUTED}`}>{due > 15000 ? `in ${Math.ceil(due / 60000)}` : 'now'}</span>
                    </li>
                  );
                })}
              </ul>
              {t.note && <p className="mt-2 text-sm font-semibold text-red-800 dark:text-red-300">{t.note}</p>}
              <p className={`mt-3 text-base font-semibold ${t.cue.state === 'plate' ? 'text-green-800 dark:text-green-300' : 'text-gray-900 dark:text-slate-100'}`}>{t.cue.text}</p>
              <button className={`${BTN} ${ON} w-full mt-3 min-h-[56px] text-base inline-flex items-center justify-center gap-2`} disabled={!!busy}
                onClick={() => act(t.id, () => api.post('/api/grill/bump', { id: t.id }))}>
                <Check className="w-5 h-5" />Up
              </button>
            </article>
          );
        })}
      </div>

      {state.bumped.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Just went up</p>
          <div className="flex flex-wrap gap-2">
            {state.bumped.map((b) => (
              <button key={b.id} className={`${BTN} ${OFF} inline-flex items-center gap-2`} disabled={!!busy} onClick={() => act(b.id, () => api.post('/api/grill/recall', { id: b.id }))}>
                <Undo2 className="w-4 h-4" />Bring back {b.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
