// Moved from templates/crm-bar/frontend/src/pages/bar/StockPage.tsx.
import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Plus, Trash2 } from 'lucide-react'
import { api } from '../../../api'
import FormError, { errorText } from '../../ui/FormError'
import { BTN, ON, OFF, DANGER, CARD, LABEL, INPUT, MUTED, money, centsFrom, Dialog } from './registerUi';

/**
 * STOCK & COSTING — the manager's side (routes/barStock.ts, bar:update). Stock bought by the pack and used by the
 * unit; on hand estimated between counts from what the register sold; what each plate and pour costs; the count's
 * report (what went missing, food and pour cost); what to reorder and the order to the rep. The count itself is
 * the bartender's, on a phone (/crm/count).
 */

type Tab = 'stock' | 'recipes' | 'counts' | 'orders';
interface StockRow { id: string; name: string; category: string; unit: string; unitLabel: string; packName: string; packSize: number; packCostCents: number | null; unitCostCents: number | null; vendorId: string | null; vendorName: string | null; parPacks: number | null; isActive: boolean; onHand: number | null; onHandPacks: number | null; low: boolean; suggestPacks: number; lastCountAt: string | null }
interface Vendor { id: string; name: string; email: string | null; phone: string | null; orderDays: string | null }
interface Meta { categories: Array<{ id: string; label: string }>; units: Record<string, string>; presets: Array<{ name: string; unit: string; size: number }> }

const pct = (n: number | null) => (n === null ? '—' : `${n}%`);
const day = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—');

export default function StockPage() {
  const [tab, setTab] = useState<Tab>('stock');
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100">Stock &amp; Costing</h1>
        <Link to="/crm/count" className={`${BTN} ${OFF} inline-flex items-center`}>Do a count</Link>
      </div>
      <div className="flex flex-wrap gap-2" role="tablist">
        {([['stock', 'Stock'], ['recipes', 'Recipes & pours'], ['counts', 'Counts'], ['orders', 'Orders']] as Array<[Tab, string]>).map(([t, l]) => (
          <button key={t} role="tab" aria-selected={tab === t} className={`${BTN} ${tab === t ? ON : OFF}`} onClick={() => setTab(t)}>{l}</button>
        ))}
      </div>
      {tab === 'stock' && <StockTab />}
      {tab === 'recipes' && <RecipesTab />}
      {tab === 'counts' && <CountsTab />}
      {tab === 'orders' && <OrdersTab />}
    </div>
  );
}

