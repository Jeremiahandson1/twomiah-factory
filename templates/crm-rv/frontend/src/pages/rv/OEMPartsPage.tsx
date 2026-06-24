import { useEffect, useState } from 'react';
import { Package, Search, Loader2, Info } from 'lucide-react';
import api from '../../services/api';

const money = (n?: number) => (n ? '$' + Number(n).toFixed(2) : '');

export default function OEMPartsPage() {
  const [q, setQ] = useState('');
  const [oem, setOem] = useState('');
  const [category, setCategory] = useState('');
  const [parts, setParts] = useState<any[]>([]);
  const [oems, setOems] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [live, setLive] = useState(true);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const r = await api.get('/api/oem-parts/search', { q, oem, category });
      setParts(r.parts || []); setOems(r.oems || []); setCats(r.categories || []); setLive(!!r.live);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  // run on mount + whenever a filter changes; text search runs via button/Enter
  useEffect(() => { run(); }, [oem, category]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-white"><Package size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">Parts Catalog</h1>
          <p className="text-sm text-gray-500">Search OEM parts by number, name, or unit — price, fitment, availability, supersessions.</p>
        </div>
      </div>

      {!live && (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" />
          <span>Demo catalog data. Connects to the live OEM catalog (Snap-on EPC / ARI) once the data feed is licensed — the search, UI, and workflow stay identical.</span>
        </div>
      )}

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-4 flex flex-wrap gap-3 items-end">
        <div className="flex-1 min-w-[220px]">
          <label className="text-xs font-medium text-gray-600">Search</label>
          <div className="flex gap-2 mt-1">
            <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') run(); }}
              placeholder="part #, name, or unit (e.g. 3211202, oil filter, RANGER)" className="flex-1 p-2 border rounded-lg text-sm" />
            <button onClick={run} disabled={loading} className="px-4 rounded-lg bg-slate-700 text-white font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5">
              {loading ? <Loader2 className="animate-spin" size={16} /> : <Search size={16} />} Search</button>
          </div>
        </div>
        <div><label className="text-xs font-medium text-gray-600">OEM</label>
          <select value={oem} onChange={(e) => setOem(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm"><option value="">All</option>{oems.map(o => <option key={o} value={o}>{o}</option>)}</select></div>
        <div><label className="text-xs font-medium text-gray-600">Category</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm"><option value="">All</option>{cats.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
      </div>

      <div className="mt-4 bg-white rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-2.5 border-b text-sm font-semibold text-gray-600">{parts.length} part{parts.length === 1 ? '' : 's'}</div>
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50 text-gray-500"><tr>
              <th className="px-4 py-2 text-left font-semibold">Part #</th>
              <th className="px-4 py-2 text-left font-semibold">Description</th>
              <th className="px-4 py-2 text-left font-semibold">OEM</th>
              <th className="px-4 py-2 text-left font-semibold">Fits</th>
              <th className="px-4 py-2 text-right font-semibold">Price</th>
              <th className="px-4 py-2 text-left font-semibold">Availability</th>
            </tr></thead>
            <tbody>
              {parts.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-gray-400">{loading ? 'Searching…' : 'No parts found.'}</td></tr>}
              {parts.map((p, i) => (
                <tr key={i} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs align-top">{p.partNumber}{p.supersededBy && <span className="block text-[10px] text-amber-600">→ {p.supersededBy}</span>}</td>
                  <td className="px-4 py-2 align-top">{p.name}<span className="block text-[11px] text-gray-400">{p.category}{p.diagram ? ` · ${p.diagram}` : ''}</span></td>
                  <td className="px-4 py-2 text-gray-600 align-top">{p.oem}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs align-top">{p.fitment || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold align-top">{money(p.price)}{p.msrp && p.msrp > p.price ? <span className="block text-[10px] text-gray-400 line-through font-normal">{money(p.msrp)}</span> : null}</td>
                  <td className="px-4 py-2 align-top"><span className={`text-xs px-2 py-0.5 rounded-full ${/in stock/i.test(p.availability) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{p.availability}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
