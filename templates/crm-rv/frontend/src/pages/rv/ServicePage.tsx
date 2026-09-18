import { useState, useEffect, useCallback } from 'react';
import { Plus, Loader2, X, Wrench, Package, Search, Trash2, PackagePlus } from 'lucide-react';
import api from '../../services/api';

const money = (n?: number | string | null) => (n != null && n !== '' ? '$' + Number(n).toFixed(2) : '$0.00');

/**
 * Service Department — repair orders backed by /api/repair-orders.
 */

const STATUSES: { value: string; label: string }[] = [
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'waiting_parts', label: 'Waiting Parts' },
  { value: 'ready', label: 'Ready' },
  { value: 'closed', label: 'Closed' },
];

const STATUS_COLORS: Record<string, string> = {
  open: 'bg-blue-100 text-blue-700',
  in_progress: 'bg-purple-100 text-purple-700',
  waiting_parts: 'bg-amber-100 text-amber-700',
  ready: 'bg-green-100 text-green-700',
  closed: 'bg-gray-100 text-gray-700',
};

interface RoRow {
  ro: {
    id: string;
    roNumber?: string;
    status: string;
    customerUnitInfo?: string | null;
    advisorName?: string | null;
    estimatedTotal?: string | null;
    services?: string[] | null;
    notes?: string | null;
    writeUpDate?: string | null;
  };
  customerName?: string | null;
  customerPhone?: string | null;
  unitYear?: number | null;
  unitMake?: string | null;
  unitModel?: string | null;
  unitVin?: string | null;
}

function unitDesc(row: RoRow): string {
  const fromUnit = [row.unitYear, row.unitMake, row.unitModel].filter(Boolean).join(' ');
  return fromUnit || row.ro.customerUnitInfo || '—';
}

