import { useState, useEffect } from 'react';
import { Plus, Trash2, Calculator, Loader2, Ruler } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';

const AREA_FIELDS = [
  { value: 'lawnSqft', label: 'Lawn' },
  { value: 'bedSqft', label: 'Beds' },
  { value: 'hardscapeSqft', label: 'Hardscape' },
  { value: 'lotSqft', label: 'Full lot' },
  { value: 'drivewaySqft', label: 'Driveway' },
];

const EMPTY = { serviceType: '', areaField: 'lawnSqft', ratePer1000Sqft: '', minCharge: '0', unitLabel: 'per visit' };

export default function AreaPricingPage() {
  const toast = useToast();
  const [rates, setRates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState<any>(EMPTY);
  const [calc, setCalc] = useState({ siteId: '', serviceType: '' });
  const [calcResult, setCalcResult] = useState<any>(null);
  const [measure, setMeasure] = useState<any>({ siteId: '', lawnSqft: '', bedSqft: '', hardscapeSqft: '', drivewaySqft: '', lotSqft: '' });

  const load = async () => {
    try {
      const res = await api.get('/api/area-pricing/rates');
      setRates(res.data || res || []);
    } catch { toast.error('Failed to load rate card'); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const addRate = async () => {
    if (!form.serviceType || !form.ratePer1000Sqft) { toast.error('Service type and rate are required'); return; }
    try {
      await api.post('/api/area-pricing/rates', form);
      toast.success('Rate added');
      setForm(EMPTY);
      load();
    } catch (e: any) { toast.error(e?.message || 'Failed to add rate'); }
  };

  const removeRate = async (id: string) => {
    if (!confirm('Delete this rate?')) return;
    try { await api.delete(`/api/area-pricing/rates/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Failed to delete'); }
  };

  const saveMeasurements = async () => {
    if (!measure.siteId) { toast.error('Site ID required'); return; }
    try {
      await api.put(`/api/area-pricing/sites/${measure.siteId}/measurements`, { ...measure, measurementSource: 'manual' });
      toast.success('Measurements saved');
    } catch (e: any) { toast.error(e?.message || 'Failed to save measurements'); }
  };

  const runQuote = async () => {
    if (!calc.siteId || !calc.serviceType) { toast.error('Pick a site and service'); return; }
    setCalcResult(null);
    try {
      const res = await api.get('/api/area-pricing/quote', { siteId: calc.siteId, serviceType: calc.serviceType });
      setCalcResult(res);
    } catch (e: any) {
      toast.error(e?.message || 'No price (check the site has a measurement and an active rate)');
    }
  };

  if (loading) return <div className="p-8 flex justify-center"><Loader2 className="animate-spin" /></div>;

  return (
    <div className="p-6 max-w-5xl space-y-8">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2"><Ruler className="w-6 h-6" /> Area-Based Pricing</h1>
        <p className="text-gray-500 text-sm dark:text-slate-400">Price services by measured square footage. Price = max(min charge, area ÷ 1,000 × rate).</p>
      </div>

      {/* Rate card */}
      <section className="bg-white border rounded-lg p-5 dark:bg-slate-900">
        <h2 className="font-semibold mb-3">Rate Card</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-gray-500 border-b dark:text-slate-400">
              <th className="py-2">Service</th><th>Drives off</th><th>Rate / 1,000 sq ft</th><th>Min charge</th><th>Unit</th><th></th>
            </tr></thead>
            <tbody>
              {rates.map(r => (
                <tr key={r.id} className="border-b">
                  <td className="py-2 font-medium">{r.serviceType}</td>
                  <td>{AREA_FIELDS.find(a => a.value === r.areaField)?.label || r.areaField}</td>
                  <td>${Number(r.ratePer1000Sqft).toFixed(2)}</td>
                  <td>${Number(r.minCharge).toFixed(2)}</td>
                  <td>{r.unitLabel}</td>
                  <td><button onClick={() => removeRate(r.id)} className="text-red-600 p-1 hover:bg-red-50 rounded"><Trash2 className="w-4 h-4" /></button></td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={6} className="py-4 text-gray-400">No rates yet — add one below.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-4 items-end">
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Service (e.g. mowing)" value={form.serviceType} onChange={e => setForm({ ...form, serviceType: e.target.value })} />
          <select className="border rounded px-2 py-1.5 text-sm" value={form.areaField} onChange={e => setForm({ ...form, areaField: e.target.value })}>
            {AREA_FIELDS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
          </select>
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Rate /1k" value={form.ratePer1000Sqft} onChange={e => setForm({ ...form, ratePer1000Sqft: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" type="number" placeholder="Min $" value={form.minCharge} onChange={e => setForm({ ...form, minCharge: e.target.value })} />
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Unit" value={form.unitLabel} onChange={e => setForm({ ...form, unitLabel: e.target.value })} />
          <button onClick={addRate} className="flex items-center justify-center gap-1 bg-green-600 text-white rounded px-3 py-1.5 text-sm"><Plus className="w-4 h-4" /> Add</button>
        </div>
      </section>

      {/* Site measurements */}
      <section className="bg-white border rounded-lg p-5 dark:bg-slate-900">
        <h2 className="font-semibold mb-3">Set Property Measurements</h2>
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 items-end">
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Site ID" value={measure.siteId} onChange={e => setMeasure({ ...measure, siteId: e.target.value })} />
          {['lawnSqft', 'bedSqft', 'hardscapeSqft', 'drivewaySqft', 'lotSqft'].map(f => (
            <input key={f} className="border rounded px-2 py-1.5 text-sm" type="number" placeholder={f.replace('Sqft', '') + ' sq ft'} value={measure[f]} onChange={e => setMeasure({ ...measure, [f]: e.target.value })} />
          ))}
        </div>
        <button onClick={saveMeasurements} className="mt-3 bg-gray-800 text-white rounded px-4 py-1.5 text-sm">Save Measurements</button>
      </section>

      {/* Quote calculator */}
      <section className="bg-white border rounded-lg p-5 dark:bg-slate-900">
        <h2 className="font-semibold mb-3 flex items-center gap-2"><Calculator className="w-5 h-5" /> Price a Service for a Property</h2>
        <div className="flex flex-wrap gap-2 items-end">
          <input className="border rounded px-2 py-1.5 text-sm" placeholder="Site ID" value={calc.siteId} onChange={e => setCalc({ ...calc, siteId: e.target.value })} />
          <select className="border rounded px-2 py-1.5 text-sm" value={calc.serviceType} onChange={e => setCalc({ ...calc, serviceType: e.target.value })}>
            <option value="">Select service…</option>
            {rates.map(r => <option key={r.id} value={r.serviceType}>{r.serviceType}</option>)}
          </select>
          <button onClick={runQuote} className="bg-green-600 text-white rounded px-4 py-1.5 text-sm">Calculate</button>
        </div>
        {calcResult && (
          <div className="mt-4 p-4 bg-green-50 border border-green-200 rounded">
            <div className="text-2xl font-bold text-green-800">${Number(calcResult.price).toFixed(2)}</div>
            <div className="text-sm text-green-700">{calcResult.lineItem?.description}</div>
            {calcResult.minChargeApplied && <div className="text-xs text-green-600 mt-1">Minimum charge applied.</div>}
          </div>
        )}
      </section>
    </div>
  );
}
