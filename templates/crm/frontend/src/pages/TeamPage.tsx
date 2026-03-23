import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface TeamForm {
  name: string;
  email: string;
  phone: string;
  role: string;
  department: string;
  hourlyRate: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function TeamPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<TeamForm>({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await api.team.list({ page, limit: 25 }) as Record<string, unknown>; setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); }
    catch (err) { toast.error('Failed to load team'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined };
      if (editing) { await api.team.update(editing.id as string, payload); toast.success('Updated'); }
      else { await api.team.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.team.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };

  const openCreate = () => { setEditing(null); setForm({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ name: item.name as string, email: (item.email as string) || '', phone: (item.phone as string) || '', role: (item.role as string) || '', department: (item.department as string) || '', hourlyRate: item.hourlyRate ? String(item.hourlyRate) : '' }); setModalOpen(true); };

  const columns = [
    { key: 'name', label: 'Name', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'role', label: 'Role' },
    { key: 'department', label: 'Department' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'hourlyRate', label: 'Rate', render: (v: unknown) => v ? `$${Number(v)}/hr` : '-' },
  ];

  return (
    <div>
      <PageHeader title="Team" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Member</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Member' : 'Add Member'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Role</label><input value={form.role} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Department</label><input value={form.department} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, department: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" value={form.email} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Phone</label><input value={form.phone} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Hourly Rate</label><input type="number" value={form.hourlyRate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, hourlyRate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Member" message={`Delete ${toDelete?.name as string}?`} confirmText="Delete" />
    </div>
  );
}
