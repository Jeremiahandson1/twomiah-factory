import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Search } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

const statuses = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const types = ['residential', 'commercial', 'renovation', 'new_construction'];

const initialForm = { name: '', description: '', status: 'planning', type: '', address: '', city: '', state: '', zip: '', startDate: '', endDate: '', estimatedValue: '', budget: '', contactId: '', notes: '' };

export default function ProjectsPage() {
  const toast = useToast();
  const [data, setData] = useState([]);
  const [contacts, setContacts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(initialForm);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const [res, contactsRes] = await Promise.all([api.projects.list(params), api.contacts.list({ limit: 100 })]);
      setData(res.data);
      setPagination(res.pagination);
      setContacts(contactsRes.data);
    } catch (err) { toast.error('Failed to load projects'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openCreate = () => { setEditing(null); setForm(initialForm); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ ...initialForm, ...item, startDate: item.startDate?.split('T')[0] || '', endDate: item.endDate?.split('T')[0] || '', estimatedValue: item.estimatedValue || '', budget: item.budget || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined, budget: form.budget ? Number(form.budget) : undefined };
      if (editing) { await api.projects.update(editing.id, payload); toast.success('Project updated'); }
      else { await api.projects.create(payload); toast.success('Project created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try { await api.projects.delete(toDelete.id); toast.success('Project deleted'); setDeleteOpen(false); load(); }
    catch (err) { toast.error(err.message); }
  };

  const columns = [
    { key: 'number', label: 'Number', render: (v) => <span className="font-mono text-sm">{v}</span> },
    { key: 'name', label: 'Name', render: (v, r) => <div><p className="font-medium">{v}</p>{r.contact && <p className="text-sm text-gray-500">{r.contact.name}</p>}</div> },
    { key: 'status', label: 'Status', render: (v) => <StatusBadge status={v} /> },
    { key: 'type', label: 'Type', render: (v) => v || '-' },
    { key: 'estimatedValue', label: 'Value', render: (v) => v ? `$${Number(v).toLocaleString()}` : '-' },
    { key: 'progress', label: 'Progress', render: (v) => <div className="w-20 h-2 bg-gray-200 rounded-full"><div className="h-full bg-orange-500 rounded-full" style={{width:`${v}%`}}/></div> },
  ];

  return (
    <div>
      <PageHeader title="Projects" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Project</Button>} />
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="px-4 py-2 border rounded-lg">
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage}
        actions={[{ label: 'Edit', icon: Edit, onClick: openEdit }, { label: 'Delete', icon: Trash2, onClick: (r) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Project' : 'New Project'} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Status</label><select value={form.status} onChange={(e) => setForm({...form, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">{statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Type</label><select value={form.type} onChange={(e) => setForm({...form, type: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{types.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Client</label><select value={form.contactId} onChange={(e) => setForm({...form, contactId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{contacts.filter(c => c.type === 'client').map(c => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Estimated Value</label><input type="number" value={form.estimatedValue} onChange={(e) => setForm({...form, estimatedValue: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Budget</label><input type="number" value={form.budget} onChange={(e) => setForm({...form, budget: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Start Date</label><input type="date" value={form.startDate} onChange={(e) => setForm({...form, startDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">End Date</label><input type="date" value={form.endDate} onChange={(e) => setForm({...form, endDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Address</label><input value={form.address} onChange={(e) => setForm({...form, address: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">City</label><input value={form.city} onChange={(e) => setForm({...form, city: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-1">State</label><input value={form.state} onChange={(e) => setForm({...form, state: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div><div><label className="block text-sm font-medium mb-1">ZIP</label><input value={form.zip} onChange={(e) => setForm({...form, zip: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={(e) => setForm({...form, description: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Project" message={`Delete "${toDelete?.name}"?`} confirmText="Delete" />
    </div>
  );
}
