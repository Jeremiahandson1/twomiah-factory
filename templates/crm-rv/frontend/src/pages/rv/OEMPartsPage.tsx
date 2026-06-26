import { useEffect, useState, type ChangeEvent } from 'react';
import { Package, Search, Loader2, Info, Upload, X, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';

const money = (n?: number) => (n ? '$' + Number(n).toFixed(2) : '');

export default function OEMPartsPage() {
  const [q, setQ] = useState('');
  const [oem, setOem] = useState('');
  const [category, setCategory] = useState('');
  const [parts, setParts] = useState<any[]>([]);
  const [oems, setOems] = useState<string[]>([]);
  const [cats, setCats] = useState<string[]>([]);
  const [live, setLive] = useState(false);
  const [imported, setImported] = useState(0);
  const [loading, setLoading] = useState(false);

  // import panel
  const [showImport, setShowImport] = useState(false);
  const [csv, setCsv] = useState('');
  const [fileName, setFileName] = useState('');
  const [importOem, setImportOem] = useState('');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  async function run() {
    setLoading(true);
    try {
      const r = await api.get('/api/oem-parts/search', { q, oem, category });
      setParts(r.parts || []); setOems(r.oems || []); setCats(r.categories || []);
      setLive(!!r.live); setImported(r.imported || 0);
    } catch { /* ignore */ } finally { setLoading(false); }
  }
  // run on mount + whenever a filter changes; text search runs via button/Enter
  useEffect(() => { run(); }, [oem, category]); // eslint-disable-line react-hooks/exhaustive-deps

  const [ordered, setOrdered] = useState<Record<string, string>>({});
  async function order(p: any) {
    try {
      const r = await api.post('/api/parts-orders/create', { item: { partNumber: p.partNumber, name: p.name, price: p.price, qty: 1 } });
      if (r?.order?.poNumber) setOrdered((o) => ({ ...o, [p.partNumber]: r.order.poNumber }));
    } catch { /* ignore */ }
  }

  async function onFile(e: ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setFileName(f.name);
    setCsv(await f.text());
  }

  async function doImport() {
    if (!csv.trim()) { setImportMsg({ ok: false, text: 'Paste a CSV or choose a file first.' }); return; }
    setImporting(true); setImportMsg(null);
    try {
      const r = await api.post('/api/oem-parts/import', { csv, oem: importOem });
      if (r?.error) { setImportMsg({ ok: false, text: r.error }); }
      else {
        setImportMsg({ ok: true, text: `Imported ${r.imported} part${r.imported === 1 ? '' : 's'}${r.skipped ? ` (${r.skipped} skipped)` : ''}. Catalog now has ${r.total}.` });
        setCsv(''); setFileName('');
        await run();
      }
    } catch (e: any) {
      setImportMsg({ ok: false, text: 'Import failed: ' + (e?.message || 'try again') });
    } finally { setImporting(false); }
  }

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-start justify-between gap-3 mb-1">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-slate-700 flex items-center justify-center text-white"><Package size={22} /></div>
          <div>
            <h1 className="text-2xl font-bold">Parts Catalog</h1>
            <p className="text-sm text-gray-500">Search parts by number, name, or unit — price, fitment, availability, supersessions.</p>
          </div>
        </div>
        <button onClick={() => setShowImport((s) => !s)}
          className="shrink-0 inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm font-medium hover:bg-slate-50">
          <Upload size={15} /> Import parts
        </button>
      </div>

      {live ? (
        <div className="mt-3 bg-green-50 border border-green-200 rounded-lg p-3 text-xs text-green-800 flex gap-2">
          <CheckCircle2 size={15} className="shrink-0 mt-0.5" />
          <span><b>Live catalog — {imported.toLocaleString()} parts</b> from your imported data. Import again any time to add brands or refresh pricing.</span>
        </div>
      ) : (
        <div className="mt-3 bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
          <Info size={15} className="shrink-0 mt-0.5" />
          <span><b>Demo catalog.</b> Import your own parts to go live — your OEM price files (downloaded from your dealer portal) or your parts export from your old system. <button onClick={() => setShowImport(true)} className="underline font-medium">Import now →</button></span>
        </div>
      )}

      {showImport && (
        <div className="mt-3 bg-white rounded-xl border shadow-sm p-4">
          <div className="flex items-center justify-between mb-2">
            <h2 className="font-semibold text-sm">Import a parts file</h2>
            <button onClick={() => setShowImport(false)} className="text-gray-400 hover:text-gray-600"><X size={16} /></button>
          </div>
          <p className="text-xs text-gray-500 mb-3">
            Upload a CSV — an OEM price file you downloaded from your dealer portal, or a parts export from your old DMS.
            We auto-detect columns (Part Number / Description / Price / Cost / Brand / Qty / Fitment). Re-importing updates existing parts by part number.
          </p>
          <div className="flex flex-wrap gap-3 items-center mb-3">
            <label className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-slate-300 text-sm cursor-pointer hover:bg-slate-50">
              <Upload size={14} /> Choose CSV
              <input type="file" accept=".csv,.txt" onChange={onFile} className="hidden" />
            </label>
            {fileName && <span className="text-xs text-gray-500">{fileName}</span>}
            <div className="flex items-center gap-1.5">
              <label className="text-xs text-gray-600">Brand for this file (if the file has no brand column):</label>
              <input value={importOem} onChange={(e) => setImportOem(e.target.value)} placeholder="e.g. Polaris"
                className="p-1.5 border rounded text-sm w-32" />
            </div>
          </div>
          <textarea value={csv} onChange={(e) => setCsv(e.target.value)} rows={5}
            placeholder={'…or paste CSV here. First row = headers, e.g.:\npart number,description,price,qty\n2540086,Oil Filter,12.99,8'}
            className="w-full p-2 border rounded-lg text-xs font-mono" />
          <div className="flex items-center gap-3 mt-3">
            <button onClick={doImport} disabled={importing}
              className="px-4 py-2 rounded-lg bg-slate-700 text-white text-sm font-medium hover:bg-slate-800 disabled:opacity-50 inline-flex items-center gap-1.5">
              {importing ? <Loader2 className="animate-spin" size={15} /> : <Upload size={15} />} Import
            </button>
            {importMsg && (
              <span className={`text-xs font-medium ${importMsg.ok ? 'text-green-700' : 'text-red-600'}`}>{importMsg.text}</span>
            )}
          </div>
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
              <th className="px-4 py-2 text-left font-semibold">Order</th>
            </tr></thead>
            <tbody>
              {parts.length === 0 && <tr><td colSpan={7} className="px-4 py-8 text-center text-gray-400">{loading ? 'Searching…' : 'No parts found.'}</td></tr>}
              {parts.map((p, i) => (
                <tr key={i} className="border-t hover:bg-gray-50">
                  <td className="px-4 py-2 font-mono text-xs align-top">{p.partNumber}{p.supersededBy && <span className="block text-[10px] text-amber-600">→ {p.supersededBy}</span>}</td>
                  <td className="px-4 py-2 align-top">{p.name}<span className="block text-[11px] text-gray-400">{p.category}{p.diagram ? ` · ${p.diagram}` : ''}</span></td>
                  <td className="px-4 py-2 text-gray-600 align-top">{p.oem}</td>
                  <td className="px-4 py-2 text-gray-500 text-xs align-top">{p.fitment || '—'}</td>
                  <td className="px-4 py-2 text-right font-semibold align-top">{money(p.price)}{p.msrp && p.msrp > p.price ? <span className="block text-[10px] text-gray-400 line-through font-normal">{money(p.msrp)}</span> : null}</td>
                  <td className="px-4 py-2 align-top"><span className={`text-xs px-2 py-0.5 rounded-full ${/in stock/i.test(p.availability) ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{p.availability}</span></td>
                  <td className="px-4 py-2 align-top">{ordered[p.partNumber] ? <span className="text-xs text-green-700 font-medium whitespace-nowrap">✓ {ordered[p.partNumber]}</span> : <button onClick={() => order(p)} className="text-xs px-2.5 py-1 rounded border border-slate-300 hover:bg-slate-50">Order</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
