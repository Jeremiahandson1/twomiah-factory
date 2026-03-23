import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Search, Send, Check, X, FileText } from 'lucide-react';
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

interface QuoteForm {
  name: string;
  contactId: string;
  projectId: string;
  expiryDate: string;
  taxRate: number;
  discount: number;
  notes: string;
  terms: string;
  lineItems: LineItem[];
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const statuses = ['draft', 'sent', 'viewed', 'approved', 'rejected', 'expired'];

export default function QuotesPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<QuoteForm>({ name: '', contactId: '', projectId: '', expiryDate: '', taxRate: 0, discount: 0, notes: '', terms: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 25 };
      if (statusFilter) params.status = statusFilter;
      const [resRaw, contResRaw, projResRaw] = await Promise.all([api.quotes.list(params), api.contacts.list({ limit: 100 }), api.projects.list({ limit: 100 })]);
      const res = resRaw as Record<string, unknown>; const contRes = contResRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as PaginationData | null);
      setContacts(contRes.data as Record<string, unknown>[]);
      setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load quotes'); }
    finally { setLoading(false); }
  }, [page, statusFilter]);

  useEffect(() => { load(); }, [load]);

  const openCreate = () => { setEditing(null); setForm({ name: '', contactId: '', projectId: '', expiryDate: '', taxRate: 0, discount: 0, notes: '', terms: '', lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ name: item.name as string, contactId: (item.contactId as string) || '', projectId: (item.projectId as string) || '', expiryDate: (item.expiryDate as string)?.split('T')[0] || '', taxRate: Number(item.taxRate), discount: Number(item.discount), notes: (item.notes as string) || '', terms: (item.terms as string) || '', lineItems: (item.lineItems as LineItem[])?.length ? (item.lineItems as LineItem[]).map((li: LineItem) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const calcTotals = () => {
    const subtotal = form.lineItems.reduce((s: number, li: LineItem) => s + (li.quantity * li.unitPrice), 0);
    const taxAmount = subtotal * (form.taxRate / 100);
    return { subtotal, taxAmount, total: subtotal + taxAmount - form.discount };
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lineItems: form.lineItems.filter((li: LineItem) => li.description.trim()) };
      if (editing) { await api.quotes.update(editing.id as string, payload); toast.success('Quote updated'); }
      else { await api.quotes.create(payload); toast.success('Quote created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.quotes.delete((toDelete as Record<string, unknown>).id as string); toast.success('Quote deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleSend = async (q: Record<string, unknown>) => { try { await api.quotes.send(q.id as string); toast.success('Quote sent'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleApprove = async (q: Record<string, unknown>) => { try { await api.quotes.approve(q.id as string); toast.success('Quote approved'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleReject = async (q: Record<string, unknown>) => { try { await api.quotes.reject(q.id as string); toast.success('Quote rejected'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleConvert = async (q: Record<string, unknown>) => { try { await api.quotes.convertToInvoice(q.id as string); toast.success('Invoice created'); load(); } catch (err) { toast.error((err as Error).message); } };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx: number, field: string, val: string | number) => { const items = [...form.lineItems]; (items[idx] as Record<string, unknown>)[field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx: number) => setForm({ ...form, lineItems: form.lineItems.filter((_: LineItem, i: number) => i !== idx) });

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'name', label: 'Name', render: (v: unknown, r: Record<string, unknown>) => <div><p className="font-medium">{v as string}</p>{!!r.contact && <p className="text-sm text-gray-500">{(r.contact as Record<string, unknown>).name as string}</p>}</div> },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'total', label: 'Total', render: (v: unknown) => `$${Number(v).toLocaleString()}` },
    { key: 'expiryDate', label: 'Expires', render: (v: unknown) => v ? new Date(v as string).toLocaleDateString() : '-' },
  ];

  const { subtotal, taxAmount, total } = calcTotals();

  return (
    <div>
      <PageHeader title="Quotes" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Quote</Button>} />
      <div className="mb-4"><select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => { setStatusFilter(e.target.value); setPage(1); }} className="px-4 py-2 border rounded-lg"><option value="">All Status</option>{statuses.map(s => <option key={s} value={s}>{s}</option>)}</select></div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row: Record<string, unknown>) => navigate(`/crm/quotes/${row.id}`)} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Send', icon: Send, onClick: handleSend },
        { label: 'Approve', icon: Check, onClick: handleApprove },
        { label: 'Reject', icon: X, onClick: handleReject },
        { label: 'Convert to Invoice', icon: FileText, onClick: handleConvert },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Quote' : 'New Quote'} size="xl">
        <div className="space-y-4">
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Contact</label><select value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, contactId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{contacts.map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}</select></div>
            <div><label className="block text-sm font-medium mb-1">Project</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg overflow-hidden">
              <table className="w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs font-medium">Description</th><th className="px-4 py-2 text-left text-xs font-medium w-24">Qty</th><th className="px-4 py-2 text-left text-xs font-medium w-32">Unit Price</th><th className="px-4 py-2 text-right text-xs font-medium w-32">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li: LineItem, idx: number) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'description', e.target.value)} placeholder="Description" className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'quantity', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'unitPrice', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2 text-right">${(li.quantity * li.unitPrice).toLocaleString()}</td>
                    <td className="px-2"><button onClick={() => removeLineItem(idx)} className="p-1 hover:bg-gray-100 rounded text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>
                ))}</tbody>
              </table>
              <div className="p-2 border-t"><button onClick={addLineItem} className="text-sm text-orange-500 hover:text-orange-600">+ Add Line</button></div>
            </div>
          </div>
          <div className="grid md:grid-cols-3 gap-4">
            <div><label className="block text-sm font-medium mb-1">Tax Rate (%)</label><input type="number" value={form.taxRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, taxRate: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Discount ($)</label><input type="number" value={form.discount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, discount: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Expiry Date</label><input type="date" value={form.expiryDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, expiryDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div className="bg-gray-50 p-4 rounded-lg text-right space-y-1"><p>Subtotal: <span className="font-medium">${subtotal.toLocaleString()}</span></p><p>Tax: <span className="font-medium">${taxAmount.toLocaleString()}</span></p>{form.discount > 0 && <p>Discount: <span className="font-medium">-${form.discount.toLocaleString()}</span></p>}<p className="text-lg font-bold">Total: ${total.toLocaleString()}</p></div>
          <div><label className="block text-sm font-medium mb-1">Notes</label><textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, notes: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Quote" message={`Delete "${toDelete?.name as string}"?`} confirmText="Delete" />
    </div>
  );
}
