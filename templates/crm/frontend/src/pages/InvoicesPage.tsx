import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, DollarSign } from 'lucide-react';
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
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const statuses = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue'];

export default function InvoicesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<InvoiceForm>({ contactId: '', projectId: '', dueDate: '', taxRate: 0, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState<Record<string, unknown> | null>(null);
  const [payment, setPayment] = useState<PaymentForm>({ amount: '', method: 'card', reference: '', notes: '' });

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

  const calcTotals = () => { const subtotal = form.lineItems.reduce((s: number, li: LineItem) => s + (li.quantity * li.unitPrice), 0); const taxAmount = subtotal * (form.taxRate / 100); return { subtotal, taxAmount, total: subtotal + taxAmount - form.discount }; };

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

  const openPayment = (inv: Record<string, unknown>) => { setPaymentInvoice(inv); setPayment({ amount: String(Number(inv.total) - Number(inv.amountPaid || 0)), method: 'card', reference: '', notes: '' }); setPaymentOpen(true); };
  const handlePayment = async () => {
    if (!payment.amount || Number(payment.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.invoices.recordPayment((paymentInvoice as Record<string, unknown>).id as string, { ...payment, amount: Number(payment.amount) }); toast.success('Payment recorded'); setPaymentOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx: number, field: string, val: string | number) => { const items = [...form.lineItems]; (items[idx] as Record<string, unknown>)[field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx: number) => setForm({ ...form, lineItems: form.lineItems.filter((_: LineItem, i: number) => i !== idx) });

  const openCreate = () => { setEditing(null); setForm({ contactId: '', projectId: '', dueDate: '', taxRate: 0, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ contactId: (item.contactId as string) || '', projectId: (item.projectId as string) || '', dueDate: (item.dueDate as string)?.split('T')[0] || '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: (item.notes as string) || '', lineItems: (item.lineItems as LineItem[])?.length ? (item.lineItems as LineItem[]).map((li: LineItem) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'contact', label: 'Client', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'total', label: 'Total', render: (v: unknown) => `$${Number(v).toLocaleString()}` },
    { key: 'amountPaid', label: 'Balance', render: (v: unknown, r: Record<string, unknown>) => { const bal = Number(r.total) - Number(v || 0); return bal > 0 ? <span className="text-orange-600 font-medium">${bal.toLocaleString()}</span> : <span className="text-green-600">Paid</span>; } },
    { key: 'dueDate', label: 'Due', render: (v: unknown) => v ? new Date(String(v).split('T')[0] + 'T00:00:00').toLocaleDateString() : '-' },
  ];

  const { subtotal, taxAmount, total } = calcTotals();

  return (
    <div>
      <PageHeader title="Invoices" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Invoice</Button>} />
      <div className="mb-4"><select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg"><option value="">All Status</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row: Record<string, unknown>) => navigate(`/crm/invoices/${row.id}`)} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Send', icon: Send, onClick: handleSend },
        { label: 'Record Payment', icon: DollarSign, onClick: openPayment },
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
              <table className="w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium">Description</th><th className="px-4 py-2 w-24">Qty</th><th className="px-4 py-2 w-32">Unit Price</th><th className="px-4 py-2 text-right w-32">Total</th><th className="w-10"></th></tr></thead>
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
          <div className="bg-gray-50 p-4 rounded-lg text-right"><p className="text-lg font-bold">Total: ${total.toLocaleString()}</p></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <Modal isOpen={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={payment.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayment({...payment, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Method</label><select value={payment.method} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setPayment({...payment, method: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank Transfer</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Reference</label><input value={payment.reference} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setPayment({...payment, reference: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Check # or transaction ID" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setPaymentOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handlePayment}>Record Payment</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Invoice" message={`Delete invoice ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