function StockTab() {
  const [data, setData] = useState<{ stock: StockRow[]; vendors: Vendor[] } & Meta | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<Partial<StockRow> & { cost?: string; par?: string } | null>(null);
  const [vendorEdit, setVendorEdit] = useState<Partial<Vendor> | null>(null);
  const load = useCallback(async () => { try { setData(await api.get('/api/stock/items')); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the stock.')); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  return (
    <>
      <FormError message={err} onDismiss={() => setErr('')} />
      <div className="flex flex-wrap gap-2">
        <button className={`${BTN} ${ON} inline-flex items-center gap-2`} onClick={() => setEdit({ category: 'food', unit: 'each', packName: 'each', packSize: 1, cost: '', par: '' })}><Plus className="w-4 h-4" />Stock item</button>
        <button className={`${BTN} ${OFF} inline-flex items-center gap-2`} onClick={() => setVendorEdit({})}><Plus className="w-4 h-4" />Vendor</button>
      </div>
      {data.stock.length === 0 && (
        <div className={CARD}>
          <p className="text-sm text-gray-900 dark:text-slate-100">No stock yet.</p>
          <p className={`text-sm mt-1 ${MUTED}`}>Add what you buy with "Stock item": a keg, a case of buns, a bottle. Set "Keep at least" on each, and the Orders tab will draft what is below it. Then say what each plate and pour uses under Recipes &amp; pours to see what it costs.</p>
        </div>
      )}
      {data.categories.map((c) => {
        const rows = data.stock.filter((s) => s.category === c.id);
        if (!rows.length) return null;
        return (
          <section key={c.id} className={CARD} aria-label={c.label}>
            <p className={`${LABEL} mb-2`}>{c.label}</p>
            <ul className="divide-y divide-gray-200 dark:divide-slate-800">
              {rows.map((s) => (
                <li key={s.id}>
                  <button className="w-full text-left py-2 flex flex-wrap items-center justify-between gap-2 hover:bg-gray-50 dark:hover:bg-slate-800 rounded-lg px-2" onClick={() => setEdit({ ...s, cost: s.packCostCents === null ? '' : (s.packCostCents / 100).toFixed(2), par: s.parPacks === null ? '' : String(s.parPacks) })}>
                    <span className="min-w-0 text-gray-900 dark:text-slate-100">
                      <span className="font-semibold">{s.name}</span>
                      <span className={`block text-xs ${MUTED}`}>{s.packName} of {s.packSize} {s.unitLabel} · {s.packCostCents === null ? 'no price yet' : money(s.packCostCents)}{s.vendorName ? ` · ${s.vendorName}` : ''}</span>
                    </span>
                    <span className="text-right text-sm text-gray-900 dark:text-slate-100">
                      {s.onHand === null ? <span className={MUTED}>Not counted yet</span> : <>{s.onHandPacks} {s.packName}</>}
                      {/* The par shows whether or not it has been counted (Bar Run 1: it only showed after a count). */}
                      <span className={`block text-xs ${MUTED}`}>{s.parPacks !== null ? `Keep at least ${s.parPacks} ${s.packName}` : 'No par set'}</span>
                      {s.low && <span className="block text-xs font-semibold text-amber-800 dark:text-amber-200">Order {s.suggestPacks}</span>}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {data.vendors.length > 0 && (
        <div className={CARD}>
          <p className={`${LABEL} mb-2`}>Vendors</p>
          <ul className="text-sm space-y-1">{data.vendors.map((v) => <li key={v.id}><button className="underline text-gray-900 dark:text-slate-100" onClick={() => setVendorEdit(v)}>{v.name}</button><span className={MUTED}>{[v.orderDays, v.email, v.phone].filter(Boolean).length ? ` · ${[v.orderDays, v.email, v.phone].filter(Boolean).join(' · ')}` : ''}</span></li>)}</ul>
        </div>
      )}
      {edit && <ItemDialog item={edit} meta={data} vendors={data.vendors} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
      {vendorEdit && <VendorDialog vendor={vendorEdit} onClose={() => setVendorEdit(null)} onSaved={() => { setVendorEdit(null); load(); }} />}
    </>
  );
}

function ItemDialog({ item, meta, vendors, onClose, onSaved }: { item: Partial<StockRow> & { cost?: string; par?: string }; meta: Meta; vendors: Vendor[]; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(item);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const preset = (name: string) => { const p = meta.presets.find((x) => x.name === name); if (p) setF({ ...f, packName: p.name, unit: p.unit, packSize: p.size }); };
  return (
    <Dialog title={f.id ? f.name || 'Stock item' : 'New stock item'} onClose={onClose} wide>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="sm:col-span-2"><label className={LABEL} htmlFor="si-name">Name</label><input id="si-name" className={`${INPUT} mt-1`} value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} maxLength={80} /></div>
        <div><label className={LABEL} htmlFor="si-cat">Kind</label><select id="si-cat" className={`${INPUT} mt-1`} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{meta.categories.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}</select></div>
        <div><label className={LABEL} htmlFor="si-preset">Bought as</label><select id="si-preset" className={`${INPUT} mt-1`} value="" onChange={(e) => preset(e.target.value)}><option value="">Pick a common pack…</option>{meta.presets.map((p) => <option key={p.name} value={p.name}>{p.name}</option>)}</select></div>
        <div><label className={LABEL} htmlFor="si-pack">Pack name</label><input id="si-pack" className={`${INPUT} mt-1`} value={f.packName || ''} onChange={(e) => setF({ ...f, packName: e.target.value })} maxLength={40} /></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className={LABEL} htmlFor="si-size">Holds</label><input id="si-size" className={`${INPUT} mt-1`} inputMode="decimal" value={String(f.packSize ?? '')} onChange={(e) => setF({ ...f, packSize: e.target.value as any })} /></div>
          <div><label className={LABEL} htmlFor="si-unit">Unit</label><select id="si-unit" className={`${INPUT} mt-1`} value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })}>{Object.entries(meta.units).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
        </div>
        <div><label className={LABEL} htmlFor="si-cost">Price per pack ($)</label><input id="si-cost" className={`${INPUT} mt-1`} inputMode="decimal" value={f.cost || ''} onChange={(e) => setF({ ...f, cost: e.target.value })} placeholder="Set when an order comes in" /></div>
        <div><label className={LABEL} htmlFor="si-par">Keep at least (packs)</label><input id="si-par" className={`${INPUT} mt-1`} inputMode="decimal" value={f.par || ''} onChange={(e) => setF({ ...f, par: e.target.value })} /></div>
        <div className="sm:col-span-2"><label className={LABEL} htmlFor="si-vendor">Vendor</label><select id="si-vendor" className={`${INPUT} mt-1`} value={f.vendorId || ''} onChange={(e) => setF({ ...f, vendorId: e.target.value || null })}><option value="">None</option>{vendors.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}</select></div>
        <label className="sm:col-span-2 flex items-center gap-2 text-sm text-gray-900 dark:text-slate-100"><input type="checkbox" className="w-5 h-5" checked={f.isActive !== false} onChange={(e) => setF({ ...f, isActive: e.target.checked })} /> Still stocked (uncheck to retire it)</label>
      </div>
      <FormError message={err} className="mt-3" />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} disabled={busy || !f.name?.trim()} onClick={async () => {
          setBusy(true); setErr('');
          const body = { name: f.name, category: f.category, unit: f.unit, packName: f.packName, packSize: f.packSize, packCostCents: f.cost?.trim() ? centsFrom(f.cost) : null, parPacks: f.par?.trim() ? f.par : null, vendorId: f.vendorId || null, isActive: f.isActive !== false };
          try { if (f.id) await api.patch(`/api/stock/items/${f.id}`, body); else await api.post('/api/stock/items', body); onSaved(); }
          catch (e) { setErr(errorText(e, 'That did not save.')); } finally { setBusy(false); }
        }}>Save</button>
      </div>
    </Dialog>
  );
}

function VendorDialog({ vendor, onClose, onSaved }: { vendor: Partial<Vendor>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState(vendor);
  const [err, setErr] = useState('');
  return (
    <Dialog title={f.id ? f.name || 'Vendor' : 'New vendor'} onClose={onClose}>
      <div className="space-y-3">
        {(['name', 'email', 'phone', 'orderDays'] as const).map((k) => (
          <div key={k}><label className={LABEL} htmlFor={`v-${k}`}>{k === 'orderDays' ? 'Order days (what the rep said)' : k[0].toUpperCase() + k.slice(1)}</label><input id={`v-${k}`} className={`${INPUT} mt-1`} value={(f as any)[k] || ''} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></div>
        ))}
      </div>
      <FormError message={err} className="mt-3" />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} disabled={!f.name?.trim()} onClick={async () => {
          setErr('');
          try { if (f.id) await api.patch(`/api/stock/vendors/${f.id}`, f); else await api.post('/api/stock/vendors', f); onSaved(); } catch (e) { setErr(errorText(e, 'That did not save.')); }
        }}>Save</button>
      </div>
    </Dialog>
  );
}

interface BookSize { id: string; name: string; priceCents: number | null; costCents: number | null; missing: string[]; pct: number | null; hasRecipe: boolean }
interface BookItem { id: string; name: string; lines: Array<{ id: string; sizeId: string | null; stockItemId: string; qty: number; name: string; unit: string }>; sizes: BookSize[] }
interface Pour { tapId: string; line: number; beer: string; priceCents: number | null; stockItemId: string | null; stockName: string | null; pourOz: number; costCents: number | null; pct: number | null; sizes?: Array<{ id: string; name: string; oz: number; priceCents: number | null; costCents: number | null; pct: number | null }> }

function RecipesTab() {
  const [data, setData] = useState<{ sections: Array<{ id: string; name: string; items: BookItem[] }>; pours: Pour[]; stock: Array<{ id: string; name: string; unitLabel: string; category: string }> } | null>(null);
  const [err, setErr] = useState('');
  const [edit, setEdit] = useState<{ item: BookItem; sizeId: string | null } | null>(null);
  const load = useCallback(async () => { try { setData(await api.get('/api/stock/recipes')); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the recipes.')); } }, []);
  useEffect(() => { load(); }, [load]);
  if (!data) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  const kegs = data.stock.filter((s) => s.category === 'beer');
  return (
    <>
      <FormError message={err} onDismiss={() => setErr('')} />
      {data.sections.map((s) => (
        <section key={s.id} className={CARD} aria-label={s.name}>
          <p className={`${LABEL} mb-2`}>{s.name}</p>
          <ul className="divide-y divide-gray-200 dark:divide-slate-800">
            {s.items.map((i) => (
              <li key={i.id} className="py-2">
                <p className="font-semibold text-gray-900 dark:text-slate-100">{i.name}</p>
                <div className="flex flex-wrap gap-2 mt-1">
                  {i.sizes.map((z) => (
                    <button key={z.id} className={`${BTN} ${OFF} min-h-[40px] text-xs`} onClick={() => setEdit({ item: i, sizeId: i.sizes.length > 1 ? z.id : null })}>
                      {i.sizes.length > 1 ? `${z.name}: ` : ''}{z.hasRecipe ? (z.costCents === null ? `missing ${z.missing.join(', ')}` : `${money(z.costCents)} · ${pct(z.pct)}`) : 'No recipe'}
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
      {data.pours.length > 0 && (
        <section className={CARD} aria-label="Pours">
          <p className={`${LABEL} mb-2`}>On tap</p>
          <ul className="divide-y divide-gray-200 dark:divide-slate-800">
            {data.pours.map((p) => (
              <li key={p.tapId} className="py-2 grid grid-cols-1 sm:grid-cols-[1fr_200px_90px_120px] gap-2 items-center text-gray-900 dark:text-slate-100">
                <span><span className="font-semibold">{p.line}. {p.beer}</span><span className={`block text-xs ${MUTED}`}>{p.costCents === null ? 'Pick its keg to cost it' : (p.sizes && p.sizes.length > 1 ? p.sizes.map((z) => `${z.name} ${money(z.costCents)} · ${pct(z.pct)}`).join(' — ') : `${money(p.costCents)} a pour · ${pct(p.pct)}`)}</span></span>
                <select aria-label={`Keg on line ${p.line}`} className={INPUT} value={p.stockItemId || ''} onChange={async (e) => { try { await api.patch(`/api/stock/taps/${p.tapId}`, { stockItemId: e.target.value || null }); load(); } catch (ex) { setErr(errorText(ex, 'That did not save.')); } }}>
                  <option value="">No keg</option>{kegs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                </select>
                <input aria-label={`Pour size on line ${p.line}, ounces`} className={INPUT} inputMode="decimal" defaultValue={String(p.pourOz)} onBlur={async (e) => { if (Number(e.target.value) === p.pourOz) return; try { await api.patch(`/api/stock/taps/${p.tapId}`, { pourOz: e.target.value }); load(); } catch (ex) { setErr(errorText(ex, 'That did not save.')); } }} />
                <span className={`text-xs ${MUTED}`}>oz a pour</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {edit && <RecipeDialog edit={edit} stock={data.stock} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); load(); }} />}
    </>
  );
}

function RecipeDialog({ edit, stock, onClose, onSaved }: { edit: { item: BookItem; sizeId: string | null }; stock: Array<{ id: string; name: string; unitLabel: string }>; onClose: () => void; onSaved: () => void }) {
  const start = edit.item.lines.filter((l) => l.sizeId === edit.sizeId).map((l) => ({ stockItemId: l.stockItemId, qty: String(l.qty) }));
  const [lines, setLines] = useState(start.length ? start : [{ stockItemId: '', qty: '' }]);
  const [err, setErr] = useState('');
  const size = edit.item.sizes.find((z) => z.id === edit.sizeId);
  return (
    <Dialog title={`${edit.item.name}${size && edit.sizeId ? ` (${size.name})` : ''}`} onClose={onClose} wide>
      <p className={`text-sm mb-3 ${MUTED}`}>What goes into one{edit.sizeId ? ' of this size' : ' (every size)'}, in each item's own unit.</p>
      <ul className="space-y-2">
        {lines.map((l, i) => (
          <li key={i} className="grid grid-cols-[1fr_110px_auto] gap-2 items-center">
            <select aria-label="Stock item" className={INPUT} value={l.stockItemId} onChange={(e) => setLines((x) => x.map((y, n) => (n === i ? { ...y, stockItemId: e.target.value } : y)))}>
              <option value="">Pick…</option>{stock.map((s) => <option key={s.id} value={s.id}>{s.name} ({s.unitLabel})</option>)}
            </select>
            <input aria-label="Quantity" className={INPUT} inputMode="decimal" value={l.qty} onChange={(e) => setLines((x) => x.map((y, n) => (n === i ? { ...y, qty: e.target.value } : y)))} />
            <button className={`${BTN} ${DANGER} px-3`} aria-label="Remove" onClick={() => setLines((x) => x.filter((_, n) => n !== i))}><Trash2 className="w-4 h-4" /></button>
          </li>
        ))}
      </ul>
      <button className={`${BTN} ${OFF} inline-flex items-center gap-2 mt-2`} onClick={() => setLines((x) => [...x, { stockItemId: '', qty: '' }])}><Plus className="w-4 h-4" />Ingredient</button>
      <FormError message={err} className="mt-3" />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} onClick={async () => {
          setErr('');
          try { await api.put(`/api/stock/recipes/${edit.item.id}`, { sizeId: edit.sizeId, lines: lines.filter((l) => l.stockItemId && l.qty.trim()) }); onSaved(); } catch (e) { setErr(errorText(e, 'The recipe did not save.')); }
        }}>Save the recipe</button>
      </div>
    </Dialog>
  );
}

function CountsTab() {
  const [counts, setCounts] = useState<Array<{ id: string; status: string; startedAt: string; finishedAt: string | null; finishedByName: string | null; items: number }> | null>(null);
  const [report, setReport] = useState<any>(null);
  const [err, setErr] = useState('');
  useEffect(() => { api.get('/api/stock/counts').then((r) => setCounts(r.counts)).catch((e) => setErr(errorText(e, 'Could not load the counts.'))); }, []);
  if (!counts) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  return (
    <>
      <FormError message={err} onDismiss={() => setErr('')} />
      <div className={CARD}>
        {counts.length === 0 && <p className={`text-sm ${MUTED}`}>No counts yet. On hand is estimated from the first one on.</p>}
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {counts.map((c) => (
            <li key={c.id} className="py-2 flex items-center justify-between gap-2 text-gray-900 dark:text-slate-100">
              <span>{c.status === 'open' ? 'In progress' : `Finished ${day(c.finishedAt)}`}{c.finishedByName ? ` by ${c.finishedByName}` : ''} · {c.items} items</span>
              {c.status === 'done' && <button className={`${BTN} ${OFF} min-h-[40px]`} onClick={async () => { try { setReport(await api.get(`/api/stock/counts/${c.id}/report`)); } catch (e) { setErr(errorText(e, 'Could not load the report.')); } }}>Report</button>}
            </li>
          ))}
        </ul>
      </div>
      {report && (
        <Dialog title="Since the count before" onClose={() => setReport(null)} wide>
          {!report.previous && <p className={`text-sm ${MUTED}`}>This was the first count, so there is nothing to compare it with yet.</p>}
          {report.totals && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              {[['Unaccounted for', money(report.totals.varianceCents)], ['Food cost', pct(report.totals.foodCostPct)], ['Pour cost', pct(report.totals.pourCostPct)], ['Sales', money(report.totals.foodSalesCents + report.totals.drinkSalesCents)]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-gray-200 dark:border-slate-700 p-2"><p className={LABEL}>{k}</p><p className="font-bold text-gray-900 dark:text-slate-100">{v}</p></div>
              ))}
            </div>
          )}
          <ul className="text-sm divide-y divide-gray-200 dark:divide-slate-800 max-h-[50vh] overflow-y-auto">
            {report.rows.map((r: any) => (
              <li key={r.stockItemId} className="py-2 flex justify-between gap-2 text-gray-900 dark:text-slate-100">
                <span>{r.name}<span className={`block text-xs ${MUTED}`}>used {r.actual} {r.unit === 'floz' ? 'fl oz' : r.unit}, the register says {r.expected}</span></span>
                <span className="font-mono">{r.varianceCents === null ? '—' : money(r.varianceCents)}</span>
              </li>
            ))}
          </ul>
        </Dialog>
      )}
    </>
  );
}

function OrdersTab() {
  const [orders, setOrders] = useState<any[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState('');
  const [receiving, setReceiving] = useState<any>(null);
  const load = useCallback(async () => { try { setOrders((await api.get('/api/stock/orders')).orders); setErr(''); } catch (e) { setErr(errorText(e, 'Could not load the orders.')); } }, []);
  useEffect(() => { load(); }, [load]);
  const act = async (key: string, fn: () => Promise<unknown>) => { setBusy(key); setErr(''); try { await fn(); await load(); } catch (e) { setErr(errorText(e, 'That did not go.')); } finally { setBusy(''); } };
  if (!orders) return <div className="flex justify-center py-10">{err ? <FormError message={err} /> : <Loader2 className="w-6 h-6 animate-spin text-gray-500 dark:text-slate-400" />}</div>;
  return (
    <>
      <FormError message={err} onDismiss={() => setErr('')} />
      <button className={`${BTN} ${ON}`} disabled={!!busy} onClick={() => act('draft', () => api.post('/api/stock/orders/draft-low', {}))}>Order what is below par</button>
      <div className={CARD}>
        {orders.length === 0 && <p className={`text-sm ${MUTED}`}>No orders yet.</p>}
        <ul className="divide-y divide-gray-200 dark:divide-slate-800">
          {orders.map((o) => (
            <li key={o.id} className="py-3">
              <div className="flex flex-wrap items-center justify-between gap-2 text-gray-900 dark:text-slate-100">
                <span className="font-semibold">#{o.number} · {o.vendor?.name || 'No vendor'} · {o.status}</span>
                <span className="font-mono">{money(o.totalCents)}</span>
              </div>
              <p className={`text-xs ${MUTED}`}>{o.lines.map((l: any) => `${l.packs} ${l.packName} ${l.name}`).join(' · ')}</p>
              {(o.status === 'draft' || o.status === 'sent') && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {o.status === 'draft' && o.vendor?.email && <button className={`${BTN} ${OFF} min-h-[40px]`} disabled={!!busy} onClick={() => act(o.id, () => api.post(`/api/stock/orders/${o.id}/send`, { email: true }))}>Email it to {o.vendor.name}</button>}
                  {o.status === 'draft' && <button className={`${BTN} ${OFF} min-h-[40px]`} disabled={!!busy} onClick={() => act(o.id, () => api.post(`/api/stock/orders/${o.id}/send`, {}))}>Mark sent</button>}
                  <button className={`${BTN} ${ON} min-h-[40px]`} disabled={!!busy} onClick={() => setReceiving(o)}>It came in</button>
                  <button className={`${BTN} ${DANGER} min-h-[40px]`} disabled={!!busy} onClick={() => act(o.id, () => api.post(`/api/stock/orders/${o.id}/cancel`, {}))}>Cancel</button>
                </div>
              )}
            </li>
          ))}
        </ul>
      </div>
      {receiving && <ReceiveDialog order={receiving} onClose={() => setReceiving(null)} onSaved={() => { setReceiving(null); load(); }} />}
    </>
  );
}

function ReceiveDialog({ order, onClose, onSaved }: { order: any; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState(order.lines.map((l: any) => ({ lineId: l.id, name: l.name, packName: l.packName, packs: String(l.packs), cost: l.packCostCents === null ? '' : (l.packCostCents / 100).toFixed(2) })));
  const [err, setErr] = useState('');
  return (
    <Dialog title={`Order #${order.number} came in`} onClose={onClose} wide>
      <p className={`text-sm mb-3 ${MUTED}`}>What actually came, and the price on the invoice — it becomes each item's price.</p>
      <ul className="space-y-2">
        {rows.map((r: any, i: number) => (
          <li key={r.lineId} className="grid grid-cols-[1fr_90px_110px] gap-2 items-center text-gray-900 dark:text-slate-100">
            <span>{r.name} <span className={`text-xs ${MUTED}`}>({r.packName})</span></span>
            <input aria-label={`${r.name} packs received`} className={INPUT} inputMode="decimal" value={r.packs} onChange={(e) => setRows((x: any[]) => x.map((y, n) => (n === i ? { ...y, packs: e.target.value } : y)))} />
            <input aria-label={`${r.name} price per pack`} className={INPUT} inputMode="decimal" value={r.cost} onChange={(e) => setRows((x: any[]) => x.map((y, n) => (n === i ? { ...y, cost: e.target.value } : y)))} placeholder="$ / pack" />
          </li>
        ))}
      </ul>
      <FormError message={err} className="mt-3" />
      <div className="flex justify-end gap-2 mt-4">
        <button className={`${BTN} ${OFF}`} onClick={onClose}>Cancel</button>
        <button className={`${BTN} ${ON}`} onClick={async () => {
          setErr('');
          try { await api.post(`/api/stock/orders/${order.id}/receive`, { lines: rows.map((r: any) => ({ lineId: r.lineId, packs: r.packs, packCostCents: r.cost.trim() ? centsFrom(r.cost) : null })) }); onSaved(); }
          catch (e) { setErr(errorText(e, 'That did not save.')); }
        }}>Receive</button>
      </div>
    </Dialog>
  );
}
