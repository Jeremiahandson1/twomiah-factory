import { useEffect, useState } from 'react';
import { Repeat, Plus } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();
const STATUS: any = { out: 'bg-blue-100 text-blue-700', reserved: 'bg-amber-100 text-amber-700', returned: 'bg-green-100 text-green-700' };

export default function RentalsPage() {
  const [rentals, setRentals] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [form, setForm] = useState<any>({ unit: '', customer: '', start: '', end: '', rate: 0, days: 1 });
  const [show, setShow] = useState(false);

  useEffect(() => { api.get('/api/rentals/list').then((r: any) => { setRentals(r.rentals || []); setSummary(r.summary || {}); }).catch(() => {}); }, []);

  async function create() {
    if (!form.unit || !form.customer) return;
    const r = await api.post('/api/rentals/create', form).catch(() => null);
    if (r?.rental) { setRentals((x) => [r.rental, ...x]); setSummary(r.summary || summary); setShow(false); setForm({ unit: '', customer: '', start: '', end: '', rate: 0, days: 1 }); }
  }

  const cards = [['Active (out)', summary.active ?? 0], ['Reserved', summary.reserved ?? 0], ['Rental revenue', money(summary.revenue || 0)]];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-indigo-700 flex items-center justify-center text-white"><Repeat size={22} /></div>
        <div className="flex-1"><h1 className="text-2xl font-bold">Rentals</h1><p className="text-sm text-gray-500 dark:text-slate-400">Reservations, contracts, and fleet utilization.</p></div>
        <button onClick={() => setShow((s) => !s)} className="px-4 py-2 rounded-lg bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800 inline-flex items-center gap-1.5"><Plus size={16} />New reservation</button>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-4">
        {cards.map(([l, v]: any) => (<div key={l} className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900"><div className="text-xs text-gray-500 dark:text-slate-400">{l}</div><div className="text-2xl font-bold mt-1">{v}</div></div>))}
      </div>

      {show && <div className="mt-4 bg-white rounded-xl border shadow-sm p-4 grid sm:grid-cols-3 gap-3 dark:bg-slate-900">
        <input placeholder="Unit" value={form.unit} onChange={(e) => setForm((f: any) => ({ ...f, unit: e.target.value }))} className="p-2 border rounded-lg text-sm sm:col-span-2" />
        <input placeholder="Customer" value={form.customer} onChange={(e) => setForm((f: any) => ({ ...f, customer: e.target.value }))} className="p-2 border rounded-lg text-sm" />
        <input type="date" value={form.start} onChange={(e) => setForm((f: any) => ({ ...f, start: e.target.value }))} className="p-2 border rounded-lg text-sm" />
        <input type="date" value={form.end} onChange={(e) => setForm((f: any) => ({ ...f, end: e.target.value }))} className="p-2 border rounded-lg text-sm" />
        <div className="flex gap-2">
          <input type="number" placeholder="Rate/day" value={form.rate || ''} onChange={(e) => setForm((f: any) => ({ ...f, rate: Number(e.target.value) || 0 }))} className="p-2 border rounded-lg text-sm w-full" />
          <input type="number" placeholder="Days" value={form.days} onChange={(e) => setForm((f: any) => ({ ...f, days: Number(e.target.value) || 1 }))} className="p-2 border rounded-lg text-sm w-20" />
        </div>
        <button onClick={create} className="p-2 rounded-lg bg-indigo-700 text-white text-sm font-medium hover:bg-indigo-800">Save</button>
      </div>}

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600 dark:text-slate-400">Reservations</div>
        <div className="overflow-x-auto"><table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr>
            <th className="px-4 py-2 text-left font-semibold">Unit</th><th className="px-4 py-2 text-left font-semibold">Customer</th><th className="px-4 py-2 text-left font-semibold">Dates</th><th className="px-4 py-2 text-right font-semibold">Rate</th><th className="px-4 py-2 text-right font-semibold">Total</th><th className="px-4 py-2 text-left font-semibold">Status</th>
          </tr></thead>
          <tbody>
            {rentals.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">No reservations.</td></tr>}
            {rentals.map((r, i) => (<tr key={i} className="border-t hover:bg-gray-50">
              <td className="px-4 py-2">{r.unit}</td><td className="px-4 py-2 text-gray-600 dark:text-slate-400">{r.customer}</td>
              <td className="px-4 py-2 text-gray-500 text-xs dark:text-slate-400">{r.start}{r.end ? ` → ${r.end}` : ''} ({r.days}d)</td>
              <td className="px-4 py-2 text-right">{money(r.rate)}/day</td><td className="px-4 py-2 text-right font-medium">{money(r.rate * r.days)}</td>
              <td className="px-4 py-2"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[r.status] || 'bg-gray-100 text-gray-600'}`}>{r.status}</span></td>
            </tr>))}
          </tbody>
        </table></div>
      </div>
    </div>
  );
}
