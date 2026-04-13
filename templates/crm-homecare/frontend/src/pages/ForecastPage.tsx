/**
 * Forecast Page — Care Agency tier
 * Reads /api/forecast/revenue for the N-month trailing revenue trend.
 * Backend route existed; this is the missing frontend.
 */
import { useState, useEffect } from 'react';
import { TrendingUp, Loader2 } from 'lucide-react';
import { API_BASE_URL } from '../config';

export default function ForecastPage() {
  const [data, setData] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [months, setMonths] = useState(6);

  useEffect(() => { load(); }, [months]);

  const load = async () => {
    setLoading(true);
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_BASE_URL}/api/forecast/revenue?months=${months}`, { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      setData(json.data || json || []);
    } catch (e) { console.error(e); } finally { setLoading(false); }
  };

  const maxRevenue = Math.max(...data.map((d: any) => Number(d.revenue || 0)), 1);

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><TrendingUp className="w-6 h-6 text-teal-600" />Revenue Forecast</h1>
          <p className="text-sm text-gray-500 mt-1">Trailing revenue trend and projection</p>
        </div>
        <select value={months} onChange={(e) => setMonths(Number(e.target.value))} className="border rounded-lg px-3 py-2">
          <option value={3}>3 months</option>
          <option value={6}>6 months</option>
          <option value={12}>12 months</option>
        </select>
      </div>

      {loading ? <Loader2 className="w-8 h-8 animate-spin text-teal-600 mx-auto mt-12" /> : (
        <div className="bg-white rounded-lg border p-6">
          {data.length === 0 ? <div className="text-center text-gray-400 py-12">No revenue data yet. Create clients and generate invoices to see the forecast.</div> : (
            <div className="space-y-3">
              {data.map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-4">
                  <div className="w-20 text-sm font-mono text-gray-600">{d.month || d.label || '—'}</div>
                  <div className="flex-1 h-8 bg-gray-100 rounded-full overflow-hidden relative">
                    <div className="h-full bg-teal-500 rounded-full flex items-center justify-end pr-3 text-white text-xs font-semibold" style={{ width: `${(Number(d.revenue || 0) / maxRevenue) * 100}%` }}>
                      ${Number(d.revenue || 0).toLocaleString()}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
