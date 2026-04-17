import { useState, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, Edit, Trash2, Send, Check, X, FileText, Download, Copy, Briefcase, Wrench, MapPinned } from 'lucide-react';
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
      navigate('/crm/quotes');
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

  const handleDecline = async () => {
    try {
      await api.quotes.decline(id);
      toast.success('Quote declined');
      loadQuote();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleConvertToJob = async () => {
    try {
      const newJob = await api.quotes.convertToJob(id);
      toast.success('Job created from quote');
      navigate(`/crm/jobs/${newJob.id}`);
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleConvertToInvoice = async () => {
    try {
      const invoice = await api.quotes.convertToInvoice(id);
      toast.success('Invoice created');
      navigate(`/crm/invoices/${invoice.id}`);
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
          <button onClick={() => navigate('/crm/quotes')} className="p-2 hover:bg-gray-100 rounded-lg">
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
          {(quote.status === 'sent' || quote.status === 'draft') && (
            <>
              <button onClick={handleApprove} className="px-4 py-2 bg-green-500 text-white rounded-lg hover:bg-green-600 flex items-center gap-2">
                <Check className="w-4 h-4" /> Mark Approved
              </button>
              <button onClick={handleDecline} className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 flex items-center gap-2">
                <X className="w-4 h-4" /> Mark Declined
              </button>
            </>
          )}
          {quote.status === 'approved' && !quote.convertedToJobId && (
            <button onClick={handleConvertToJob} className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 flex items-center gap-2">
              <Briefcase className="w-4 h-4" /> Convert to Job
            </button>
          )}
          {quote.status === 'approved' && (
            <button onClick={handleConvertToInvoice} className="px-4 py-2 bg-orange-500 text-white rounded-lg hover:bg-orange-600 flex items-center gap-2">
              <Copy className="w-4 h-4" /> Create Invoice
            </button>
          )}
          <a href={api.quotes.downloadPdf(id)} target="_blank" rel="noopener noreferrer" className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
            <Download className="w-4 h-4" /> PDF
          </a>
          {['draft', 'sent'].includes(quote.status) && (
            <Link to={`/crm/quotes?edit=${id}`} className="px-4 py-2 bg-gray-100 rounded-lg hover:bg-gray-200 flex items-center gap-2">
              <Edit className="w-4 h-4" /> Edit
            </Link>
          )}
          {quote.status === 'draft' && (
            <button onClick={() => setDeleteOpen(true)} className="px-4 py-2 bg-red-50 text-red-600 rounded-lg hover:bg-red-100">
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      </div>

      {quote.convertedToJobId && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-center justify-between">
          <p className="text-green-800">This quote has been converted to a job.</p>
          <Link to={`/crm/jobs/${quote.convertedToJobId}`} className="text-green-700 font-medium hover:underline flex items-center gap-1">
            <Briefcase className="w-4 h-4" /> View Job
          </Link>
        </div>
      )}

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

          {quote.customerMessage && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold mb-2">Customer Message</h2>
              <p className="text-gray-700 whitespace-pre-wrap">{quote.customerMessage}</p>
            </div>
          )}

          {quote.notes && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold mb-2">Internal Notes</h2>
              <p className="text-gray-700 whitespace-pre-wrap">{quote.notes}</p>
            </div>
          )}

          {quote.terms && (
            <div className="bg-white rounded-lg shadow-sm p-6">
              <h2 className="font-semibold mb-2">Terms & Conditions</h2>
              <p className="text-gray-700 whitespace-pre-wrap text-sm">{quote.terms}</p>
            </div>
          )}

          {/* Status Timeline */}
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Timeline</h2>
            <div className="space-y-3">
              <div className="flex items-center gap-3 text-sm">
                <div className="w-2 h-2 rounded-full bg-gray-400" />
                <span className="text-gray-500">Created</span>
                <span className="text-gray-900">{new Date(quote.createdAt).toLocaleDateString()}</span>
              </div>
              {quote.sentAt && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-blue-500" />
                  <span className="text-gray-500">Sent</span>
                  <span className="text-gray-900">{new Date(quote.sentAt).toLocaleDateString()}</span>
                </div>
              )}
              {quote.viewedAt && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-purple-500" />
                  <span className="text-gray-500">Viewed</span>
                  <span className="text-gray-900">{new Date(quote.viewedAt).toLocaleDateString()}</span>
                </div>
              )}
              {quote.approvedAt && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-green-500" />
                  <span className="text-gray-500">Approved</span>
                  <span className="text-gray-900">{new Date(quote.approvedAt).toLocaleDateString()}</span>
                </div>
              )}
              {quote.declinedAt && (
                <div className="flex items-center gap-3 text-sm">
                  <div className="w-2 h-2 rounded-full bg-red-500" />
                  <span className="text-gray-500">Declined</span>
                  <span className="text-gray-900">{new Date(quote.declinedAt).toLocaleDateString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-sm p-6">
            <h2 className="font-semibold mb-4">Details</h2>
            <div className="space-y-3 text-sm">
              {quote.contact && (
                <div>
                  <p className="text-gray-500">Client</p>
                  <Link to={`/crm/contacts/${quote.contact.id}`} className="text-orange-500 hover:underline">{quote.contact.name}</Link>
                </div>
              )}
              {quote.project && (
                <div>
                  <p className="text-gray-500">Project</p>
                  <Link to={`/crm/projects/${quote.project.id}`} className="text-orange-500 hover:underline">{quote.project.name}</Link>
                </div>
              )}
              {quote.equipment && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1"><Wrench className="w-3 h-3" /> Equipment</p>
                  <p className="text-gray-900">{quote.equipment.name}{quote.equipment.manufacturer ? ` — ${quote.equipment.manufacturer}` : ''}{quote.equipment.model ? ` ${quote.equipment.model}` : ''}</p>
                </div>
              )}
              {quote.site && (
                <div>
                  <p className="text-gray-500 flex items-center gap-1"><MapPinned className="w-3 h-3" /> Location</p>
                  <p className="text-gray-900">{quote.site.name}{quote.site.address ? ` — ${quote.site.address}` : ''}</p>
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
