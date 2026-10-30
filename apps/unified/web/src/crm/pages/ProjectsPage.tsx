// Moved from templates/crm/frontend/src/pages/ProjectsPage.tsx.
import { useState, useEffect, useCallback } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Plus, Edit, Trash2, Search, Copy } from 'lucide-react'
import { api } from '../../api'
import { useToast } from '../../shared'
import { useAuth } from '../../shared'
import { DataTable, StatusBadge, PageHeader, Button } from '../ui/DataTable'
import { Modal, ConfirmModal } from '../ui/Modal'
import { money } from '@twomiah/tenant-ui/src/money'
import { CUSTOMER_PICKER_PARAMS, customersOnly } from '@twomiah/tenant-ui/src/contacts/types'

interface ProjectForm {
  name: string;
  description: string;
  status: string;
  type: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  startDate: string;
  endDate: string;
  estimatedValue: string;
  budget: string;
  contactId: string;
  notes: string;
  [key: string]: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const statuses = ['planning', 'active', 'on_hold', 'completed', 'cancelled'];
const types = ['residential', 'commercial', 'renovation', 'new_construction'];

const initialForm: ProjectForm = { name: '', description: '', status: 'planning', type: '', address: '', city: '', state: '', zip: '', startDate: '', endDate: '', estimatedValue: '', budget: '', contactId: '', notes: '' };

export default function ProjectsPage() {
  const toast = useToast();
  // Every write on this page asks projects:create|update|delete on the server (routes/projects.ts); the
  // read-only seat was offered all of them. Same `can` the Change Orders and Bids pages ask. (T43 viewer round, T68)
  const { can, hasFeature } = useAuth();
  // Project templates (feature project_templates): start from one, save a project as one. Both gated server-side the same way.
  const templatesOn = hasFeature('project_templates') && can('projects:read');
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  // Detail pages link here as /crm/projects?edit=<id>. Open that record's edit
  // modal (fetched by id), then clear the param.
  useEffect(() => {
    const editId = searchParams.get('edit');
    if (!editId || !can('projects:update')) return;
    let cancelled = false;
    api.projects.get(editId).then((item: unknown) => {
      if (cancelled || !item) return;
      openEdit(item as Record<string, unknown>);
      searchParams.delete('edit');
      setSearchParams(searchParams, { replace: true });
    }).catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [contacts, setContacts] = useState<Record<string, unknown>[]>([]);
  // The contact a project is being started for from the Lead Inbox, kept apart from the picker's list so a reload of that list cannot drop them.
  const [startContact, setStartContact] = useState<Record<string, unknown> | null>(null);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<ProjectForm>(initialForm);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);
  const [templates, setTemplates] = useState<Array<{ id: string; name: string; taskCount: number; punchItemCount: number }>>([]);
  const [templateId, setTemplateId] = useState('');
  // "Save as template": the project being saved, and the name asked for.
  const [saveFrom, setSaveFrom] = useState<Record<string, unknown> | null>(null);
  const [templateName, setTemplateName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: Record<string, string | number> = { page, limit: 25 };
      if (search) params.search = search;
      if (statusFilter) params.status = statusFilter;
      const [resRaw, contactsResRaw] = await Promise.all([api.projects.list(params), api.contacts.list({ limit: 100, ...CUSTOMER_PICKER_PARAMS })]);
      const res = resRaw as Record<string, unknown>; const contactsRes = contactsResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]);
      setPagination(res.pagination as PaginationData | null);
      // A project's client: customers only (contacts/types.ts CUSTOMER_PICKER_PARAMS).
      setContacts(customersOnly((contactsRes.data || []) as Array<Record<string, unknown> & { id: string; type?: string | null }>));
    } catch (err) { toast.error('Failed to load projects'); }
    finally { setLoading(false); }
  }, [page, search, statusFilter]);

  useEffect(() => { load(); }, [load]);
  const loadTemplates = useCallback(() => {
    if (!templatesOn) return;
    api.get('/api/project-templates').then((r: any) => setTemplates(r?.data || [])).catch(() => setTemplates([]));
  }, [templatesOn]);
  useEffect(() => { loadTemplates(); }, [loadTemplates]);
  useEffect(() => { setPage(1); }, [search, statusFilter]);

  const openCreate = (contactId = '') => { setEditing(null); setTemplateId(''); setForm({ ...initialForm, contactId }); setModalOpen(true); };

  // A lead that has just become a contact starts a project from the Lead Inbox (/crm/projects?new=1&contactId=…): the form
  // opens with that person chosen. Their record is fetched if the first page of the picker does not hold them.
  useEffect(() => {
    if (searchParams.get('new') !== '1' || !can('projects:create')) return;
    const contactId = searchParams.get('contactId') || '';
    let cancelled = false;
    const finish = () => {
      if (cancelled) return;
      openCreate(contactId);
      searchParams.delete('new'); searchParams.delete('contactId');
      setSearchParams(searchParams, { replace: true });
    };
    if (!contactId) { finish(); return () => { cancelled = true; }; }
    api.contacts.get(contactId).then((row: unknown) => {
      if (cancelled || !row) return;
      setStartContact(row as Record<string, unknown>);
    }).catch(() => {}).finally(finish);
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ ...initialForm, ...(item as unknown as ProjectForm), startDate: (item.startDate as string)?.split('T')[0] || '', endDate: (item.endDate as string)?.split('T')[0] || '', estimatedValue: (item.estimatedValue as string) || '', budget: (item.budget as string) || '' }); setModalOpen(true); };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, estimatedValue: form.estimatedValue ? Number(form.estimatedValue) : undefined, budget: form.budget ? Number(form.budget) : undefined };
      if (editing) { await api.projects.update(editing.id as string, payload); toast.success('Project updated'); }
      else if (templateId) {
        const r: any = await api.post(`/api/project-templates/${templateId}/start`, payload);
        const got = r?.copied || { tasks: 0, punchItems: 0 };
        toast.success(`Project created from the template — ${got.tasks} schedule ${got.tasks === 1 ? 'task' : 'tasks'}, ${got.punchItems} punch ${got.punchItems === 1 ? 'item' : 'items'}`);
        if (r?.leftOut?.length) toast.error(`Not copied: ${r.leftOut.join('; ')}`);
      }
      else { await api.projects.create(payload); toast.success('Project created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const saveTemplate = async () => {
    if (!saveFrom || !templateName.trim()) { toast.error('Name the template'); return; }
    try {
      const r: any = await api.post('/api/project-templates/from-project', { projectId: saveFrom.id, name: templateName.trim() });
      toast.success(`Saved "${r?.name || templateName.trim()}" — ${r?.taskCount ?? 0} schedule ${r?.taskCount === 1 ? 'task' : 'tasks'}, ${r?.punchItemCount ?? 0} punch ${r?.punchItemCount === 1 ? 'item' : 'items'}`);
      if (r?.punchListLeftOut) toast.error('The punch list was left out — you cannot read punch lists, or Punch Lists is off.');
      setSaveFrom(null); setTemplateName(''); loadTemplates();
    } catch (err) { toast.error((err as Error).message); }
  };

  const handleDelete = async () => {
    try { await api.projects.delete((toDelete as Record<string, unknown>).id as string); toast.success('Project deleted'); setDeleteOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const columns = [
    { key: 'number', label: 'Number', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'name', label: 'Name', render: (v: unknown, r: Record<string, unknown>) => <div><p className="font-medium">{v as string}</p>{!!r.contact && <p className="text-sm text-gray-500 dark:text-slate-400">{(r.contact as Record<string, unknown>).name as string}</p>}</div> },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'type', label: 'Type', render: (v: unknown) => (v as string) || '-' },
    { key: 'estimatedValue', label: 'Value', render: (v: unknown) => v ? `${money(Number(v))}` : '-' },
    { key: 'progress', label: 'Progress', render: (v: unknown) => <div className="w-20 h-2 bg-gray-200 rounded-full dark:bg-slate-700 dark:text-slate-100"><div className="h-full bg-orange-500 rounded-full" style={{width:`${v}%`}}/></div> },
  ];

  return (
    <div>
      <PageHeader title="Projects" action={can('projects:create') ? <Button onClick={() => openCreate()}><Plus className="w-4 h-4 mr-2 inline"/>Add Project</Button> : undefined} />
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
      <DataTable data={data} emptyMessage="No projects yet. Create one to group the jobs, change orders and RFIs for a piece of work." columns={columns} loading={loading} pagination={pagination} onPageChange={setPage}
        onRowClick={(row: Record<string, unknown>) => navigate(`/crm/projects/${row.id}`)}
        actions={[{ label: 'Edit', icon: Edit, onClick: openEdit, show: () => can('projects:update') }, { label: 'Save as template', icon: Copy, onClick: (r: Record<string, unknown>) => { setSaveFrom(r); setTemplateName(`${r.name as string} template`); }, show: () => templatesOn && can('projects:update') }, { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600', show: () => can('projects:delete') }]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Project' : 'New Project'} size="lg">
        <div className="grid md:grid-cols-2 gap-4">
          {!editing && templatesOn && templates.length > 0 && can('projects:create') && (
            <div className="md:col-span-2">
              <label className="block text-sm font-medium mb-1" htmlFor="project-template">Start from a template</label>
              <select id="project-template" value={templateId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => {
                const id = e.target.value; setTemplateId(id);
                const t = templates.find((x) => x.id === id);
                // the template's name is a fair first name for the project, until the person types their own
                if (t && !form.name.trim()) setForm({ ...form, name: t.name.replace(/ template$/i, '') });
              }} className="w-full px-3 py-2 border rounded-lg">
                <option value="">Blank project</option>
                {templates.map((t) => <option key={t.id} value={t.id}>{t.name} — {t.taskCount} {t.taskCount === 1 ? 'task' : 'tasks'}, {t.punchItemCount} punch {t.punchItemCount === 1 ? 'item' : 'items'}</option>)}
              </select>
              {templateId && <p className="mt-1 text-xs text-gray-600 dark:text-slate-300">The schedule is placed from the start date below{form.startDate ? '' : ' — pick one to give the tasks dates'}.</p>}
            </div>
          )}
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Status</label><select value={form.status} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, status: e.target.value})} className="w-full px-3 py-2 border rounded-lg">{statuses.map(s => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Type</label><select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, type: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{types.map(t => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Client</label><select value={form.contactId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, contactId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{[...contacts, ...(startContact && !contacts.some((c) => c.id === startContact.id) ? [startContact] : [])].filter((c: Record<string, unknown>) => c.type === 'client' || (!!form.contactId && c.id === form.contactId)).map((c: Record<string, unknown>) => <option key={c.id as string} value={c.id as string}>{c.name as string}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Estimated Value</label><input type="number" value={form.estimatedValue} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, estimatedValue: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Budget</label><input type="number" value={form.budget} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, budget: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Start Date</label><input type="date" value={form.startDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, startDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">End Date</label><input type="date" value={form.endDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, endDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Address</label><input value={form.address} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, address: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">City</label><input value={form.city} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, city: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4"><div><label className="block text-sm font-medium mb-1">State</label><input value={form.state} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, state: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div><div><label className="block text-sm font-medium mb-1">ZIP</label><input value={form.zip} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, zip: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div></div>
          <div className="md:col-span-2"><label className="block text-sm font-medium mb-1">Description</label><textarea value={form.description} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, description: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : editing ? 'Update' : 'Create'}</Button></div>
      </Modal>
      <Modal isOpen={!!saveFrom} onClose={() => setSaveFrom(null)} title="Save as template" size="md">
        <p className="mb-3 text-sm text-gray-700 dark:text-slate-200">Keeps this project's schedule (phases, milestones and tasks, by days from the start) and its punch list as a starting point. Who was assigned, progress, money and documents are not kept.</p>
        <label className="block text-sm font-medium mb-1" htmlFor="template-name">Template name</label>
        <input id="template-name" value={templateName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setTemplateName(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setSaveFrom(null)} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button><Button onClick={saveTemplate}>Save template</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Project" message={`Delete "${toDelete?.name as string}"?`} confirmText="Delete" />
    </div>
  );
}
