import { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { Receipt, Download, AlertCircle, CheckCircle, Clock, Loader2, CreditCard } from 'lucide-react';
import { usePortal } from '../../contexts/PortalContext';
import { PaymentModal } from '../payments/PaymentForm';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const STATUS_STYLES = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  partial: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
};

export default function PortalInvoices() {
  const { token } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadInvoices() {
      try {
        const data = await portalFetch('/invoices');
        setInvoices(data);
      } catch (error) {
        console.error('Failed to load invoices:', error);
      } finally {
        setLoading(false);
      }
    }
    loadInvoices();
  }, [portalFetch]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  const unpaidInvoices = invoices.filter(i => ['sent', 'partial', 'overdue'].includes(i.status));
  const paidInvoices = invoices.filter(i => i.status === 'paid');

  const totalOutstanding = unpaidInvoices.reduce((sum, i) => sum + Number(i.balance), 0);

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-gray-600">View and download your invoices.</p>
      </div>

      {/* Outstanding balance banner */}
      {totalOutstanding > 0 && (
        <div className="bg-orange-50 border border-orange-200 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <AlertCircle className="w-6 h-6 text-orange-500" />
              <div>
                <p className="font-medium text-gray-900">Outstanding Balance</p>
                <p className="text-sm text-gray-600">{unpaidInvoices.length} unpaid invoice(s)</p>
              </div>
            </div>
            <p className="text-2xl font-bold text-orange-600">
              ${totalOutstanding.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {invoices.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-12 text-center">
          <Receipt className="w-12 h-12 text-gray-300 mx-auto mb-4" />
          <p className="text-gray-500">No invoices yet.</p>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Unpaid invoices */}
          {unpaidInvoices.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <Clock className="w-5 h-5 text-orange-500" />
                Unpaid ({unpaidInvoices.length})
              </h2>
              <div className="space-y-3">
                {unpaidInvoices.map((invoice) => (
                  <InvoiceCard key={invoice.id} invoice={invoice} token={token} />
                ))}
              </div>
            </div>
          )}

          {/* Paid invoices */}
          {paidInvoices.length > 0 && (
            <div>
              <h2 className="text-lg font-semibold text-gray-900 mb-3 flex items-center gap-2">
                <CheckCircle className="w-5 h-5 text-green-500" />
                Paid ({paidInvoices.length})
              </h2>
              <div className="space-y-3">
                {paidInvoices.map((invoice) => (
                  <InvoiceCard key={invoice.id} invoice={invoice} token={token} />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InvoiceCard({ invoice, token }) {
  const isOverdue = invoice.status === 'overdue' || 
    (invoice.status === 'sent' && invoice.dueDate && new Date(invoice.dueDate) < new Date());

  return (
    <Link
      to={`/portal/${token}/invoices/${invoice.id}`}
      className={`block bg-white rounded-xl border p-4 hover:shadow-md transition-all ${
        isOverdue ? 'border-red-200' : 'border-gray-200'
      }`}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg ${isOverdue ? 'bg-red-100' : 'bg-green-100'}`}>
            <Receipt className={`w-5 h-5 ${isOverdue ? 'text-red-600' : 'text-green-600'}`} />
          </div>
          <div>
            <p className="font-medium text-gray-900">{invoice.number}</p>
            <p className="text-sm text-gray-500">
              {invoice.dueDate ? `Due ${new Date(invoice.dueDate).toLocaleDateString()}` : 'No due date'}
            </p>
          </div>
        </div>
        <div className="text-right">
          {Number(invoice.balance) > 0 ? (
            <>
              <p className="text-lg font-bold text-gray-900">
                ${Number(invoice.balance).toLocaleString()}
              </p>
              <p className="text-xs text-gray-500">
                of ${Number(invoice.total).toLocaleString()}
              </p>
            </>
          ) : (
            <p className="text-lg font-bold text-green-600">Paid</p>
          )}
          <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium mt-1 ${STATUS_STYLES[invoice.status]}`}>
            {invoice.status}
          </span>
        </div>
      </div>
    </Link>
  );
}

// Invoice detail page
export function PortalInvoiceDetail() {
  const { token, invoiceId } = useParams();
  const { fetch: portalFetch } = usePortal();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showPayment, setShowPayment] = useState(false);

  useEffect(() => {
    async function loadInvoice() {
      try {
        const data = await portalFetch(`/invoices/${invoiceId}`);
        setInvoice(data);
      } catch (error) {
        console.error('Failed to load invoice:', error);
      } finally {
        setLoading(false);
      }
    }
    loadInvoice();
  }, [portalFetch, invoiceId]);

  const handleDownloadPDF = () => {
    window.open(`${API_URL}/portal/p/${token}/invoices/${invoiceId}/pdf`, '_blank');
  };

  const handlePaymentSuccess = () => {
    setShowPayment(false);
    // Reload invoice to get updated balance
    portalFetch(`/invoices/${invoiceId}`).then(setInvoice);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
      </div>
    );
  }

  if (!invoice) {
    return <div className="text-center py-12 text-gray-500">Invoice not found.</div>;
  }

  const isOverdue = invoice.status === 'overdue' || 
    (invoice.status === 'sent' && invoice.dueDate && new Date(invoice.dueDate) < new Date());
  const hasBalance = Number(invoice.balance) > 0;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <Link to={`/portal/${token}/invoices`} className="text-orange-600 hover:underline text-sm">
          ← Back to Invoices
        </Link>
        <button
          onClick={handleDownloadPDF}
          className="flex items-center gap-2 px-4 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4" />
          Download PDF
        </button>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        {/* Header */}
        <div className="p-6 border-b">
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Invoice {invoice.number}</h1>
              {invoice.project && (
                <p className="text-gray-500">Project: {invoice.project.name}</p>
              )}
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${STATUS_STYLES[invoice.status]}`}>
              {invoice.status}
            </span>
          </div>
          {invoice.dueDate && (
            <p className={`mt-2 ${isOverdue ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
              {isOverdue ? 'OVERDUE - ' : ''}Due {new Date(invoice.dueDate).toLocaleDateString()}
            </p>
          )}
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
              {invoice.lineItems?.map((item, i) => (
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
        <div className="p-6 bg-gray-50 border-b">
          <div className="max-w-xs ml-auto space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-gray-600">Subtotal</span>
              <span>${Number(invoice.subtotal).toLocaleString()}</span>
            </div>
            {invoice.taxAmount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Tax ({invoice.taxRate}%)</span>
                <span>${Number(invoice.taxAmount).toLocaleString()}</span>
              </div>
            )}
            {invoice.discount > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-600">Discount</span>
                <span>-${Number(invoice.discount).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between font-medium border-t pt-2">
              <span>Total</span>
              <span>${Number(invoice.total).toLocaleString()}</span>
            </div>
            {Number(invoice.amountPaid) > 0 && (
              <div className="flex justify-between text-sm text-green-600">
                <span>Paid</span>
                <span>-${Number(invoice.amountPaid).toLocaleString()}</span>
              </div>
            )}
            <div className="flex justify-between text-lg font-bold border-t pt-2">
              <span>Balance Due</span>
              <span className={Number(invoice.balance) > 0 ? 'text-orange-600' : 'text-green-600'}>
                ${Number(invoice.balance).toLocaleString()}
              </span>
            </div>
          </div>
        </div>

        {/* Pay Now Button */}
        {hasBalance && (
          <div className="p-6 bg-orange-50 border-t">
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">Ready to pay?</p>
                <p className="text-sm text-gray-600">Secure payment via credit card</p>
              </div>
              <button
                onClick={() => setShowPayment(true)}
                className="flex items-center gap-2 px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
              >
                <CreditCard className="w-5 h-5" />
                Pay ${Number(invoice.balance).toLocaleString()}
              </button>
            </div>
          </div>
        )}

        {/* Payment history */}
        {invoice.payments?.length > 0 && (
          <div className="p-6">
            <h3 className="font-semibold text-gray-900 mb-3">Payment History</h3>
            <div className="space-y-2">
              {invoice.payments.map((payment, i) => (
                <div key={i} className="flex justify-between text-sm py-2 border-b last:border-0">
                  <div>
                    <span className="text-gray-900">{new Date(payment.paidAt).toLocaleDateString()}</span>
                    <span className="text-gray-500 ml-2">via {payment.method}</span>
                  </div>
                  <span className="font-medium text-green-600">
                    ${Number(payment.amount).toLocaleString()}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact info */}
        <div className="p-6 bg-gray-100 border-t">
          <p className="text-sm text-gray-600">
            Questions about this invoice? Contact {invoice.company?.email || invoice.company?.phone}
          </p>
        </div>
      </div>

      {/* Payment Modal */}
      <PaymentModal
        isOpen={showPayment}
        onClose={() => setShowPayment(false)}
        invoiceId={invoice.id}
        amount={Number(invoice.balance)}
        onSuccess={handlePaymentSuccess}
        portalToken={token}
      />
    </div>
  );
}
