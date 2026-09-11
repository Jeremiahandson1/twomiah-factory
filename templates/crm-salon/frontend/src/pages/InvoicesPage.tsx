import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { formatDate } from '../utils/date';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, DollarSign, Ban, RotateCcw } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  [key: string]: unknown;
}

interface InvoiceForm {
  contactId: string;
  projectId: string;
  dueDate: string;
  taxRate: number;
  discount: number;
  notes: string;
  lineItems: LineItem[];
}

interface PaymentForm {
  amount: string;
  method: string;
  reference: string;
  notes: string;
  tipAmount?: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const statuses = ['draft', 'open', 'sent', 'viewed', 'partial', 'paid', 'overdue', 'refunded', 'void'];

export default function InvoicesPage() {
  // New quotes/invoices start from the company's default sales-tax rate (Settings → Company). (W-8)
  const defaultTaxRate = Number((useAuth().company as any)?.settings?.defaultTaxRate) || 0;
  // New invoices default to net-<terms> (Settings › Company), net-30 when unset. (SALON-L12)
  const defaultDueDate = () => { const terms = Number((useAuth().company as any)?.settings?.defaultPaymentTerms); const d = new Date(); d.setDate(d.getDate() + (Number.isFinite(terms) && terms >= 0 ? terms : 30)); return d.toISOString().slice(0, 10); };
  const toast = useToast();
  const [refundOpen, setRefundOpen] = useState<boolean>(false);
  const [refundInvoice, setRefundInvoice] = useState<Record<string, unknown> | null>(null);
  const [refund, setRefund] = useState<{ amount: string; method: string; reference: string }>({ amount: '', method: 'other', reference: '' });
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId) return;
    let cancelled = false;
    api.invoices.get(editId).then((item: unknown) => {
      if (cancelled || !item) return;
      openEdit(item as Record<string, unknown>);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<InvoiceForm>({ contactId: '', projectId: '', dueDate: '', taxRate: defaultTaxRate, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Record<string, unknown> | null>(null);
  const [payment, setPayment] = useState<PaymentForm>({ amount: '', method: 'card', reference: '', notes: '', tipAmount: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      const res = await api.invoices.list(params) as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as PaginationData | null);
      // Load contacts separately so failure doesn't block invoice list
      const contRes = await api.contacts.list({ limit: 100 }).catch(() => ({ data: [] })) as Record<string, unknown>;
      setContacts(contRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  // Must match the server's calcTotals exactly, or the builder preview disagrees with the
  // saved invoice: tax on the POST-discount amount, discount clamped, rounded to cents. (CC-01)
  const calcTotals = () => { const round2 = (n: number) => Math.round(n * 100) / 100; const subtotal = round2(form.lineItems.reduce((s: number, li: LineItem) => s + (li.quantity * li.unitPrice), 0)); const effectiveDiscount = Math.min(Math.max(0, form.discount), subtotal); const taxable = subtotal - effectiveDiscount; const taxAmount = round2(taxable * (form.taxRate / 100)); return { subtotal, taxAmount, total: round2(taxable + taxAmount) }; };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...form, lineItems: form.lineItems.filter((li: LineItem) => li.description.trim()) };
      if (editing) { await api.invoices.update(editing.id as string, payload); toast.success('Invoice updated'); }
      else { await api.invoices.create(payload); toast.success('Invoice created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.invoices.delete((toDelete as Record<string, unknown>).id as string); toast.success('Invoice deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleSend = async (inv: Record<string, unknown>) => { try { await api.invoices.send(inv.id as string); toast.success('Invoice sent'); load(); } catch (err) { toast.error((err as Error).message); } };

  const handleVoid = async (inv: Record<string, unknown>) => {
    if (!confirm(`Void invoice ${inv.number as string}? It stays on record but no longer counts as owed.`)) return;
    try { await api.post(`/api/invoices/${inv.id}/void`, {}); toast.success('Invoice voided'); load(); } catch (err) { toast.error((err as Error).message); }
  };
  const openRefund = (inv: Record<string, unknown>) => { setRefundInvoice(inv); setRefund({ amount: String(Number(inv.amountPaid || 0)), method: 'other', reference: '' }); setRefundOpen(true); };
  const handleRefund = async () => {
    if (!refund.amount || Number(refund.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.post(`/api/invoices/${(refundInvoice as Record<string, unknown>).id}/refund`, { ...refund, amount: Number(refund.amount) }); toast.success('Refund recorded'); setRefundOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };
  const openPayment = (inv: Record<string, unknown>) => { setPaymentInvoice(inv); setPayment({ amount: String(Number(inv.total) - Number(inv.amountPaid || 0)), method: 'card', reference: '', notes: '' }); setPaymentOpen(true); };
  const handlePayment = async () => {
    if (!payment.amount || Number(payment.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.invoices.recordPayment((paymentInvoice as Record<string, unknown>).id as string, { ...payment, amount: Number(payment.amount), tipAmount: Number(payment.tipAmount) || 0 }); toast.success('Payment recorded'); setPaymentOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx: number, field: string, val: string | number) => { const items = [...form.lineItems]; (items[idx] as Record<string, unknown>)[field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx: number) => setForm({ ...form, lineItems: form.lineItems.filter((_: LineItem, i: number) => i !== idx) });

  const openCreate = () => { setEditing(null); setForm({ contactId: '', projectId: '', dueDate: defaultDueDate(), taxRate: defaultTaxRate, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ contactId: (item.contactId as string) || '', projectId: (item.projectId as string) || '', dueDate: (item.dueDate as string)?.split('T')[0] || '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: (item.notes as string) || '', lineItems: (item.lineItems as LineItem[])?.length ? (item.lineItems as LineItem[]).map((li: LineItem) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'contact', label: 'Client', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'total', label: 'Total', render: (v: unknown) => `$${Number(v).toLocaleString()}` },
    { key: 'amountPaid', label: 'Balance', render: (v: unknown, r: Record<string, unknown>) => { if (r.status === 'void') return <span className="text-gray-400">Void</span>; const bal = Number(r.total) - Number(v || 0); return bal > 0 ? <span className="text-orange-600 font-medium">${bal.toLocaleString()}</span> : <span className="text-green-600">Paid</span>; } },
    { key: 'dueDate', label: 'Due', render: (v: unknown) => v ? formatDate(String(v).split('T')[0] + 'T00:00:00') : '-' },
  ];

  const { subtotal, taxAmount, total } = calcTotals();

  return (
    <div>
      <PageHeader title="Invoices" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Invoice</Button>} />
      <div className="mb-4"><select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg"><option value="">All Status</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row: Record<string, unknown>) => navigate(`/crm/invoices/${row.id}`)} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit, show: (r: Record<string, unknown>) => r.status !== 'void' },
        { label: 'Send', icon: Send, onClick: handleSend, show: (r: Record<string, unknown>) => r.status !== 'void' },
        { label: 'Record Payment', icon: DollarSign, onClick: openPayment, show: (r: Record<string, unknown>) => r.status !== 'void' && r.status !== 'refunded' },
        { label: 'Void', icon: Ban, onClick: handleVoid, show: (r: Record<string, unknown>) => r.status !== 'void' && Number(r.amountPaid || 0) <= 0 },
        { label: 'Refund', icon: RotateCcw, onClick: openRefund, show: (r: Record<string, unknown>) => Number(r.amountPaid || 0) > 0 },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Invoice' : 'New Invoice'} size="xl">
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Contact</label><select value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, contactId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{contacts.map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full"><thead className="bg-gray-50 dark:bg-slate-900"><tr><th className="px-4 py-2 text-left text-xs font-medium">Description</th><th className="px-4 py-2 w-24">Qty</th><th className="px-4 py-2 w-32">Unit Price</th><th className="px-4 py-2 text-right w-32">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li: LineItem, idx: number) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'description', e.target.value)} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'quantity', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'unitPrice', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2 text-right">${(li.quantity * li.unitPrice).toLocaleString()}</td>
                    <td><button onClick={() => removeLineItem(idx)} className="p-1 text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>
                ))}</tbody>
              </table>
              <div className="p-2 border-t"><button onClick={addLineItem} className="text-sm text-orange-500">+ Add Line</button></div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Tax Rate (%)</label><input type="number" value={form.taxRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, taxRate: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Discount ($)</label><input type="number" value={form.discount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, discount: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg text-right dark:bg-slate-900"><p className="text-lg font-bold">Total: ${total.toLocaleString()}</p></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <Modal isOpen={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={payment.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayment({...payment, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Tip (optional)</label><input type="number" step="0.01" min="0" value={payment.tipAmount || ''} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayment({...payment, tipAmount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="0.00" /></div>
          <div><label className="block text-sm font-medium mb-1">Method</label><select value={payment.method} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayment({...payment, method: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank Transfer</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Reference</label><input value={payment.reference} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayment({...payment, reference: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Check # or transaction ID" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setPaymentOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handlePayment}>Record Payment</Button></div>
      </Modal>
      <Modal isOpen={refundOpen} onClose={() => setRefundOpen(false)} title="Record Refund" size="sm">
        <div className="space-y-4">
          <p className="text-sm text-gray-500">Records money returned to the client on invoice {(refundInvoice as Record<string, unknown>)?.number as string}. Card refunds are issued in your payment processor; this keeps the invoice truthful.</p>
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" step="0.01" value={refund.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRefund({ ...refund, amount: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Method</label><select value={refund.method} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setRefund({ ...refund, method: e.target.value })} className="w-full px-3 py-2 border rounded-lg"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank Transfer</option><option value="other">Other</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Reference</label><input value={refund.reference} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setRefund({ ...refund, reference: e.target.value })} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setRefundOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleRefund}>Record Refund</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Invoice" message={`Delete invoice ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
