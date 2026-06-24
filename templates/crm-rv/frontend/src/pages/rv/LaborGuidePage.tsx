import { useEffect, useState } from 'react';
import { Clock, Search, Loader2, Info, ShieldCheck } from 'lucide-react';
import api from '../../services/api';

export default function LaborGuidePage() {
  const [q, setQ] = useState('');
  const [category, setCategory] = useState('');
  const [ops, setOps] = useState<any[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [rate, setRate] = useState(0);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await api.get('/api/labor-guide/search', { q, category });
      setOps(r.ops || []); setCats(r.categories || []); setRate(r.laborRate || 0); setLive(!!r.live);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  useEffect(() => { run(); }, [category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-orange-700 flex items-center justify-center text-white"><Clock size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">Labor Guide</h1>
          <p className="text-sm text-gray-500">Flat-rate service operations — standard hours × your shop rate{rate ? ` ($${rate}/hr)` : ''}.</p>
        </div>
      </div>

      {!live && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" />
          <span>Demo flat-rate data. Connects to Mitchell1 / MOTOR / OEM flat-rate feeds once licensed — the search and UI stay identical.</span>
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs font-medium text-gray-600">Search operations</label>
          <div className="flex gap-2 mt-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }} placeholder="oil change, brake, CVT belt, winterize…" className="flex-1 p-2 border rounded-lg text-sm" />
            <button onClick={run} disabled={loading} className="px-4 rounded-lg bg-orange-700 text-white font-medium hover:bg-orange-800 disabled:opacity-50 inline-flex items-center gap-1.5">{loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />} Search</button>
          </div>
        </div>
        <div><label className="text-xs font-medium text-gray-600">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm"><option value="">All</option>{cats.map((c) => <option key={c} value={c}>{c}</option>)}</select></div>
      </div>

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600">{ops.length} operation{ops.length === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-4 py-2 text-left font-semibold">Code</th>
              <th className="px-4 py-2 text-left font-semibold">Operation</th>
              <th className="px-4 py-2 text-left font-semibold">Applies to</th>
              <th className="px-4 py-2 text-right font-semibold">Hours</th>
              <th className="px-4 py-2 text-right font-semibold">Labor</th>
              <th className="px-4 py-2 text-left font-semibold">Warranty</th>
            </tr></thead>
            <tbody>
              {ops.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{loading ? 'Searching…' : 'No operations found.'}</td></tr>}
              {ops.map((o, i) => (
                <tr key={i} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs text-gray-500 align-top">{o.code}</td>
                  <td className="px-4 py-2 align-top">{o.name}<span className="block text-[11px] text-gray-400">{o.category}</span></td>
                  <td className="px-4 py-2 text-gray-500 text-xs align-top">{o.applies}</td>
                  <td className="px-4 py-2 text-right align-top">{Number(o.hours).toFixed(1)}</td>
                  <td className="px-4 py-2 text-right font-semibold align-top">${o.price}</td>
                  <td className="px-4 py-2 align-top">{o.warranty ? <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-100 text-blue-700"><ShieldCheck size={12} />Eligible</span> : <span className="text-xs text-gray-400">—</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
