import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Beer, Edit2, Trash2 } from 'lucide-react';
import api from '../../services/api';
import { useMayWrite } from '../../shared';
import FormError, { errorText } from '../../components/ui/FormError';

/**
 * TAPS — the beer on each line, shown live on the website's tap wall (GET /api/public/bar/taps). A blown keg
 * leaves the website by itself; the status is changed from the Tonight console. Putting a new beer on a line
 * is a manager's (bar:update).
 */

interface Tap {
  id: string; lineNumber: number; beerName: string; brewery: string | null; style: string | null; abv: string | null;
  originCountry: string | null; description: string | null; badge: string | null; priceCents: number | null; status: string; isActive: boolean;
}

const STATUS_LABEL: Record<string, string> = { pouring: 'Pouring', just_tapped: 'Just tapped', last_keg: 'Last keg', blown: 'Blown' };
const INPUT = 'w-full px-3 py-2 rounded-lg border border-gray-300 bg-white text-gray-900 dark:bg-slate-950 dark:border-slate-700 dark:text-slate-100';
const LBL = 'block text-sm font-medium text-gray-700 dark:text-slate-200 mb-1';

export default function TapsPage() {
  const mayEdit = useMayWrite('bar:update');
  const [taps, setTaps] = useState<Tap[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [form, setForm] = useState<(Partial<Tap> & { price?: string }) | null>(null);
  const [formErr, setFormErr] = useState('');
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState('');

  const load = useCallback(async () => {
    try { setTaps((await api.get('/api/bar/taps')) || []); setErr('') }
    catch (e) { setErr(errorText(e, 'Could not load the taps. Try again.')) }
    finally { setLoading(false) }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async () => {
    if (!form) return;
    setSaving(true); setFormErr('');
    try {
      const body: Record<string, unknown> = {
        lineNumber: Number(form.lineNumber), beerName: form.beerName, brewery: form.brewery ?? null, style: form.style ?? null,
        abv: form.abv === '' || form.abv === undefined ? null : form.abv, originCountry: form.originCountry ?? null,
        description: form.description ?? null, badge: form.badge ?? null, isActive: form.isActive !== false,
        price: form.price === undefined || form.price.trim() === '' ? null : form.price,
      };
      if (form.id) await api.put(`/api/bar/taps/${form.id}`, body); else await api.post('/api/bar/taps', body);
      setForm(null); await load();
    } catch (e) { setFormErr(errorText(e, 'The tap did not save.')) } finally { setSaving(false) }
  };

  const remove = async (id: string) => {
    setErr('');
    try { await api.delete('/api/bar/taps', id); setConfirmDelete(''); await load() }
    catch (e) { setErr(errorText(e, 'That tap was not removed.')); setConfirmDelete('') }
  };

  const nextLine = taps.reduce((m, t) => Math.max(m, t.lineNumber), 0) + 1;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 flex items-center gap-2 dark:text-slate-100"><Beer className="w-6 h-6 text-orange-600 dark:text-orange-300" /> Taps</h1>
          <p className="text-gray-500 dark:text-slate-400">What's on each line — the website's tap wall reads it live</p>
        </div>
        {mayEdit && <button onClick={() => { setFormErr(''); setForm({ lineNumber: nextLine, isActive: true, price: '' }) }} className="flex items-center gap-2 px-4 py-2 bg-orange-600 text-white rounded-lg hover:bg-orange-700"><Plus className="w-4 h-4" /> Tap</button>}
      </div>

      <FormError message={err} onDismiss={() => setErr('')} />

      {loading ? <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        : taps.length === 0 ? <div className="text-center py-12 text-gray-500 bg-white rounded-xl border dark:text-slate-400 dark:bg-slate-900 dark:border-slate-800">No taps yet.</div>
        : (
          <ul className="bg-white dark:bg-slate-900 rounded-xl border border-gray-200 dark:border-slate-800 divide-y divide-gray-100 dark:divide-slate-800">
            {taps.map((t) => (
              <li key={t.id} className={`flex items-start justify-between gap-3 p-4 ${t.isActive ? '' : 'opacity-60'}`}>
                <div className="min-w-0">
                  <p className="font-medium text-gray-900 dark:text-slate-100">{t.lineNumber}. {t.beerName} <span className="ml-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 dark:bg-slate-800 dark:text-slate-200">{STATUS_LABEL[t.status] || t.status}</span></p>
                  <p className="text-sm text-gray-500 dark:text-slate-400">{[t.brewery, t.style, t.abv ? `${t.abv}%` : null, t.originCountry].filter(Boolean).join(' · ')}</p>
                  {t.badge && <p className="text-xs text-orange-700 dark:text-orange-300">{t.badge}</p>}
                </div>
                {mayEdit && (
                  <div className="flex items-center gap-1 shrink-0">
                    <button onClick={() => { setFormErr(''); setForm({ ...t, price: t.priceCents === null ? '' : String(t.priceCents / 100) }) }} className="p-2 text-gray-500 hover:text-gray-800 dark:text-slate-400 dark:hover:text-slate-100" aria-label={`Edit tap ${t.lineNumber}`}><Edit2 className="w-4 h-4" /></button>
                    {confirmDelete === t.id
                      ? <><button onClick={() => remove(t.id)} className="px-2 py-1 text-sm font-semibold text-red-700 dark:text-red-300">Remove</button><button onClick={() => setConfirmDelete('')} className="px-2 py-1 text-sm text-gray-600 dark:text-slate-300">Keep</button></>
                      : <button onClick={() => setConfirmDelete(t.id)} className="p-2 text-gray-500 hover:text-red-700 dark:text-slate-400 dark:hover:text-red-300" aria-label={`Remove tap ${t.lineNumber}`}><Trash2 className="w-4 h-4" /></button>}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

      {form && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" role="dialog" aria-modal="true" aria-label={form.id ? 'Edit tap' : 'New tap'}>
          <div className="bg-white dark:bg-slate-900 rounded-2xl w-full max-w-lg p-5 space-y-3 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between"><h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100">{form.id ? 'Edit tap' : 'New tap'}</h2><button onClick={() => setForm(null)} aria-label="Close" className="p-1 text-gray-500 dark:text-slate-400"><X className="w-5 h-5" /></button></div>
            <FormError message={formErr} />
            <div className="grid grid-cols-3 gap-3">
              <div><label htmlFor="tap-line" className={LBL}>Line</label><input id="tap-line" className={INPUT} inputMode="numeric" value={form.lineNumber ?? ''} onChange={(e) => setForm({ ...form, lineNumber: e.target.value as unknown as number })} /></div>
              <div className="col-span-2"><label htmlFor="tap-beer" className={LBL}>Beer</label><input id="tap-beer" className={INPUT} value={form.beerName || ''} onChange={(e) => setForm({ ...form, beerName: e.target.value })} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label htmlFor="tap-brewery" className={LBL}>Brewery</label><input id="tap-brewery" className={INPUT} value={form.brewery || ''} onChange={(e) => setForm({ ...form, brewery: e.target.value })} /></div>
              <div><label htmlFor="tap-style" className={LBL}>Style</label><input id="tap-style" className={INPUT} value={form.style || ''} onChange={(e) => setForm({ ...form, style: e.target.value })} /></div>
              <div><label htmlFor="tap-abv" className={LBL}>ABV %</label><input id="tap-abv" className={INPUT} inputMode="decimal" value={form.abv || ''} onChange={(e) => setForm({ ...form, abv: e.target.value })} /></div>
              <div><label htmlFor="tap-origin" className={LBL}>From</label><input id="tap-origin" className={INPUT} placeholder="Germany" value={form.originCountry || ''} onChange={(e) => setForm({ ...form, originCountry: e.target.value })} /></div>
              <div><label htmlFor="tap-price" className={LBL}>Price</label><input id="tap-price" className={INPUT} inputMode="decimal" placeholder="5.50" value={form.price || ''} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
            </div>
            <div><label htmlFor="tap-badge" className={LBL}>Badge (optional)</label><input id="tap-badge" className={INPUT} placeholder="House root beer, since 1920" value={form.badge || ''} onChange={(e) => setForm({ ...form, badge: e.target.value })} /></div>
            <div><label htmlFor="tap-desc" className={LBL}>Description</label><textarea id="tap-desc" className={INPUT} rows={2} value={form.description || ''} onChange={(e) => setForm({ ...form, description: e.target.value })} /></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-slate-200"><input type="checkbox" checked={form.isActive !== false} onChange={(e) => setForm({ ...form, isActive: e.target.checked })} /> This line is in use</label>
            <div className="flex justify-end gap-2 pt-2"><button onClick={() => setForm(null)} className="px-4 py-2 rounded-lg border border-gray-300 text-gray-800 dark:border-slate-700 dark:text-slate-100">Cancel</button><button onClick={save} disabled={saving} className="px-4 py-2 rounded-lg bg-orange-600 text-white disabled:opacity-50">{saving ? 'Saving…' : 'Save'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
