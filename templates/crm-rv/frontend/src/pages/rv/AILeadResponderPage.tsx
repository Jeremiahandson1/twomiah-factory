import { useEffect, useState } from 'react';
import { MessageSquare, Mail, Send, Loader2, Copy, Check, Sparkles, RefreshCw, Zap } from 'lucide-react';
import api from '../../services/api';

type Lead = {
  id: string; stage: string; source: string; createdAt: string;
  customerName?: string; email?: string; phone?: string;
  unitYear?: number; unitMake?: string; unitModel?: string; unitPrice?: string; unitCategory?: string;
};

function money(v?: string) { const n = Number(v); return n ? '$' + n.toLocaleString() : ''; }
function interestLabel(l: Lead) { return l.unitMake ? `${l.unitYear || ''} ${l.unitMake} ${l.unitModel || ''}`.trim() : '—'; }

export default function AILeadResponderPage() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selected, setSelected] = useState<Lead | null>(null);
  const [draft, setDraft] = useState<any>(null);
  const [emailSubject, setEmailSubject] = useState('');
  const [emailBody, setEmailBody] = useState('');
  const [sms, setSms] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [sent, setSent] = useState<{ email?: boolean; sms?: boolean }>({});

  useEffect(() => {
    api.get('/api/ai-leads/inbox').then((r: any) => setLeads(r.leads || [])).catch(() => {});
  }, []);

  async function draftFor(lead: Lead) {
    setSelected(lead); setDraft(null); setError(null); setLoading(true); setSent({});
    try {
      const r = await api.post('/api/ai-leads/draft', { leadId: lead.id });
      setDraft(r); setEmailSubject(r.draft?.email?.subject || ''); setEmailBody(r.draft?.email?.body || ''); setSms(r.draft?.sms || '');
    } catch (e: any) { setError(e?.message || 'Could not draft a response.'); }
    finally { setLoading(false); }
  }

  function copy(which: string, text: string) { navigator.clipboard?.writeText(text); setCopied(which); setTimeout(() => setCopied(null), 1500); }

  return (
    <div className="max-w-6xl mx-auto p-6">
      <div className="flex items-center gap-3 mb-1">
        <div className="w-10 h-10 rounded-lg bg-indigo-600 flex items-center justify-center text-white"><Zap size={22} /></div>
        <div>
          <h1 className="text-2xl font-bold">AI Lead Responder</h1>
          <p className="text-sm text-gray-500 dark:text-slate-400">Pick a fresh lead — AI drafts a personalized, inventory-aware email + text in seconds. Review, tweak, send.</p>
        </div>
      </div>

      <div className="grid md:grid-cols-[320px_1fr] gap-5 mt-5">
        {/* Lead inbox */}
        <div className="bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
          <div className="px-4 py-3 border-b text-sm font-semibold text-gray-600 flex items-center gap-2 dark:text-slate-400"><MessageSquare size={15} /> Leads ({leads.length})</div>
          <div className="max-h-[70vh] overflow-y-auto divide-y">
            {leads.length === 0 && <div className="p-4 text-sm text-gray-400">No leads yet.</div>}
            {leads.map((l) => (
              <button key={l.id} onClick={() => draftFor(l)}
                className={`w-full text-left px-4 py-3 hover:bg-indigo-50 transition ${selected?.id === l.id ? 'bg-indigo-50 border-l-2 border-indigo-600' : ''}`}>
                <div className="font-medium text-sm">{l.customerName || 'Unknown lead'}</div>
                <div className="text-xs text-gray-500 mt-0.5 dark:text-slate-400">{interestLabel(l)} {l.unitPrice ? `· ${money(l.unitPrice)}` : ''}</div>
                <div className="text-[11px] text-gray-400 mt-0.5 capitalize">{(l.source || '').replace(/_/g, ' ')} · {l.stage?.replace(/_/g, ' ')}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Draft */}
        <div>
          {!selected && <div className="bg-white rounded-xl border p-10 text-center text-gray-400 dark:bg-slate-900"><Sparkles className="mx-auto mb-2" /> Pick a lead to draft an instant response.</div>}

          {selected && (
            <div className="space-y-4">
              <div className="bg-white rounded-xl border shadow-sm p-4 flex items-center justify-between flex-wrap gap-2 dark:bg-slate-900">
                <div>
                  <div className="font-semibold">{selected.customerName}</div>
                  <div className="text-xs text-gray-500 dark:text-slate-400">Interested in <span className="font-medium text-gray-700 dark:text-slate-200">{interestLabel(selected)}</span> · via {(selected.source || '').replace(/_/g, ' ')}</div>
                </div>
                <button onClick={() => draftFor(selected)} disabled={loading}
                  className="text-sm px-3 py-1.5 rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1.5 disabled:opacity-50">
                  {loading ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />} {draft ? 'Regenerate' : 'Draft response'}
                </button>
              </div>

              {error && <div className="bg-red-50 border border-red-200 text-red-800 rounded-lg p-4 text-sm">{error}</div>}
              {loading && !draft && <div className="bg-white rounded-xl border p-8 text-center text-gray-500 dark:bg-slate-900 dark:text-slate-400"><Loader2 className="animate-spin mx-auto mb-2" /> AI is reading the lead + your inventory and writing the response…</div>}

              {draft && (
                <>
                  {/* Email */}
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
                    <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:bg-slate-900 dark:text-slate-200"><Mail size={15} /> Email</div>
                    <div className="p-4 space-y-2">
                      <input value={emailSubject} onChange={(e) => setEmailSubject(e.target.value)} className="w-full text-sm font-medium p-2 border rounded-lg" />
                      <textarea value={emailBody} onChange={(e) => setEmailBody(e.target.value)} className="w-full text-sm p-2 border rounded-lg h-40 leading-relaxed" />
                      <div className="flex gap-2">
                        <button onClick={() => copy('email', `Subject: ${emailSubject}\n\n${emailBody}`)} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1.5">{copied === 'email' ? <Check size={13} /> : <Copy size={13} />} Copy</button>
                        <button onClick={() => setSent(s => ({ ...s, email: true }))} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5"><Send size={13} /> {sent.email ? 'Sent ✓' : 'Send email'}</button>
                      </div>
                    </div>
                  </div>

                  {/* SMS */}
                  <div className="bg-white rounded-xl border shadow-sm overflow-hidden dark:bg-slate-900">
                    <div className="px-4 py-2.5 border-b bg-gray-50 flex items-center gap-2 text-sm font-semibold text-gray-700 dark:bg-slate-900 dark:text-slate-200"><MessageSquare size={15} /> Text message</div>
                    <div className="p-4 space-y-2">
                      <textarea value={sms} onChange={(e) => setSms(e.target.value)} className="w-full text-sm p-2 border rounded-lg h-20" />
                      <div className="flex items-center gap-2">
                        <button onClick={() => copy('sms', sms)} className="text-xs px-3 py-1.5 rounded-lg border hover:bg-gray-50 inline-flex items-center gap-1.5">{copied === 'sms' ? <Check size={13} /> : <Copy size={13} />} Copy</button>
                        <button onClick={() => setSent(s => ({ ...s, sms: true }))} className="text-xs px-3 py-1.5 rounded-lg bg-indigo-600 text-white hover:bg-indigo-700 inline-flex items-center gap-1.5"><Send size={13} /> {sent.sms ? 'Sent ✓' : 'Send text'}</button>
                        <span className="text-[11px] text-gray-400 ml-auto">{sms.length} chars</span>
                      </div>
                    </div>
                  </div>
                  {(sent.email || sent.sms) && <p className="text-[11px] text-gray-400">Live delivery sends through the CRM's connected Twilio/SendGrid once configured.</p>}
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
