import { useState, useEffect, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { formatDate } from '../utils/date';
import { Plus, Edit, Trash2, MessageSquare } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { DataTable, StatusBadge, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

interface RFIForm {
  subject: string;
  question: string;
  projectId: string;
  priority: string;
  dueDate: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export default function RFIsPage() {
  const toast = useToast();
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<RFIForm>({ subject: '', question: '', projectId: '', priority: 'normal', dueDate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);
  const [respondOpen, setRespondOpen] = useState(false);
  const [respondRfi, setRespondRfi] = useState<Record<string, unknown> | null>(null);
  const [response, setResponse] = useState('');

  /**
   * THE PROJECT THE LINK CAME FROM. (T51 contractor: "View All ignores the project")
   *
   * ProjectDetailPage's RFIs panel shows the first five and links to `/crm/rfis?projectId=<id>`.
   * This page never read it, so View All landed on every RFI in the company. GET /api/rfis has
   * filtered on it since it was written (rfis.ts:34); only the screen never asked. The third of
   * three panels with the same link and the same omission — Jobs and Change Orders were the others.
   */
  const [searchParams, setSearchParams] = useSearchParams();
  const projectFilter = searchParams.get('projectId') || '';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Projects is its own module; switched off it answers 403 and the page simply offers no project.
      const [resRaw, projResRaw] = await Promise.all([
        api.rfis.list({ page, limit: 25, ...(projectFilter ? { projectId: projectFilter } : {}) }),
        api.projects.list({ limit: 100 }).catch(() => ({ data: [] })),
      ]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load RFIs'); }
    finally { setLoading(false); }
  }, [page, projectFilter]);

  useEffect(() => { load(); }, [load]);

  /** Arriving on page 3 of the whole company and then filtering to one project would show nothing. */
  useEffect(() => { setPage(1); }, [projectFilter]);

  const filteredProjectName = projectFilter
    ? String((projects.find((p: Record<string, unknown>) => p.id === projectFilter)?.name as string) || '')
    : '';

  const handleSave = async () => {
    if (!form.subject || !form.question || !form.projectId) { toast.error('Subject, question, and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.rfis.update(editing.id as string, form); toast.success('Updated'); }
      else { await api.rfis.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.rfis.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };

  const handleRespond = async () => {
    if (!response) { toast.error('Response required'); return; }
    try { await api.rfis.respond((respondRfi as Record<string, unknown>).id as string, { response }); toast.success('Response added'); setRespondOpen(false); load(); }
    catch (err) { toast.error((err as Error).message); }
  };

  const openCreate = (projectId = '') => { setEditing(null); setForm({ subject: '', question: '', projectId, priority: 'normal', dueDate: '' }); setModalOpen(true); };

  /**
   * `&new=true` opens the form with that project already chosen. (T51)
   *
   * ProjectDetailPage's Quick Action "Create RFI" has sent it since the panel was written and this
   * page ignored it, so the link did nothing at all: you landed on the list and had to find New RFI
   * and re-pick the project you had just been looking at. The parameter is dropped once acted on, so
   * the browser's Back button does not reopen the dialog.
   */
  useEffect(() => {
    if (searchParams.get('new') !== 'true') return;
    openCreate(projectFilter);
    const next = new URLSearchParams(searchParams); next.delete('new');
    setSearchParams(next, { replace: true });
  }, [searchParams, projectFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ subject: item.subject as string, question: item.question as string, projectId: item.projectId as string, priority: item.priority as string, dueDate: (item.dueDate as string)?.split('T')[0] || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'subject', label: 'Subject', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} /> },
    { key: 'priority', label: 'Priority', render: (v: unknown) => <StatusBadge status={v as string} statusColors={{ low: 'bg-gray-100 text-gray-700 dark:text-slate-200 dark:bg-slate-800', normal: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', high: 'bg-orange-100 text-orange-700 dark:text-orange-300 dark:bg-orange-950/40', urgent: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40' }} /> },
    { key: 'dueDate', label: 'Due', render: (v: unknown) => v ? formatDate(v as string) : '-' },
  ];

  return (
    <div>
      {/* () => openCreate(), not openCreate — the handler now takes a projectId, and passing the
          click event straight in would put a React SyntheticEvent in the form's project field. */}
      <PageHeader title="RFIs" action={<Button onClick={() => openCreate()}><Plus className="w-4 h-4 mr-2 inline"/>New RFI</Button>} />
      {/* A filter that is applied and not shown is indistinguishable from a project with no RFIs on it. */}
      {projectFilter && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg bg-orange-50 px-3 py-2 text-sm text-orange-900 dark:bg-orange-950 dark:text-orange-100">
          <span>
            Showing RFIs on <span className="font-semibold">{filteredProjectName || 'this project'}</span>
            {pagination ? ` — ${pagination.total} in total` : ''}
          </span>
          <Link to="/crm/rfis" className="font-semibold underline underline-offset-2 hover:no-underline">
            Show all RFIs
          </Link>
        </div>
      )}
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={[
        { label: 'Edit', icon: Edit, onClick: openEdit },
        { label: 'Respond', icon: MessageSquare, onClick: (r: Record<string, unknown>) => { setRespondRfi(r); setResponse((r.response as string) || ''); setRespondOpen(true); } },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' },
      ]} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit RFI' : 'New RFI'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Subject *</label><input value={form.subject} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, subject: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Question *</label><textarea value={form.question} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, question: e.target.value})} rows={4} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Priority</label><select value={form.priority} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, priority: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option></select></div>
            <div><label className="block text-sm font-medium mb-1">Due Date</label><input type="date" value={form.dueDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, dueDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <Modal isOpen={respondOpen} onClose={() => setRespondOpen(false)} title="Respond to RFI" size="md">
        <div className="space-y-4">
          <div className="p-3 bg-gray-50 rounded-lg dark:bg-slate-900"><p className="font-medium">{respondRfi?.subject as string}</p><p className="text-sm text-gray-600 mt-1 dark:text-slate-400">{respondRfi?.question as string}</p></div>
          <div><label className="block text-sm font-medium mb-1">Response *</label><textarea value={response} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setResponse(e.target.value)} rows={4} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setRespondOpen(false)} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button><Button onClick={handleRespond}>Submit Response</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete RFI" message={`Delete ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
