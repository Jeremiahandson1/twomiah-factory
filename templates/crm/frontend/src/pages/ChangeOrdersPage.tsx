import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Send, Check, X as XIcon } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function ChangeOrdersPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ title: '', description: '', projectId: '', reason: '', daysAdded: 0, lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.changeOrders.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load change orders'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const calcTotal = () => form.lineItems.reduce((s, li) => s + (li.quantity * li.unitPrice), 0);

  const handleSave = async () => {
    if (!form.title || !form.projectId) { toast.error('Title and project required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, lineItems: form.lineItems.filter(li => li.description.trim()) };
      if (editing) { await api.changeOrders.update(editing.id, payload); toast.success('Updated'); }
      else { await api.changeOrders.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.changeOrders.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  const handleSubmit = async (co) => { try { await api.changeOrders.submit(co.id); toast.success('Submitted'); load(); } catch (err) { toast.error(err.message); } };
  const handleApprove = async (co) => { try { await api.changeOrders.approve(co.id, { approvedBy: 'Current User' }); toast.success('Approved'); load(); } catch (err) { toast.error(err.message); } };
  const handleReject = async (co) => { try { await api.changeOrders.reject(co.id); toast.success('Rejected'); load(); } catch (err) { toast.error(err.message); } };

  const addLineItem = () => setForm({ ...form, lineItems: [...form.lineItems, { description: '', quantity: 1, unitPrice: 0 }] });
  const updateLineItem = (idx, field, val) => { const items = [...form.lineItems]; items[idx][field] = val; setForm({ ...form, lineItems: items }); };
  const removeLineItem = (idx) => setForm({ ...form, lineItems: form.lineItems.filter((_, i) => i !== idx) });

  const openCreate = () => { setEditing(null); setForm({ title: '', description: '', projectId: '', reason: '', daysAdded: 0, lineItems: [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ title: item.title, description: item.description || '', projectId: item.projectId, reason: item.reason || '', daysAdded: item.daysAdded || 0, lineItems: item.lineItems?.length ? item.lineItems.map(li => ({ description: li.description, quantity: Number(li.quantity), unitPrice: Number(li.unitPrice) })) : [{ description: '', quantity: 1, unitPrice: 0 }] }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'title', label: 'Title', render: (v) => <span className="font-medium">{v}</span> },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'amount', label: 'Amount', render: (v) => `$${Number(v).toLocaleString()}` },
    { key: 'daysAdded', label: 'Days', render: (v) => v ? `+${v}` : '-' },
  ];

  return (
    <div>
      <PageHeader title="Change Orders" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New CO</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Submit', icon: Send, onClick: handleSubmit },
        { label: 'Approve', icon: Check, onClick: handleApprove },
        { label: 'Reject', icon: XIcon, onClick: handleReject },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Change Order' : 'New Change Order'} size="lg">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Title *</label><input value={form.title} onChange={(e) => setForm({...form, title: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Reason</label><input value={form.reason} onChange={(e) => setForm({...form, reason: e.target.value})} className="w-full px-3 py-2 border rounded-lg" placeholder="Owner request, unforeseen conditions..." /></div>
            <div><label className="block text-sm font-medium mb-1">Days Added</label><input type="number" value={form.daysAdded} onChange={(e) => setForm({...form, daysAdded: Number(e.target.value)})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-2">Line Items</label>
            <div className="border rounded-lg">
              <table className="w-full"><thead className="bg-gray-50"><tr><th className="px-4 py-2 text-left text-xs">Description</th><th className="px-4 py-2 w-20">Qty</th><th className="px-4 py-2 w-28">Price</th><th className="px-4 py-2 text-right w-28">Total</th><th className="w-10"></th></tr></thead>
                <tbody className="divide-y">{form.lineItems.map((li, idx) => (
                  <tr key={idx}><td className="px-4 py-2"><input value={li.description} onChange={(e) => updateLineItem(idx, 'description', e.target.value)} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.quantity} onChange={(e) => updateLineItem(idx, 'quantity', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
                    <td className="px-4 py-2"><input type="number" value={li.unitPrice} onChange={(e) => updateLineItem(idx, 'unitPrice', Number(e.target.value))} className="w-full px-2 py-1 border rounded" /></td>
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
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete CO" message={`Delete ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
