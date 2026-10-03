import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
import { Plus, Trash2, Snowflake, Loader2, CloudSnow } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SitePicker, useSites } from './SitePicker';
import { useMayWrite } from '../../shared';

const MODES = [
  { value: 'per_push', label: 'Per Push' },
  { value: 'per_event', label: 'Per Event' },
  { value: 'per_inch', label: 'Per Inch' },
  { value: 'seasonal', label: 'Seasonal' },
];

/**
 * Which rate the contract is actually billed by. (T41)
 *
 * Mirrors MODE_RATE in backend/src/routes/snowBilling.ts, which refuses a contract whose own rate is
 * blank or zero — "a per-push contract saves with no per-push rate" was accepted and then charged
 * $0.00 for the season. The form shows all four boxes because switching modes mid-setup is normal, so
 * it has to say WHICH one is the one that matters, and catch it here rather than let the server's
 * refusal arrive as a toast after the operator has moved on.
 */
const MODE_RATE: Record<string, { field: string; label: string }> = {
  per_push: { field: 'perPushRate', label: 'Per push' },
  per_event: { field: 'perEventRate', label: 'Per event' },
  per_inch: { field: 'perInchRate', label: 'Per inch' },
  seasonal: { field: 'seasonalRate', label: 'Seasonal' },
};

const EMPTY_CONTRACT = {
  siteId: '', billingMode: 'per_push', perPushRate: '', perEventRate: '', perInchRate: '',
  seasonalRate: '', triggerDepthInches: '2', saltRate: '', notes: '',
};

// Every field keeps its name visible next to the box — a placeholder disappears as soon as the operator types,
// which left the snow forms unlabelled once they started filling them in. (Landscaping T14 M8)
function Field({ id, label, children, className = '' }: { id: string; label: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={className}>
      <label htmlFor={id} className="block text-xs font-medium text-gray-600 mb-1 dark:text-slate-400">{label}</label>
      {children}
    </div>
  );
}

