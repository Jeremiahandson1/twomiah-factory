import { useState, useEffect } from 'react';
import { Receipt, CreditCard, Loader2, ExternalLink } from 'lucide-react';
import { portalHeaders } from './PortalLayout';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-700 text-gray-300',
  sent: 'bg-blue-800 text-blue-200',
  viewed: 'bg-purple-800 text-purple-200',
  partial: 'bg-yellow-800 text-yellow-200',
  paid: 'bg-green-800 text-green-200',
  overdue: 'bg-red-800 text-red-200',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function PortalInvoices() {
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [paying, setPaying] = useState<string | null>(null);

  useEffect(() => {
    loadInvoices();
  }, []);

  const loadInvoices = async () => {
    try {
      const res = await fetch('/api/portal/invoices', { headers: portalHeaders() });
      const data = await res.json();
      setInvoices(Array.isArray(data) ? data : data.data || []);
    } catch (err) {
      console.error('Failed to load invoices:', err);
    } finally {
      setLoading(false);
    }
  };

  const handlePayNow = async (invoiceId: string) => {
    setPaying(invoiceId);
    try {
      const res = await fetch(`/api/portal/invoices/${invoiceId}/pay`, {
        method: 'POST',
        headers: { ...portalHeaders(), 'Content-Type': 'application/json' },
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      if (data.paymentUrl) {
        window.location.href = data.paymentUrl;
      } else {
        loadInvoices();
      }
    } catch {
      console.error('Payment failed');
    } finally {
      setPaying(null);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-white">Invoices</h1>
        <p className="text-gray-400 text-sm mt-0.5">View and pay your invoices</p>
      </div>

      {invoices.length === 0 ? (
        <div className="bg-gray-800 rounded-xl p-8 border border-gray-700 text-center">
          <Receipt className="w-10 h-10 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400">No invoices yet</p>
        </div>
      ) : (
        <div className="space-y-3">
          {invoices.map((inv) => {
            const balance = Number(inv.total || 0) - Number(inv.amountPaid || 0);
            const isUnpaid = balance > 0 && inv.status !== 'draft';
            return (
              <div key={inv.id} className="bg-gray-800 rounded-xl p-4 border border-gray-700">
                <div className="flex items-start justify-between mb-3">
                  <div>
                    <p className="text-sm font-mono text-gray-400">
                      {inv.invoiceNumber || `INV-${String(inv.id).padStart(4, '0')}`}
                    </p>
                    <p className="text-lg font-bold text-white mt-0.5">
                      ${Number(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                    </p>
                  </div>
                  <span className={`text-[10px] font-medium px-2 py-0.5 rounded ${STATUS_COLORS[inv.status] || 'bg-gray-700 text-gray-400'}`}>
                    {formatStatus(inv.status)}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs text-gray-500 mb-3">
                  <span>Due: {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}</span>
                  {inv.amountPaid > 0 && (
                    <span>Paid: ${Number(inv.amountPaid).toLocaleString(undefined, { minimumFractionDigits: 2 })}</span>
                  )}
                </div>

                {isUnpaid && (
                  <div className="flex items-center justify-between bg-gray-700/50 rounded-lg p-3">
                    <div>
                      <p className="text-xs text-gray-400">Balance Due</p>
                      <p className="text-lg font-bold text-white">
                        ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </p>
                    </div>
                    <button
                      onClick={() => handlePayNow(inv.id)}
                      disabled={paying === inv.id}
                      className="flex items-center gap-1.5 px-4 py-2.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50"
                    >
                      {paying === inv.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <CreditCard className="w-4 h-4" />
                      )}
                      Pay Now
                    </button>
                  </div>
                )}

                {inv.status === 'paid' && (
                  <div className="bg-green-900/20 border border-green-800/30 rounded-lg p-3 text-center">
                    <p className="text-sm text-green-400 font-medium">Paid in full</p>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
