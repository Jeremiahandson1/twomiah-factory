import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function TeamPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await api.team.list({ page, limit: 25 }); setData(res.data); setPagination(res.pagination); }
    catch (err) { toast.error('Failed to load team'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined };
      if (editing) { await api.team.update(editing.id, payload); toast.success('Updated'); }
      else { await api.team.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.team.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ name: item.name, email: item.email || '', phone: item.phone || '', role: item.role || '', department: item.department || '', hourlyRate: item.hourlyRate ? String(item.hourlyRate) : '' }); setModalOpen(true); };

  const columns = [
    { key: 'name', label: 'Name', render: (v) => <span className="font-medium">{v}</span> },
    { key: 'role', label: 'Role' },
    { key: 'department', label: 'Department' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'hourlyRate', label: 'Rate', render: (v) => v ? `$${Number(v)}/hr` : '-' },
  ];

  return (
    <div>
      <PageHeader title="Team" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Member</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Member' : 'Add Member'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Role</label><input value={form.role} onChange={(e) => setForm({...form, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Department</label><input value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Phone</label><input value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Hourly Rate</label><input type="number" value={form.hourlyRate} onChange={(e) => setForm({...form, hourlyRate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Member" message={`Delete ${toDelete?.name}?`} confirmText="Delete" />
    </div>
  );
}
