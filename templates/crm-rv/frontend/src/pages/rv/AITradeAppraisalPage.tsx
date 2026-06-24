import { useState } from 'react';
import { Calculator, Loader2, Info } from 'lucide-react';
import api from '../../services/api';

const CATEGORIES = ['motorcycle', 'atv', 'utv', 'snowmobile', 'pwc', 'boat', 'motorhome', 'towable'];
const CONDITIONS = ['excellent', 'good', 'fair', 'rough'];
const money = (n?: number) => (typeof n === 'number' ? '$' + n.toLocaleString() : '—');

export default function AITradeAppraisalPage() {
  const [f, setF] = useState<any>({ year: '', make: '', model: '', category: 'boat', mileageHours: '', condition: 'good' });
  const [res, setRes] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (k: string, v: any) => setF((p: any) => ({ ...p, [k]: v }));

  async function appraise() {
    if (!f.make.trim() || !f.model.trim()) { setError('Enter at least a make and model.'); return; }
    setLoading(true); setError(null); setRes(null);
    try {
      const r = await api.post('/api/ai-trade/appraise', { ...f, year: f.year ? Number(f.year) : undefined });
      setRes(r);
    } catch (e: any) { setError(e?.message || 'Could not appraise.'); }
    finally { setLoading(false); }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center text-white"><Calculator size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">AI Trade Appraisal</h1>
          <p className="text-sm text-gray-500">Instant trade-in estimate on any unit. Type it in, get a number to work the deal.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-5 grid grid-cols-2 md:grid-cols-3 gap-3">
        <label className="text-xs font-medium text-gray-600">Year
          <input value={f.year} onChange={(e) => set('year', e.target.value)} placeholder="2023" className="mt-1 w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs font-medium text-gray-600">Make
          <input value={f.make} onChange={(e) => set('make', e.target.value)} placeholder="Bennington" className="mt-1 w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs font-medium text-gray-600">Model
          <input value={f.model} onChange={(e) => set('model', e.target.value)} placeholder="22 SSBX" className="mt-1 w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs font-medium text-gray-600">Category
          <select value={f.category} onChange={(e) => set('category', e.target.value)} className="mt-1 w-full p-2 border rounded-lg text-sm capitalize">{CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <label className="text-xs font-medium text-gray-600">Miles / Hours
          <input value={f.mileageHours} onChange={(e) => set('mileageHours', e.target.value)} placeholder="120 hrs" className="mt-1 w-full p-2 border rounded-lg text-sm" /></label>
        <label className="text-xs font-medium text-gray-600">Condition
          <select value={f.condition} onChange={(e) => set('condition', e.target.value)} className="mt-1 w-full p-2 border rounded-lg text-sm capitalize">{CONDITIONS.map(c => <option key={c} value={c}>{c}</option>)}</select></label>
        <div className="col-span-2 md:col-span-3">
          <button onClick={appraise} disabled={loading} className="px-6 py-2 rounded-lg bg-emerald-600 text-white font-medium hover:bg-emerald-700 disabled:opacity-50 inline-flex items-center gap-2">
            {loading ? <Loader2 className="animate-spin" size={18} /> : <Calculator size={18} />}{loading ? 'Appraising…' : 'Appraise'}</button>
        </div>
      </div>

      {error && <div className="mt-5 bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">{error}</div>}

      {res && (
        <div className="mt-5 space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Trade-in (wholesale)</div>
              <div className="text-3xl font-bold text-emerald-700">{money(res.appraisal?.tradeIn?.avg)}</div>
              <div className="text-sm text-gray-500 mt-1">range {money(res.appraisal?.tradeIn?.low)} – {money(res.appraisal?.tradeIn?.high)}</div>
            </div>
            <div className="bg-white rounded-xl border shadow-sm p-5">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">Est. retail</div>
              <div className="text-3xl font-bold text-gray-800">{money(res.appraisal?.retail?.low)} – {money(res.appraisal?.retail?.high)}</div>
            </div>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-5 text-sm text-gray-700 space-y-2">
            {res.appraisal?.conditionNote && <p><span className="font-semibold">Condition:</span> {res.appraisal.conditionNote}</p>}
            {res.appraisal?.reasoning && <p>{res.appraisal.reasoning}</p>}
            {Array.isArray(res.appraisal?.comps) && res.appraisal.comps.length > 0 && (
              <ul className="list-disc pl-5 text-gray-600">{res.appraisal.comps.map((c: string, i: number) => <li key={i}>{c}</li>)}</ul>
            )}
          </div>
          <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800 flex gap-2">
            <Info size={15} className="shrink-0 mt-0.5" /><span>{res.disclaimer}</span>
          </div>
        </div>
      )}
    </div>
  );
}
