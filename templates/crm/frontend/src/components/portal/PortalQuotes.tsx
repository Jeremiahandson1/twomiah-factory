import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { FileText, CheckCircle, XCircle, Clock, Eye, Download, Loader2, PenTool } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';
import { SignatureModal, SignatureDisplay } from '../common/SignaturePad';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-yellow-100 text-yellow-700',
  approved: 'bg-green-100 text-green-700',
  rejected: 'bg-red-100 text-red-700',
  expired: 'bg-gray-100 text-gray-500',
};

export default function PortalQuotes() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [quotes, setQuotes] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadQuotes() {
      try {
        const data = await portalFetch('/quotes');
        setQuotes(data);
      } catch (error) {
        console.error('Failed to load quotes:', error);
      } finally {
        setLoading(false);
      }
    }
    loadQuotes();
  }, [portalFetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const pendingQuotes = quotes.filter(q => ['sent', 'viewed'].includes(q.status));
  const otherQuotes = quotes.filter(q => !['sent', 'viewed'].includes(q.status));

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
        <p className="text-gray-600">Review and approve quotes from your contractor.</p>
      </div>

      {quotes.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <FileText className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No quotes yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Pending quotes */}
          {pendingQuotes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Awaiting Your Response ({pendingQuotes.length})
              </h2>
              <div className="space-y-3">
                {pendingQuotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} token={token} highlight />
                ))}
              </div>
            </div>
          )}

          {/* Other quotes */}
          {otherQuotes.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3">All Quotes</h2>
              <div className="space-y-3">
                {otherQuotes.map((quote) => (
                  <QuoteCard key={quote.id} quote={quote} token={token} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuoteCard({ quote, token, highlight }) {
  return (
    <Link
      to={`/portal/${token}/quotes/${quote.id}`}
      className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all ${
        highlight ? 'border-orange-300 ring-2 ring-orange-100' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-blue-100 rounded-lg">
            <FileText className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="font-medium text-gray-900">{quote.name || quote.number}</p>
            <p className="text-sm text-gray-500">{quote.number}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="text-lg font-bold text-gray-900">
            ${Number(quote.total).toLocaleString()}
          </p>
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_STYLES[quote.status]}`}>
            {quote.status}
          </span>
        </div>
      </div>
      {quote.validUntil && (
        <p className="mt-2 text-sm text-gray-500">
          Valid until {new Date(quote.validUntil).toLocaleDateString()}
        </p>
      )}
    </Link>
  );
}

// Quote detail page
export function PortalQuoteDetail() {
  const { token, quoteId } = useParams();
  const { fetch: portalFetch, contact } = usePortal();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showSignatureModal, setShowSignatureModal] = useState(false);

  useEffect(() => {
    async function loadQuote() {
      try {
        const data = await portalFetch(`/quotes/${quoteId}`);
        setQuote(data);
      } catch (error) {
        console.error('Failed to load quote:', error);
      } finally {
        setLoading(false);
      }
    }
    loadQuote();
  }, [portalFetch, quoteId]);

  const handleApprove = async (signatureData) => {
    setActionLoading(true);
    setShowSignatureModal(false);
    try {
      await portalFetch(`/quotes/${quoteId}/approve`, {
        method: 'POST',
        body: JSON.stringify({
          signature: signatureData.signature,
          signedBy: signatureData.signedBy,
        }),
      });
      setQuote({ 
        ...quote, 
        status: 'approved',
        signature: signatureData.signature,
        signedBy: signatureData.signedBy,
        approvedAt: signatureData.signedAt,
      });
    } catch (error) {
      alert('Failed to approve quote: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  const handleReject = async () => {
    const reason = prompt('Please provide a reason for rejection (optional):');
    
    setActionLoading(true);
    try {
      await portalFetch(`/quotes/${quoteId}/reject`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
      setQuote({ ...quote, status: 'rejected' });
    } catch (error) {
      alert('Failed to reject quote: ' + error.message);
    } finally {
      setActionLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!quote) {
    return <div className="text-center py-12 text-gray-500">Quote not found.</div>;
  }

  const canRespond = ['sent', 'viewed'].includes(quote.status);

  return (
    <div>
      <Link to={`/portal/${token}/quotes`} className="text-orange-600 hover:underline text-sm mb-4 inline-block">
        ← Back to Quotes
      </Link>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{quote.name || quote.number}</h1>
              <p className="text-gray-500">{quote.number}</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[quote.status]}`}>
              {quote.status}
            </span>
          </div>
        </div>

        {/* Line items */}
        <div className="p-6 border-b">
          <table className="w-full">
            <thead>
              <tr className="text-left text-sm text-gray-500 border-b">
                <th className="pb-2">Description</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Price</th>
                <th className="pb-2 text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {quote.lineItems?.map((item, i) => (
                <tr key={i} className="border-b last:border-0">
                  <td className="py-3">{item.description}</td>
                  <td className="py-3 text-right">{item.quantity}</td>
                  <td className="py-3 text-right">${Number(item.unitPrice).toLocaleString()}</td>
                  <td className="py-3 text-right font-medium">${Number(item.total).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Totals */}
        <div className="p-6 bg-gray-50">
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span>${Number(quote.subtotal).toLocaleString()}</span>
            </div>
            {quote.taxAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Tax ({quote.taxRate}%)</span>
                <span>${Number(quote.taxAmount).toLocaleString()}</span>
              </div>
            )}
            {quote.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Discount</span>
                <span>-${Number(quote.discount).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Total</span>
              <span>${Number(quote.total).toLocaleString()}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        {canRespond && (
          <div className="p-6 bg-orange-50 border-t">
            <p className="text-sm text-gray-600 mb-4">
              Please review this quote and provide your signature to approve.
            </p>
            <div className="flex gap-3">
              <button
                onClick={() => setShowSignatureModal(true)}
                disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
              >
                <PenTool className="w-4 h-4" />
                Sign & Approve
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading}
                className="flex items-center gap-2 px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Decline
              </button>
            </div>
          </div>
        )}

        {/* Approved with signature */}
        {quote.status === 'approved' && (
          <div className="p-6 bg-green-50 border-t">
            <div className="flex items-start gap-4">
              <CheckCircle className="w-6 h-6 text-green-600 flex-shrink-0 mt-1" />
              <div className="flex-1">
                <p className="font-medium text-green-800">
                  Quote approved on {new Date(quote.approvedAt).toLocaleDateString()}
                </p>
                {quote.signature && (
                  <div className="mt-3">
                    <SignatureDisplay 
                      signature={quote.signature}
                      signedBy={quote.signedBy || quote.approvedBy}
                      signedAt={quote.approvedAt}
                    />
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Signature Modal */}
      <SignatureModal
        isOpen={showSignatureModal}
        onClose={() => setShowSignatureModal(false)}
        onSave={handleApprove}
        title="Approve Quote"
        signerName={contact?.name || ''}
      />
    </div>
  );
}