export default function SnowBillingPage() {
  const toast = useToast();
  /**
   * The nav now keeps a seat without `invoices:read` off this page entirely (shellConfig.ts). These
   * are for the seat that gets IN and still cannot do everything on it — the manager, who holds
   * invoices:read/create/update and not invoices:delete. T41 landscaping found exactly that:
   * "contract delete 403 (invoices:delete)", and "Cleanup for owner: probe contract … could not be
   * deleted; the manager lacks permission" — they were shown the bin and then refused.
   *
   *   New Contract   POST /contracts         invoices:create
   *   Log Event      POST /events            invoices:create
   *   Bill $…        POST /contracts/:id/bill invoices:create
   *   Delete         DELETE /contracts/:id   invoices:delete
   *
   * LOGGING A STORM VISIT STAYS AN OFFICE ACT, deliberately. The report asked: "Crews can't log snow
   * visits: POST /api/snow/events needs invoices:create. Please confirm whether crews should log
   * storm visits." The answer written into the code is no, because logging a push is not recording
   * work — computeSnowEventCharge runs inside that endpoint and stores a billableAmount — and the
   * operator would have to pick from a contract list that carries the shop's per-inch and seasonal
   * rates. Letting the plough truck in means handing it the price list. A crew records storm work
   * the way they record any work, on their job and their timesheet, and the office turns that into
   * pushes. Changing that is a product decision, not a permission tweak.
   */
  const mayBill = useMayWrite('invoices:create');
  const mayDelete = useMayWrite('invoices:delete');
  const [contracts, setContracts] = useState<any[]>([]);
  const [summary, setSummary] = useState<any[]>([]);
  const [events, setEvents] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<any>(EMPTY_CONTRACT);
  const [evForm, setEvForm] = useState<any>({ pushes: 1, snowfallInches: '', saltApplied: false, notes: '' });
  const { sites, reloadSites } = useSites();

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

  const needed = MODE_RATE[form.billingMode];

  const createContract = async () => {
    if (!form.siteId) { toast.error('Pick the property this contract covers'); return; }
    if (needed && !(Number(form[needed.field]) > 0)) {
      toast.error(`This contract is billed ${needed.label.toLowerCase()}, so set the "${needed.label} ($)" rate above zero.`);
      return;
    }
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
    // The measure this contract's charge is calculated from. Without it the visit stores $0.00 and
    // then sits unbillable for ever, which is what the server now refuses. (T41)
    if (!evForm.saltApplied) {
      if (selected.billingMode === 'per_push' && !(Number(evForm.pushes) > 0)) {
        toast.error('This contract is billed per push — enter how many pushes, or tick Salt applied if that is all that was done.');
        return;
      }
      if (selected.billingMode === 'per_inch' && !(Number(evForm.snowfallInches) > 0)) {
        toast.error('This contract is billed per inch — enter the snowfall, or tick Salt applied if that is all that was done.');
        return;
      }
    }
    try {
      const res = await api.post('/api/snow/events', { snowContractId: selected.id, ...evForm });
      toast.success(`Logged — billed $${Number(res.billableAmount).toFixed(2)}`);
      setEvForm({ pushes: 1, snowfallInches: '', saltApplied: false, notes: '' });
      openContract(selected); load();
    } catch (e: any) { toast.error(e?.message || 'Failed to log event'); }
  };

  // Unbilled visits → one draft invoice to the site's customer (T14 H5: the charge had no way to be billed).
  const [billing, setBilling] = useState<string | null>(null);
  const billContract = async (ct: any, amount: number) => {
    if (!confirm(`Create a draft invoice for the $${amount.toFixed(2)} of unbilled snow visits at ${ct.siteName || 'this site'}?`)) return;
    setBilling(ct.id);
    try {
      const res = await api.post(`/api/snow/contracts/${ct.id}/bill`, {});
      toast.success(`Draft invoice ${res.invoice?.number} created for ${res.billedVisits} visit${res.billedVisits === 1 ? '' : 's'} — review and send it from Invoices`);
      if (selected?.id === ct.id) openContract(ct);
      load();
    } catch (e: any) { toast.error(e?.message || 'Failed to bill this contract'); }
    finally { setBilling(null); }
  };

  const sumFor = (id: string) => summary.find(s => s.contractId === id) || {};

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><Snowflake className="w-6 h-6" /> Snow &amp; Ice Billing</h1>
          <p className="text-gray-500 text-sm dark:text-slate-400">Per-push, per-event, per-inch, or seasonal — log storms and the charge is computed automatically.</p>
        </div>
        {mayBill && <button onClick={() => setShowForm(!showForm)} className="flex items-center gap-2 bg-blue-600 text-white rounded-lg px-4 py-2 text-sm"><Plus className="w-4 h-4" /> New Contract</button>}
      </div>

      {showForm && (
        <div className="bg-white border rounded-lg p-5 mb-6 grid grid-cols-2 md:grid-cols-4 gap-3 dark:bg-slate-900">
          <Field id="snow-site" label="Property" className="col-span-2">
            <SitePicker id="snow-site" value={form.siteId} sites={sites} onAdded={reloadSites} onChange={(siteId) => setForm({ ...form, siteId })} />
          </Field>
          <Field id="snow-mode" label="Billing mode">
            <select id="snow-mode" className="w-full border rounded px-2 py-1.5 text-sm" value={form.billingMode} onChange={e => setForm({ ...form, billingMode: e.target.value })}>
              {MODES.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </Field>
          <Field id="snow-per-push" label="Per push ($)">
            <input id="snow-per-push" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-push $" value={form.perPushRate} onChange={e => setForm({ ...form, perPushRate: e.target.value })} />
          </Field>
          <Field id="snow-per-event" label="Per event ($)">
            <input id="snow-per-event" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-event $" value={form.perEventRate} onChange={e => setForm({ ...form, perEventRate: e.target.value })} />
          </Field>
          <Field id="snow-per-inch" label="Per inch ($)">
            <input id="snow-per-inch" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Per-inch $" value={form.perInchRate} onChange={e => setForm({ ...form, perInchRate: e.target.value })} />
          </Field>
          <Field id="snow-seasonal" label="Seasonal ($)">
            <input id="snow-seasonal" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Seasonal $" value={form.seasonalRate} onChange={e => setForm({ ...form, seasonalRate: e.target.value })} />
          </Field>
          <Field id="snow-trigger" label="Trigger depth (in)">
            <input id="snow-trigger" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Trigger depth in" value={form.triggerDepthInches} onChange={e => setForm({ ...form, triggerDepthInches: e.target.value })} />
          </Field>
          <Field id="snow-salt" label="Salt ($)">
            <input id="snow-salt" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Salt $" value={form.saltRate} onChange={e => setForm({ ...form, saltRate: e.target.value })} />
          </Field>
          {/* Four rate boxes, one of which the invoice is actually calculated from. Say which. (T41) */}
          {needed && (
            <p className="col-span-2 md:col-span-4 text-xs text-gray-600 dark:text-slate-400">
              Billed <strong>{needed.label.toLowerCase()}</strong>, so <strong>{needed.label} ($)</strong> is required — the other rates can stay blank.
              Salt is charged on top in every mode.
            </p>
          )}
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
                className={`border rounded-lg p-4 bg-white cursor-pointer hover:shadow ${selected?.id === ct.id ? 'ring-2 ring-blue-500' : ''} dark:bg-slate-900`}>
                <div className="flex justify-between">
                  <div>
                    <div className="font-medium">{ct.siteName || ct.siteId}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">{ct.siteAddress}</div>
                    <span className="inline-block mt-1 text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{MODES.find(m => m.value === ct.billingMode)?.label}</span>
                  </div>
                  <div className="text-right">
                    <div className="text-sm font-semibold text-green-700 dark:text-green-300">${Number(sm.unbilledTotal || 0).toFixed(2)}</div>
                    <div className="text-xs text-gray-500 dark:text-slate-400">unbilled • {sm.events || 0} events</div>
                    {Number(sm.unbilledTotal || 0) > 0 && mayBill && (
                      <button onClick={(e) => { e.stopPropagation(); billContract(ct, Number(sm.unbilledTotal)); }} disabled={billing === ct.id}
                        className="mt-1 mr-2 text-xs bg-green-700 text-white rounded px-2 py-1 disabled:opacity-50">
                        {billing === ct.id ? 'Billing…' : `Bill $${Number(sm.unbilledTotal).toFixed(2)}`}
                      </button>
                    )}
                    {mayDelete && <button onClick={(e) => { e.stopPropagation(); removeContract(ct.id); }} className="text-red-500 mt-1" aria-label="Delete contract"><Trash2 className="w-4 h-4" /></button>}
                  </div>
                </div>
              </div>
            );
          })}
          {contracts.length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No snow contracts yet.</p>}
        </div>

        <div>
          {selected ? (
            <div className="bg-white border rounded-lg p-5 dark:bg-slate-900">
              <h2 className="font-semibold flex items-center gap-2 mb-3"><CloudSnow className="w-5 h-5" /> Log Storm Visit</h2>
              <div className="grid grid-cols-2 gap-2">
                <Field id="snow-pushes" label="Pushes">
                  <input id="snow-pushes" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Pushes" value={evForm.pushes} onChange={e => setEvForm({ ...evForm, pushes: e.target.value })} />
                </Field>
                <Field id="snow-inches" label="Snowfall (in)">
                  <input id="snow-inches" className="w-full border rounded px-2 py-1.5 text-sm" type="number" placeholder="Snowfall in." value={evForm.snowfallInches} onChange={e => setEvForm({ ...evForm, snowfallInches: e.target.value })} />
                </Field>
                <label className="flex items-center gap-2 text-sm col-span-2">
                  <input type="checkbox" checked={evForm.saltApplied} onChange={e => setEvForm({ ...evForm, saltApplied: e.target.checked })} /> Salt applied
                </label>
                <Field id="snow-notes" label="Notes" className="col-span-2">
                  <input id="snow-notes" className="w-full border rounded px-2 py-1.5 text-sm" placeholder="Notes" value={evForm.notes} onChange={e => setEvForm({ ...evForm, notes: e.target.value })} />
                </Field>
              </div>
              {mayBill && <button onClick={logEvent} className="mt-3 w-full bg-blue-600 text-white rounded px-3 py-2 text-sm">Log Event</button>}

              <h3 className="font-semibold mt-5 mb-2 text-sm">Recent Events</h3>
              <div className="space-y-1 max-h-72 overflow-y-auto">
                {events.map(ev => (
                  <div key={ev.id} className="flex justify-between text-sm border-b py-1.5">
                    {/* A salt-only run has no pushes and no snowfall; it reads "salt", not "0 push · 0"". */}
                    <span>{[
                      formatDate(ev.servicedAt),
                      Number(ev.pushes) > 0 ? `${ev.pushes} push` : '',
                      Number(ev.snowfallInches) > 0 ? `${Number(ev.snowfallInches)}"` : '',
                      ev.saltApplied ? 'salt' : '',
                    ].filter(Boolean).join(' · ')}</span>
                    <span className="font-semibold">${Number(ev.billableAmount).toFixed(2)}</span>
                  </div>
                ))}
                {events.length === 0 && <p className="text-gray-500 dark:text-slate-400 text-sm">No events logged.</p>}
              </div>
            </div>
          ) : (
            <div className="border border-dashed rounded-lg p-8 text-center text-gray-500 dark:text-slate-400">Select a contract to log storm visits.</div>
          )}
        </div>
      </div>
    </div>
  );
}
