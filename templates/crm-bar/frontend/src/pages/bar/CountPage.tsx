import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Check } from 'lucide-react';
import api from '../../services/api';
import FormError, { errorText } from '../../components/ui/FormError';
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED } from './registerUi';

/**
 * THE COUNT — walk the walk-in and the back bar with a phone. Type full packs and loose units for each thing;
 * what you type is saved as you go, so two people can count into the same count. Blind on purpose: it never shows
 * what the system expects to find (routes/barStock.ts GET /count). Finishing it is what the manager's stock
 * report compares against the count before.
 */

interface Item { id: string; name: string; category: string; unitLabel: string; packName: string; packSize: number }
interface Count { id: string; lines: Array<{ stockItemId: string; qty: number; countedByName: string | null }> }

export default function CountPage() {
  const [data, setData] = useState<{ categories: Array<{ id: string; label: string }>; count: Count | null; stock: Item[] } | null>(null);
  const [entry, setEntry] = useState<Record<string, { packs: string; units: string }>>({});
  const [saved, setSaved] = useState<Record<string, number | null>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [done, setDone] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/stock/count');
      setData(r);
      const s: Record<string, number | null> = {};
      for (const l of r.count?.lines || []) s[l.stockItemId] = l.qty;
      setSaved(s); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not load the count.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (it: Item) => {
    const e = entry[it.id] || { packs: '', units: '' };
    setBusy(it.id); setErr('');
    try {
      const r = await api.post('/api/stock/count/item', { stockItemId: it.id, packs: e.packs, units: e.units, clear: !e.packs.trim() && !e.units.trim() });
      setSaved((s) => ({ ...s, [it.id]: r.qty }));
    } catch (ex) { setErr(errorText(ex, 'That did not save.')); } finally { setBusy(''); }
  };

  const grouped = useMemo(() => (data ? data.categories.map((c) => ({ ...c, items: data.stock.filter((s) => s.category === c.id) })).filter((g) => g.items.length) : []), [data]);
  if (!data) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const countedN = Object.values(saved).filter((v) => v !== null && v !== undefined).length;

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">The count</h1>
        <p className={`text-sm ${MUTED}`}>{countedN} of {data.stock.length} counted. Full packs, then anything loose. Saved as you go.</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {done && <div className="rounded-2xl border border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100 p-4">Count finished. Thank you.</div>}
      {data.stock.length === 0 && <p className={`text-sm ${MUTED}`}>Nothing to count yet — a manager adds stock items first.</p>}
      {grouped.map((g) => (
        <section key={g.id} className={CARD} aria-label={g.label}>
          <p className={`${LABEL} mb-2`}>{g.label}</p>
          <ul className="divide-y divide-gray-200 dark:divide-slate-800">
            {g.items.map((it) => {
              const e = entry[it.id] || { packs: '', units: '' };
              const isPack = it.packSize > 1;
              return (
                <li key={it.id} className="py-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="font-semibold text-gray-900 dark:text-slate-100">{it.name}</p>
                    {saved[it.id] !== undefined && saved[it.id] !== null && <span className="text-sm text-green-800 dark:text-green-300 inline-flex items-center gap-1"><Check className="w-4 h-4" />{saved[it.id]} {it.unitLabel}</span>}
                  </div>
                  <div className="flex flex-wrap items-end gap-2 mt-2">
                    {isPack && <div className="w-28"><label className={LABEL} htmlFor={`p-${it.id}`}>{it.packName}</label><input id={`p-${it.id}`} className={`${INPUT} mt-1`} inputMode="decimal" value={e.packs} onChange={(ev) => setEntry((s) => ({ ...s, [it.id]: { ...e, packs: ev.target.value } }))} /></div>}
                    <div className="w-28"><label className={LABEL} htmlFor={`u-${it.id}`}>{isPack ? `Loose (${it.unitLabel})` : it.unitLabel}</label><input id={`u-${it.id}`} className={`${INPUT} mt-1`} inputMode="decimal" value={e.units} onChange={(ev) => setEntry((s) => ({ ...s, [it.id]: { ...e, units: ev.target.value } }))} /></div>
                    <button className={`${BTN} ${OFF}`} disabled={busy === it.id} onClick={() => save(it)}>Save</button>
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {data.stock.length > 0 && (
        <div className="flex justify-end">
          <button className={`${BTN} ${ON}`} disabled={!countedN || busy === 'finish'} onClick={async () => {
            setBusy('finish'); setErr('');
            try { await api.post('/api/stock/count/finish', {}); setDone(true); setEntry({}); await load(); } catch (e) { setErr(errorText(e, 'Could not finish the count.')); } finally { setBusy(''); }
          }}>Finish the count</button>
        </div>
      )}
    </div>
  );
}
