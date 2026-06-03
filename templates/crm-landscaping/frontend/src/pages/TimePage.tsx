import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function TimePage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], hours: '', description: '', billable: true, projectId: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.time.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load time entries'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.hours) { toast.error('Hours required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.time.update(editing.id, { ...form, hours: Number(form.hours) }); toast.success('Updated'); }
      else { await api.time.create({ ...form, hours: Number(form.hours) }); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.time.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ date: new Date().toISOString().split('T')[0], hours: '', description: '', billable: true, projectId: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ date: item.date?.split('T')[0] || '', hours: String(item.hours), description: item.description || '', billable: item.billable, projectId: item.projectId || '' }); setModalOpen(true); };

  const columns = [
    { key: 'date', label: 'Date', render: (v) => new Date(v).toLocaleDateString() },
    { key: 'user', label: 'User', render: (v) => v ? `${v.firstName} ${v.lastName}` : '-' },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'hours', label: 'Hours', render: (v) => Number(v).toFixed(1) },
    { key: 'description', label: 'Description' },
    { key: 'billable', label: 'Billable', render: (v) => v ? <span className="text-green-600">Yes</span> : <span className="text-gray-400">No</span> },
  ];

  return (
    <div>
      <PageHeader title="Time Tracking" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Log Time</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Time Entry' : 'Log Time'} size="md">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Hours *</label><input type="number" step="0.5" value={form.hours} onChange={(e) => setForm({...form, hours: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Project</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.billable} onChange={(e) => setForm({...form, billable: e.target.checked})} className="rounded" /><span className="text-sm">Billable</span></label>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Entry" message="Delete this time entry?" confirmText="Delete" />
    </div>
  );
}
