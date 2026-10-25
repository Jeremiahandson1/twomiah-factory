// Moved from templates/crm-bar/frontend/src/pages/bar/TonightPage.tsx.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { Loader2, Flame, Beer, Users, MessageSquare, Star, Search, RefreshCw } from 'lucide-react'
import { api } from '../../../api'
import { useAuth, useMayWrite } from '../../../shared'
import { SHELL_HERE } from '../../../shell'
import { verticalScreens } from '../../vertical'
import FormError, { errorText } from '../../ui/FormError'
import { zoneMoment, zoneWall } from '@twomiah/tenant-ui/src/time/companyClock'

/**
 * TONIGHT — the bartender's console, made for one thumb on a phone behind the bar.
 *
 * Everything here reaches the bar's website within a minute (GET /api/public/bar/live): kitchen and bar open
 * or closed, how busy, the note, tonight's special, what is 86ed, what is pouring. Overrides lapse at 4 AM by
 * themselves (routes/bar.ts), so a Friday "kitchen closed" never leaves Saturday's board wrong.
 *
 * Who sees what: everyone signed in reads it (bar:read); the controls need bar:console (staff and up).
 *
 * BUILT FROM WHAT THE BUSINESS HAS (2026-10-25). The page asked for the menu and the taps whatever was switched on, so a
 * restaurant without Draft Taps got the server's 403 for /api/bar/taps as a red "This module is not enabled" on its
 * opening page, every role. The 86 list rides the menu feature; the taps card rides what the Taps page itself needs
 * in this vertical's menu (SHELL_HERE: 'draft_taps' on a restaurant, the menu on a bar), so the two never disagree;
 * the Bar card shows only where the business has a bar (screens.foodService.bar).
 */

type Dept = { isOpen: boolean; line: string; short: string; source: string };
interface Live {
  kitchen: Dept; bar: Dept; room: { status: string; label: string }; note: string | null;
  special: { title: string; price: string | null } | null; taps: { count: number }; updatedBy: string | null; updatedAt: string | null;
  timezone: string;
}
interface Status { kitchenOpen: boolean | null; kitchenClosesAt: string | null; barOpen: boolean | null; barClosesAt: string | null; roomStatus: string; note: string | null }
interface Item { id: string; name: string; is86ed: boolean; isActive: boolean }
interface Section { id: string; name: string; items: Item[] }
interface Tap { id: string; lineNumber: number; beerName: string; status: string; isActive: boolean }
interface Special { id: string; title: string; priceCents: number | null; startsAt: string; endsAt: string | null; isRecurring: boolean }

const ROOMS = [
  { value: 'quiet', label: 'Plenty of seats' },
  { value: 'filling', label: 'Filling up' },
  { value: 'packed', label: 'Packed' },
];
const TAP_STATES = [
  { value: 'pouring', label: 'Pouring' },
  { value: 'just_tapped', label: 'Just tapped' },
  { value: 'last_keg', label: 'Last keg' },
  { value: 'blown', label: 'Blown' },
];

// Big targets: these are pressed with a wet thumb in a dim bar.
const BTN = 'min-h-[48px] px-4 rounded-xl text-sm font-semibold border transition-colors disabled:opacity-50';
const ON = 'bg-orange-600 text-white border-orange-600 dark:bg-orange-600 dark:text-white dark:border-orange-500';
const OFF = 'bg-white text-gray-800 border-gray-300 hover:bg-gray-50 dark:bg-slate-900 dark:text-slate-100 dark:border-slate-700 dark:hover:bg-slate-800';
const CARD = 'bg-white dark:bg-slate-900 rounded-2xl border border-gray-200 dark:border-slate-800 p-4';
const LABEL = 'text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400';

/** "21:30" on the bar's clock today → an instant (the server stores instants). */
function localTimeToday(hhmm: string, tz: string): string | null {
  if (!/^\d{2}:\d{2}$/.test(hhmm)) return null;
  const now = new Date();
  // The shared zone arithmetic (one implementation, clock changes included).
  let at = zoneMoment(zoneWall(now, tz).date, hhmm, tz);
  // A close "at 1:00" typed at 11 PM means tonight's 1 AM, which is tomorrow's date.
  if (at.getTime() < now.getTime() - 3600_000) at = new Date(at.getTime() + 86400_000);
  return at.toISOString();
}

