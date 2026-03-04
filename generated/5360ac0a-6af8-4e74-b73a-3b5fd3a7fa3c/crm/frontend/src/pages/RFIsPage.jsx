import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, MessageSquare } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function RFIsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ subject: '', question: '', projectId: '', priority: 'normal', dueDate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);
  const [respondOpen, setRespondOpen] = useState(false);
  const [respondRfi, setRespondRfi] = useState(null);
  const [response, setResponse] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.rfis.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load RFIs'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.subject || !form.question || !form.projectId) { toast.error('Subject, question, and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.rfis.update(editing.id, form); toast.success('Updated'); }
      else { await api.rfis.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.rfis.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };
  
  const handleRespond = async () => {
    if (!response) { toast.error('Response required'); return; }
    try { await api.rfis.respond(respondRfi.id, { response, respondedBy: 'Current User' }); toast.success('Response added'); setRespondOpen(false); load(); }
    catch (err) { toast.error(err.message); }
  };

  const openCreate = () => { setEditing(null); setForm({ subject: '', question: '', projectId: '', priority: 'normal', dueDate: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ subject: item.subject, question: item.question, projectId: item.projectId, priority: item.priority, dueDate: item.dueDate?.split('T')[0] || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'subject', label: 'Subject', render: (v) => <span className="font-medium">{v}</span> },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'priority', label: 'Priority', render: (v) => <StatusBadge status={v} statusColors={{ low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' }} /> },
    { key: 'dueDate', label: 'Due', render: (v) => v ? new Date(v).toLocaleDateString() : '-' },
  ];

  return (
    <div>
      <PageHeader title="RFIs" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New RFI</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Respond', icon: MessageSquare, onClick: (r) => { setRespondRfi(r); setResponse(r.response || ''); setRespondOpen(true); } },
        { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit RFI' : 'New RFI'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Subject *</label><input value={form.subject} onChange={(e) => setForm({...form, subject: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Question *</label><textarea value={form.question} onChange={(e) => setForm({...form, question: e.target.value})} rows={4} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Priority</label><select value={form.priority} onChange={(e) => setForm({...form, priority: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <Modal isOpen={respondOpen} onClose={() => setRespondOpen(false)} title="Respond to RFI" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg"><p className="font-medium">{respondRfi?.subject}</p><p className="text-sm text-gray-600 mt-1">{respondRfi?.question}</p></div>
          <div><label className="block text-sm font-medium mb-1">Response *</label><textarea value={response} onChange={(e) => setResponse(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setRespondOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleRespond}>Submit Response</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete RFI" message={`Delete ${toDelete?.number}?`} confirmText="Delete" />
    </div>
  );
}
