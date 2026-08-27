import { useEffect, useState } from 'react';
import { ClipboardCheck, Loader2, Send, CheckCircle2 } from 'lucide-react';
import api from '../../services/api';

const STATES = ['WI', 'MN', 'IA', 'IL', 'MI', 'ND', 'SD', 'Other'];
const money = (n: number) => '$' + (Number(n) || 0).toFixed(2);

export default function TitleRegPage() {
  const [leads, setLeads] = useState<any[]>([]);
  const [leadId, setLeadId] = useState('');
  const [state, setState] = useState('WI');
  const [result, setResult] = useState<any>(null);
  const [submitting, setSubmitting] = useState(false);
  const [live, setLive] = useState(false);

  useEffect(() => {
    api.get('/api/ai-leads/inbox').then((r: any) => {
      const ls = r.leads || []; setLeads(ls);
      const pre = new URLSearchParams(window.location.search).get('lead');
      if (pre && ls.find((l: any) => l.id === pre)) setLeadId(pre);
    }).catch(() => {});
  }, []);
  const lead = leads.find((l) => l.id === leadId);

  async function submit() {
    if (!lead) return;
    setSubmitting(true); setResult(null);
    try {
      const r = await api.post('/api/title-reg/submit', { buyer: { name: lead.customerName }, unit: { year: lead.unitYear, make: lead.unitMake, model: lead.unitModel }, state });
      setResult(r); setLive(!!r.live);
    } catch (e: any) { setResult({ error: e?.message || 'Submit failed' }); }
    finally { setSubmitting(false); }
  }

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-teal-700 flex items-center justify-center text-white"><ClipboardCheck size={22} /></div>
        <div><h1 className="text-2xl font-bold">Title & Registration</h1><p className="text-sm text-gray-500 dark:text-slate-400">Generate the title/reg paperwork and submit to the DMV.</p></div>
      </div>

      <div className="bg-white rounded-xl border shadow-sm p-4 mt-4 space-y-3 dark:bg-slate-900">
        <div><label className="text-xs font-medium text-gray-600 dark:text-slate-400">Deal / customer</label>
          <select value={leadId} onChange={(e) => { setLeadId(e.target.value); setResult(null); }} className="mt-1 block w-full p-2 border rounded-lg text-sm">
            <option value="">Select a lead…</option>
            {leads.map((l) => <option key={l.id} value={l.id}>{l.customerName} — {[l.unitYear, l.unitMake, l.unitModel].filter(Boolean).join(' ')}</option>)}
          </select></div>
        {lead && <>
          <div className="text-sm text-gray-600 dark:text-slate-400">Buyer: <span className="font-medium text-gray-800 dark:text-slate-200">{lead.customerName}</span> · Unit: <span className="font-medium text-gray-800 dark:text-slate-200">{[lead.unitYear, lead.unitMake, lead.unitModel].filter(Boolean).join(' ') || '—'}</span></div>
          <div className="flex items-end gap-3">
            <div><label className="text-xs font-medium text-gray-600 dark:text-slate-400">State</label>
              <select value={state} onChange={(e) => setState(e.target.value)} className="mt-1 block p-2 border rounded-lg text-sm">{STATES.map((s) => <option key={s} value={s}>{s}</option>)}</select></div>
            <button onClick={submit} disabled={submitting} className="px-5 py-2 rounded-lg bg-teal-700 text-white font-medium hover:bg-teal-800 disabled:opacity-50 inline-flex items-center gap-2">{submitting ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}{submitting ? 'Submitting…' : 'Submit to DMV'}</button>
          </div>
        </>}
      </div>

      {result && (result.error
        ? <div className="mt-4 bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">{result.error}</div>
        : <div className="mt-4 bg-white rounded-xl border shadow-sm p-5 dark:bg-slate-900">
          <div className="flex items-center gap-2 mb-3 flex-wrap"><CheckCircle2 className="text-green-600" /><span className="text-lg font-bold capitalize">{result.result?.status}</span><span className="text-sm text-gray-500 dark:text-slate-400">· {result.result?.refNumber} · {result.result?.state}</span>
            {!live && <span className="sm:ml-auto text-[11px] bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2 py-0.5">demo — live via Vitu on integration</span>}</div>
          <div className="grid sm:grid-cols-2 gap-4 text-sm">
            <div><div className="font-semibold text-gray-700 mb-1 dark:text-slate-200">Fees</div>
              <div className="divide-y">
                <div className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">Title</span><span>{money(result.result?.fees?.title)}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">Registration</span><span>{money(result.result?.fees?.registration)}</span></div>
                <div className="flex justify-between py-1"><span className="text-gray-600 dark:text-slate-400">Plate</span><span>{money(result.result?.fees?.plate)}</span></div>
                <div className="flex justify-between py-1 font-bold"><span>Total</span><span>{money(result.result?.fees?.total)}</span></div>
              </div>
              <div className="text-xs text-gray-400 mt-1">ETA {result.result?.eta}</div></div>
            <div><div className="font-semibold text-gray-700 mb-1 dark:text-slate-200">Required documents</div>
              <ul className="list-disc pl-5 text-gray-600 space-y-0.5 dark:text-slate-400">{(result.result?.checklist || []).map((c: string, i: number) => <li key={i}>{c}</li>)}</ul></div>
          </div>
        </div>)}
    </div>
  );
}
