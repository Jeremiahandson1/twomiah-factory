import { useState, useEffect } from 'react';
import { formatDate } from '../../utils/date';
import { FileText, Loader2, PenTool, XCircle, CheckCircle, ChevronLeft } from 'lucide-react';
import { portalHeaders } from './PortalLayout';
import { SignatureModal, SignatureDisplay, type SignatureData } from '../../components/common/SignaturePad';

const STATUS_COLORS: Record<string, string> = {
  sent: 'bg-blue-800 text-blue-200',
  viewed: 'bg-purple-800 text-purple-200',
  approved: 'bg-green-800 text-green-200',
  declined: 'bg-red-800 text-red-200',
  expired: 'bg-gray-700 text-gray-400',
};

interface QuoteLineItem { description?: string; quantity?: number | string; unitPrice?: number | string; total?: number | string; [k: string]: unknown }
interface PortalQuote {
  id: string;
  quoteNumber?: string;
  status: string;
  total?: number | string;
  subtotal?: number | string;
  taxAmount?: number | string;
  expiresAt?: string | null;
  createdAt?: string;
  approvedAt?: string | null;
  signature?: string | null;
  signedBy?: string | null;
  signedAt?: string | null;
  notes?: string | null;
  customerMessage?: string | null;
  lineItems?: QuoteLineItem[] | string;
  company?: { name?: string; email?: string; phone?: string } | null;
  [k: string]: unknown;
}

