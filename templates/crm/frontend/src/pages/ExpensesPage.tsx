import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface ExpenseForm {
  date: string;
  category: string;
  vendor: string;
  description: string;
  amount: string;
  billable: boolean;
  projectId: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const categories = ['materials', 'equipment', 'labor', 'travel', 'other'];

export default function ExpensesPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<ExpenseForm>({ date: new Date().toISOString().split('T')[0], category: 'materials', vendor: '', description: '', amount: '', billable: false, projectId: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resRaw, projResRaw] = await Promise.all([api.expenses.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load expenses'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.description || !form.amount) { toast.error('Description and amount required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.expenses.update(editing.id as string, { ...form, amount: Number(form.amount) }); toast.success('Updated'); }
      else { await api.expenses.create({ ...form, amount: Number(form.amount) }); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.expenses.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };

  const openCreate = () => { setEditing(null); setForm({ date: new Date().toISOString().split('T')[0], category: 'materials', vendor: '', description: '', amount: '', billable: false, projectId: '' }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ date: (item.date as string)?.split('T')[0] || '', category: item.category as string, vendor: (item.vendor as string) || '', description: item.description as string, amount: String(item.amount), billable: item.billable as boolean, projectId: (item.projectId as string) || '' }); setModalOpen(true); };

  const columns = [
    { key: 'date', label: 'Date', render: (v: unknown) => new Date(v as string).toLocaleDateString() },
    { key: 'category', label: 'Category', render: (v: unknown) => <span className="capitalize">{v as string}</span> },
    { key: 'vendor', label: 'Vendor' },
    { key: 'description', label: 'Description' },
    { key: 'amount', label: 'Amount', render: (v: unknown) => `$${Number(v).toLocaleString()}` },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
  ];

  return (
    <div>
      <PageHeader title="Expenses" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Expense</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Expense' : 'Add Expense'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={form.date} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Category</label><select value={form.category} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, category: e.target.value})} className="w-full px-3 py-2 border rounded-lg">{categories.map(c => <option key={c} value={c}>{c}</option>)}</select></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Vendor</label><input value={form.vendor} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, vendor: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Description *</label><input value={form.description} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, description: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Amount *</label><input type="number" value={form.amount} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, amount: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Project</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Expense" message="Delete this expense?" confirmText="Delete" />
    </div>
  );
}
