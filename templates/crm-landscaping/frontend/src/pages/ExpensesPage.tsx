import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const categories = ['materials', 'equipment', 'labor', 'travel', 'other'];

export default function ExpensesPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], category: 'materials', vendor: '', description: '', amount: '', billable: false, projectId: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.expenses.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load expenses'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.description || !form.amount) { toast.error('Description and amount required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.expenses.update(editing.id, { ...form, amount: Number(form.amount) }); toast.success('Updated'); }
      else { await api.expenses.create({ ...form, amount: Number(form.amount) }); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.expenses.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ date: new Date().toISOString().split('T')[0], category: 'materials', vendor: '', description: '', amount: '', billable: false, projectId: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ date: item.date?.split('T')[0] || '', category: item.category, vendor: item.vendor || '', description: item.description, amount: String(item.amount), billable: item.billable, projectId: item.projectId || '' }); setModalOpen(true); };

  const columns = [
    { key: 'date', label: 'Date', render: (v) => new Date(v).toLocaleDateString() },
    { key: 'category', label: 'Category', render: (v) => <span className="capitalize">{v}</span> },
    { key: 'vendor', label: 'Vendor' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', render: (v) => `$${Number(v).toLocaleString()}` },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
  ];

  return (
    <div>
      <PageHeader title="Expenses" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Expense</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Expense' : 'Add Expense'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Category</label><select value={form.category} onChange={(e) => setForm({...form, category: e.target.value})} className="w-full px-3 py-2 border rounded-lg">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Vendor</label><input value={form.vendor} onChange={(e) => setForm({...form, vendor: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Description *</label><input value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={form.amount} onChange={(e) => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Project</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Expense" message="Delete this expense?" confirmText="Delete" />
    </div>
  );
}
