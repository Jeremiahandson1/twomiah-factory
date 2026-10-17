import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, CalendarDays, Trophy, Repeat, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useMayWrite } from '../../shared';
import FormError, { errorText } from '../../components/ui/FormError';

/**
 * WHAT'S ON — the public calendar the website shows (trivia, live music, the fish fry), the games worth
 * coming in for (a featured one goes on the Tonight board), and the weekly specials (Taco Tuesday). One-off
 * "tonight's special" is posted from the Tonight console instead.
 *
 * Posting an event or a game is the console's (bar:console); editing and removing an event is a manager's.
 */

interface Ev { id: string; title: string; description: string | null; startsAt: string; endsAt: string | null; isRecurring: boolean; recurrenceDays: string | null; isPublished: boolean }
interface Game { id: string; league: string; home: string; away: string; startsAt: string; isFeatured: boolean; note: string | null }
interface Special { id: string; title: string; description: string | null; priceCents: number | null; startsAt: string; isRecurring: boolean; recurrenceDays: string | null }

const DAY_CODES: Array<[string, string]> = [['MO', 'Mon'], ['TU', 'Tue'], ['WE', 'Wed'], ['TH', 'Thu'], ['FR', 'Fri'], ['SA', 'Sat'], ['SU', 'Sun']];
const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100';
const LBL = 'block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1';
const CARD = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800';
const when = (iso: string) => new Date(iso).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const daysLabel = (d: string | null) => (d ? d.split(',').map((c) => DAY_CODES.find(([k]) => k === c)?.[1] || c).join(', ') : 'Every day');

