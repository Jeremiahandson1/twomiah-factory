import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Check, CheckCheck } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface PunchListForm {
  description: string;
  projectId: string;
  location: string;
  priority: string;
  assignedTo: string;
  dueDate: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function PunchListsPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<PunchListForm>({ description: '', projectId: '', location: '', priority: 'normal', assignedTo: '', dueDate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [resRaw, projResRaw] = await Promise.all([api.punchLists.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      const items = (res.data as Record<string, unknown>[]).map((d: Record<string, unknown>) => d.punchListItem ? { ...(d.punchListItem as Record<string, unknown>), project: d.project } : d);
      setData(items); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load punch list'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.description || !form.projectId) { toast.error('Description and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.punchLists.update(editing.id as string, form); toast.success('Updated'); }
      else { await api.punchLists.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.punchLists.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleComplete = async (item: Record<string, unknown>) => { try { await api.punchLists.complete(item.id as string); toast.success('Completed'); load(); } catch (err) { toast.error((err as Error).message); } };
  const handleVerify = async (item: Record<string, unknown>) => { try { await api.punchLists.verify(item.id as string, { verifiedBy: 'Current User' }); toast.success('Verified'); load(); } catch (err) { toast.error((err as Error).message); } };

  const openCreate = () => { setEditing(null); setForm({ description: '', projectId: '', location: '', priority: 'normal', assignedTo: '', dueDate: '' }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ description: item.description as string, projectId: item.projectId as string, location: (item.location as string) || '', priority: item.priority as string, assignedTo: (item.assignedTo as string) || '', dueDate: (item.dueDate as string)?.split('T')[0] || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'description', label: 'Description', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'location', label: 'Location' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'priority', label: 'Priority', render: (v: unknown) => <StatusBadge status={v as string} statusColors={{ low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' }} /> },
  ];

  return (
    <div>
      <PageHeader title="Punch Lists" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Item</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Complete', icon: Check, onClick: handleComplete },
        { label: 'Verify', icon: CheckCheck, onClick: handleVerify },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Item' : 'Add Item'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Description *</label><textarea value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, description: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Location</label><input value={form.location} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, location: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Priority</label><select value={form.priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, priority: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Assigned To</label><input value={form.assignedTo} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, assignedTo: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Item" message={`Delete ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
