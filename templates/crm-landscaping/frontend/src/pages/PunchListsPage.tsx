import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Check, CheckCheck } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function PunchListsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ description: '', projectId: '', location: '', priority: 'normal', assignedTo: '', dueDate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.punchLists.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load punch list'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.description || !form.projectId) { toast.error('Description and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.punchLists.update(editing.id, form); toast.success('Updated'); }
      else { await api.punchLists.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.punchLists.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  const handleComplete = async (item) => { try { await api.punchLists.complete(item.id); toast.success('Completed'); load(); } catch (err) { toast.error(err.message); } };
  const handleVerify = async (item) => { try { await api.punchLists.verify(item.id, { verifiedBy: 'Current User' }); toast.success('Verified'); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ description: '', projectId: '', location: '', priority: 'normal', assignedTo: '', dueDate: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ description: item.description, projectId: item.projectId, location: item.location || '', priority: item.priority, assignedTo: item.assignedTo || '', dueDate: item.dueDate?.split('T')[0] || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'description', label: 'Description', render: (v) => <span className="font-medium">{v}</span> },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'priority', label: 'Priority', render: (v) => <StatusBadge status={v} statusColors={{ low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' }} /> },
  ];

  return (
    <div>
      <PageHeader title="Punch Lists" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Item</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Complete', icon: Check, onClick: handleComplete },
        { label: 'Verify', icon: CheckCheck, onClick: handleVerify },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Item' : 'Add Item'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Description *</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Location</label><input value={form.location} onChange={(e) => setForm({...form, location: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Priority</label><select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Assigned To</label><input value={form.assignedTo} onChange={(e) => setForm({...form, assignedTo: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Item" message={`Delete ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
