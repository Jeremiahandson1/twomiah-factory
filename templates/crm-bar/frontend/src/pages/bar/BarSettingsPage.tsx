import { useState, useEffect, useCallback } from 'react';
import { Loader2, Clock, KeyRound, Upload, Plus, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useMayWrite } from '../../shared';
import { useAuth } from '../../contexts/AuthContext';
import FormError, { errorText } from '../../components/ui/FormError';

/**
 * BAR SETTINGS — bar hours and kitchen hours (never the same thing: the website shows both, everywhere),
 * holidays, the speakeasy door's password, and a one-time import of a whole menu. The website reads the
 * hours live (GET /api/public/bar/hours); the Tonight console overrides them for a night.
 */

type Range = { open: string; close: string };
type Week = Partial<Record<Day, Range[]>>;
type Day = 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat';
interface Holiday { date: string; label?: string; bar?: Range[] | null; kitchen?: Range[] | null }
interface Hours { timezone?: string; bar: Week; kitchen: Week; holidays?: Holiday[] }

const DAYS: Array<[Day, string]> = [['mon', 'Monday'], ['tue', 'Tuesday'], ['wed', 'Wednesday'], ['thu', 'Thursday'], ['fri', 'Friday'], ['sat', 'Saturday'], ['sun', 'Sunday']];
const INPUT = 'px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100';
const CARD = 'bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 p-5 space-y-4';

