import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import api from '../../services/api';

const money = (n: number) => '$' + (Math.round(n) || 0).toLocaleString();
function payment(p: number, apr: number, m: number) {
  const r = apr / 100 / 12;
  if (!p || !m) return 0;
  if (!r) return p / m;
  return (p * r) / (1 - Math.pow(1 + r, -m));
}

export default function DeskingPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [leadId, setLeadId] = useState('');
  const [d, setD] = useState<any>({ price: 0, discount: 0, accessories: 0, tradeAllow: 0, tradePayoff: 0, doc: 399, freight: 695, titleReg: 250, prep: 199, taxRate: 5.5, down: 0 });
  const set = (k: string, v: number) => setD((s: any) => ({ ...s, [k]: v }));

  useEffect(() => { api.get('/api/ai-leads/inbox').then((r: any) => setLeads(r.leads || [])).catch(() => {}); }, []);
  const lead = leads.find((l) => l.id === leadId);
  function pick(id: string) { setLeadId(id); const l = leads.find((x) => x.id === id); setD((s: any) => ({ ...s, price: Number(l?.unitPrice) || 0 })); }

  const sp = Math.max(0, d.price - d.discount);
  const taxable = Math.max(0, sp + d.accessories - d.tradeAllow);
  const tax = (d.taxRate / 100) * taxable;
  const fees = d.doc + d.freight + d.titleReg + d.prep;
  const otd = sp + d.accessories + tax + fees;
  const netTrade = d.tradeAllow - d.tradePayoff;
  const financed = Math.max(0, otd - d.down - netTrade);

  const inputs: [string, string][] = [
    ['Selling price', 'price'], ['Discount', 'discount'], ['Accessories / add-ons', 'accessories'],
    ['Trade allowance', 'tradeAllow'], ['Trade payoff', 'tradePayoff'],
    ['Doc fee', 'doc'], ['Freight / setup', 'freight'], ['Title & reg', 'titleReg'], ['Dealer prep', 'prep'], ['Down payment', 'down'],
  ];
  const otdRows: [string, number][] = [
    ['Selling price', sp], ['Accessories / add-ons', d.accessories],
    [`Sales tax (${d.taxRate}% net of trade)`, tax], ['Fees (doc / freight / title / prep)', fees],
  ];

  return (
    <div className="max-w-5xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-blue-700 flex items-center justify-center text-white"><ClipboardList size={22} /></div>
        <div><h1 className="text-2xl font-bold">Desking</h1><p className="text-sm text-gray-500">Structure the deal — out-the-door price, trade, fees, tax, and the payment matrix.</p></div>
      </div>

      <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4 mt-4">
        <label className="text-xs font-medium text-gray-600">Deal / customer</label>
        <select value={leadId} onChange={(e) => pick(e.target.value)} className="mt-1 block w-full p-2 border rounded-lg text-sm">
          <option value="">Select a lead…</option>
          {leads.map((l) => <option key={l.id} value={l.id}>{l.customerName} — {[l.unitYear, l.unitMake, l.unitModel].filter(Boolean).join(' ')} {l.unitPrice ? `($${Number(l.unitPrice).toLocaleString()})` : ''}</option>)}
        </select>
      </div>

      <div className="grid md:grid-cols-2 gap-4 mt-4">
        <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4 space-y-2.5">
          <div className="text-sm font-semibold text-gray-700 mb-1">Deal inputs</div>
          {inputs.map(([label, key]) => (
            <label key={key} className="flex items-center justify-between text-sm"><span className="text-gray-600">{label}</span>
              <span className="flex items-center"><span className="text-gray-400 mr-1">$</span><input type="number" value={d[key]} onChange={(e) => set(key, Number(e.target.value) || 0)} className="w-28 p-1.5 border rounded text-right text-sm" /></span></label>
          ))}
          <label className="flex items-center justify-between text-sm"><span className="text-gray-600">Tax rate</span>
            <span className="flex items-center"><input type="number" step="0.1" value={d.taxRate} onChange={(e) => set('taxRate', Number(e.target.value) || 0)} className="w-20 p-1.5 border rounded text-right text-sm" /><span className="text-gray-400 ml-1">%</span></span></label>
        </div>

        <div className="space-y-4">
          <div className="bg-white text-gray-900 rounded-xl border shadow-sm p-4">
            <div className="text-sm font-semibold text-gray-700 mb-2">Buyer's order</div>
            <div className="text-sm divide-y">
              {otdRows.map(([l, v]) => (<div key={l} className="flex justify-between py-1.5"><span className="text-gray-600">{l}</span><span>{money(v)}</span></div>))}
              <div className="flex justify-between py-2 font-bold text-base"><span>Out-the-door</span><span>{money(otd)}</span></div>
              <div className="flex justify-between py-1.5"><span className="text-gray-600">Down payment</span><span className="text-green-700">-{money(d.down)}</span></div>
              {netTrade !== 0 && <div className="flex justify-between py-1.5"><span className="text-gray-600">Net trade equity</span><span className={netTrade > 0 ? 'text-green-700' : ''}>{netTrade > 0 ? '-' : '+'}{money(Math.abs(netTrade))}</span></div>}
              <div className="flex justify-between py-2 font-bold text-lg text-blue-800"><span>Amount to finance</span><span>{money(financed)}</span></div>
            </div>
            {lead && <a href={`/crm/fi?lead=${leadId}`} className="mt-3 inline-block text-xs text-blue-700 hover:underline">Send to F&I →</a>}
          </div>

          <div className="bg-white text-gray-900 rounded-xl border shadow-sm overflow-hidden">
            <div className="px-4 py-2 border-b text-sm font-semibold text-gray-700">Monthly payment</div>
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-gray-500"><tr><th className="px-4 py-2 text-left font-semibold">Term</th>{[6.99, 9.99, 12.99].map((a) => <th key={a} className="px-4 py-2 text-right font-semibold">{a}%</th>)}</tr></thead>
              <tbody>{[48, 60, 72].map((m) => (<tr key={m} className="border-t"><td className="px-4 py-2 text-gray-600">{m} mo</td>{[6.99, 9.99, 12.99].map((a) => <td key={a} className="px-4 py-2 text-right">{money(payment(financed, a, m))}</td>)}</tr>))}</tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