/** The features the Taps page needs in this vertical's menu (any one of them), as the shell gates it. */
const TAPS_FEATURES: string[] = SHELL_HERE.nav.find((i) => i.to === '/crm/taps')?.features || ['bar_menu'];

export default function TonightPage() {
  const mayConsole = useMayWrite('bar:console');
  const { hasFeature } = useAuth();
  const hasMenu = hasFeature('bar_menu');
  const hasTaps = hasMenu && TAPS_FEATURES.some((f) => hasFeature(f));
  const hasBar = verticalScreens().foodService?.bar !== false;
  const [live, setLive] = useState<Live | null>(null);
  const [status, setStatus] = useState<Status | null>(null);
  const [sections, setSections] = useState<Section[]>([]);
  const [taps, setTaps] = useState<Tap[]>([]);
  const [specials, setSpecials] = useState<Special[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string>('');
  const [err, setErr] = useState('');
  const [note, setNote] = useState('');
  const [closeAt, setCloseAt] = useState<{ kitchen: string; bar: string }>({ kitchen: '', bar: '' });
  const [special, setSpecial] = useState({ title: '', price: '' });
  const [q, setQ] = useState('');

  const load = useCallback(async () => {
    try {
      const [t, m, tp, sp] = await Promise.all([
        api.get('/api/bar/tonight'), hasMenu ? api.get('/api/bar/menu') : { sections: [] },
        hasTaps ? api.get('/api/bar/taps') : { data: [] }, api.get('/api/bar/specials'),
      ]);
      setLive(t.live); setStatus(t.status); setNote(t.status?.note || '');
      // The taps and the specials are list replies ({ data, pagination }).
      setSections(m.sections || []); setTaps(tp?.data || []); setSpecials(sp?.data || []);
      setErr('');
    } catch (e) {
      setErr(errorText(e, 'Could not load tonight. Try again.'));
    } finally {
      setLoading(false);
    }
  }, [hasMenu, hasTaps]);
  useEffect(() => { load(); }, [load]);

  // Every console action: one request, then the board re-reads. The refusal stays on the page.
  const act = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key); setErr('');
    try { await fn(); await load(); } catch (e) { setErr(errorText(e, 'That did not save. Try again.')); } finally { setBusy(''); }
  };
  const tonight = (patch: Record<string, unknown>, key: string) => act(key, () => api.put('/api/bar/tonight', patch));

  const activeSpecial = useMemo(() => {
    const now = Date.now();
    return specials.find((s) => !s.isRecurring && new Date(s.startsAt).getTime() <= now && (!s.endsAt || new Date(s.endsAt).getTime() >= now)) || null;
  }, [specials]);

  const items = useMemo(() => {
    const all = sections.flatMap((s) => s.items.filter((i) => i.isActive).map((i) => ({ ...i, section: s.name })));
    const t = q.trim().toLowerCase();
    const shown = t ? all.filter((i) => i.name.toLowerCase().includes(t) || i.section.toLowerCase().includes(t)) : all;
    // What is 86ed first: the list a bartender clears at the start of the next shift.
    return [...shown].sort((a, b) => Number(b.is86ed) - Number(a.is86ed) || a.name.localeCompare(b.name));
  }, [sections, q]);

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const deptControls = (dept: 'kitchen' | 'bar') => {
    const openKey = dept === 'kitchen' ? 'kitchenOpen' : 'barOpen';
    const closesKey = dept === 'kitchen' ? 'kitchenClosesAt' : 'barClosesAt';
    const forced = status?.[openKey as keyof Status] === false;
    const forcedOpen = status?.[openKey as keyof Status] === true;
    const early = !!status?.[closesKey as keyof Status];
    const following = !forced && !forcedOpen && !early;
    const d = live?.[dept];
    return (
      <div className={CARD}>
        <div className="flex items-center justify-between gap-2 mb-3">
          <p className={LABEL}>{dept === 'kitchen' ? 'Kitchen' : 'Bar'}</p>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${d?.isOpen ? 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-200' : 'bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200'}`}>
            {d?.isOpen ? 'Open' : 'Closed'}
          </span>
        </div>
        <p className="text-base font-semibold text-gray-900 dark:text-slate-100 mb-3">{d?.line}</p>
        {mayConsole && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <button className={`${BTN} ${following ? ON : OFF}`} disabled={!!busy} aria-pressed={following}
              onClick={() => tonight({ [openKey]: null, [closesKey]: null }, `${dept}-follow`)}>Follow the hours</button>
            <button className={`${BTN} ${forcedOpen ? ON : OFF}`} disabled={!!busy} aria-pressed={forcedOpen}
              onClick={() => tonight({ [openKey]: true, [closesKey]: null }, `${dept}-open`)}>Open now</button>
            <button className={`${BTN} ${forced ? ON : OFF}`} disabled={!!busy} aria-pressed={forced}
              onClick={() => tonight({ [openKey]: false, [closesKey]: null }, `${dept}-closed`)}>Closed now</button>
            <div className="flex gap-2">
              <label className="sr-only" htmlFor={`${dept}-close-at`}>{dept === 'kitchen' ? 'Kitchen' : 'Bar'} closes at</label>
              <input id={`${dept}-close-at`} type="time" value={closeAt[dept]} onChange={(e) => setCloseAt((c) => ({ ...c, [dept]: e.target.value }))}
                className="min-h-[48px] flex-1 min-w-0 px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
              <button className={`${BTN} ${early ? ON : OFF}`} disabled={!!busy || !closeAt[dept]}
                onClick={() => {
                  const at = live ? localTimeToday(closeAt[dept], live.timezone) : null;
                  if (!at) { setErr('Pick a closing time'); return; }
                  // An "Open now" stays open until this time; otherwise it is an early close of tonight's hours.
                  tonight({ [openKey]: forcedOpen ? true : null, [closesKey]: at }, `${dept}-early`);
                }}>Close at</button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Flame className="w-6 h-6 text-orange-600 dark:text-orange-200" /> Tonight</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm">What your website says right now{live?.updatedBy ? ` · last change by ${live.updatedBy}` : ''}</p>
        </div>
        <button className={`${BTN} ${OFF} flex items-center gap-2`} onClick={() => load()} aria-label="Refresh"><RefreshCw className="w-4 h-4" /> Refresh</button>
      </div>

      <FormError message={err} onDismiss={() => setErr('')} />

      {deptControls('kitchen')}
      {hasBar && deptControls('bar')}

      <div className={CARD}>
        <p className={`${LABEL} mb-3 flex items-center gap-1`}><Users className="w-4 h-4" /> How busy</p>
        <div className="grid grid-cols-3 gap-2">
          {ROOMS.map((r) => (
            <button key={r.value} className={`${BTN} ${live?.room.status === r.value ? ON : OFF}`} disabled={!mayConsole || !!busy} aria-pressed={live?.room.status === r.value}
              onClick={() => tonight({ roomStatus: r.value }, `room-${r.value}`)}>{r.label}</button>
          ))}
        </div>
      </div>

      <div className={CARD}>
        <label htmlFor="tonight-note" className={`${LABEL} mb-2 flex items-center gap-1`}><MessageSquare className="w-4 h-4" /> The note on the board</label>
        <div className="flex gap-2">
          <input id="tonight-note" value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} disabled={!mayConsole} placeholder="Packers on every screen"
            className="min-h-[48px] flex-1 min-w-0 px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
          {mayConsole && <button className={`${BTN} ${ON}`} disabled={!!busy} onClick={() => tonight({ note }, 'note')}>Save</button>}
          {mayConsole && live?.note && <button className={`${BTN} ${OFF}`} disabled={!!busy} onClick={() => { setNote(''); tonight({ note: null }, 'note-clear'); }}>Clear</button>}
        </div>
      </div>

      <div className={CARD}>
        <p className={`${LABEL} mb-2 flex items-center gap-1`}><Star className="w-4 h-4" /> Tonight's special</p>
        {activeSpecial ? (
          <div className="flex items-center justify-between gap-2">
            <p className="font-semibold text-gray-900 dark:text-slate-100">{activeSpecial.title}{live?.special?.price ? ` — ${live.special.price}` : ''}</p>
            {mayConsole && <button className={`${BTN} ${OFF}`} disabled={!!busy} onClick={() => act('special-remove', () => api.delete('/api/bar/specials', activeSpecial.id))}>Take it down</button>}
          </div>
        ) : mayConsole ? (
          <div className="flex flex-col sm:flex-row gap-2">
            <label className="sr-only" htmlFor="special-title">Special</label>
            <input id="special-title" value={special.title} maxLength={160} onChange={(e) => setSpecial((s) => ({ ...s, title: e.target.value }))} placeholder="Walleye basket"
              className="min-h-[48px] flex-1 min-w-0 px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
            <label className="sr-only" htmlFor="special-price">Price</label>
            <input id="special-price" value={special.price} inputMode="decimal" onChange={(e) => setSpecial((s) => ({ ...s, price: e.target.value }))} placeholder="$12.50"
              className="min-h-[48px] sm:w-28 px-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
            <button className={`${BTN} ${ON}`} disabled={!!busy || !special.title.trim()}
              onClick={() => act('special', async () => { await api.post('/api/bar/specials', { title: special.title, price: special.price || null }); setSpecial({ title: '', price: '' }); })}>Post it</button>
          </div>
        ) : <p className="text-sm text-gray-500 dark:text-slate-400">No special tonight.</p>}
        <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">Comes down by itself at 4 AM.</p>
      </div>

      {hasMenu && <div className={CARD}>
        <div className="flex items-center justify-between gap-2 mb-2">
          <p className={LABEL}>86 — out of it</p>
          <span className="text-xs text-gray-500 dark:text-slate-400">{items.filter((i) => i.is86ed).length} out</span>
        </div>
        <div className="relative mb-2">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 dark:text-slate-500" />
          <label className="sr-only" htmlFor="eighty-six-search">Find an item</label>
          <input id="eighty-six-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find an item"
            className="min-h-[48px] w-full pl-9 pr-3 rounded-xl border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100" />
        </div>
        {items.length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400 py-2">Nothing on the menu yet. Add it on the Menu page.</p> : (
          <ul className="divide-y divide-gray-100 dark:divide-slate-800">
            {items.map((i) => (
              <li key={i.id} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className={`font-medium truncate ${i.is86ed ? 'text-gray-500 line-through dark:text-slate-400' : 'text-gray-900 dark:text-slate-100'}`}>{i.name}</p>
                  <p className="text-xs text-gray-500 dark:text-slate-400">{i.section}</p>
                </div>
                {mayConsole && (
                  <button className={`${BTN} ${i.is86ed ? ON : OFF} shrink-0`} disabled={!!busy} aria-pressed={i.is86ed}
                    onClick={() => act(`86-${i.id}`, () => api.put(`/api/bar/menu/items/${i.id}/86`, { is86ed: !i.is86ed }))}>{i.is86ed ? 'Back on' : '86 it'}</button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>}

      {hasTaps && <div className={CARD}>
        <p className={`${LABEL} mb-2 flex items-center gap-1`}><Beer className="w-4 h-4" /> Taps</p>
        {taps.filter((t) => t.isActive).length === 0 ? <p className="text-sm text-gray-500 dark:text-slate-400 py-2">No taps yet. Add the lines on the Taps page.</p> : (
          <ul className="space-y-3">
            {taps.filter((t) => t.isActive).map((t) => (
              <li key={t.id}>
                <p className="font-medium text-gray-900 dark:text-slate-100 mb-1">{t.lineNumber}. {t.beerName}</p>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {TAP_STATES.map((s) => (
                    <button key={s.value} className={`${BTN} ${t.status === s.value ? ON : OFF}`} disabled={!mayConsole || !!busy} aria-pressed={t.status === s.value}
                      onClick={() => act(`tap-${t.id}`, () => api.put(`/api/bar/taps/${t.id}/status`, { status: s.value }))}>{s.label}</button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>}
    </div>
  );
}
