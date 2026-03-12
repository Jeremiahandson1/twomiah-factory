import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, Check, DollarSign, ChevronLeft, ChevronRight, X, Receipt } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  partial: 'bg-yellow-100 text-yellow-700',
  paid: 'bg-green-100 text-green-700',
  overdue: 'bg-red-100 text-red-700',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export default function InvoicesPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [invoices, setInvoices] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [tab, setTab] = useState<'unpaid' | 'all'>('unpaid');
  const [modalOpen, setModalOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<any>(null);
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contactId: '',
    jobId: '',
    dueDate: '',
    taxRate: 0,
    notes: '',
    lineItems: [{ description: '', quantity: 1, unitPrice: 0 }],
  });

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (tab === 'unpaid') params.set('unpaid', 'true');

      const [invRes, contRes, jobsRes] = await Promise.all([
        fetch(`/api/invoices?${params}`, { headers }),
        fetch('/api/contacts?limit=200', { headers }),
        fetch('/api/jobs?limit=200', { headers }),
      ]);
      const invData = await invRes.json();
      const contData = await contRes.json();
      const jobsData = await jobsRes.json();

      setInvoices(Array.isArray(invData) ? invData : invData.data || []);
      setTotal(invData.pagination?.total || invData.total || (Array.isArray(invData) ? invData.length : 0));
      setContacts(Array.isArray(contData) ? contData : contData.data || []);
      setJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
    } catch {
      toast.error('Failed to load invoices');
    } finally {
      setLoading(false);
    }
  }, [page, tab, token]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [tab]);

  const subtotal = form.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const tax = subtotal * (form.taxRate / 100);
  const grandTotal = subtotal + tax;

  const updateLine = (idx: number, field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((li, i) => (i === idx ? { ...li, [field]: value } : li)),
    }));
  };

  const handleCreate = async () => {
    if (!form.contactId) { toast.error('Select a contact'); return; }
    const validLines = form.lineItems.filter((li) => li.description.trim());
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/invoices', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lineItems: validLines }),
      });
      if (!res.ok) throw new Error();
      toast.success('Invoice created');
      setModalOpen(false);
      load();
    } catch {
      toast.error('Failed to create invoice');
    } finally {
      setSaving(false);
    }
  };

  const sendInvoice = async (id: string) => {
    try {
      const res = await fetch(`/api/invoices/${id}/send`, { method: 'POST', headers });
      if (!res.ok) throw new Error();
      toast.success('Invoice sent');
      load();
    } catch {
      toast.error('Failed to send invoice');
    }
  };

  const markPaid = async (id: string) => {
    try {
      const res = await fetch(`/api/invoices/${id}/mark-paid`, { method: 'POST', headers });
      if (!res.ok) throw new Error();
      toast.success('Marked as paid');
      load();
    } catch {
      toast.error('Failed to mark paid');
    }
  };

  const recordPayment = async () => {
    if (!paymentInvoice || !payment.amount) return;
    try {
      const res = await fetch(`/api/invoices/${paymentInvoice.id}/payments`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payment, amount: Number(payment.amount) }),
      });
      if (!res.ok) throw new Error();
      toast.success('Payment recorded');
      setPaymentOpen(false);
      load();
    } catch {
      toast.error('Failed to record payment');
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} invoices</p>
          </div>
          <button
            onClick={() => {
              setForm({ contactId: '', jobId: '', dueDate: '', taxRate: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
              setModalOpen(true);
            }}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Invoice
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b">
          {(['unpaid', 'all'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`px-4 py-2.5 text-sm font-medium border-b-2 capitalize ${
                tab === t ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-500 hover:text-gray-700'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Invoice #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Job</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Paid</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Balance</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Due Date</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : invoices.length === 0 ? (
                  <tr><td colSpan={9} className="text-center py-12 text-gray-400">No invoices found</td></tr>
                ) : (
                  invoices.map((inv) => {
                    const balance = Number(inv.total || 0) - Number(inv.amountPaid || 0);
                    return (
                      <tr key={inv.id} className="border-b last:border-0 hover:bg-gray-50">
                        <td
                          className="px-4 py-3 font-mono text-xs font-semibold text-blue-600 cursor-pointer hover:underline"
                          onClick={() => navigate(`/crm/invoices/${inv.id}`)}
                        >
                          {inv.invoiceNumber || `INV-${String(inv.id).padStart(4, '0')}`}
                        </td>
                        <td className="px-4 py-3 text-gray-900">{inv.contactName || '—'}</td>
                        <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                          {inv.jobNumber || (inv.jobId ? `ROOF-${String(inv.jobId).padStart(4, '0')}` : '—')}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[inv.status] || 'bg-gray-100 text-gray-600'}`}>
                            {formatStatus(inv.status)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right font-medium text-gray-900">
                          ${Number(inv.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-right text-gray-600">
                          ${Number(inv.amountPaid || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                        </td>
                        <td className="px-4 py-3 text-right font-medium">
                          <span className={balance > 0 ? 'text-red-600' : 'text-green-600'}>
                            ${balance.toLocaleString(undefined, { minimumFractionDigits: 2 })}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-500 text-xs">
                          {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-1">
                            {inv.status === 'draft' && (
                              <button onClick={() => sendInvoice(inv.id)} title="Send" className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                                <Send className="w-4 h-4" />
                              </button>
                            )}
                            {balance > 0 && inv.status !== 'draft' && (
                              <>
                                <button onClick={() => markPaid(inv.id)} title="Mark Paid" className="p-1 text-green-600 hover:bg-green-50 rounded">
                                  <Check className="w-4 h-4" />
                                </button>
                                <button
                                  onClick={() => { setPaymentInvoice(inv); setPayment({ amount: String(balance.toFixed(2)), method: 'card', reference: '', notes: '' }); setPaymentOpen(true); }}
                                  title="Record Payment"
                                  className="p-1 text-purple-600 hover:bg-purple-50 rounded"
                                >
                                  <DollarSign className="w-4 h-4" />
                                </button>
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t bg-gray-50">
              <p className="text-xs text-gray-500">Page {page} of {totalPages}</p>
              <div className="flex gap-1">
                <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages} className="p-1.5 rounded hover:bg-gray-200 disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Create Invoice Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <Receipt className="w-5 h-5 text-blue-600" /> New Invoice
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Contact *</label>
                  <select value={form.contactId} onChange={(e) => setForm({ ...form, contactId: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                    <option value="">Select contact...</option>
                    {contacts.map((c: any) => <option key={c.id} value={c.id}>{c.name || `${c.firstName || ''} ${c.lastName || ''}`.trim()}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Job (optional)</label>
                  <select value={form.jobId} onChange={(e) => setForm({ ...form, jobId: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                    <option value="">No job linked</option>
                    {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.jobNumber || `ROOF-${String(j.id).padStart(4, '0')}`}</option>)}
                  </select>
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-2">Line Items</label>
                {form.lineItems.map((li, idx) => (
                  <div key={idx} className="flex gap-2 mb-2 items-end">
                    <input
                      value={li.description}
                      onChange={(e) => updateLine(idx, 'description', e.target.value)}
                      placeholder="Description"
                      className="flex-1 text-sm border rounded px-2 py-1.5"
                    />
                    <input
                      type="number"
                      min={1}
                      value={li.quantity}
                      onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                      className="w-16 text-sm border rounded px-2 py-1.5"
                      placeholder="Qty"
                    />
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={li.unitPrice}
                      onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))}
                      className="w-24 text-sm border rounded px-2 py-1.5"
                      placeholder="Price"
                    />
                    <span className="text-sm text-gray-700 w-20 text-right">${(li.quantity * li.unitPrice).toFixed(2)}</span>
                    {form.lineItems.length > 1 && (
                      <button onClick={() => setForm((prev) => ({ ...prev, lineItems: prev.lineItems.filter((_, i) => i !== idx) }))} className="p-1 text-gray-400 hover:text-red-500">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
                <button onClick={() => setForm((prev) => ({ ...prev, lineItems: [...prev.lineItems, { description: '', quantity: 1, unitPrice: 0 }] }))} className="text-xs text-blue-600 hover:underline">+ Add line</button>
              </div>
              <div className="flex justify-end">
                <div className="w-56 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Tax (%)</span>
                    <input type="number" min={0} step={0.1} value={form.taxRate} onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })} className="w-16 text-sm border rounded px-2 py-1 text-right" />
                  </div>
                  <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Due Date</label>
                  <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
                </div>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={handleCreate} disabled={saving} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50">
                {saving ? 'Creating...' : 'Create Invoice'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record Payment Modal */}
      {paymentOpen && paymentInvoice && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setPaymentOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm mx-4 p-6" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">Record Payment</h2>
            <p className="text-sm text-gray-500 mb-4">
              Invoice {paymentInvoice.invoiceNumber || `INV-${String(paymentInvoice.id).padStart(4, '0')}`}
            </p>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500 block mb-1">Amount *</label>
                <input type="number" step={0.01} value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Method</label>
                <select value={payment.method} onChange={(e) => setPayment({ ...payment, method: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2">
                  <option value="card">Card</option>
                  <option value="check">Check</option>
                  <option value="cash">Cash</option>
                  <option value="ach">ACH</option>
                  <option value="insurance">Insurance</option>
                  <option value="other">Other</option>
                </select>
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Reference #</label>
                <input value={payment.reference} onChange={(e) => setPayment({ ...payment, reference: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
              <div>
                <label className="text-xs text-gray-500 block mb-1">Notes</label>
                <input value={payment.notes} onChange={(e) => setPayment({ ...payment, notes: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-6">
              <button onClick={() => setPaymentOpen(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg">Cancel</button>
              <button onClick={recordPayment} className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700">Record</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
