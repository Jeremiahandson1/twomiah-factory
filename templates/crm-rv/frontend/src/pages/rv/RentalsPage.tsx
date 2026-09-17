import { useEffect, useState } from 'react';
import { Repeat, Plus, Loader2 } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();
const STATUS: any = { out: 'bg-blue-100 text-blue-700', reserved: 'bg-amber-100 text-amber-700', returned: 'bg-green-100 text-green-700', cancelled: 'bg-gray-100 text-gray-500' };
// the status changes the server allows
const ACTIONS: Record<string, [string, string][]> = { reserved: [['out', 'Check out'], ['cancelled', 'Cancel']], out: [['returned', 'Return']] };
const EMPTY = { unitId: '', customer: '', start: '', end: '', rate: '' };
const DAY_MS = 86_400_000;
// same rule as the server: days between pick-up and return, at least 1
const daysBetween = (start: string, end: string) => (start && end && end >= start ? Math.max(1, Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / DAY_MS)) : 0);

// Reservations are stored per company and checked by the server (dates, rate, sold units, overlapping bookings on
// the same unit). The page shows the server's reason when a booking or status change is refused. (RV T19 H5)
export default function RentalsPage() {
  const [rentals, setRentals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [units, setUnits] = useState<any[]>([]);
  const [form, setForm] = useState<any>(EMPTY);
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = () => api.get('/api/rentals/list').then((r: any) => { setRentals(r.rentals || []); setSummary(r.summary || {}); }).catch((e: any) => setError(e?.message || 'Could not load reservations'));
  useEffect(() => {
    load();
    api.get('/api/units', { limit: 500 }).then((r: any) => setUnits((r.data || []).filter((u: any) => u.status !== 'sold'))).catch(() => {});
  }, []);

  const days = daysBetween(form.start, form.end);
  const rate = Number(form.rate);

  async function create() {
    setError(null);
    if (!form.unitId || !form.customer.trim()) { setError('Pick a unit and enter the customer.'); return; }
    setSaving(true);
    try {
      const r = await api.post('/api/rentals/create', { ...form, rate: form.rate === '' ? '' : form.rate });
      setRentals((x) => [r.rental, ...x]); setSummary(r.summary || summary); setShow(false); setForm(EMPTY);
    } catch (e: any) { setError(e?.message || 'Could not save the reservation'); }
    finally { setSaving(false); }
  }

  async function changeStatus(id: string, status: string) {
    setError(null); setBusyId(id);
    try {
      const r = await api.post(`/api/rentals/${id}/status`, { status });
      setRentals((x) => x.map((row) => (row.id === id ? r.rental : row))); setSummary(r.summary || summary);
    } catch (e: any) { setError(e?.message || 'Could not update the reservation'); }
    finally { setBusyId(null); }
  }

  const cards = [['Active (out)', summary.active ?? 0], ['Reserved', summary.reserved ?? 0], ['Rental revenue', money(summary.revenue || 0)]];
  const unitName = (u: any) => [[u.year, u.make, u.modelName].filter(Boolean).join(' '), u.stockNumber ? `(${u.stockNumber})` : ''].filter(Boolean).join(' ');

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-indigo-700 flex items-center justify-center text-white"><Repeat size={22} /></div>
        <div className="flex-1"><h1 className="text-2xl font-bold">Rentals</h1><p className="text-sm text-gray-500 dark:text-slate-400">Reservations, contracts, and fleet utilization.</p></div>
        <button onClick={() => { setShow((s) => !s); setError(null); }} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800 inline-flex items-center gap-1.5"><Plus size={16} />New reservation</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {cards.map(([l, v]: any) => (<div key={l} className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900"><div className="text-xs text-gray-500 dark:text-slate-400">{l}</div><div className="text-2xl font-bold mt-1">{v}</div></div>))}
      </div>

      {error && <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-lg p-3 text-sm">{error}</div>}

      {show && <div className="mt-4 bg-white rounded-xl border shadow-sm p-4 grid sm:grid-cols-3 gap-3 dark:bg-slate-900">
        <select value={form.unitId} onChange={(e) => setForm((f: any) => ({ ...f, unitId: e.target.value }))} className="p-2 border rounded-lg text-sm sm:col-span-2">
          <option value="">Select a unit…</option>
          {units.map((u) => <option key={u.id} value={u.id}>{unitName(u)}</option>)}
        </select>
        <input placeholder="Customer" value={form.customer} onChange={(e) => setForm((f: any) => ({ ...f, customer: e.target.value }))} className="p-2 border rounded-lg text-sm" />
        <label className="text-xs text-gray-500 dark:text-slate-400">Pick-up<input type="date" value={form.start} onChange={(e) => setForm((f: any) => ({ ...f, start: e.target.value }))} className="mt-1 block w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs text-gray-500 dark:text-slate-400">Return<input type="date" min={form.start || undefined} value={form.end} onChange={(e) => setForm((f: any) => ({ ...f, end: e.target.value }))} className="mt-1 block w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs text-gray-500 dark:text-slate-400">Rate / day<input type="number" min="0" step="0.01" inputMode="decimal" placeholder="0.00" value={form.rate} onChange={(e) => setForm((f: any) => ({ ...f, rate: e.target.value }))} className="mt-1 block w-full p-2 border rounded-lg text-sm" /></label>
        <div className="sm:col-span-2 text-sm text-gray-600 self-center dark:text-slate-400">{days > 0 && Number.isFinite(rate) && rate >= 0 ? `${days} day${days === 1 ? '' : 's'} × ${money(rate)} = ${money(rate * days)}` : 'Pick the dates and rate to see the total.'}</div>
        <button onClick={create} disabled={saving} className="p-2 rounded-lg bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800 disabled:opacity-50 inline-flex items-center justify-center gap-1.5">{saving && <Loader2 size={14} className="animate-spin" />}Save</button>
      </div>}

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600 dark:text-slate-400">Reservations</div>
        <div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr>
            <th className="px-4 py-2 text-left font-semibold">Unit</th><th className="px-4 py-2 text-left font-semibold">Customer</th><th className="px-4 py-2 text-left font-semibold">Dates</th><th className="px-4 py-2 text-right font-semibold">Rate</th><th className="px-4 py-2 text-right font-semibold">Total</th><th className="px-4 py-2 text-left font-semibold">Status</th><th className="px-4 py-2" />
          </tr></thead>
          <tbody>
            {rentals.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">No reservations.</td></tr>}
            {rentals.map((r) => (<tr key={r.id} className="border-t hover:bg-gray-50 dark:hover:bg-slate-800">
              <td className="px-4 py-2">{r.unit}</td><td className="px-4 py-2 text-gray-600 dark:text-slate-400">{r.customer}</td>
              <td className="px-4 py-2 text-gray-500 text-xs dark:text-slate-400">{r.start} → {r.end} ({r.days}d)</td>
              <td className="px-4 py-2 text-right">{money(r.rate)}/day</td><td className="px-4 py-2 text-right font-medium">{money(r.total)}</td>
              <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
              <td className="px-4 py-2 text-right whitespace-nowrap">{(ACTIONS[r.status] || []).map(([s, label]) => (
                <button key={s} onClick={() => changeStatus(r.id, s)} disabled={busyId === r.id} className="ml-2 text-xs text-indigo-700 hover:underline disabled:opacity-50 dark:text-indigo-300">{label}</button>
              ))}</td>
            </tr>))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
