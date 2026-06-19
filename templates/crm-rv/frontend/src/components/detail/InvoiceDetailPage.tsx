import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Send, DollarSign, Download } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { Modal, ConfirmModal } from '../ui/Modal';

export default function InvoiceDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [invoice, setInvoice] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '', notes: '' });
  const [recording, setRecording] = useState(false);

  useEffect(() => { loadInvoice(); }, [id]);

  const loadInvoice = async () => {
    setLoading(true);
    try {
      const data = await api.invoices.get(id);
      setInvoice(data);
      setPayment(p => ({ ...p, amount: data.balance }));
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.invoices.delete(id);
      toast.success('Invoice deleted');
      navigate('/invoices');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSend = async () => {
    try {
      await api.invoices.send(id);
      toast.success('Invoice sent');
      loadInvoice();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleRecordPayment = async () => {
    if (!payment.amount || Number(payment.amount) <= 0) {
      toast.error('Enter a valid amount');
      return;
    }
    setRecording(true);
    try {
      await api.invoices.recordPayment(id, { ...payment, amount: Number(payment.amount) });
      toast.success('Payment recorded');
      setPaymentOpen(false);
      loadInvoice();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setRecording(false);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error" description={error} onAction={loadInvoice} actionLabel="Retry" />;
  if (!invoice) return <EmptyState title="Invoice not found" />;

  const balanceColor = Number(invoice.balance) > 0 ? 'text-red-600' : 'text-green-600';

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/invoices')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-sm font-mono text-gray-500">{invoice.number}</p>
            <h1 className="text-2xl font-bold text-gray-900">Invoice</h1>
            <StatusBadge status={invoice.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {invoice.status === 'draft' && (
            <button onClick={handleSend} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2">
              <Send className="w-4 h-4" /> Send
            </button>
          )}
          {Number(invoice.balance) > 0 && invoice.status !== 'draft' && (
            <button onClick={() => setPaymentOpen(true)} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
              <DollarSign className="w-4 h-4" /> Record Payment
            </button>
          )}
          <Link to={`/invoices?edit=${id}`} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
            <Edit className="w-4 h-4" /> Edit
          </Link>
          <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white rounded-lg shadow-sm overflow-hidden">
            <div className="p-4 border-b"><h2 className="font-semibold">Line Items</h2></div>
            <table className="w-full">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500">Description</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Qty</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Price</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-500">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoice.lineItems?.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">{item.description}</td>
                    <td className="px-4 py-3 text-right">{Number(item.quantity)}</td>
                    <td className="px-4 py-3 text-right">${Number(item.unitPrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium">${Number(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Subtotal</td><td className="px-4 py-2 text-right">${Number(invoice.subtotal).toFixed(2)}</td></tr>
                {Number(invoice.taxAmount) > 0 && <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Tax</td><td className="px-4 py-2 text-right">${Number(invoice.taxAmount).toFixed(2)}</td></tr>}
                <tr className="font-bold"><td colSpan="3" className="px-4 py-2 text-right">Total</td><td className="px-4 py-2 text-right">${Number(invoice.total).toFixed(2)}</td></tr>
                <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Paid</td><td className="px-4 py-2 text-right text-green-600">-${Number(invoice.amountPaid).toFixed(2)}</td></tr>
                <tr className="font-bold text-lg"><td colSpan="3" className="px-4 py-3 text-right">Balance Due</td><td className={`px-4 py-3 text-right ${balanceColor}`}>${Number(invoice.balance).toFixed(2)}</td></tr>
              </tfoot>
            </table>
          </div>

          {invoice.payments?.length > 0 && (
            <div className="bg-white rounded-lg shadow-sm overflow-hidden">
              <div className="p-4 border-b"><h2 className="font-semibold">Payments</h2></div>
              <table className="w-full">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-4 py-2 text-left text-xs">Date</th>
                    <th className="px-4 py-2 text-left text-xs">Method</th>
                    <th className="px-4 py-2 text-left text-xs">Reference</th>
                    <th className="px-4 py-2 text-right text-xs">Amount</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {invoice.payments.map((p, i) => (
                    <tr key={i}>
                      <td className="px-4 py-2">{new Date(p.paidAt).toLocaleDateString()}</td>
                      <td className="px-4 py-2 capitalize">{p.method}</td>
                      <td className="px-4 py-2">{p.reference || '-'}</td>
                      <td className="px-4 py-2 text-right font-medium text-green-600">${Number(p.amount).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Details</h2>
            <div className="space-y-3 text-sm">
              {invoice.contact && (
                <div>
                  <p className="text-gray-500">Client</p>
                  <Link to={`/contacts/${invoice.contact.id}`} className="text-orange-500 hover:underline">{invoice.contact.name}</Link>
                </div>
              )}
              {invoice.dueDate && (
                <div>
                  <p className="text-gray-500">Due Date</p>
                  <p className={new Date(invoice.dueDate) < new Date() && Number(invoice.balance) > 0 ? 'text-red-600 font-medium' : ''}>{new Date(invoice.dueDate).toLocaleDateString()}</p>
                </div>
              )}
              <div>
                <p className="text-gray-500">Created</p>
                <p>{new Date(invoice.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          <div className={`rounded-lg p-6 text-center ${Number(invoice.balance) > 0 ? 'bg-red-50' : 'bg-green-50'}`}>
            <p className={`text-3xl font-bold ${balanceColor}`}>${Number(invoice.balance).toLocaleString()}</p>
            <p className="text-gray-600">{Number(invoice.balance) > 0 ? 'Balance Due' : 'Paid in Full'}</p>
          </div>
        </div>
      </div>

      {/* Payment Modal */}
      <Modal isOpen={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Amount *</label>
            <input type="number" step="0.01" value={payment.amount} onChange={(e) => setPayment({...payment, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Method</label>
            <select value={payment.method} onChange={(e) => setPayment({...payment, method: e.target.value})} className="w-full px-3 py-2 border rounded-lg">
              <option value="card">Card</option>
              <option value="cash">Cash</option>
              <option value="check">Check</option>
              <option value="bank_transfer">Bank Transfer</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Reference</label>
            <input value={payment.reference} onChange={(e) => setPayment({...payment, reference: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Check #, transaction ID..." />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Notes</label>
            <textarea value={payment.notes} onChange={(e) => setPayment({...payment, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" />
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6">
          <button onClick={() => setPaymentOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button>
          <button onClick={handleRecordPayment} disabled={recording} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 disabled:opacity-50">
            {recording ? 'Recording...' : 'Record Payment'}
          </button>
        </div>
      </Modal>

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Invoice" message={`Delete invoice ${invoice.number}?`} confirmText="Delete" />
    </div>
  );
}
