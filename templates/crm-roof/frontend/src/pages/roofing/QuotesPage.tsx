import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Send, Check, X, ChevronLeft, ChevronRight, FileText, Trash2, ArrowRight } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

const STATUS_COLORS: Record<string, string> = {
  draft: 'bg-gray-100 text-gray-700',
  sent: 'bg-blue-100 text-blue-700',
  viewed: 'bg-purple-100 text-purple-700',
  approved: 'bg-green-100 text-green-700',
  declined: 'bg-red-100 text-red-700',
  expired: 'bg-yellow-100 text-yellow-700',
};

function formatStatus(s: string) {
  return (s || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

const emptyLine = { description: '', quantity: 1, unitPrice: 0 };

export default function QuotesPage() {
  const { token } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();

  const [quotes, setQuotes] = useState<any[]>([]);
  const [contacts, setContacts] = useState<any[]>([]);
  const [jobs, setJobs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [modalOpen, setModalOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    contactId: '',
    jobId: '',
    notes: '',
    taxRate: 0,
    expiresAt: '',
    lineItems: [{ ...emptyLine }],
  });

  const limit = 25;
  const headers = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      const [quotesRes, contactsRes, jobsRes] = await Promise.all([
        fetch(`/api/quotes?${params}`, { headers }),
        fetch('/api/contacts?limit=200', { headers }),
        fetch('/api/jobs?limit=200', { headers }),
      ]);
      const quotesData = await quotesRes.json();
      const contactsData = await contactsRes.json();
      const jobsData = await jobsRes.json();

      setQuotes(Array.isArray(quotesData) ? quotesData : quotesData.data || []);
      setTotal(quotesData.pagination?.total || quotesData.total || (Array.isArray(quotesData) ? quotesData.length : 0));
      setContacts(Array.isArray(contactsData) ? contactsData : contactsData.data || []);
      setJobs(Array.isArray(jobsData) ? jobsData : jobsData.data || []);
    } catch {
      toast.error('Failed to load quotes');
    } finally {
      setLoading(false);
    }
  }, [page, token]);

  useEffect(() => { load(); }, [load]);

  const subtotal = form.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const tax = subtotal * (form.taxRate / 100);
  const grandTotal = subtotal + tax;

  const updateLine = (idx: number, field: string, value: any) => {
    setForm((prev) => ({
      ...prev,
      lineItems: prev.lineItems.map((li, i) => (i === idx ? { ...li, [field]: value } : li)),
    }));
  };

  const addLine = () => setForm((prev) => ({ ...prev, lineItems: [...prev.lineItems, { ...emptyLine }] }));
  const removeLine = (idx: number) => setForm((prev) => ({ ...prev, lineItems: prev.lineItems.filter((_, i) => i !== idx) }));

  const openCreate = () => {
    setForm({ contactId: '', jobId: '', notes: '', taxRate: 0, expiresAt: '', lineItems: [{ ...emptyLine }] });
    setModalOpen(true);
  };

  const handleCreate = async () => {
    if (!form.contactId) { toast.error('Select a contact'); return; }
    const validLines = form.lineItems.filter((li) => li.description.trim());
    if (validLines.length === 0) { toast.error('Add at least one line item'); return; }
    setSaving(true);
    try {
      const res = await fetch('/api/quotes', {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, lineItems: validLines }),
      });
      if (!res.ok) throw new Error();
      toast.success('Quote created');
      setModalOpen(false);
      load();
    } catch {
      toast.error('Failed to create quote');
    } finally {
      setSaving(false);
    }
  };

  const performAction = async (quoteId: string, action: string) => {
    try {
      const res = await fetch(`/api/quotes/${quoteId}/${action}`, {
        method: 'POST',
        headers,
      });
      if (!res.ok) throw new Error();
      toast.success(`Quote ${action === 'convert' ? 'converted to job' : action + 'ed'}`);
      load();
    } catch {
      toast.error(`Failed to ${action} quote`);
    }
  };

  const totalPages = Math.ceil(total / limit) || 1;

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="max-w-7xl mx-auto px-6 py-6">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold text-gray-900">Quotes</h1>
            <p className="text-sm text-gray-500 mt-0.5">{total} quotes</p>
          </div>
          <button
            onClick={openCreate}
            className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" /> New Quote
          </button>
        </div>

        <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b">
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Quote #</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Contact</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Job</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Status</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Total</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Created</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-500">Expires</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-500">Actions</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400">Loading...</td></tr>
                ) : quotes.length === 0 ? (
                  <tr><td colSpan={8} className="text-center py-12 text-gray-400">No quotes found</td></tr>
                ) : (
                  quotes.map((q) => (
                    <tr key={q.id} className="border-b last:border-0 hover:bg-gray-50">
                      <td
                        className="px-4 py-3 font-mono text-xs font-semibold text-blue-600 cursor-pointer hover:underline"
                        onClick={() => navigate(`/crm/quotes/${q.id}`)}
                      >
                        {q.quoteNumber || `Q-${String(q.id).padStart(4, '0')}`}
                      </td>
                      <td className="px-4 py-3 text-gray-900">{q.contact ? `${q.contact.firstName || ''} ${q.contact.lastName || ''}`.trim() : q.contactName || '—'}</td>
                      <td className="px-4 py-3 text-gray-600 text-xs font-mono">
                        {q.job?.jobNumber || q.jobNumber || (q.jobId ? q.jobId.slice(0, 12) + '...' : '—')}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium px-2 py-0.5 rounded ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-600'}`}>
                          {formatStatus(q.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-gray-900">
                        ${Number(q.total || 0).toLocaleString(undefined, { minimumFractionDigits: 2 })}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {q.createdAt ? new Date(q.createdAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 text-xs">
                        {q.expiresAt ? new Date(q.expiresAt).toLocaleDateString() : '—'}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1">
                          {q.status === 'draft' && (
                            <button onClick={() => performAction(q.id, 'send')} title="Send" className="p-1 text-blue-600 hover:bg-blue-50 rounded">
                              <Send className="w-4 h-4" />
                            </button>
                          )}
                          {(q.status === 'sent' || q.status === 'viewed') && (
                            <>
                              <button onClick={() => performAction(q.id, 'approve')} title="Approve" className="p-1 text-green-600 hover:bg-green-50 rounded">
                                <Check className="w-4 h-4" />
                              </button>
                              <button onClick={() => performAction(q.id, 'decline')} title="Decline" className="p-1 text-red-600 hover:bg-red-50 rounded">
                                <X className="w-4 h-4" />
                              </button>
                            </>
                          )}
                          {q.status === 'approved' && !q.jobId && (
                            <button onClick={() => performAction(q.id, 'convert')} title="Convert to Job" className="p-1 text-purple-600 hover:bg-purple-50 rounded">
                              <ArrowRight className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
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

      {/* Create Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={() => setModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl mx-4 max-h-[90vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-5 h-5 text-blue-600" /> New Quote
              </h2>
              <button onClick={() => setModalOpen(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-5 h-5" />
              </button>
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
                    {jobs.map((j: any) => <option key={j.id} value={j.id}>{j.jobNumber || `ROOF-${String(j.id).padStart(4, '0')}`} — {j.contactName || j.address || ''}</option>)}
                  </select>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <label className="text-xs text-gray-500 block mb-2">Line Items</label>
                <table className="w-full text-sm mb-2">
                  <thead>
                    <tr className="text-left text-gray-500 text-xs">
                      <th className="pb-1 font-medium">Description</th>
                      <th className="pb-1 font-medium w-20">Qty</th>
                      <th className="pb-1 font-medium w-28">Unit Price</th>
                      <th className="pb-1 font-medium w-24 text-right">Total</th>
                      <th className="pb-1 w-8"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {form.lineItems.map((li, idx) => (
                      <tr key={idx}>
                        <td className="py-1 pr-2">
                          <input
                            value={li.description}
                            onChange={(e) => updateLine(idx, 'description', e.target.value)}
                            placeholder="Description"
                            className="w-full text-sm border rounded px-2 py-1.5"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            min={1}
                            value={li.quantity}
                            onChange={(e) => updateLine(idx, 'quantity', Number(e.target.value))}
                            className="w-full text-sm border rounded px-2 py-1.5"
                          />
                        </td>
                        <td className="py-1 pr-2">
                          <input
                            type="number"
                            min={0}
                            step={0.01}
                            value={li.unitPrice}
                            onChange={(e) => updateLine(idx, 'unitPrice', Number(e.target.value))}
                            className="w-full text-sm border rounded px-2 py-1.5"
                          />
                        </td>
                        <td className="py-1 text-right text-gray-700 font-medium">
                          ${(li.quantity * li.unitPrice).toFixed(2)}
                        </td>
                        <td className="py-1 pl-1">
                          {form.lineItems.length > 1 && (
                            <button onClick={() => removeLine(idx)} className="p-1 text-gray-400 hover:text-red-500">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button onClick={addLine} className="text-xs text-blue-600 hover:underline">+ Add line</button>
              </div>

              {/* Totals */}
              <div className="flex justify-end">
                <div className="w-64 space-y-1 text-sm">
                  <div className="flex justify-between"><span className="text-gray-500">Subtotal</span><span>${subtotal.toFixed(2)}</span></div>
                  <div className="flex justify-between items-center">
                    <span className="text-gray-500">Tax (%)</span>
                    <input
                      type="number"
                      min={0}
                      step={0.1}
                      value={form.taxRate}
                      onChange={(e) => setForm({ ...form, taxRate: Number(e.target.value) })}
                      className="w-16 text-sm border rounded px-2 py-1 text-right"
                    />
                  </div>
                  {tax > 0 && <div className="flex justify-between"><span className="text-gray-500">Tax amount</span><span>${tax.toFixed(2)}</span></div>}
                  <div className="flex justify-between font-bold border-t pt-1"><span>Total</span><span>${grandTotal.toFixed(2)}</span></div>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs text-gray-500 block mb-1">Expires On</label>
                  <input type="date" value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} className="w-full text-sm border rounded-lg px-3 py-2" />
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
                {saving ? 'Creating...' : 'Create Quote'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
