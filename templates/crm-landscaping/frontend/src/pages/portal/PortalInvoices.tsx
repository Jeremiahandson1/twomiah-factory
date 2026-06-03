import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Receipt, Loader2, ChevronRight, CreditCard, ChevronLeft, X } from 'lucide-react';
import portalApi from './portalApi';

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft',
  sent: 'Unpaid',
  partial: 'Partial',
  overdue: 'Overdue',
  paid: 'Paid',
  void: 'Void',
};

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-600',
  sent: 'bg-yellow-100 text-yellow-700',
  partial: 'bg-orange-100 text-orange-700',
  overdue: 'bg-red-100 text-red-700',
  paid: 'bg-green-100 text-green-700',
  void: 'bg-gray-100 text-gray-500',
};

export default function PortalInvoices() {
  const navigate = useNavigate();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'unpaid' | 'all'>('unpaid');
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [payLoading, setPayLoading] = useState(false);

  useEffect(() => {
    portalApi.get('/api/portal/invoices').then(setInvoices).catch(() => {}).finally(() => setLoading(false));
  }, []);

  const unpaid = invoices.filter(i => ['sent', 'partial', 'overdue'].includes(i.status));
  const displayedInvoices = tab === 'unpaid' ? unpaid : invoices;

  const openDetail = async (invoiceId: string) => {
    setDetailLoading(true);
    try {
      const detail = await portalApi.get(`/api/portal/invoices/${invoiceId}`);
      setSelectedInvoice(detail);
    } catch {} finally {
      setDetailLoading(false);
    }
  };

  const handlePay = async (invoiceId: string) => {
    setPayLoading(true);
    try {
      const result = await portalApi.post(`/api/portal/invoices/${invoiceId}/pay`);
      if (result.url) {
        window.location.href = result.url;
      } else if (result.clientSecret) {
        // Stripe Elements would handle this — for now show a message
        alert('Payment initiated. You will receive a confirmation email.');
      }
    } catch (err: any) {
      alert(err.message || 'Payment failed');
    } finally {
      setPayLoading(false);
    }
  };

  if (loading) {
    return <div className="flex items-center justify-center py-20"><Loader2 className="w-8 h-8 animate-spin text-blue-500" /></div>;
  }

  // Invoice Detail View
  if (selectedInvoice) {
    const inv = selectedInvoice;
    const balance = Number(inv.total) - Number(inv.amountPaid);
    const isUnpaid = ['sent', 'partial', 'overdue'].includes(inv.status);

    return (
      <div className="px-4 py-6 max-w-lg mx-auto space-y-5">
        <div className="flex items-center gap-3">
          <button onClick={() => setSelectedInvoice(null)} className="p-2 -ml-2 rounded-lg hover:bg-gray-100">
            <ChevronLeft className="w-6 h-6 text-gray-600" />
          </button>
          <div className="flex-1">
            <h1 className="text-xl font-bold text-gray-900">Invoice {inv.number}</h1>
            <p className="text-sm text-gray-500">{new Date(inv.issueDate).toLocaleDateString()}</p>
          </div>
          <span className={`px-2.5 py-1 rounded-lg text-xs font-bold ${STATUS_COLORS[inv.status] || ''}`}>
            {STATUS_LABELS[inv.status] || inv.status}
          </span>
        </div>

        {/* Line Items */}
        <div className="bg-white rounded-xl shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h3 className="font-semibold text-gray-900">Items</h3>
          </div>
          <div className="divide-y">
            {(inv.lineItems || []).map((item: any, i: number) => (
              <div key={i} className="p-4 flex justify-between">
                <div className="flex-1">
                  <p className="text-gray-900">{item.description}</p>
                  <p className="text-sm text-gray-500">
                    {Number(item.quantity)} x ${Number(item.unitPrice).toFixed(2)}
                  </p>
                </div>
                <p className="font-medium text-gray-900">${Number(item.total).toFixed(2)}</p>
              </div>
            ))}
          </div>
          <div className="p-4 border-t bg-gray-50 space-y-1.5">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Subtotal</span>
              <span className="text-gray-900">${Number(inv.subtotal).toFixed(2)}</span>
            </div>
            {Number(inv.taxAmount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Tax</span>
                <span className="text-gray-900">${Number(inv.taxAmount).toFixed(2)}</span>
              </div>
            )}
            {Number(inv.discount) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Discount</span>
                <span className="text-green-600">-${Number(inv.discount).toFixed(2)}</span>
              </div>
            )}
            <div className="flex justify-between font-semibold text-lg pt-2 border-t">
              <span>Total</span>
              <span>${Number(inv.total).toFixed(2)}</span>
            </div>
            {Number(inv.amountPaid) > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">Paid</span>
                <span className="text-green-600">${Number(inv.amountPaid).toFixed(2)}</span>
              </div>
            )}
            {isUnpaid && balance > 0 && (
              <div className="flex justify-between font-semibold text-orange-700">
                <span>Balance Due</span>
                <span>${balance.toFixed(2)}</span>
              </div>
            )}
          </div>
        </div>

        {inv.dueDate && (
          <div className="bg-white rounded-xl p-4 shadow-sm">
            <div className="flex justify-between text-sm">
              <span className="text-gray-500">Due Date</span>
              <span className="text-gray-900">{new Date(inv.dueDate).toLocaleDateString()}</span>
            </div>
          </div>
        )}

        {isUnpaid && balance > 0 && (
          <button
            onClick={() => handlePay(inv.id)}
            disabled={payLoading}
            className="w-full flex items-center justify-center gap-2 py-4 bg-green-600 text-white rounded-xl font-bold text-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
          >
            {payLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <CreditCard className="w-5 h-5" />}
            Pay ${balance.toFixed(2)}
          </button>
        )}
      </div>
    );
  }

  // Invoice List
  return (
    <div className="px-4 py-6 max-w-lg mx-auto">
      <h1 className="text-xl font-bold text-gray-900 mb-4">Invoices</h1>

      {/* Tabs */}
      <div className="flex bg-gray-100 rounded-lg p-1 mb-4">
        <button
          onClick={() => setTab('unpaid')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'unpaid' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          Unpaid ({unpaid.length})
        </button>
        <button
          onClick={() => setTab('all')}
          className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${tab === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}
        >
          All ({invoices.length})
        </button>
      </div>

      {displayedInvoices.length === 0 ? (
        <div className="text-center py-12">
          <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">{tab === 'unpaid' ? 'No unpaid invoices' : 'No invoices yet'}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {displayedInvoices.map(inv => {
            const balance = Number(inv.total) - Number(inv.amountPaid);
            const isUnpaid = ['sent', 'partial', 'overdue'].includes(inv.status);

            return (
              <div
                key={inv.id}
                className="bg-white rounded-xl shadow-sm overflow-hidden"
              >
                <button
                  onClick={() => openDetail(inv.id)}
                  className="w-full p-4 flex items-center gap-3 text-left hover:bg-gray-50"
                  disabled={detailLoading}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-gray-900">{inv.number}</p>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${STATUS_COLORS[inv.status] || ''}`}>
                        {STATUS_LABELS[inv.status] || inv.status}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500 mt-0.5">
                      {new Date(inv.issueDate).toLocaleDateString()}
                      {inv.dueDate && ` — Due ${new Date(inv.dueDate).toLocaleDateString()}`}
                    </p>
                  </div>
                  <p className="font-semibold text-gray-900">${Number(inv.total).toFixed(2)}</p>
                  <ChevronRight className="w-5 h-5 text-gray-300 flex-shrink-0" />
                </button>
                {isUnpaid && balance > 0 && (
                  <div className="px-4 pb-3">
                    <button
                      onClick={() => handlePay(inv.id)}
                      disabled={payLoading}
                      className="w-full flex items-center justify-center gap-2 py-2.5 bg-green-600 text-white rounded-lg font-medium text-sm hover:bg-green-700 disabled:opacity-50 transition-colors"
                    >
                      <CreditCard className="w-4 h-4" />
                      Pay ${balance.toFixed(2)}
                    </button>
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
