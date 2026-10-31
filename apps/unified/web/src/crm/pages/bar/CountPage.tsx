// Moved from templates/crm-bar/frontend/src/pages/bar/CountPage.tsx.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Loader2, Check } from 'lucide-react'
import { api } from '../../../api'
import { useAuth } from '../../../shared'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, CARD, LABEL, INPUT, MUTED } from './registerUi';

/**
 * THE COUNT — walk the walk-in and the back bar with a phone. Type full packs and loose units for each thing;
 * what you type is saved as you go, so two people can count into the same count. Blind on purpose: it never shows
 * what the system expects to find (routes/barStock.ts GET /count). Finishing it is what the manager's stock
 * report compares against the count before.
 */

interface Item { id: string; name: string; category: string; unitLabel: string; packName: string; packSize: number }
interface Count { id: string; lines: Array<{ stockItemId: string; qty: number; fills?: number[]; countedByName: string | null }> }
// Things that come in bottles, which a person counts by how full the open ones are.
const BOTTLED = ['liquor', 'wine', 'beer', 'na'];

export default function CountPage() {
  const [data, setData] = useState<{ categories: Array<{ id: string; label: string }>; count: Count | null; stock: Item[] } | null>(null);
  const { hasFeature } = useAuth();
  const byFill = hasFeature('stock_fill_levels');
  const [entry, setEntry] = useState<Record<string, { packs: string; units: string }>>({});
  // Open bottles by how full each is, 0 to 1 (restaurant-bar-depth #13), per item.
  const [fills, setFills] = useState<Record<string, number[]>>({});
  const [saved, setSaved] = useState<Record<string, number | null>>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  // The count just finished, as it stood: finishing opens the next count (empty), which read "0 of 1 counted" beside
  // "Count finished" (bar live test, 2026-10-25).
  const [done, setDone] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get('/api/stock/count');
      setData(r);
      const s: Record<string, number | null> = {};
      const f: Record<string, number[]> = {};
      for (const l of r.count?.lines || []) { s[l.stockItemId] = l.qty; if (l.fills?.length) f[l.stockItemId] = l.fills; }
      setSaved(s); setFills(f); setErr('');
    } catch (e) { setErr(errorText(e, 'Could not load the count.')); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const save = async (it: Item) => {
    const e = entry[it.id] || { packs: '', units: '' };
    const open = byFill ? fills[it.id] || [] : [];
    setBusy(it.id); setErr('');
    try {
      const r = await api.post('/api/stock/count/item', { stockItemId: it.id, packs: e.packs, units: e.units, ...(byFill ? { fills: open } : {}), clear: !e.packs.trim() && !e.units.trim() && open.length === 0 });
      setSaved((s) => ({ ...s, [it.id]: r.qty })); setDone(null);
    } catch (ex) { setErr(errorText(ex, 'That did not save.')); } finally { setBusy(''); }
  };

  const grouped = useMemo(() => (data ? data.categories.map((c) => ({ ...c, items: data.stock.filter((s) => s.category === c.id) })).filter((g) => g.items.length) : []), [data]);
  if (!data) return <div className="flex justify-center py-16">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const countedN = Object.values(saved).filter((v) => v !== null && v !== undefined).length;

  return (
    <div className="space-y-3 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">The count</h1>
        <p className={`text-sm ${MUTED}`}>{done !== null ? `The count is finished: ${done} of ${data.stock.length} counted. The next count starts from here.` : `${countedN} of ${data.stock.length} counted. Full packs, then anything loose. Saved as you go.`}</p>
      </div>
      <FormError message={err} onDismiss={() => setErr('')} />
      {done !== null && <div className="rounded-2xl border border-green-300 bg-green-50 text-green-900 dark:border-green-800 dark:bg-green-950/40 dark:text-green-100 p-4">Count finished. Thank you.</div>}
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
                  {byFill && BOTTLED.includes(it.category) && (
                    <div className="mt-2 space-y-1" aria-label={`Open bottles of ${it.name}`}>
                      {(fills[it.id] || []).map((f, i) => (
                        <div key={i} className="flex items-center gap-3">
                          <label className={LABEL} htmlFor={`f-${it.id}-${i}`}>Open bottle {i + 1}</label>
                          <input id={`f-${it.id}-${i}`} type="range" min={0} max={100} step={5} value={Math.round(f * 100)} className="flex-1 max-w-xs"
                            aria-valuetext={`${Math.round(f * 100)} percent full`}
                            onChange={(ev) => setFills((s) => ({ ...s, [it.id]: (s[it.id] || []).map((x, j) => (j === i ? Number(ev.target.value) / 100 : x)) }))} />
                          <span className="w-12 text-sm tabular-nums">{Math.round(f * 100)}%</span>
                          <button type="button" className={`${BTN} ${OFF}`} aria-label={`Remove open bottle ${i + 1}`} onClick={() => setFills((s) => ({ ...s, [it.id]: (s[it.id] || []).filter((_, j) => j !== i) }))}>Remove</button>
                        </div>
                      ))}
                      <button type="button" className={`${BTN} ${OFF}`} onClick={() => setFills((s) => ({ ...s, [it.id]: [...(s[it.id] || []), 1] }))}>Add an open bottle</button>
                    </div>
                  )}
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
            try { const n = countedN; await api.post('/api/stock/count/finish', {}); setEntry({}); setFills({}); await load(); setDone(n); } catch (e) { setErr(errorText(e, 'Could not finish the count.')); } finally { setBusy(''); }
          }}>Finish the count</button>
        </div>
      )}
    </div>
  );
}