export default function ServicePage() {
  const [rows, setRows] = useState<RoRow[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [showForm, setShowForm] = useState<boolean>(false);
  const [partsRo, setPartsRo] = useState<RoRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (statusFilter) params.set('status', statusFilter);
      params.set('limit', '200');
      const res = await api.get(`/api/repair-orders?${params.toString()}`);
      setRows(res.data || []);
    } catch (error) {
      console.error('Failed to load repair orders:', error);
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  const changeStatus = async (id: string, status: string) => {
    setRows((prev) => prev.map((r) => (r.ro.id === id ? { ...r, ro: { ...r.ro, status } } : r)));
    try {
      await api.put(`/api/repair-orders/${id}`, { status });
    } catch {
      alert('Failed to update status');
      load();
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Service</h1>
          <p className="text-gray-500">Repair orders & shop status</p>
        </div>
        <button onClick={() => setShowForm(true)} className="flex items-center gap-2 px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600">
          <Plus className="w-4 h-4" /> New Repair Order
        </button>
      </div>

      <div className="flex items-center gap-3">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border rounded-lg">
          <option value="">All Statuses</option>
          {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
        </div>
      ) : rows.length === 0 ? (
        <div className="text-center py-12 text-gray-500 bg-white rounded-xl border">No repair orders</div>
      ) : (
        <div className="bg-white rounded-xl border overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">RO #</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Customer</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Unit</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Advisor</th>
                <th className="text-right px-4 py-3 text-sm font-medium text-gray-500">Est. Total</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Status</th>
                <th className="text-left px-4 py-3 text-sm font-medium text-gray-500">Parts</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((row) => (
                <tr key={row.ro.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{row.ro.roNumber || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-700">{row.customerName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{unitDesc(row)}</td>
                  <td className="px-4 py-3 text-sm text-gray-600">{row.ro.advisorName || '—'}</td>
                  <td className="px-4 py-3 text-sm text-right text-gray-900">
                    {row.ro.estimatedTotal ? `$${Number(row.ro.estimatedTotal).toLocaleString()}` : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={row.ro.status}
                      onChange={(e) => changeStatus(row.ro.id, e.target.value)}
                      className={`text-xs px-2 py-1 rounded-full border-0 ${STATUS_COLORS[row.ro.status] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <button onClick={() => setPartsRo(row)} className="inline-flex items-center gap-1 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">
                      <Package className="w-3.5 h-3.5" /> Parts
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && <RoFormModal onSave={() => { setShowForm(false); load(); }} onClose={() => setShowForm(false)} />}
      {partsRo && <RoPartsModal row={partsRo} onClose={() => setPartsRo(null)} />}
    </div>
  );
}

/* ---------------- New RO Modal ---------------- */

interface ContactOption { id: string; name: string }
interface UnitOption { id: string; year?: number; make?: string; modelName?: string }

interface RoFormModalProps { onSave: () => void; onClose: () => void }

function RoFormModal({ onSave, onClose }: RoFormModalProps) {
  const [contacts, setContacts] = useState<ContactOption[]>([]);
  const [units, setUnits] = useState<UnitOption[]>([]);
  const [saving, setSaving] = useState<boolean>(false);
  const [form, setForm] = useState({
    customerId: '', unitId: '', customerUnitInfo: '',
    advisorName: '', estimatedTotal: '', status: 'open', services: '', notes: '',
  });

  useEffect(() => {
    (async () => {
      try {
        const [contactsRes, unitsRes] = await Promise.all([
          api.get('/api/contacts?limit=500'),
          api.get('/api/units?limit=500'),
        ]);
        setContacts(contactsRes.data || []);
        setUnits(unitsRes.data || []);
      } catch {
        /* degrade gracefully */
      }
    })();
  }, []);

  const set = (k: string, v: string) => setForm((f) => ({ ...f, [k]: v }));

  const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!form.customerId) { alert('Customer is required'); return; }
    setSaving(true);
    try {
      const services = form.services.split(',').map((s) => s.trim()).filter(Boolean);
      await api.post('/api/repair-orders', {
        customerId: form.customerId,
        unitId: form.unitId || undefined,
        customerUnitInfo: form.unitId ? undefined : (form.customerUnitInfo || undefined),
        advisorName: form.advisorName || undefined,
        estimatedTotal: form.estimatedTotal || undefined,
        status: form.status || 'open',
        services: services.length ? services : undefined,
        notes: form.notes || undefined,
      });
      onSave();
    } catch (err) {
      alert((err as Error).message || 'Failed to create repair order');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-bold flex items-center gap-2"><Wrench className="w-5 h-5 text-orange-500" /> New Repair Order</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer <span className="text-red-500">*</span></label>
              <select value={form.customerId} onChange={(e) => set('customerId', e.target.value)} className="w-full px-3 py-2 border rounded-lg" required>
                <option value="">Select customer...</option>
                {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Unit</label>
              <select value={form.unitId} onChange={(e) => set('unitId', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                <option value="">Not in inventory — enter manually below</option>
                {units.map((u) => (
                  <option key={u.id} value={u.id}>{[u.year, u.make, u.modelName].filter(Boolean).join(' ') || u.id}</option>
                ))}
              </select>
            </div>
            {!form.unitId && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Customer Unit Info</label>
                <input type="text" value={form.customerUnitInfo} onChange={(e) => set('customerUnitInfo', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="2019 Forest River Cherokee 274RK" />
              </div>
            )}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Advisor</label>
                <input type="text" value={form.advisorName} onChange={(e) => set('advisorName', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Total</label>
                <input type="number" step="0.01" value={form.estimatedTotal} onChange={(e) => set('estimatedTotal', e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <select value={form.status} onChange={(e) => set('status', e.target.value)} className="w-full px-3 py-2 border rounded-lg">
                {STATUSES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Services (comma-separated)</label>
              <input type="text" value={form.services} onChange={(e) => set('services', e.target.value)} className="w-full px-3 py-2 border rounded-lg" placeholder="Roof reseal, Wheel bearing repack" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
              <textarea value={form.notes} onChange={(e) => set('notes', e.target.value)} rows={3} className="w-full px-3 py-2 border rounded-lg" />
            </div>
            <div className="flex gap-3 pt-2">
              <button type="button" onClick={onClose} className="flex-1 px-4 py-2 border rounded-lg">Cancel</button>
              <button type="submit" disabled={saving} className="flex-1 px-4 py-2 bg-orange-500 text-white rounded-lg disabled:opacity-50">
                {saving ? 'Saving...' : 'Create RO'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

/* ---------------- RO Parts Panel ---------------- */

interface RoPartsModalProps { row: RoRow; onClose: () => void }

function RoPartsModal({ row, onClose }: RoPartsModalProps) {
  const roId = row.ro.id;
  const [parts, setParts] = useState<any[]>([]);
  const [loadingParts, setLoadingParts] = useState<boolean>(true);
  const [locations, setLocations] = useState<any[]>([]);
  const [loc, setLoc] = useState('');
  const [q, setQ] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);
  const [addQty, setAddQty] = useState('1');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [custom, setCustom] = useState({ description: '', quantity: '1', unitPrice: '' });

  const loadParts = useCallback(async () => {
    setLoadingParts(true);
    try { setParts(await api.get(`/api/repair-orders/${roId}/parts`) || []); }
    catch { /* ignore */ } finally { setLoadingParts(false); }
  }, [roId]);

  useEffect(() => {
    loadParts();
    api.get('/api/inventory/locations').then((r: any) => {
      const locs = Array.isArray(r) ? r : (r?.data || []);
      setLocations(locs);
      if (locs[0]) setLoc(locs[0].id);
    }).catch(() => {});
  }, [loadParts]);

  async function search() {
    setSearching(true);
    try { const r = await api.get('/api/oem-parts/search', { q }); setResults(r.parts || []); }
    catch { /* ignore */ } finally { setSearching(false); }
  }

  async function addCatalog(p: any) {
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/repair-orders/${roId}/parts`, {
        catalogPartId: p.id || undefined,
        locationId: loc || undefined,
        quantity: parseInt(addQty) || 1,
        unitPrice: p.price,
        description: p.name,
        partNumber: p.partNumber,
      });
      if (r?.error) setErr(r.error);
      else { await loadParts(); if (q) await search(); }
    } catch (e: any) { setErr(e?.message || 'Failed to add part'); }
    finally { setBusy(false); }
  }

  async function addCustom() {
    if (!custom.description.trim()) { setErr('Enter a description.'); return; }
    setBusy(true); setErr('');
    try {
      const r = await api.post(`/api/repair-orders/${roId}/parts`, {
        description: custom.description.trim(),
        quantity: parseInt(custom.quantity) || 1,
        unitPrice: custom.unitPrice || 0,
      });
      if (r?.error) setErr(r.error);
      else { setCustom({ description: '', quantity: '1', unitPrice: '' }); await loadParts(); }
    } catch (e: any) { setErr(e?.message || 'Failed to add part'); }
    finally { setBusy(false); }
  }

  async function removePart(partId: string) {
    setBusy(true); setErr('');
    try {
      await api.delete(`/api/repair-orders/${roId}/parts/${partId}`);
      await loadParts(); if (q) await search();
    } catch (e: any) { setErr(e?.message || 'Failed to remove part'); }
    finally { setBusy(false); }
  }

  const partsTotal = parts.reduce((s, p) => s + Number(p.totalPrice || 0), 0);

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      <div className="fixed inset-0 bg-black/50" onClick={onClose} />
      <div className="relative min-h-screen flex items-start justify-center p-4 py-8">
        <div className="relative bg-white rounded-xl shadow-xl max-w-2xl w-full p-6">
          <div className="flex items-center justify-between mb-1">
            <h2 className="text-lg font-bold flex items-center gap-2"><Package className="w-5 h-5 text-orange-500" /> Parts — {row.ro.roNumber || 'RO'}</h2>
            <button onClick={onClose} className="p-1 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
          <p className="text-xs text-gray-500 mb-4">{row.customerName || '—'} · {unitDesc(row)}</p>

          {/* Current parts on the RO */}
          <div className="border rounded-lg overflow-hidden mb-4">
            <div className="px-3 py-2 bg-gray-50 border-b text-xs font-semibold text-gray-600 flex justify-between">
              <span>Parts on this order</span><span>Total: {money(partsTotal)}</span>
            </div>
            {loadingParts ? (
              <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
            ) : parts.length === 0 ? (
              <div className="py-6 text-center text-sm text-gray-400">No parts yet — add from the catalog below.</div>
            ) : (
              <table className="w-full text-sm">
                <tbody className="divide-y">
                  {parts.map((p) => (
                    <tr key={p.id}>
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs">{p.partNumber || '—'}</div>
                        <div className="text-gray-700">{p.description}</div>
                        {p.stockDecremented
                          ? <span className="text-[10px] text-green-700">− pulled from stock</span>
                          : <span className="text-[10px] text-gray-400">not stocked (no decrement)</span>}
                      </td>
                      <td className="px-3 py-2 text-center text-gray-600 whitespace-nowrap">{p.quantity} × {money(p.unitPrice)}</td>
                      <td className="px-3 py-2 text-right font-semibold whitespace-nowrap">{money(p.totalPrice)}</td>
                      <td className="px-2 py-2 text-right">
                        <button onClick={() => removePart(p.id)} disabled={busy} className="text-gray-400 hover:text-red-600 disabled:opacity-50" title="Remove (restocks if pulled)"><Trash2 className="w-4 h-4" /></button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>

          {err && <p className="text-xs text-red-600 mb-2">{err}</p>}

          {/* Add from catalog */}
          <div className="border rounded-lg p-3 mb-3">
            <div className="flex items-end gap-2 mb-2 flex-wrap">
              <div className="flex-1 min-w-[180px]">
                <label className="text-xs font-medium text-gray-600">Add from catalog</label>
                <div className="flex gap-2 mt-1">
                  <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }}
                    placeholder="part # or name" className="flex-1 p-2 border rounded-lg text-sm" />
                  <button onClick={search} disabled={searching} className="px-3 rounded-lg bg-slate-700 text-white text-sm inline-flex items-center gap-1 disabled:opacity-50">
                    {searching ? <Loader2 className="animate-spin w-4 h-4" /> : <Search className="w-4 h-4" />}</button>
                </div>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600">Qty</label>
                <input value={addQty} onChange={(e) => setAddQty(e.target.value)} type="number" min="1" className="mt-1 w-16 p-2 border rounded-lg text-sm" />
              </div>
              {locations.length > 0 && (
                <div>
                  <label className="text-xs font-medium text-gray-600">Pull from</label>
                  <select value={loc} onChange={(e) => setLoc(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm">
                    {locations.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                  </select>
                </div>
              )}
            </div>
            {results.length > 0 && (
              <div className="max-h-48 overflow-y-auto border rounded-lg divide-y">
                {results.map((p, i) => (
                  <div key={p.id || i} className="flex items-center justify-between px-3 py-2 text-sm hover:bg-gray-50">
                    <div>
                      <span className="font-mono text-xs">{p.partNumber}</span> · {p.name}
                      <span className="text-xs text-gray-400"> · {p.oem}</span>
                      {p.id && <span className={`ml-2 text-[10px] ${p.onHand > 0 ? 'text-green-700' : 'text-gray-400'}`}>on hand: {p.onHand ?? 0}</span>}
                    </div>
                    <button onClick={() => addCatalog(p)} disabled={busy} className="shrink-0 text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50 inline-flex items-center gap-1 disabled:opacity-50">
                      <PackagePlus className="w-3.5 h-3.5" /> {money(p.price)}</button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Add a custom / non-stock line */}
          <div className="border rounded-lg p-3">
            <label className="text-xs font-medium text-gray-600">Or add a custom part (no stock decrement)</label>
            <div className="flex gap-2 mt-1 flex-wrap">
              <input value={custom.description} onChange={(e) => setCustom((c) => ({ ...c, description: e.target.value }))} placeholder="description" className="flex-1 min-w-[160px] p-2 border rounded-lg text-sm" />
              <input value={custom.quantity} onChange={(e) => setCustom((c) => ({ ...c, quantity: e.target.value }))} type="number" min="1" className="w-16 p-2 border rounded-lg text-sm" />
              <input value={custom.unitPrice} onChange={(e) => setCustom((c) => ({ ...c, unitPrice: e.target.value }))} type="number" min="0" step="0.01" placeholder="price" className="w-24 p-2 border rounded-lg text-sm" />
              <button onClick={addCustom} disabled={busy} className="px-3 py-2 rounded-lg border border-slate-300 hover:bg-slate-50 text-sm inline-flex items-center gap-1 disabled:opacity-50"><Plus className="w-4 h-4" /> Add</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
