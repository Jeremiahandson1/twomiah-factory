import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, DollarSign } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const statuses = ['draft', 'sent', 'viewed', 'partial', 'paid', 'overdue'];

export default function InvoicesPage() {
  const toast = useToast();
  const navigate = useNavigate();
    const [data, setData] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ contactId: '', projectId: '', dueDate: '', taxRate: 0, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentInvoice, setPaymentInvoice] = useState(null);
  const [payment, setPayment] = useState({ amount: '', method: 'card', reference: '', notes: '' });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      const [res, contRes] = await Promise.all([api.invoices.list(params), api.contacts.list({ limit: 100 })]);
      setData(res.data);
      setPagination(res.pagination);
      setContacts(contRes.data);
    } catch (err) { toast.error('Failed to load invoices'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const calcTotals = () => { const subtotal = form.lineItems.reduce((s, li) => s + (li.quantity * li.unitPrice), 0); const taxAmount = subtotal * (form.taxRate / 100); return { subtotal, taxAmount, total: subtotal + taxAmount - form.discount }; };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = { ...form, lineItems: form.lineItems.filter(li => li.description.trim()) };
      if (editing) { await api.invoices.update(editing.id, payload); toast.success('Invoice updated'); }
      else { await api.invoices.create(payload); toast.success('Invoice created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.invoices.delete(toDelete.id); toast.success('Invoice deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  const handleSend = async (inv) => { try { await api.invoices.send(inv.id); toast.success('Invoice sent'); load(); } catch (err) { toast.error(err.message); } };
  
  const openPayment = (inv) => { setPaymentInvoice(inv); setPayment({ amount: String(Number(inv.balance)), method: 'card', reference: '', notes: '' }); setPaymentOpen(true); };
  const handlePayment = async () => {
    if (!payment.amount || Number(payment.amount) <= 0) { toast.error('Enter a valid amount'); return; }
    try { await api.invoices.addPayment(paymentInvoice.id, { ...payment, amount: Number(payment.amount) }); toast.success('Payment recorded'); setPaymentOpen(false); load(); }
    catch (err) { toast.error(err.message); }
  };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx, field, val) => { const items = [...form.lineItems]; items[idx][field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx) => setForm({ ...form, lineItems: form.lineItems.filter((_, i) => i !== idx) });

  const openCreate = () => { setEditing(null); setForm({ contactId: '', projectId: '', dueDate: '', taxRate: 0, discount: 0, notes: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ contactId: item.contactId || '', projectId: item.projectId || '', dueDate: item.dueDate?.split('T')[0] || '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: item.notes || '', lineItems: item.lineItems?.length ? item.lineItems.map(li => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: 'Number', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'contact', label: 'Client', render: (v) => v?.name || '-' },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'total', label: 'Total', render: (v) => `$${Number(v).toLocaleString()}` },
    { key: 'balance', label: 'Balance', render: (v) => Number(v) > 0 ? <span className="text-orange-600 font-medium">${Number(v).toLocaleString()}</span> : <span className="text-green-600">Paid</span> },
    { key: 'dueDate', label: 'Due', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
  ];

  const { subtotal, taxAmount, total } = calcTotals();

  return (
    <div>
      <PageHeader title="Invoices" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Invoice</Button>} />
      <div className="mb-4"><select value={statusFilter} onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg"><option value="">All Status</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row) => navigate(`/crm/invoices/${row.id}`)} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Send', icon: Send, onClick: handleSend },
        { label: 'Record Payment', icon: DollarSign, onClick: openPayment },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Invoice' : 'New Invoice'} size="xl">
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Contact</label><select value={form.contactId} onChange={(e) => setForm({...form, contactId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{contacts.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium">Description</th><th className="px-4 py-2 w-24">Qty</th><th className="px-4 py-2 w-32">Unit Price</th><th className="px-4 py-2 text-right w-32">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li, idx) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} onChange={(e) => updateLineItem(idx, 'description', e.target.value)} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} onChange={(e) => updateLineItem(idx, 'quantity', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} onChange={(e) => updateLineItem(idx, 'unitPrice', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2 text-right">${(li.quantity * li.unitPrice).toLocaleString()}</td>
                    <td><button onClick={() => removeLineItem(idx)} className="p-1 text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>
                ))}</tbody>
              </table>
              <div className="p-2 border-t"><button onClick={addLineItem} className="text-sm text-orange-500">+ Add Line</button></div>
            </div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Tax Rate (%)</label><input type="number" value={form.taxRate} onChange={(e) => setForm({...form, taxRate: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Discount ($)</label><input type="number" value={form.discount} onChange={(e) => setForm({...form, discount: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg text-right"><p className="text-lg font-bold">Total: ${total.toLocaleString()}</p></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <Modal isOpen={paymentOpen} onClose={() => setPaymentOpen(false)} title="Record Payment" size="sm">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={payment.amount} onChange={(e) => setPayment({...payment, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Method</label><select value={payment.method} onChange={(e) => setPayment({...payment, method: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="card">Card</option><option value="cash">Cash</option><option value="check">Check</option><option value="bank_transfer">Bank Transfer</option></select></div>
          <div><label className="block text-sm font-medium mb-1">Reference</label><input value={payment.reference} onChange={(e) => setPayment({...payment, reference: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Check # or transaction ID" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setPaymentOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handlePayment}>Record Payment</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Invoice" message={`Delete invoice ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
