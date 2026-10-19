// Moved from templates/crm-rv/frontend/src/pages/rv/FIPage.tsx.
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { CreditCard, Loader2, Send, CheckCircle2, XCircle, AlertCircle } from 'lucide-react'
import { api } from '../../../api'
import { useMayWrite, errorText } from '../../../shared'
import { DEAL_DEFAULTS, dealTotals, leadLabel, type Deal, type DealInfo, type InboxLead, type InboxReply } from './deal';

/** GET /api/fi/products (server/crm/rv/fi.ts): the menu; `cost` only for margin:read. */
interface FiProduct { id: string; name: string; desc: string; price: number; cost?: number }
/** POST /api/fi/submit: the lender's answer. With no credit rail connected it is always decision 'not_submitted'. */
interface LenderResult {
  decision: string; lender: string | null; reason?: string; stipulations?: string[]
  apr?: number; termMonths?: number; approvedAmount?: number
}
type FiDecision = { result: LenderResult; provider: string; live: boolean; submittedAt: string } | { error: string }

/** Only these are approvals: anything else (declined, not_submitted) has no APR or amount to show. */
const APPROVED = ['approved', 'conditional']

const money = (n: number) => `$${Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
function payment(principal: number, apr: number, months: number) {
  const r = apr / 100 / 12;
  if (!principal || !months) return 0;
  if (!r) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

// F&I finances the deal saved in Desking (GET /api/sales-leads/:id/deal) plus the products picked here, using the
// same calculation, so tax, fees, discount, trade and payoff all carry through. A deal that hasn't been desked is
// sent back to Desking rather than financed at the sticker price. (RV T19 H1)
export default function FIPage() {
  const [leads, setLeads] = useState<InboxLead[]>([]);
  // POST /api/fi/submit asks financing:create — managers and up. Staff were offered the button and refused. (T63)
  const maySubmit = useMayWrite('financing:create');
  const [products, setProducts] = useState<FiProduct[]>([]);
  const [leadId, setLeadId] = useState('');
  const [info, setInfo] = useState<DealInfo | null>(null);
  const [loadError, setLoadError] = useState('');
  const [term, setTerm] = useState(60);
  const [sel, setSel] = useState<Record<string, boolean>>({});
  const [decision, setDecision] = useState<FiDecision | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [live, setLive] = useState(false);
  const picked = useRef('');

  useEffect(() => {
    api.get('/api/ai-leads/inbox?stages=new,contacted,demo,desking,closed_won&limit=500').then((r: InboxReply) => setLeads(r.leads || [])).catch(() => {});
    api.get('/api/fi/products').then((r: { products?: FiProduct[] }) => setProducts(r.products || [])).catch(() => {});
    const pre = new URLSearchParams(window.location.search).get('lead');
    if (pre) pick(pre);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function pick(id: string) {
    picked.current = id;
    setLeadId(id); setDecision(null); setInfo(null); setLoadError('');
    if (!id) return;
    try {
      const r: DealInfo = await api.get(`/api/sales-leads/${id}/deal`);
      if (picked.current === id) setInfo(r);
    } catch (e: unknown) {
      if (picked.current === id) setLoadError(errorText(e, 'Could not load this deal'));
    }
  }

  const lead = info && info.leadId === leadId ? info : null;
  const desked: Deal | null = lead?.dealSaved ? { ...DEAL_DEFAULTS, ...lead.deal } : null;
  const totals = desked ? dealTotals(desked) : null;
  const productTotal = products.filter((p) => sel[p.id]).reduce((s, p) => s + p.price, 0);
  const amountFinanced = totals ? totals.financed + productTotal : 0;
  const result = decision && 'result' in decision ? decision.result : null;
  const approved = !!result && APPROVED.includes(result.decision);
  const apr = (approved && result?.apr) || 9.99;
  const months = (approved && result?.termMonths) || term;
  const estPay = payment(amountFinanced, apr, months);
  const missingOption = lead && !leads.some((l) => l.id === leadId);

  async function submit() {
    if (!lead || !totals) return;
    setSubmitting(true); setDecision(null);
    try {
      const r: { result: LenderResult; provider: string; live: boolean; submittedAt: string } = await api.post('/api/fi/submit', { applicant: { name: lead.customerName, email: lead.email, phone: lead.phone }, amountFinanced, term, products: products.filter((p) => sel[p.id]).map((p) => p.id) });
      setDecision(r); setLive(!!r.live);
    } catch (e: unknown) { setDecision({ error: errorText(e, 'Submit failed') }); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-violet-700 flex items-center justify-center text-white"><CreditCard size={22} /></div>
        <div><h1 className="text-2xl font-bold">F&I / Deal Jacket</h1><p className="text-sm text-gray-500 dark:text-slate-400">Structure the deal, present the product menu, submit the credit app to lenders.</p></div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-4 dark:bg-slate-900">
        <label className="text-xs font-medium text-gray-600 dark:text-slate-400">Deal / customer</label>
        <select value={leadId} onChange={(e) => pick(e.target.value)} className="mt-1 block w-full p-2 border rounded-lg text-sm">
          <option value="">Select a lead…</option>
          {missingOption && lead && <option value={leadId}>{leadLabel({ customerName: lead.customerName, unitYear: lead.unit?.year, unitMake: lead.unit?.make, unitModel: lead.unit?.modelName, unitPrice: lead.unit?.price })}</option>}
          {leads.map((l) => <option key={l.id} value={l.id}>{leadLabel(l)}</option>)}
        </select>
        {loadError && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{loadError}</p>}
      </div>

      {lead && !totals && (
        <div className="mt-4 bg-amber-50 border border-amber-200 text-amber-900 rounded-xl p-4 text-sm dark:bg-amber-900/30 dark:border-amber-800 dark:text-amber-200">
          <div className="font-semibold">This deal hasn't been desked yet.</div>
          <p className="mt-1">{lead.deal ? 'A desk from the Sales Pipeline is waiting to be saved. ' : ''}Structure it in Desking first (price, trade, tax and fees) so F&I finances the right amount.</p>
          <Link to={`/crm/desking?lead=${leadId}`} className="mt-2 inline-block font-medium text-orange-700 hover:underline dark:text-orange-200">Open in Desking →</Link>
        </div>
      )}

      {lead && totals && desked && <>
        <div className="grid md:grid-cols-2 gap-4 mt-4">
          <div className="bg-white rounded-xl border shadow-sm p-4 space-y-3 dark:bg-slate-900">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-gray-700 dark:text-slate-200">Deal structure <span className="font-normal text-gray-500 dark:text-slate-400">(from Desking)</span></div>
              <Link to={`/crm/desking?lead=${leadId}`} className="text-xs text-orange-700 hover:underline dark:text-orange-200">Edit in Desking</Link>
            </div>
            <div className="text-sm divide-y">
              {([
                ['Selling price', totals.sellingPrice], ['Accessories / add-ons', desked.accessories],
                [`Sales tax (${desked.taxRate}%)`, totals.tax], ['Fees (doc / freight / title / prep)', totals.fees],
              ] as [string, number][]).map(([l, v]) => <div key={l} className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">{l}</span><span>{money(v)}</span></div>)}
              <div className="flex justify-between py-1 font-semibold"><span>Out-the-door</span><span>{money(totals.outTheDoor)}</span></div>
              <div className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">Down payment</span><span>-{money(desked.down)}</span></div>
              {/* The same row as the desk worksheet, and it had the same fault — see the comment in
                  DeskingPage.tsx. A report naming one screen is not a reason to leave its sibling
                  saying "+$2,200 of equity" to a customer who is $2,200 upside down. (T41) */}
              {totals.netTrade !== 0 && <div className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">{totals.netTrade > 0 ? 'Net trade equity' : 'Negative trade equity'}</span><span>{totals.netTrade > 0 ? '-' : '+'}{money(Math.abs(totals.netTrade))}</span></div>}
              <div className="flex justify-between py-1 font-semibold"><span>Desked amount to finance</span><span>{money(totals.financed)}</span></div>
            </div>
            <label className="flex items-center justify-between text-sm"><span className="text-gray-600 dark:text-slate-400">Term (months)</span>
              <select value={term} onChange={(e) => setTerm(Number(e.target.value))} className="p-1.5 border rounded text-sm">{[24, 36, 48, 60, 72, 84].map((t) => <option key={t} value={t}>{t}</option>)}</select></label>
          </div>
          <div className="bg-white rounded-xl border shadow-sm p-4 dark:bg-slate-900">
            <div className="text-sm font-semibold text-gray-700 mb-2 dark:text-slate-200">F&I menu</div>
            <div className="space-y-1.5">
              {products.map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-sm p-1.5 rounded hover:bg-gray-50 dark:hover:bg-slate-800 cursor-pointer">
                  <input type="checkbox" checked={!!sel[p.id]} onChange={(e) => setSel((s) => ({ ...s, [p.id]: e.target.checked }))} />
                  <span className="flex-1">{p.name}<span className="block text-[11px] text-gray-500 dark:text-slate-400">{p.desc}</span></span>
                  <span className="font-medium">{money(p.price)}</span>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="bg-white rounded-xl border shadow-sm p-4 mt-4 flex items-center justify-between flex-wrap gap-3 dark:bg-slate-900">
          <div className="text-sm">
            <div className="text-gray-500 dark:text-slate-400">Amount financed</div>
            <div className="text-2xl font-bold">{money(amountFinanced)}</div>
            <div className="text-xs text-gray-500 dark:text-slate-400">+ {money(productTotal)} F&I products · est. {money(estPay)}/mo @ {apr}% / {months}mo</div>
          </div>
          {maySubmit && <button onClick={submit} disabled={submitting} className="px-5 py-2.5 rounded-lg bg-violet-700 text-white font-medium hover:bg-violet-800 disabled:opacity-50 inline-flex items-center gap-2">
            {submitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}{submitting ? 'Submitting…' : 'Submit credit app'}</button>}
        </div>

        {decision && 'error' in decision && <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm dark:text-red-400 dark:bg-red-950/40">{decision.error}</div>}
        {/* Only an approval has an APR, a term and an amount. The lender rail answers 'not_submitted' until one is
            connected, and that was drawn as "Not_submitted · " over "APR %", "Approved $0.00" and a link reading
            "Approved — send to Title & Registration". It reads as what it is now: the reason, and no approval. */}
        {result && (
          <div className="mt-4 bg-white rounded-xl border shadow-sm p-5 dark:bg-slate-900">
            <div className="flex items-center gap-2 mb-2 flex-wrap">
              {approved ? <CheckCircle2 className="text-green-700 dark:text-green-300" /> : result.decision === 'declined' ? <XCircle className="text-red-600 dark:text-red-400" /> : <AlertCircle className="text-amber-700 dark:text-amber-300" />}
              <span className="text-lg font-bold capitalize">{result.decision === 'not_submitted' ? 'Not submitted' : result.decision}</span>
              {result.lender && <span className="text-sm text-gray-500 dark:text-slate-400">· {result.lender}</span>}
              {!live && <span className="sm:ml-auto text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5 dark:text-amber-300 dark:bg-amber-950/40">no lender connected — live via RouteOne / DealerTrack on integration</span>}
            </div>
            {approved ? <div className="text-sm text-gray-700 grid grid-cols-3 gap-3 mt-2 dark:text-slate-200">
              <div><div className="text-gray-500 dark:text-slate-400 text-xs">APR</div>{result.apr}%</div>
              <div><div className="text-gray-500 dark:text-slate-400 text-xs">Term</div>{result.termMonths} mo</div>
              <div><div className="text-gray-500 dark:text-slate-400 text-xs">Approved</div>{money(result.approvedAmount ?? 0)}</div>
            </div> : <div className="text-sm text-gray-600 dark:text-slate-400">{result.reason}</div>}
            {!!result.stipulations?.length && <div className="mt-3 text-xs text-gray-500 dark:text-slate-400"><span className="font-semibold">Stipulations:</span> {result.stipulations.join(', ')}</div>}
          </div>
        )}
        {approved && (
          <a href={`/crm/title-reg?lead=${leadId}`} className="mt-3 inline-block text-xs text-violet-700 hover:underline dark:text-violet-300">Approved — send to Title &amp; Registration →</a>
        )}
      </>}
    </div>
  );
}