const money = (v: unknown) => `$${Number(v || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}`;
const formatStatus = (s: string) => (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export default function PortalQuotes() {
  const [quotes, setQuotes] = useState<PortalQuote[]>([]);
  const [openQuote, setOpenQuote] = useState<PortalQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [showSignature, setShowSignature] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [me, setMe] = useState<{ firstName?: string; lastName?: string } | null>(null);

  useEffect(() => { loadQuotes(); loadMe(); }, []);

  const loadMe = async () => {
    try {
      const res = await fetch('/api/portal/me', { headers: portalHeaders() });
      if (res.ok) { const data = await res.json(); setMe(data?.contact || null); }
    } catch { /* name is a convenience prefill only */ }
  };

  const loadQuotes = async () => {
    try {
      const res = await fetch('/api/portal/quotes', { headers: portalHeaders() });
      const data = await res.json();
      setQuotes(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error('Failed to load quotes:', err);
    } finally {
      setLoading(false);
    }
  };

  const openDetail = async (id: string) => {
    setError(null);
    try {
      const res = await fetch(`/api/portal/quotes/${id}`, { headers: portalHeaders() });
      if (!res.ok) throw new Error('Could not open that proposal.');
      setOpenQuote(await res.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    }
  };

  const handleSign = async (data: SignatureData) => {
    if (!openQuote) return;
    setBusy(true);
    setShowSignature(false);
    setError(null);
    try {
      const res = await fetch(`/api/portal/quotes/${openQuote.id}/approve`, {
        method: 'POST',
        headers: { ...portalHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ signature: data.signature, signedBy: data.signedBy, consent: data.consent }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not record your signature.');
      setOpenQuote({ ...openQuote, ...(body.quote || {}) });
      loadQuotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  const handleDecline = async () => {
    if (!openQuote) return;
    const reason = prompt('Let them know why (optional):') || null;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/portal/quotes/${openQuote.id}/decline`, {
        method: 'POST',
        headers: { ...portalHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not decline this proposal.');
      setOpenQuote({ ...openQuote, ...(body.quote || {}) });
      loadQuotes();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  // ── detail view ───────────────────────────────────────────────────────────
  if (openQuote) {
    const items: QuoteLineItem[] = Array.isArray(openQuote.lineItems)
      ? openQuote.lineItems
      : (() => { try { return JSON.parse(String(openQuote.lineItems || '[]')); } catch { return []; } })();
    const expired = !!openQuote.expiresAt && new Date(openQuote.expiresAt) < new Date();
    const canSign = ['sent', 'viewed'].includes(openQuote.status) && !expired;

    return (
      <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
        <button onClick={() => { setOpenQuote(null); setError(null); }} className="flex items-center gap-1 text-sm text-gray-400 hover:text-gray-200">
          <ChevronLeft className="w-4 h-4" /> Back to proposals
        </button>

        <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
          <div className="p-4 border-b border-gray-700 flex items-start justify-between">
            <div>
              <p className="text-sm font-mono text-gray-400">{openQuote.quoteNumber || 'Proposal'}</p>
              <p className="text-2xl font-bold text-white mt-0.5">{money(openQuote.total)}</p>
            </div>
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_COLORS[openQuote.status] || 'bg-gray-700 text-gray-400'}`}>
              {formatStatus(openQuote.status)}
            </span>
          </div>

          {openQuote.customerMessage && (
            <div className="px-4 py-3 border-b border-gray-700 text-sm text-gray-300 whitespace-pre-wrap">{openQuote.customerMessage}</div>
          )}

          <div className="p-4 space-y-2">
            {items.map((li, i) => (
              <div key={i} className="flex items-start justify-between gap-3 text-sm">
                <div className="text-gray-300">
                  {li.description || 'Item'}
                  {li.quantity ? <span className="text-gray-500"> &times; {Number(li.quantity)}</span> : null}
                </div>
                <div className="text-gray-200 whitespace-nowrap">
                  {money(li.total ?? Number(li.quantity || 1) * Number(li.unitPrice || 0))}
                </div>
              </div>
            ))}
            <div className="pt-3 mt-2 border-t border-gray-700 space-y-1 text-sm">
              <div className="flex justify-between text-gray-400"><span>Subtotal</span><span>{money(openQuote.subtotal)}</span></div>
              {Number(openQuote.taxAmount || 0) > 0 && (
                <div className="flex justify-between text-gray-400"><span>Tax</span><span>{money(openQuote.taxAmount)}</span></div>
              )}
              <div className="flex justify-between text-white font-bold text-base pt-1"><span>Total</span><span>{money(openQuote.total)}</span></div>
            </div>
          </div>

          {openQuote.notes && (
            <div className="px-4 py-3 border-t border-gray-700">
              <p className="text-xs uppercase tracking-wide text-gray-500 mb-1">Notes</p>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">{openQuote.notes}</p>
            </div>
          )}

          {error && <div className="px-4 py-3 border-t border-gray-700 text-sm text-red-400">{error}</div>}

          {canSign && (
            <div className="p-4 border-t border-gray-700 bg-gray-800/60">
              <p className="text-sm text-gray-400 mb-3">Review the proposal, then sign to approve it.</p>
              <div className="flex gap-3">
                <button
                  onClick={() => setShowSignature(true)}
                  disabled={busy}
                  className="flex items-center gap-2 px-5 py-2.5 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  <PenTool className="w-4 h-4" /> Sign &amp; Approve
                </button>
                <button
                  onClick={handleDecline}
                  disabled={busy}
                  className="flex items-center gap-2 px-4 py-2.5 text-gray-300 border border-gray-600 text-sm rounded-lg hover:bg-gray-700 disabled:opacity-50"
                >
                  <XCircle className="w-4 h-4" /> Decline
                </button>
              </div>
            </div>
          )}

          {expired && ['sent', 'viewed'].includes(openQuote.status) && (
            <div className="p-4 border-t border-gray-700 text-sm text-orange-300">
              This proposal expired on {formatDate(openQuote.expiresAt!)}. Ask for an updated one.
            </div>
          )}

          {openQuote.status === 'approved' && (
            <div className="p-4 border-t border-gray-700 bg-green-900/20">
              <div className="flex items-start gap-3">
                <CheckCircle className="w-5 h-5 text-green-400 shrink-0 mt-0.5" />
                <div className="flex-1">
                  <p className="font-medium text-green-300">
                    Approved{openQuote.approvedAt ? ` on ${formatDate(openQuote.approvedAt)}` : ''}
                  </p>
                  <SignatureDisplay
                    className="mt-3"
                    signature={openQuote.signature}
                    signedBy={openQuote.signedBy}
                    signedAt={openQuote.signedAt}
                  />
                </div>
              </div>
            </div>
          )}

          {openQuote.status === 'declined' && (
            <div className="p-4 border-t border-gray-700 text-sm text-red-300">You declined this proposal.</div>
          )}
        </div>

        <SignatureModal
          isOpen={showSignature}
          onClose={() => setShowSignature(false)}
          onSave={handleSign}
          title="Sign & Approve Proposal"
          documentLabel={`${openQuote.quoteNumber || 'Proposal'} - ${money(openQuote.total)}`}
          signerName={[me?.firstName, me?.lastName].filter(Boolean).join(' ')}
        />
      </div>
    );
  }

  // ── list view ─────────────────────────────────────────────────────────────
  // An expired proposal is not waiting on the homeowner — it is waiting on the
  // roofer to reissue it, so it must not sit under "awaiting your signature".
  const isExpired = (q: PortalQuote) => !!q.expiresAt && new Date(q.expiresAt) < new Date();
  const isOpen = (q: PortalQuote) => ['sent', 'viewed'].includes(q.status) && !isExpired(q);
  const awaiting = quotes.filter(isOpen);
  const rest = quotes.filter((q) => !isOpen(q));

  const Card = ({ q }: { q: PortalQuote }) => (
    <button
      onClick={() => openDetail(q.id)}
      className="w-full text-left bg-gray-800 rounded-xl p-4 border border-gray-700 hover:border-gray-600 transition-colors"
    >
      <div className="flex items-start justify-between mb-2">
        <div>
          <p className="text-sm font-mono text-gray-400">{q.quoteNumber || 'Proposal'}</p>
          <p className="text-lg font-bold text-white mt-0.5">{money(q.total)}</p>
        </div>
        {(() => {
          const shown = ['sent', 'viewed'].includes(q.status) && isExpired(q) ? 'expired' : q.status;
          return (
            <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_COLORS[shown] || 'bg-gray-700 text-gray-400'}`}>
              {formatStatus(shown)}
            </span>
          );
        })()}
      </div>
      <div className="flex items-center justify-between text-xs text-gray-500">
        <span>{q.expiresAt ? `${isExpired(q) ? 'Expired' : 'Expires'} ${formatDate(q.expiresAt)}` : ''}</span>
        {q.signedBy && <span className="text-green-400">Signed by {q.signedBy}</span>}
      </div>
    </button>
  );

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Proposals</h1>
        <p className="text-gray-400 text-sm mt-0.5">Review and sign your roofing proposals</p>
      </div>

      {error && <div className="text-sm text-red-400">{error}</div>}

      {quotes.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
          <FileText className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No proposals yet</p>
        </div>
      ) : (
        <div className="space-y-5">
          {awaiting.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-orange-300">Awaiting your signature ({awaiting.length})</h2>
              {awaiting.map((q) => <Card key={q.id} q={q} />)}
            </div>
          )}
          {rest.length > 0 && (
            <div className="space-y-3">
              <h2 className="text-sm font-semibold text-gray-400">All proposals</h2>
              {rest.map((q) => <Card key={q.id} q={q} />)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
