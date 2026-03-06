import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Check, X as XIcon } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const inspectionTypes = ['Foundation', 'Framing', 'Electrical', 'Plumbing', 'HVAC', 'Insulation', 'Drywall', 'Final', 'Other'];

export default function InspectionsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ type: '', projectId: '', scheduledDate: '', inspector: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.inspections.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load inspections'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.type || !form.projectId) { toast.error('Type and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.inspections.update(editing.id, form); toast.success('Updated'); }
      else { await api.inspections.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.inspections.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  const handlePass = async (item) => { try { await api.inspections.pass(item.id); toast.success('Passed'); load(); } catch (err) { toast.error(err.message); } };
  const handleFail = async (item) => { try { await api.inspections.fail(item.id, { deficiencies: 'See notes' }); toast.success('Failed'); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ type: '', projectId: '', scheduledDate: '', inspector: '', notes: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ type: item.type, projectId: item.projectId, scheduledDate: item.scheduledDate?.split('T')[0] || '', inspector: item.inspector || '', notes: item.notes || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'type', label: 'Type', render: (v) => <span className="font-medium">{v}</span> },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} statusColors={{ scheduled: 'bg-blue-100 text-blue-700', passed: 'bg-green-100 text-green-700', failed: 'bg-red-100 text-red-700' }} /> },
    { key: 'scheduledDate', label: 'Scheduled', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
    { key: 'inspector', label: 'Inspector' },
  ];

  return (
    <div>
      <PageHeader title="Inspections" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Schedule Inspection</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Pass', icon: Check, onClick: handlePass },
        { label: 'Fail', icon: XIcon, onClick: handleFail },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Inspection' : 'Schedule Inspection'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Type *</label><select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{inspectionTypes.map(t => <option key={t} value={t}>{t}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Scheduled Date</label><input type="date" value={form.scheduledDate} onChange={(e) => setForm({...form, scheduledDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Inspector</label><input value={form.inspector} onChange={(e) => setForm({...form, inspector: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Notes</label><textarea value={form.notes} onChange={(e) => setForm({...form, notes: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Inspection" message={`Delete ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
