import { useEffect, useState } from 'react';
import { DollarSign, AlertTriangle } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();

export default function FloorplanPage() {
  const [units, setUnits] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get('/api/floorplan/units').then((r: any) => { setUnits(r.units || []); setSummary(r.summary || {}); }).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const cards = [
    ['Units floored', summary.count ?? 0, ''],
    ['Total floored', money(summary.totalFloored || 0), ''],
    ['Interest accrued', money(summary.totalInterest || 0), 'text-amber-700'],
    ['Curtailment due', summary.dueCount ?? 0, (summary.dueCount || 0) > 0 ? 'text-red-600' : ''],
  ];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-emerald-700 flex items-center justify-center text-white"><DollarSign size={22} /></div>
        <div><h1 className="text-2xl font-bold">Floorplan</h1><p className="text-sm text-gray-500">New units financed on floorplan — curtailment, interest accrual, and payoff tracking.</p></div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4">
        {cards.map(([label, val, cls]: any) => (
          <div key={label} className="bg-white rounded-xl border shadow-sm p-4">
            <div className="text-xs text-gray-500">{label}</div>
            <div className={`text-2xl font-bold mt-1 ${cls}`}>{val}</div>
          </div>
        ))}
      </div>

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600">Floored units</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-4 py-2 text-left font-semibold">Unit</th>
              <th className="px-4 py-2 text-left font-semibold">Stock</th>
              <th className="px-4 py-2 text-left font-semibold">Lender</th>
              <th className="px-4 py-2 text-right font-semibold">Amount</th>
              <th className="px-4 py-2 text-right font-semibold">Days</th>
              <th className="px-4 py-2 text-right font-semibold">Interest</th>
              <th className="px-4 py-2 text-left font-semibold">Status</th>
            </tr></thead>
            <tbody>
              {units.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{loading ? 'Loading…' : 'No floored units.'}</td></tr>}
              {units.map((u, i) => (
                <tr key={i} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2">{u.unit}</td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-500">{u.stock || '—'}</td>
                  <td className="px-4 py-2 text-gray-600">{u.lender}</td>
                  <td className="px-4 py-2 text-right font-medium">{money(u.amount)}</td>
                  <td className="px-4 py-2 text-right text-gray-600">{u.flooredDays}</td>
                  <td className="px-4 py-2 text-right text-amber-700">{money(u.interest)}</td>
                  <td className="px-4 py-2">{u.curtailmentDue
                    ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-100 text-red-700"><AlertTriangle size={12} />{u.status}</span>
                    : <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700">{u.status}</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
