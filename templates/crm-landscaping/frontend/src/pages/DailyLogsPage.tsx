import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

export default function DailyLogsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ date: new Date().toISOString().split('T')[0], projectId: '', weather: '', temperature: '', crewSize: '', hoursWorked: '', workPerformed: '', materials: '', delays: '', safetyNotes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, projRes] = await Promise.all([api.dailyLogs.list({ page, limit: 25 }), api.projects.list({ limit: 100 })]);
      setData(res.data); setPagination(res.pagination); setProjects(projRes.data);
    } catch (err) { toast.error('Failed to load daily logs'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.projectId) { toast.error('Project required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, temperature: form.temperature ? Number(form.temperature) : undefined, crewSize: form.crewSize ? Number(form.crewSize) : undefined, hoursWorked: form.hoursWorked ? Number(form.hoursWorked) : undefined };
      if (editing) { await api.dailyLogs.update(editing.id, payload); toast.success('Updated'); }
      else { await api.dailyLogs.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.dailyLogs.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ date: new Date().toISOString().split('T')[0], projectId: '', weather: '', temperature: '', crewSize: '', hoursWorked: '', workPerformed: '', materials: '', delays: '', safetyNotes: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ date: item.date?.split('T')[0] || '', projectId: item.projectId, weather: item.weather || '', temperature: item.temperature?.toString() || '', crewSize: item.crewSize?.toString() || '', hoursWorked: item.hoursWorked?.toString() || '', workPerformed: item.workPerformed || '', materials: item.materials || '', delays: item.delays || '', safetyNotes: item.safetyNotes || '' }); setModalOpen(true); };

  const columns = [
    { key: 'date', label: 'Date', render: (v) => new Date(v).toLocaleDateString() },
    { key: 'project', label: 'Project', render: (v) => v?.name || '-' },
    { key: 'user', label: 'Created By', render: (v) => v ? `${v.firstName} ${v.lastName}` : '-' },
    { key: 'weather', label: 'Weather' },
    { key: 'crewSize', label: 'Crew' },
    { key: 'hoursWorked', label: 'Hours' },
  ];

  return (
    <div>
      <PageHeader title="Daily Logs" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>New Log</Button>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Log' : 'New Daily Log'} size="lg">
        <div className="space-y-4">
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Date</label><input type="date" value={form.date} onChange={(e) => setForm({...form, date: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
          </div>
          <div className="grid md:grid-cols-4 gap-4">
            <div><label className="block text-sm font-medium mb-1">Weather</label><input value={form.weather} onChange={(e) => setForm({...form, weather: e.target.value})} placeholder="Sunny, Rainy..." className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Temp (°F)</label><input type="number" value={form.temperature} onChange={(e) => setForm({...form, temperature: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Crew Size</label><input type="number" value={form.crewSize} onChange={(e) => setForm({...form, crewSize: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Hours Worked</label><input type="number" value={form.hoursWorked} onChange={(e) => setForm({...form, hoursWorked: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Work Performed</label><textarea value={form.workPerformed} onChange={(e) => setForm({...form, workPerformed: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Materials Used</label><textarea value={form.materials} onChange={(e) => setForm({...form, materials: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid md:grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Delays/Issues</label><textarea value={form.delays} onChange={(e) => setForm({...form, delays: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Safety Notes</label><textarea value={form.safetyNotes} onChange={(e) => setForm({...form, safetyNotes: e.target.value})} rows={2} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Log" message="Delete this daily log?" confirmText="Delete" />
    </div>
  );
}