export default function BarSettingsPage() {
  const mayEdit = useMayWrite('bar:update');
  const { user } = useAuth() as { user?: { role?: string } };
  const mayImport = mayEdit && ['owner', 'admin'].includes(String(user?.role || ''));
  const [hours, setHours] = useState<Hours>({ bar: {}, kitchen: {}, holidays: [] });
  const [speakeasy, setSpeakeasy] = useState<{ enabled: boolean; note: string | null }>({ enabled: false, note: null });
  const [password, setPassword] = useState('');
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState('');
  const [err, setErr] = useState('');
  const [ok, setOk] = useState('');
  const [importText, setImportText] = useState('');

  const load = useCallback(async () => {
    try {
      const s = await api.get('/api/bar/settings');
      setHours({ timezone: s.hours?.timezone, bar: s.hours?.bar || {}, kitchen: s.hours?.kitchen || {}, holidays: s.hours?.holidays || [] });
      setSpeakeasy(s.speakeasy); setNote(s.speakeasy?.note || ''); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not load the settings. Try again.')) }
    finally { setLoading(false) }
  }, []);
  useEffect(() => { load(); }, [load]);

  const put = async (key: string, body: Record<string, unknown>, done: string) => {
    setSaving(key); setErr(''); setOk('');
    try { await api.put('/api/bar/settings', body); setOk(done); await load() }
    catch (e) { setErr(errorText(e, 'That did not save.')) } finally { setSaving('') }
  };

  const dayRange = (dept: 'bar' | 'kitchen', day: Day): Range | null => (hours[dept][day] && hours[dept][day]!.length ? hours[dept][day]![0] : null);
  const setDay = (dept: 'bar' | 'kitchen', day: Day, r: Range | null) => setHours((h) => ({ ...h, [dept]: { ...h[dept], [day]: r ? [r] : [] } }));

  const runImport = async () => {
    setSaving('import'); setErr(''); setOk('');
    try {
      let body: unknown
      try { body = JSON.parse(importText) } catch { throw new Error('That is not valid JSON') }
      const r = await api.post('/api/bar/import', body);
      const n = r.imported || {};
      setOk(`Imported ${n.sections || 0} sections, ${n.items || 0} items, ${n.taps || 0} taps, ${n.events || 0} events${n.hours ? ' and the hours' : ''}.`);
      setImportText(''); await load();
    } catch (e) { setErr(errorText(e, 'The import did not run.')) } finally { setSaving('') }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>;

  const deptTable = (dept: 'bar' | 'kitchen') => (
    <div>
      <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">{dept === 'bar' ? 'Bar' : 'Kitchen'}</h3>
      <div className="space-y-2">
        {DAYS.map(([day, label]) => {
          const r = dayRange(dept, day);
          return (
            <div key={day} className="flex flex-wrap items-center gap-2">
              <span className="w-24 text-sm text-gray-700 dark:text-slate-200">{label}</span>
              <label className="flex items-center gap-1 text-sm text-gray-700 dark:text-slate-200">
                <input type="checkbox" checked={!!r} disabled={!mayEdit} onChange={(e) => setDay(dept, day, e.target.checked ? { open: '11:00', close: dept === 'bar' ? '02:00' : '21:00' } : null)} /> Open
              </label>
              {r && (
                <>
                  <label className="sr-only" htmlFor={`${dept}-${day}-open`}>{label} {dept} opens</label>
                  <input id={`${dept}-${day}-open`} type="time" className={INPUT} value={r.open} disabled={!mayEdit} onChange={(e) => setDay(dept, day, { ...r, open: e.target.value })} />
                  <span className="text-gray-500 dark:text-slate-400">to</span>
                  <label className="sr-only" htmlFor={`${dept}-${day}-close`}>{label} {dept} closes</label>
                  <input id={`${dept}-${day}-close`} type="time" className={INPUT} value={r.close} disabled={!mayEdit} onChange={(e) => setDay(dept, day, { ...r, close: e.target.value })} />
                  {r.close <= r.open && <span className="text-xs text-gray-500 dark:text-slate-400">(closes after midnight)</span>}
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Clock className="w-6 h-6 text-orange-600 dark:text-orange-200" /> Bar settings</h1>
        <p className="text-gray-500 dark:text-slate-400">Hours, holidays and the speakeasy door — your website reads them live</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {ok && <div role="status" className="rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800 dark:border-green-800 dark:bg-green-950/40 dark:text-green-200">{ok}</div>}

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">Hours</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">The bar and the kitchen keep their own hours. A close earlier than the open runs past midnight (11:00 to 02:00 closes at 2 AM).</p>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">{deptTable('bar')}{deptTable('kitchen')}</div>
        <div>
          <h3 className="font-semibold text-gray-900 dark:text-slate-100 mb-2">Holidays and one-off days</h3>
          {(hours.holidays || []).length === 0 && <p className="text-sm text-gray-500 dark:text-slate-400">None. Christmas, New Year's Eve, a private event — add the day and whether you're closed.</p>}
          <div className="space-y-2">
            {(hours.holidays || []).map((h, i) => (
              <div key={i} className="flex flex-wrap items-center gap-2">
                <label className="sr-only" htmlFor={`hol-date-${i}`}>Date</label>
                <input id={`hol-date-${i}`} type="date" className={INPUT} value={h.date} disabled={!mayEdit} onChange={(e) => setHours((x) => ({ ...x, holidays: x.holidays!.map((y, j) => (j === i ? { ...y, date: e.target.value } : y)) }))} />
                <label className="sr-only" htmlFor={`hol-label-${i}`}>What it is</label>
                <input id={`hol-label-${i}`} className={INPUT} placeholder="Christmas" value={h.label || ''} disabled={!mayEdit} onChange={(e) => setHours((x) => ({ ...x, holidays: x.holidays!.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)) }))} />
                <span className="text-sm text-gray-700 dark:text-slate-200">Closed all day</span>
                {mayEdit && <button onClick={() => setHours((x) => ({ ...x, holidays: x.holidays!.filter((_, j) => j !== i) }))} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label="Remove this day"><Trash2 className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
          {mayEdit && <button onClick={() => setHours((x) => ({ ...x, holidays: [...(x.holidays || []), { date: '', label: '', bar: null, kitchen: null }] }))} className="mt-2 flex items-center gap-1 text-sm font-semibold text-orange-700 dark:text-orange-200"><Plus className="w-4 h-4" /> Add a day</button>}
        </div>
        {mayEdit && <button disabled={saving === 'hours'} onClick={() => put('hours', { hours: { ...hours, holidays: (hours.holidays || []).filter((h) => h.date) } }, 'Hours saved.')} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">{saving === 'hours' ? 'Saving…' : 'Save hours'}</button>}
      </section>

      <section className={CARD}>
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><KeyRound className="w-5 h-5" /> The speakeasy door</h2>
        <p className="text-sm text-gray-500 dark:text-slate-400">A hidden door on your website asks for a password. Tell regulars the password; whoever gets it right sees what it's good for. {speakeasy.enabled ? 'The door is on.' : 'The door is off until you set a password.'}</p>
        {mayEdit && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div><label htmlFor="sp-pass" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">{speakeasy.enabled ? 'New password' : 'Password'}</label><input id="sp-pass" className={`${INPUT} w-full`} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="off" /></div>
            <div><label htmlFor="sp-note" className="block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1">What it's good for</label><input id="sp-note" className={`${INPUT} w-full`} placeholder="$1 off a root beer" value={note} onChange={(e) => setNote(e.target.value)} /></div>
          </div>
        )}
        {mayEdit && (
          <div className="flex gap-2">
            <button disabled={!!saving || (!password && note === (speakeasy.note || ''))} onClick={() => put('speak', { ...(password ? { speakeasyPassword: password } : {}), speakeasyNote: note }, 'Speakeasy saved.').then(() => setPassword(''))} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">Save</button>
            {speakeasy.enabled && <button disabled={!!saving} onClick={() => put('speak-off', { speakeasyPassword: null }, 'The door is off.')} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Turn the door off</button>}
          </div>
        )}
      </section>

      {mayImport && (
        <section className={CARD}>
          <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 flex items-center gap-2"><Upload className="w-5 h-5" /> Import a whole menu</h2>
          <p className="text-sm text-gray-500 dark:text-slate-400">For moving onto Twomiah: paste the menu, taps, hours and events as JSON. Running it again updates what's there instead of adding copies.</p>
          <label htmlFor="bar-import" className="sr-only">Menu JSON</label>
          <textarea id="bar-import" className={`${INPUT} w-full font-mono text-xs`} rows={8} value={importText} onChange={(e) => setImportText(e.target.value)} placeholder='{ "menu": { "sections": [ { "name": "Burgers", "items": [ { "name": "Hamburger", "priceCents": 579 } ] } ] } }' />
          <button disabled={!importText.trim() || saving === 'import'} onClick={runImport} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">{saving === 'import' ? 'Importing…' : 'Import'}</button>
        </section>
      )}
    </div>
  );
}
