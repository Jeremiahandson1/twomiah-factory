import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, Check, X as XIcon } from 'lucide-react';
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

interface ChangeOrderForm {
  title: string;
  description: string;
  projectId: string;
  reason: string;
  daysAdded: number;
  lineItems: LineItem[];
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function ChangeOrdersPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<ChangeOrderForm>({ title: '', description: '', projectId: '', reason: '', daysAdded: 0, lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resRaw, projResRaw] = await Promise.all([api.changeOrders.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load change orders'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const calcTotal = () => form.lineItems.reduce((s: number, li: LineItem) => s + (li.quantity * li.unitPrice), 0);

  const handleSave = async () => {
    if (!form.title || !form.projectId) { toast.error('Title and project required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lineItems: form.lineItems.filter((li: LineItem) => li.description.trim()) };
      if (editing) { await api.changeOrders.update(editing.id as string, payload); toast.success('Updated'); }
      else { await api.changeOrders.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.changeOrders.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleSubmit = async (co: Record<string, unknown>) => { try { await api.changeOrders.submit(co.id as string); toast.success('Submitted'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleApprove = async (co: Record<string, unknown>) => { try { await api.changeOrders.approve(co.id as string, { approvedBy: 'Current User' }); toast.success('Approved'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleReject = async (co: Record<string, unknown>) => { try { await api.changeOrders.reject(co.id as string); toast.success('Rejected'); load(); } catch (err) { toast.error((err as Error).message); } };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx: number, field: string, val: string | number) => { const items = [...form.lineItems]; (items[idx] as Record<string, unknown>)[field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx: number) => setForm({ ...form, lineItems: form.lineItems.filter((_: LineItem, i: number) => i !== idx) });

  const openCreate = () => { setEditing(null); setForm({ title: '', description: '', projectId: '', reason: '', daysAdded: 0, lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ title: item.title as string, description: (item.description as string) || '', projectId: item.projectId as string, reason: (item.reason as string) || '', daysAdded: (item.daysAdded as number) || 0, lineItems: (item.lineItems as LineItem[])?.length ? (item.lineItems as LineItem[]).map((li: LineItem) => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'title', label: 'Title', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'amount', label: 'Amount', render: (v: unknown) => `$${Number(v).toLocaleString()}` },
    { key: 'daysAdded', label: 'Days', render: (v: unknown) => v ? `+${v}` : '-' },
  ];

  return (
    <div>
      <PageHeader title="Change Orders" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New CO</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Submit', icon: Send, onClick: handleSubmit },
        { label: 'Approve', icon: Check, onClick: handleApprove },
        { label: 'Reject', icon: XIcon, onClick: handleReject },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Change Order' : 'New Change Order'} size="lg">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Title *</label><input value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, title: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Reason</label><input value={form.reason} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, reason: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Owner request, unforeseen conditions..." /></div>
            <div><label className="block text-sm font-medium mb-1">Days Added</label><input type="number" value={form.daysAdded} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, daysAdded: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg">
              <table className="w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs">Description</th><th className="px-4 py-2 w-20">Qty</th><th className="px-4 py-2 w-28">Price</th><th className="px-4 py-2 text-right w-28">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li: LineItem, idx: number) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'description', e.target.value)} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'quantity', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} onChange={(e: React.ChangeEvent<HTMLInputElement>) => updateLineItem(idx, 'unitPrice', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2 text-right">${(li.quantity * li.unitPrice).toLocaleString()}</td>
                    <td><button onClick={() => removeLineItem(idx)} className="p-1 text-red-500"><Trash2 className="w-4 h-4" /></button></td></tr>
                ))}</tbody>
              </table>
              <div className="p-2 border-t flex justify-between items-center"><button onClick={addLineItem} className="text-sm text-orange-500">+ Add Line</button><span className="font-bold">Total: ${calcTotal().toLocaleString()}</span></div>
            </div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete CO" message={`Delete ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
