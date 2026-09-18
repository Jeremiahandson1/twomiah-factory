import { useState, useEffect, useCallback } from 'react';
import { ShoppingCart, Search, Loader2, Trash2, PackagePlus, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';

const money = (n?: number | string | null) => (n != null && n !== '' ? '$' + Number(n).toFixed(2) : '$0.00');

interface Contact { id: string; name: string }

/**
 * Parts Counter — walk-in parts POS. Lines pull from the same perpetual stock
 * ledger as repair-order parts.
 */
export default function CounterPage() {
  const [locations, setLocations] = useState<any[]>([]);
  const [loc, setLoc] = useState('');
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [customerId, setCustomerId] = useState('');

  const [saleId, setSaleId] = useState<string | null>(null);
  const [sale, setSale] = useState<any | null>(null);

  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [addQty, setAddQty] = useState('1');

  const [paymentMethod, setPaymentMethod] = useState('cash');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [done, setDone] = useState<{ number: string; total: string } | null>(null);

  useEffect(() => {
    api.get('/api/inventory/locations').then((r: any) => {
      const locs = Array.isArray(r) ? r : (r?.data || []);
      setLocations(locs);
      if (locs[0]) setLoc(locs[0].id);
    }).catch(() => {});
    api.get('/api/contacts?limit=500').then((r: any) => setContacts(r.data || [])).catch(() => {});
  }, []);

  const reloadSale = useCallback(async (id: string) => {
    try { setSale(await api.get(`/api/counter-sales/${id}`)); } catch { /* ignore */ }
  }, []);

  async function ensureSale(): Promise<string> {
    if (saleId) return saleId;
    const s = await api.post('/api/counter-sales', { customerId: customerId || undefined });
    setSaleId(s.id); setSale({ ...s, lines: [] });
    return s.id;
  }

  async function search() {
    setSearching(true);
    try { const r = await api.get('/api/oem-parts/search', { q }); setResults(r.parts || []); }
    catch { /* ignore */ } finally { setSearching(false); }
  }

  async function addLine(p: any) {
    setBusy(true); setErr(''); setDone(null);
    try {
      const id = await ensureSale();
      const r = await api.post(`/api/counter-sales/${id}/lines`, {
        catalogPartId: p.id || undefined,
        locationId: loc || undefined,
        quantity: parseInt(addQty) || 1,
        unitPrice: p.price,
        description: p.name,
        partNumber: p.partNumber,
      });
      if (r?.error) setErr(r.error);
      else { await reloadSale(id); if (q) await search(); }
    } catch (e: any) { setErr(e?.message || 'Failed to add part'); }
    finally { setBusy(false); }
  }

  async function removeLine(lineId: string) {
    if (!saleId) return;
    setBusy(true); setErr('');
    try {
      await api.delete(`/api/counter-sales/${saleId}/lines/${lineId}`);
      await reloadSale(saleId); if (q) await search();
    } catch (e: any) { setErr(e?.message || 'Failed to remove line'); }
    finally { setBusy(false); }
  }

  async function complete() {
    if (!saleId || !sale?.lines?.length) { setErr('Add at least one part first.'); return; }
    setBusy(true); setErr('');
    try {
      const s = await api.post(`/api/counter-sales/${saleId}/complete`, { paymentMethod });
      if (s?.error) { setErr(s.error); }
      else {
        setDone({ number: s.saleNumber || 'Sale', total: s.total });
        setSaleId(null); setSale(null); setCustomerId(''); setResults([]); setQ('');
      }
    } catch (e: any) { setErr(e?.message || 'Failed to complete sale'); }
    finally { setBusy(false); }
  }

  const lines = sale?.lines || [];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-orange-500 flex items-center justify-center text-white"><ShoppingCart size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">Parts Counter</h1>
          <p className="text-sm text-gray-500">Walk-in parts sale — pulls from live inventory.</p>
        </div>
      </div>

      {done && (
        <div className="mb-4 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-800 flex items-center gap-2">
          <CheckCircle2 size={16} /> <b>{done.number}</b> completed — {money(done.total)}. Ready for the next customer.
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-4">
        {/* Catalog search */}
        <div className="bg-white rounded-xl border shadow-sm p-4">
          <label className="text-xs font-medium text-gray-600">Add parts</label>
          <div className="flex gap-2 mt-1 mb-2">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
              placeholder="part # or name" className="flex-1 p-2 border rounded-lg text-sm" />
            <button onClick={search} disabled={searching} className="px-3 rounded-lg bg-slate-700 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50">
              {searching ? <Loader2 className="animate-spin w-4 h-4" /> : <Search className="w-4 h-4" />}</button>
          </div>
          <div className="flex items-end gap-3 mb-2">
            <div>
              <label className="text-xs text-gray-600">Qty</label>
              <input value={addQty} onChange={(e) => setAddQty(e.target.value)} type="number" min="1" className="mt-1 w-16 p-2 border rounded-lg text-sm" />
            </div>
            {locations.length > 0 && (
              <div>
                <label className="text-xs text-gray-600">Pull from</label>
                <select value={loc} onChange={(e) => setLoc(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm">
                  {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                </select>
              </div>
            )}
          </div>
          <div className="max-h-72 overflow-y-auto border rounded-lg divide-y">
            {results.length === 0 && <div className="py-6 text-center text-sm text-gray-400">Search the catalog to add parts.</div>}
            {results.map((p, i) => (
              <div key={p.id || i} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50">
                <div>
                  <span className="font-mono text-xs">{p.partNumber}</span> · {p.name}
                  <span className="text-xs text-gray-400"> · {p.oem}</span>
                  {p.id && <span className={`ml-2 text-[10px] ${p.onHand > 0 ? 'text-green-700' : 'text-gray-400'}`}>on hand: {p.onHand ?? 0}</span>}
                </div>
                <button onClick={() => addLine(p)} disabled={busy} className="shrink-0 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50">
                  <PackagePlus className="w-3.5 h-3.5" /> {money(p.price)}</button>
              </div>
            ))}
          </div>
        </div>

        {/* Ticket */}
        <div className="bg-white rounded-xl border shadow-sm p-4 flex flex-col">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Ticket {sale?.saleNumber ? `· ${sale.saleNumber}` : ''}</h2>
            <select value={customerId} onChange={(e) => setCustomerId(e.target.value)} disabled={!!saleId}
              className="text-xs p-1.5 border rounded-lg max-w-[55%]" title={saleId ? 'Set before adding the first part' : ''}>
              <option value="">Walk-in (no customer)</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>

          <div className="flex-1 border rounded-lg divide-y min-h-[8rem] mb-3">
            {lines.length === 0 ? (
              <div className="py-8 text-center text-sm text-gray-400">No parts on the ticket yet.</div>
            ) : lines.map((l: any) => (
              <div key={l.id} className="flex items-center justify-between px-3 py-2 text-sm">
                <div>
                  <div className="font-mono text-xs">{l.partNumber || '—'}</div>
                  <div className="text-gray-700">{l.description}</div>
                  {l.stockDecremented
                    ? <span className="text-[10px] text-green-700">− pulled from stock</span>
                    : <span className="text-[10px] text-gray-400">not stocked</span>}
                </div>
                <div className="flex items-center gap-2 whitespace-nowrap">
                  <span className="text-gray-600">{l.quantity} × {money(l.unitPrice)}</span>
                  <span className="font-semibold w-16 text-right">{money(l.totalPrice)}</span>
                  <button onClick={() => removeLine(l.id)} disabled={busy} className="text-gray-400 hover:text-red-600 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex justify-between text-sm mb-1"><span className="text-gray-500">Subtotal</span><span>{money(sale?.subtotal)}</span></div>
          <div className="flex justify-between text-base font-bold mb-3"><span>Total</span><span>{money(sale?.total)}</span></div>

          {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

          <div className="flex items-center gap-2">
            <select value={paymentMethod} onChange={(e) => setPaymentMethod(e.target.value)} className="p-2 border rounded-lg text-sm">
              <option value="cash">Cash</option>
              <option value="card">Card</option>
              <option value="account">On account</option>
              <option value="other">Other</option>
            </select>
            <button onClick={complete} disabled={busy || !lines.length}
              className="flex-1 px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-medium hover:bg-orange-600 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">
              {busy ? <Loader2 className="animate-spin" size={15} /> : <CheckCircle2 size={15} />} Complete sale
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
