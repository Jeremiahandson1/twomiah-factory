import { useNavigate } from 'react-router-dom';
import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2, Search, Play, CheckCircle } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface JobForm {
  title: string;
  description: string;
  status: string;
  priority: string;
  type: string;
  scheduledDate: string;
  scheduledTime: string;
  estimatedHours: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  projectId: string;
  contactId: string;
  assignedToId: string;
  notes: string;
  [key: string]: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const statuses = ['scheduled', 'dispatched', 'in_progress', 'completed', 'cancelled'];
const priorities = ['low', 'normal', 'high', 'urgent'];
const initialForm: JobForm = { title: '', description: '', status: 'scheduled', priority: 'normal', type: '', scheduledDate: '', scheduledTime: '', estimatedHours: '', address: '', city: '', state: '', zip: '', projectId: '', contactId: '', assignedToId: '', notes: '' };

export default function JobsPage() {
  const toast = useToast();
  const navigate = useNavigate();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  const [useAddressOnFile, setUseAddressOnFile] = useState(false);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<JobForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const res = await api.jobs.list(params) as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as PaginationData | null);
      // Load projects/contacts separately so failures don't block jobs
      const [projRes, contRes] = await Promise.all([
        api.projects.list({ limit: 100 }).catch(() => ({ data: [] })),
        api.contacts.list({ limit: 100 }).catch(() => ({ data: [] })),
      ]) as Record<string, unknown>[];
      setProjects(projRes.data as Record<string, unknown>[]);
      setContacts(contRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load jobs'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openCreate = () => { setEditing(null); setForm(initialForm); setUseAddressOnFile(false); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ ...initialForm, ...(item as unknown as JobForm), scheduledDate: (item.scheduledDate as string)?.split('T')[0] || '', estimatedHours: (item.estimatedHours as string) || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.title.trim()) { toast.error('Title is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, estimatedHours: form.estimatedHours ? Number(form.estimatedHours) : undefined };
      if (editing) { await api.jobs.update(editing.id as string, payload); toast.success('Job updated'); }
      else { await api.jobs.create(payload); toast.success('Job created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => {
    try { await api.jobs.delete((toDelete as Record<string, unknown>).id as string); toast.success('Job deleted'); setDeleteOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const handleStart = async (job: Record<string, unknown>) => {
    try { await api.jobs.start(job.id as string); toast.success('Job started'); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const handleComplete = async (job: Record<string, unknown>) => {
    try { await api.jobs.complete(job.id as string); toast.success('Job completed'); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'title', label: 'Title', render: (v: unknown, r: Record<string, unknown>) => <div><p className="font-medium">{v as string}</p>{!!r.contact && <p className="text-sm text-gray-500">{(r.contact as Record<string, unknown>).name as string}</p>}</div> },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'priority', label: 'Priority', render: (v: unknown) => <StatusBadge status={v as string} statusColors={{ low: 'bg-gray-100 text-gray-700', normal: 'bg-blue-100 text-blue-700', high: 'bg-orange-100 text-orange-700', urgent: 'bg-red-100 text-red-700' }} /> },
    { key: 'scheduledDate', label: 'Scheduled', render: (v: unknown) => v ? new Date((v as string).split('T')[0] + 'T00:00:00').toLocaleDateString() : '-' },
    { key: 'assignedTo', label: 'Assigned To', render: (v: unknown) => v ? `${(v as Record<string, unknown>).firstName} ${(v as Record<string, unknown>).lastName}` : '-' },
  ];

  const actions = [
    { label: 'Edit', icon: Edit, onClick: openEdit },
    { label: 'Start', icon: Play, onClick: handleStart },
    { label: 'Complete', icon: CheckCircle, onClick: handleComplete },
    { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
  ];

  return (
    <div>
      <PageHeader title="Jobs" action={<Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Job</Button>} />
      <div className="mb-4 flex gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search..." value={search} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border rounded-lg" />
        </div>
        <select value={statusFilter} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setStatusFilter(e.target.value)} className="px-4 py-2 border rounded-lg">
          <option value="">All Status</option>
          {statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
        </select>
      </div>
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} onRowClick={(row: Record<string, unknown>) => navigate(`/crm/jobs/${row.id}`)} actions={actions} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Job' : 'New Job'} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Title *</label><input value={form.title} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, title: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Status</label><select value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-slate-100 dark:bg-slate-800 dark:border-slate-600">{statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Priority</label><select value={form.priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, priority: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-gray-900 dark:text-slate-100 dark:bg-slate-800 dark:border-slate-600">{priorities.map(p => <option key={p} value={p}>{p}</option>)}</select></div>
          {projects.length > 0 && <div><label className="block text-sm font-medium mb-1">Project</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-gray-900"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>}
          <div><label className="block text-sm font-medium mb-1">Contact</label><select value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const selectedContact = contacts.find((c: Record<string, unknown>) => c.id === e.target.value);
                const hasAddress = selectedContact?.address || selectedContact?.city;
                setForm({
                  ...form,
                  contactId: e.target.value,
                  ...(hasAddress ? {
                    address: (selectedContact?.address as string) || '',
                    city: (selectedContact?.city as string) || '',
                    state: (selectedContact?.state as string) || '',
                    zip: (selectedContact?.zip as string) || '',
                  } : {})
                });
                setUseAddressOnFile(!!hasAddress);
              }} className="w-full px-3 py-2 border rounded-lg text-gray-900"><option value="">Select...</option>{contacts.map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Scheduled Date</label><input type="date" value={form.scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, scheduledDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Scheduled Time</label><input type="time" value={form.scheduledTime} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, scheduledTime: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Estimated Hours</label><input type="number" value={form.estimatedHours} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, estimatedHours: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="md:col-span-2">
                <div className="flex items-center justify-between mb-1">
                  <label className="block text-sm font-medium">Address</label>
                  {useAddressOnFile && (
                    <button
                      type="button"
                      onClick={() => setUseAddressOnFile(false)}
                      className="text-xs text-orange-500 hover:text-orange-600"
                    >
                      Using address on file — Use different address?
                    </button>
                  )}
                </div>
                <input
                  value={form.address}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) => { setUseAddressOnFile(false); setForm({...form, address: e.target.value}); }}
                  className="w-full px-3 py-2 border rounded-lg text-gray-900"
                  placeholder={useAddressOnFile ? 'From contact on file' : 'Street address'}
                />
              </div>
          <div><label className="block text-sm font-medium mb-1">City</label><input value={form.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, city: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-1">State</label><input value={form.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, state: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div><div><label className="block text-sm font-medium mb-1">ZIP</label><input value={form.zip} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, zip: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Notes</label><textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, notes: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Job" message={`Delete "${toDelete?.title as string}"?`} confirmText="Delete" />
    </div>
  );
}
