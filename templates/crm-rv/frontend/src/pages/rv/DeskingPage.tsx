import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { ClipboardList, Loader2, Save } from 'lucide-react';
import api from '../../services/api';
import { DEAL_DEFAULTS, DEAL_KEYS, dealToText, dealTotals, parseDeal, type Deal } from '../../lib/deal';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();
function payment(p: number, apr: number, m: number) {
  const r = apr / 100 / 12;
  if (!p || !m) return 0;
  if (!r) return p / m;
  return (p * r) / (1 - Math.pow(1 + r, -m));
}

// The desk is saved on the lead (PUT /api/sales-leads/:id/deal) and reloads with it; F&I finances what is saved
// here. Inputs are kept as typed text, so a minus sign or a half-typed number is never rewritten. (RV T19 H1, M5)
export default function DeskingPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [leads, setLeads] = useState<any[]>([]);
  const [leadId, setLeadId] = useState('');
  const [info, setInfo] = useState<any>(null);
  const [raw, setRaw] = useState<Record<keyof Deal, string>>(dealToText(DEAL_DEFAULTS));
  const [savedText, setSavedText] = useState<string | null>(null);
  const [status, setStatus] = useState<{ kind: 'ok' | 'error'; text: string } | null>(null);
  const [loadingDeal, setLoadingDeal] = useState(false);
  const [saving, setSaving] = useState(false);
  const picked = useRef('');

  useEffect(() => {
    api.get('/api/ai-leads/inbox?stages=new,contacted,demo,desking,closed_won&limit=500').then((r: any) => setLeads(r.leads || [])).catch(() => {});
    const pre = params.get('lead');
    if (pre) pick(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(id: string) {
    picked.current = id;
    setLeadId(id); setInfo(null); setStatus(null); setSavedText(null);
    if (!id) { setRaw(dealToText(DEAL_DEFAULTS)); return; }
    setLoadingDeal(true);
    try {
      const r: any = await api.get(`/api/sales-leads/${id}/deal`);
      if (picked.current !== id) return;
      const start: Deal = r.deal ? { ...DEAL_DEFAULTS, ...r.deal } : { ...DEAL_DEFAULTS, price: Number(r.unit?.price) || 0 };
      const text = dealToText(start);
      setInfo(r); setRaw(text);
      setSavedText(r.dealSaved ? JSON.stringify(text) : null);
      if (!r.dealSaved && r.deal) setStatus({ kind: 'ok', text: 'Loaded the desk saved from the Sales Pipeline. Save to keep it with the deal.' });
    } catch (e: any) {
      if (picked.current === id) setStatus({ kind: 'error', text: e?.message || 'Could not load this deal' });
    } finally {
      if (picked.current === id) setLoadingDeal(false);
    }
  }

  const { deal: d, errors } = parseDeal(raw);
  const hasErrors = Object.keys(errors).length > 0;
  const t = dealTotals(d);
  // While a field is invalid the order and payments aren't calculated from it — "—" instead of a -5% tax line
  // (RV T20 N2). Saving is already blocked until the fields are fixed.
  const shown = (n: number) => (hasErrors ? '—' : money(n));
  const dirty = savedText !== JSON.stringify(raw);
  const setField = (k: keyof Deal, v: string) => { setRaw((s) => ({ ...s, [k]: v })); setStatus(null); };

  async function save(): Promise<boolean> {
    if (!leadId || hasErrors) return false;
    setSaving(true);
    try {
      await api.put(`/api/sales-leads/${leadId}/deal`, Object.fromEntries(DEAL_KEYS.map((k) => [k, d[k]])));
      setSavedText(JSON.stringify(raw));
      setStatus({ kind: 'ok', text: 'Deal saved' });
      return true;
    } catch (e: any) {
      setStatus({ kind: 'error', text: e?.message || 'Could not save the deal' });
      return false;
    } finally {
      setSaving(false);
    }
  }
  async function sendToFi() {
    if (await save()) navigate(`/crm/fi?lead=${leadId}`);
  }

  const inputs: [string, keyof Deal][] = [
    ['Selling price', 'price'], ['Discount', 'discount'], ['Accessories / add-ons', 'accessories'],
    ['Trade allowance', 'tradeAllow'], ['Trade payoff', 'tradePayoff'],
    ['Doc fee', 'doc'], ['Freight / setup', 'freight'], ['Title & reg', 'titleReg'], ['Dealer prep', 'prep'], ['Down payment', 'down'],
  ];
  const otdRows: [string, number][] = [
    ['Selling price', t.sellingPrice], ['Accessories / add-ons', d.accessories],
    [errors.taxRate ? 'Sales tax (net of trade)' : `Sales tax (${d.taxRate}% net of trade)`, t.tax], ['Fees (doc / freight / title / prep)', t.fees],
  ];
  const leadLabel = (l: any) => `${l.customerName} — ${[l.unitYear, l.unitMake, l.unitModel].filter(Boolean).join(' ')} ${l.unitPrice ? `($${Number(l.unitPrice).toLocaleString()})` : ''}`;
  const missingOption = leadId && info && !leads.some((l) => l.id === leadId);

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-blue-700 flex items-center justify-center text-white"><ClipboardList size={22} /></div>
        <div><h1 className="text-2xl font-bold">Desking</h1><p className="text-sm text-gray-500 dark:text-slate-400">Structure the deal — out-the-door price, trade, fees, tax, and the payment matrix.</p></div>
      </div>

      <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4 mt-4 dark:bg-slate-900 dark:text-slate-100">
        <label className="text-xs font-medium text-gray-600 dark:text-slate-400">Deal / customer</label>
        <select value={leadId} onChange={(e) => pick(e.target.value)} className="mt-1 block w-full p-2 border rounded-lg text-sm">
          <option value="">Select a lead…</option>
          {missingOption && <option value={leadId}>{leadLabel({ customerName: info.customerName, unitYear: info.unit?.year, unitMake: info.unit?.make, unitModel: info.unit?.modelName, unitPrice: info.unit?.price })}</option>}
          {leads.map((l) => <option key={l.id} value={l.id}>{leadLabel(l)}</option>)}
        </select>
        {loadingDeal && <p className="mt-2 text-xs text-gray-500 flex items-center gap-1 dark:text-slate-400"><Loader2 size={12} className="animate-spin" /> Loading the deal…</p>}
        {status && <p className={`mt-2 text-sm ${status.kind === 'error' ? 'text-red-600' : 'text-green-700 dark:text-green-400'}`}>{status.text}</p>}
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4 space-y-2.5 dark:bg-slate-900 dark:text-slate-100">
          <div className="text-sm font-semibold text-gray-700 mb-1 dark:text-slate-200">Deal inputs</div>
          {inputs.map(([label, key]) => (
            <div key={key}>
              <label className="flex items-center justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">{label}</span>
                <span className="flex items-center"><span className="text-gray-400 mr-1">$</span><input type="number" min="0" inputMode="decimal" value={raw[key]} onChange={(e) => setField(key, e.target.value)} className={`w-28 p-1.5 border rounded text-right text-sm ${errors[key] ? 'border-red-500' : ''}`} /></span></label>
              {errors[key] && <p className="text-xs text-red-600 text-right mt-0.5">{errors[key]}</p>}
            </div>
          ))}
          <div>
            <label className="flex items-center justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Tax rate</span>
              <span className="flex items-center"><input type="number" min="0" max="25" step="0.1" inputMode="decimal" value={raw.taxRate} onChange={(e) => setField('taxRate', e.target.value)} className={`w-20 p-1.5 border rounded text-right text-sm ${errors.taxRate ? 'border-red-500' : ''}`} /><span className="text-gray-400 ml-1">%</span></span></label>
            {errors.taxRate && <p className="text-xs text-red-600 text-right mt-0.5">{errors.taxRate}</p>}
          </div>
        </div>

        <div className="space-y-4">
          <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4 dark:bg-slate-900 dark:text-slate-100">
            <div className="text-sm font-semibold text-gray-700 mb-2 dark:text-slate-200">Buyer's order</div>
            <div className="text-sm divide-y">
              {otdRows.map(([l, v]) => (<div key={l} className="flex justify-between py-1.5"><span className="text-gray-600 dark:text-slate-400">{l}</span><span>{shown(v)}</span></div>))}
              <div className="flex justify-between py-2 font-bold text-base"><span>Out-the-door</span><span>{shown(t.outTheDoor)}</span></div>
              <div className="flex justify-between py-1.5"><span className="text-gray-600 dark:text-slate-400">Down payment</span><span className="text-green-700">{hasErrors ? '—' : `-${money(d.down)}`}</span></div>
              {!hasErrors && t.netTrade !== 0 && <div className="flex justify-between py-1.5"><span className="text-gray-600 dark:text-slate-400">Net trade equity</span><span className={t.netTrade > 0 ? 'text-green-700' : ''}>{t.netTrade > 0 ? '-' : '+'}{money(Math.abs(t.netTrade))}</span></div>}
              <div className="flex justify-between py-2 font-bold text-lg text-blue-800"><span>Amount to finance</span><span>{shown(t.financed)}</span></div>
            </div>
            {hasErrors && <p className="mt-2 text-xs text-red-600">Totals and payments show once the highlighted fields are fixed.</p>}
            {leadId && (
              <div className="mt-3 flex items-center gap-2 flex-wrap">
                <button type="button" onClick={save} disabled={saving || loadingDeal || hasErrors || !dirty} className="px-3 py-1.5 rounded-lg bg-blue-700 text-white text-sm font-medium hover:bg-blue-800 disabled:opacity-50 inline-flex items-center gap-1.5">
                  {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}{dirty ? 'Save deal' : 'Saved'}
                </button>
                <button type="button" onClick={sendToFi} disabled={saving || loadingDeal || hasErrors} className="px-3 py-1.5 rounded-lg border text-sm text-blue-700 hover:bg-blue-50 disabled:opacity-50 dark:hover:bg-slate-800">Send to F&I →</button>
                {hasErrors && <span className="text-xs text-red-600">Fix the highlighted fields to save.</span>}
              </div>
            )}
          </div>

          <div className="bg-white text-gray-900 rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900 dark:text-slate-100">
            <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700 dark:text-slate-200">Monthly payment</div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 dark:bg-slate-900 dark:text-slate-400"><tr><th className="px-4 py-2 text-left font-semibold">Term</th>{[6.99, 9.99, 12.99].map((a) => <th key={a} className="px-4 py-2 text-right font-semibold">{a}%</th>)}</tr></thead>
              <tbody>{[48, 60, 72].map((m) => (<tr key={m} className="border-t"><td className="px-4 py-2 text-gray-600 dark:text-slate-400">{m} mo</td>{[6.99, 9.99, 12.99].map((a) => <td key={a} className="px-4 py-2 text-right">{shown(payment(t.financed, a, m))}</td>)}</tr>))}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
