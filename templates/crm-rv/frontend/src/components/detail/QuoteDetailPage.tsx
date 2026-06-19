import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Send, Check, X, FileText, Download, Copy } from 'lucide-react';
import api from '../../services/api';
import { useToast } from '../../contexts/ToastContext';
import { SkeletonDetail } from '../common/Skeleton';
import { EmptyState } from '../common/EmptyState';
import { StatusBadge } from '../ui/DataTable';
import { ConfirmModal } from '../ui/Modal';

export default function QuoteDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const [quote, setQuote] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  useEffect(() => { loadQuote(); }, [id]);

  const loadQuote = async () => {
    setLoading(true);
    try {
      const data = await api.quotes.get(id);
      setQuote(data);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    try {
      await api.quotes.delete(id);
      toast.success('Quote deleted');
      navigate('/quotes');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSend = async () => {
    try {
      await api.quotes.send(id);
      toast.success('Quote sent');
      loadQuote();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleApprove = async () => {
    try {
      await api.quotes.approve(id);
      toast.success('Quote approved');
      loadQuote();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleConvertToInvoice = async () => {
    try {
      const invoice = await api.quotes.convertToInvoice(id);
      toast.success('Invoice created');
      navigate(`/invoices/${invoice.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <SkeletonDetail />;
  if (error) return <EmptyState iconType="error" title="Error" description={error} onAction={loadQuote} actionLabel="Retry" />;
  if (!quote) return <EmptyState title="Quote not found" />;

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/quotes')} className="p-2 hover:bg-gray-100 rounded-lg">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div>
            <p className="text-sm font-mono text-gray-500">{quote.number}</p>
            <h1 className="text-2xl font-bold text-gray-900">{quote.name}</h1>
            <StatusBadge status={quote.status} />
          </div>
        </div>
        <div className="flex items-center gap-2">
          {quote.status === 'draft' && (
            <button onClick={handleSend} className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 flex items-center gap-2">
              <Send className="w-4 h-4" /> Send
            </button>
          )}
          {quote.status === 'sent' && (
            <button onClick={handleApprove} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
              <Check className="w-4 h-4" /> Approve
            </button>
          )}
          {quote.status === 'approved' && (
            <button onClick={handleConvertToInvoice} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2">
              <Copy className="w-4 h-4" /> Create Invoice
            </button>
          )}
          <Link to={`/quotes?edit=${id}`} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
            <Edit className="w-4 h-4" /> Edit
          </Link>
          <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Line Items */}
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
                {quote.lineItems?.map((item, i) => (
                  <tr key={i}>
                    <td className="px-4 py-3">{item.description}</td>
                    <td className="px-4 py-3 text-right">{Number(item.quantity)}</td>
                    <td className="px-4 py-3 text-right">${Number(item.unitPrice).toFixed(2)}</td>
                    <td className="px-4 py-3 text-right font-medium">${Number(item.total).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50">
                <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Subtotal</td><td className="px-4 py-2 text-right">${Number(quote.subtotal).toFixed(2)}</td></tr>
                {Number(quote.taxAmount) > 0 && <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Tax ({quote.taxRate}%)</td><td className="px-4 py-2 text-right">${Number(quote.taxAmount).toFixed(2)}</td></tr>}
                {Number(quote.discount) > 0 && <tr><td colSpan="3" className="px-4 py-2 text-right text-sm">Discount</td><td className="px-4 py-2 text-right text-red-600">-${Number(quote.discount).toFixed(2)}</td></tr>}
                <tr className="font-bold"><td colSpan="3" className="px-4 py-3 text-right">Total</td><td className="px-4 py-3 text-right text-lg">${Number(quote.total).toFixed(2)}</td></tr>
              </tfoot>
            </table>
          </div>

          {quote.notes && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold mb-2">Notes</h2>
              <p className="text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          {quote.terms && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold mb-2">Terms & Conditions</h2>
              <p className="text-gray-700 whitespace-pre-wrap text-sm">{quote.terms}</p>
            </div>
          )}
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Details</h2>
            <div className="space-y-3 text-sm">
              {quote.contact && (
                <div>
                  <p className="text-gray-500">Client</p>
                  <Link to={`/contacts/${quote.contact.id}`} className="text-orange-500 hover:underline">{quote.contact.name}</Link>
                </div>
              )}
              {quote.project && (
                <div>
                  <p className="text-gray-500">Project</p>
                  <Link to={`/projects/${quote.project.id}`} className="text-orange-500 hover:underline">{quote.project.name}</Link>
                </div>
              )}
              {quote.expiryDate && (
                <div>
                  <p className="text-gray-500">Valid Until</p>
                  <p className={new Date(quote.expiryDate) < new Date() ? 'text-red-600' : ''}>{new Date(quote.expiryDate).toLocaleDateString()}</p>
                </div>
              )}
              <div>
                <p className="text-gray-500">Created</p>
                <p>{new Date(quote.createdAt).toLocaleDateString()}</p>
              </div>
            </div>
          </div>

          <div className="bg-orange-50 rounded-lg p-6 text-center">
            <p className="text-3xl font-bold text-orange-600">${Number(quote.total).toLocaleString()}</p>
            <p className="text-gray-600">Quote Total</p>
          </div>
        </div>
      </div>

      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Quote" message={`Delete quote ${quote.number}?`} confirmText="Delete" />
    </div>
  );
}