function DayPicker({ value, onChange, idPrefix }: { value: string; onChange: (v: string) => void; idPrefix: string }) {
  const set = new Set(value ? value.split(',') : []);
  return (
    <fieldset>
      <legend className={LBL}>Which days</legend>
      <div className="flex flex-wrap gap-2">
        {DAY_CODES.map(([code, label]) => (
          <label key={code} htmlFor={`${idPrefix}-${code}`} className="flex items-center gap-1 text-sm text-gray-700 dark:text-slate-200">
            <input id={`${idPrefix}-${code}`} type="checkbox" checked={set.has(code)} onChange={(e) => { const n = new Set(set); if (e.target.checked) n.add(code); else n.delete(code); onChange(DAY_CODES.map(([k]) => k).filter((k) => n.has(k)).join(',')) }} /> {label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

export default function HappeningsPage() {
  const mayPost = useMayWrite('bar:console');
  const mayEdit = useMayWrite('bar:update');
  const [events, setEvents] = useState<Ev[]>([]);
  const [games, setGames] = useState<Game[]>([]);
  const [specials, setSpecials] = useState<Special[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [evForm, setEvForm] = useState<{ title: string; description: string; startsAt: string; isRecurring: boolean; recurrenceDays: string; isPublished: boolean } | null>(null);
  const [gameForm, setGameForm] = useState<{ league: string; home: string; away: string; startsAt: string; isFeatured: boolean; note: string } | null>(null);
  const [spForm, setSpForm] = useState<{ title: string; description: string; price: string; recurrenceDays: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const [e, g, s] = await Promise.all([api.get('/api/bar/events'), api.get('/api/bar/games'), api.get('/api/bar/specials')]);
      setEvents(e || []); setGames(g || []); setSpecials((s || []).filter((x: Special) => x.isRecurring)); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not load what\'s on. Try again.')) } finally { setLoading(false) }
  }, []);
  useEffect(() => { load(); }, [load]);

  const submit = async (fn: () => Promise<unknown>, close: () => void) => {
    setSaving(true); setFormErr('');
    try { await fn(); close(); await load() } catch (e) { setFormErr(errorText(e, 'That did not save.')) } finally { setSaving(false) }
  };
  const remove = async (path: string, id: string) => {
    setErr('');
    try { await api.delete(path, id); await load() } catch (e) { setErr(errorText(e, 'That was not removed.')) }
  };
  const toIso = (local: string) => (local ? new Date(local).toISOString() : '');

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><CalendarDays className="w-6 h-6 text-orange-600 dark:text-orange-300" /> What's on</h1>
        <p className="text-gray-500 dark:text-slate-400">Events and weekly specials on your website; the game on the Tonight board</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />

      <section className={CARD}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><CalendarDays className="w-5 h-5" /> Events</h2>
          {mayPost && <button onClick={() => { setFormErr(''); setEvForm({ title: '', description: '', startsAt: '', isRecurring: false, recurrenceDays: '', isPublished: true }) }} className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" /> Event</button>}
        </div>
        {events.length === 0 ? <p className="p-4 text-sm text-gray-500 dark:text-slate-400">Nothing posted yet — trivia, live music, the fish fry.</p> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {events.map((e) => (
              <li key={e.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{e.title}{!e.isPublished && <span className="ml-2 text-xs text-gray-600 dark:text-slate-300">not on the website</span>}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{e.isRecurring ? `${daysLabel(e.recurrenceDays)}, from ${when(e.startsAt)}` : when(e.startsAt)}</p>
                </div>
                {mayEdit && <button onClick={() => remove('/api/bar/events', e.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Remove ${e.title}`}><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Trophy className="w-5 h-5" /> Games</h2>
          {mayPost && <button onClick={() => { setFormErr(''); setGameForm({ league: 'NFL', home: '', away: '', startsAt: '', isFeatured: true, note: '' }) }} className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" /> Game</button>}
        </div>
        {games.length === 0 ? <p className="p-4 text-sm text-gray-500 dark:text-slate-400">No games posted. A featured game shows on the Tonight board the day it's on.</p> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {games.map((g) => (
              <li key={g.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{g.away} at {g.home} <span className="text-xs text-gray-500 dark:text-slate-400">{g.league}{g.isFeatured ? ' · on the board' : ''}</span></p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{when(g.startsAt)}{g.note ? ` · ${g.note}` : ''}</p>
                </div>
                {mayPost && <button onClick={() => remove('/api/bar/games', g.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Remove ${g.away} at ${g.home}`}><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className={CARD}>
        <div className="flex items-center justify-between p-4 border-b border-gray-100 dark:border-slate-800">
          <h2 className="font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Repeat className="w-5 h-5" /> Weekly specials</h2>
          {mayEdit && <button onClick={() => { setFormErr(''); setSpForm({ title: '', description: '', price: '', recurrenceDays: '' }) }} className="flex items-center gap-1 px-3 py-1.5 bg-orange-600 text-white rounded-lg text-sm"><Plus className="w-4 h-4" /> Weekly special</button>}
        </div>
        {specials.length === 0 ? <p className="p-4 text-sm text-gray-500 dark:text-slate-400">None yet — Taco Tuesday, Friday fish fry.</p> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {specials.map((s) => (
              <li key={s.id} className="flex items-start justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{s.title}</p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{daysLabel(s.recurrenceDays)}{s.priceCents !== null ? ` · $${(s.priceCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : ''}</p>
                </div>
                {mayEdit && <button onClick={() => remove('/api/bar/specials', s.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Remove ${s.title}`}><Trash2 className="w-4 h-4" /></button>}
              </li>
            ))}
          </ul>
        )}
      </section>

      {evForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="New event">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">New event</h2><button onClick={() => setEvForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div><label htmlFor="ev-title" className={LBL}>What</label><input id="ev-title" className={INPUT} value={evForm.title} onChange={(e) => setEvForm({ ...evForm, title: e.target.value })} placeholder="Trivia Night" /></div>
            <div><label htmlFor="ev-start" className={LBL}>{evForm.isRecurring ? 'Starting' : 'When'}</label><input id="ev-start" type="datetime-local" className={INPUT} value={evForm.startsAt} onChange={(e) => setEvForm({ ...evForm, startsAt: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={evForm.isRecurring} onChange={(e) => setEvForm({ ...evForm, isRecurring: e.target.checked })} /> Every week</label>
            {evForm.isRecurring && <DayPicker idPrefix="ev-day" value={evForm.recurrenceDays} onChange={(v) => setEvForm({ ...evForm, recurrenceDays: v })} />}
            <div><label htmlFor="ev-desc" className={LBL}>Details</label><textarea id="ev-desc" className={INPUT} rows={3} value={evForm.description} onChange={(e) => setEvForm({ ...evForm, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={evForm.isPublished} onChange={(e) => setEvForm({ ...evForm, isPublished: e.target.checked })} /> Show on the website</label>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setEvForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button>
              <button disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50" onClick={() => submit(() => api.post('/api/bar/events', { title: evForm.title, description: evForm.description || null, startsAt: toIso(evForm.startsAt), isRecurring: evForm.isRecurring, recurrenceDays: evForm.isRecurring ? evForm.recurrenceDays || null : null, isPublished: evForm.isPublished }), () => setEvForm(null))}>{saving ? 'Saving…' : 'Post it'}</button></div>
          </div>
        </div>
      )}

      {gameForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="New game">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">New game</h2><button onClick={() => setGameForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div className="grid grid-cols-3 gap-3">
              <div><label htmlFor="g-league" className={LBL}>League</label><input id="g-league" className={INPUT} value={gameForm.league} onChange={(e) => setGameForm({ ...gameForm, league: e.target.value })} /></div>
              <div><label htmlFor="g-away" className={LBL}>Away</label><input id="g-away" className={INPUT} value={gameForm.away} onChange={(e) => setGameForm({ ...gameForm, away: e.target.value })} /></div>
              <div><label htmlFor="g-home" className={LBL}>Home</label><input id="g-home" className={INPUT} value={gameForm.home} onChange={(e) => setGameForm({ ...gameForm, home: e.target.value })} /></div>
            </div>
            <div><label htmlFor="g-start" className={LBL}>Kickoff</label><input id="g-start" type="datetime-local" className={INPUT} value={gameForm.startsAt} onChange={(e) => setGameForm({ ...gameForm, startsAt: e.target.value })} /></div>
            <div><label htmlFor="g-note" className={LBL}>Note (optional)</label><input id="g-note" className={INPUT} value={gameForm.note} onChange={(e) => setGameForm({ ...gameForm, note: e.target.value })} placeholder="Doors at 11, sound on" /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={gameForm.isFeatured} onChange={(e) => setGameForm({ ...gameForm, isFeatured: e.target.checked })} /> Show it on the Tonight board</label>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setGameForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button>
              <button disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50" onClick={() => submit(() => api.post('/api/bar/games', { ...gameForm, note: gameForm.note || null, startsAt: toIso(gameForm.startsAt) }), () => setGameForm(null))}>{saving ? 'Saving…' : 'Post it'}</button></div>
          </div>
        </div>
      )}

      {spForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label="New weekly special">
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-5 space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">New weekly special</h2><button onClick={() => setSpForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div><label htmlFor="sp-title" className={LBL}>What</label><input id="sp-title" className={INPUT} value={spForm.title} onChange={(e) => setSpForm({ ...spForm, title: e.target.value })} placeholder="Taco Tuesday" /></div>
            <div><label htmlFor="sp-price" className={LBL}>Price (optional)</label><input id="sp-price" className={INPUT} inputMode="decimal" value={spForm.price} onChange={(e) => setSpForm({ ...spForm, price: e.target.value })} placeholder="2.00" /></div>
            <DayPicker idPrefix="sp-day" value={spForm.recurrenceDays} onChange={(v) => setSpForm({ ...spForm, recurrenceDays: v })} />
            <div><label htmlFor="sp-desc" className={LBL}>Details</label><textarea id="sp-desc" className={INPUT} rows={2} value={spForm.description} onChange={(e) => setSpForm({ ...spForm, description: e.target.value })} /></div>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setSpForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button>
              <button disabled={saving || !spForm.recurrenceDays} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50" onClick={() => submit(() => api.post('/api/bar/specials', { title: spForm.title, description: spForm.description || null, price: spForm.price || null, isRecurring: true, recurrenceDays: spForm.recurrenceDays }), () => setSpForm(null))}>{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
