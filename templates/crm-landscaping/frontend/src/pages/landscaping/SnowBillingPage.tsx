import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
import { Plus, Trash2, Snowflake, Loader2, CloudSnow } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const MODES = [
  { value: 'per_push', label: 'Per Push' },
  { value: 'per_event', label: 'Per Event' },
  { value: 'per_inch', label: 'Per Inch' },
  { value: 'seasonal', label: 'Seasonal' },
];

const EMPTY_CONTRACT = {
  siteId: '', billingMode: 'per_push', perPushRate: '', perEventRate: '', perInchRate: '',
  seasonalRate: '', triggerDepthInches: '2', saltRate: '', notes: '',
};

export default function SnowBillingPage() {
  const toast = useToast();
  const [contracts, setContracts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_CONTRACT);
  const [evForm, setEvForm] = useState<any>({ pushes: 1, snowfallInches: '', saltApplied: false, notes: '' });

  const load = async () => {
    try {
      const [c, s] = await Promise.all([
        api.get('/api/snow/contracts'),
        api.get('/api/snow/summary'),
      ]);
      setContracts(c.data || []);
      setSummary(s.data || []);
    } catch { toast.error('Failed to load snow contracts'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const openContract = async (ct: any) => {
    setSelected(ct);
    try {
      const res = await api.get('/api/snow/events', { contractId: ct.id });
      setEvents(res.data || []);
    } catch { setEvents([]); }
  };

  const createContract = async () => {
    if (!form.siteId) { toast.error('Site ID is required'); return; }
    try {
      await api.post('/api/snow/contracts', form);
      toast.success('Contract created');
      setShowForm(false); setForm(EMPTY_CONTRACT); load();
    } catch (e: any) { toast.error(e?.message || 'Failed to create contract'); }
  };

  const removeContract = async (id: string) => {
    if (!confirm('Delete this contract and its events?')) return;
    try { await api.delete(`/api/snow/contracts/${id}`); toast.success('Deleted'); setSelected(null); load(); }
    catch { toast.error('Failed to delete'); }
  };

  const logEvent = async () => {
    if (!selected) return;
    try {
      const res = await api.post('/api/snow/events', { snowContractId: selected.id, ...evForm });
      toast.success(`Logged — billed $${Number(res.billableAmount).toFixed(2)}`);
      setEvForm({ pushes: 1, snowfallInches: '', saltApplied: false, notes: '' });
      openContract(selected); load();
    } catch (e: any) { toast.error(e?.message || 'Failed to log event'); }
  };

  const sumFor = (id: string) => summary.find(s => s.contractId === id) || {};

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Snowflake className="w-6 h-6" /> Snow &amp; Ice Billing</h1>
          <p className="text-gray-500 text-sm">Per-push, per-event, per-inch, or seasonal — log storms and the charge is computed automatically.</p>
        </div>
        <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm"><Plus className="w-4 h-4" /> New Contract</button>
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Site ID" value={form.siteId} onChange={e => setForm({ ...form, siteId: e.target.value })} />
          <select className="border rounded px-2 py-1.5 text-sm" value={form.billingMode} onChange={e => setForm({ ...form, billingMode: e.target.value })}>
            {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
          </select>
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-push $" value={form.perPushRate} onChange={e => setForm({ ...form, perPushRate: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-event $" value={form.perEventRate} onChange={e => setForm({ ...form, perEventRate: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-inch $" value={form.perInchRate} onChange={e => setForm({ ...form, perInchRate: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Seasonal $" value={form.seasonalRate} onChange={e => setForm({ ...form, seasonalRate: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Trigger depth in" value={form.triggerDepthInches} onChange={e => setForm({ ...form, triggerDepthInches: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Salt $" value={form.saltRate} onChange={e => setForm({ ...form, saltRate: e.target.value })} />
          <button onClick={createContract} className="col-span-2 bg-blue-600 text-white rounded px-3 py-1.5 text-sm">Create Contract</button>
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        <div className="space-y-3">
          <h2 className="font-semibold">Contracts</h2>
          {contracts.map(ct => {
            const sm = sumFor(ct.id);
            return (
              <div key={ct.id} onClick={() => openContract(ct)}
                className={`border rounded-lg p-4 bg-white cursor-pointer hover:shadow ${selected?.id === ct.id ? 'ring-2 ring-blue-500' : ''}`}>
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{ct.siteName || ct.siteId}</div>
                    <div className="text-xs text-gray-500">{ct.siteAddress}</div>
                    <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{MODES.find(m => m.value === ct.billingMode)?.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-green-700">${Number(sm.unbilledTotal || 0).toFixed(2)}</div>
                    <div className="text-xs text-gray-400">unbilled • {sm.events || 0} events</div>
                    <button onClick={(e) => { e.stopPropagation(); removeContract(ct.id); }} className="text-red-500 mt-1"><Trash2 className="w-4 h-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
          {contracts.length === 0 && <p className="text-gray-400 text-sm">No snow contracts yet.</p>}
        </div>

        <div>
          {selected ? (
            <div className="bg-white border rounded-lg p-5">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><CloudSnow className="w-5 h-5" /> Log Storm Visit</h2>
              <div className="grid grid-cols-2 gap-2">
                <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Pushes" value={evForm.pushes} onChange={e => setEvForm({ ...evForm, pushes: e.target.value })} />
                <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Snowfall in." value={evForm.snowfallInches} onChange={e => setEvForm({ ...evForm, snowfallInches: e.target.value })} />
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" checked={evForm.saltApplied} onChange={e => setEvForm({ ...evForm, saltApplied: e.target.checked })} /> Salt applied
                </label>
                <input className="border rounded px-2 py-1.5 text-sm col-span-2" placeholder="Notes" value={evForm.notes} onChange={e => setEvForm({ ...evForm, notes: e.target.value })} />
              </div>
              <button onClick={logEvent} className="mt-3 w-full bg-blue-600 text-white rounded px-3 py-2 text-sm">Log Event</button>

              <h3 className="font-semibold mt-5 mb-2 text-sm">Recent Events</h3>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {events.map(ev => (
                  <div key={ev.id} className="flex justify-between text-sm border-b py-1.5">
                    <span>{formatDate(ev.servicedAt)} · {ev.pushes} push · {Number(ev.snowfallInches)}"{ev.saltApplied ? ' · salt' : ''}</span>
                    <span className="font-semibold">${Number(ev.billableAmount).toFixed(2)}</span>
                  </div>
                ))}
                {events.length === 0 && <p className="text-gray-400 text-sm">No events logged.</p>}
              </div>
            </div>
          ) : (
            <div className="border border-dashed rounded-lg p-8 text-center text-gray-400">Select a contract to log storm visits.</div>
          )}
        </div>
      </div>
    </div>
  );
}
