// Moved from templates/crm/frontend/src/pages/InspectionsPage.tsx.
import { useState, useEffect, useCallback } from 'react'
import { formatDate } from '../date'
import { Plus, Edit, Trash2, Check, X as XIcon, RotateCcw, ListChecks } from 'lucide-react'
import { api } from '../../api'
import { useToast } from '../../shared'
import { useAuth } from '../../shared'
import { DataTable, StatusBadge, PageHeader, Button } from '../ui/DataTable'
import { Modal, ConfirmModal } from '../ui/Modal'
import { codeLabel } from '@twomiah/tenant-ui/src/labels/codes'
import { ChecklistModal, ChecklistTemplatesModal } from './InspectionChecklist'

/**
 * While an inspection has no result. Kept in step with RESULTABLE in routes/inspections.ts: a result
 * is recorded once, so offering Pass on something already passed is a button that can only fail.
 */
const AWAITING = ['scheduled', 'in_progress', 'rescheduled'];

interface InspectionForm {
  type: string;
  projectId: string;
  scheduledDate: string;
  inspector: string;
  notes: string;
}

interface PaginationData {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

const inspectionTypes = ['Foundation', 'Framing', 'Electrical', 'Plumbing', 'HVAC', 'Insulation', 'Drywall', 'Final', 'Other'];

export default function InspectionsPage() {
  const toast = useToast();
  // Every write on this page asks inspections:create|update|delete on the server (routes/inspections.ts); the
  // read-only seat was offered all of them. Same `can` the Change Orders and Bids pages ask. (T43 viewer round, T68)
  const { can, hasFeature } = useAuth();
  // Checklists (feature inspection_checklists): a list of lines to answer on each visit, and the saved checklists to start from.
  const checklistsOn = hasFeature('inspection_checklists') && can('inspections:read');
  const [checklistFor, setChecklistFor] = useState<Record<string, unknown> | null>(null);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [data, setData] = useState<Record<string, unknown>[]>([]);
  const [projects, setProjects] = useState<Record<string, unknown>[]>([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState<PaginationData | null>(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Record<string, unknown> | null>(null);
  const [form, setForm] = useState<InspectionForm>({ type: '', projectId: '', scheduledDate: '', inspector: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState<Record<string, unknown> | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Projects is its own module; switched off it answers 403 and the page simply offers no project.
      const [resRaw, projResRaw] = await Promise.all([api.inspections.list({ page, limit: 25 }), api.projects.list({ limit: 100 }).catch(() => ({ data: [] }))]);
      const res = resRaw as Record<string, unknown>; const projRes = projResRaw as Record<string, unknown>;
      setData(res.data as Record<string, unknown>[]); setPagination(res.pagination as PaginationData | null); setProjects(projRes.data as Record<string, unknown>[]);
    } catch (err) { toast.error('Failed to load inspections'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.type || !form.projectId) { toast.error('Type and project required'); return; }
    setSaving(true);
    try {
      if (editing) { await api.inspections.update(editing.id as string, form); toast.success('Updated'); }
      else { await api.inspections.create(form); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.inspections.delete((toDelete as Record<string, unknown>).id as string); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error((err as Error).message); } };
  const handlePass = async (item: Record<string, unknown>) => { try { await api.inspections.pass(item.id as string); toast.success('Passed'); load(); } catch (err) { toast.error((err as Error).message); } };
  /**
   * FAILING ASKS WHAT FAILED. (T32 M1)
   *
   * This used to post the literal string "See notes" as the deficiency list on every fail, so the
   * one field that carries what has to be put right said nothing — and the notes it pointed at were
   * usually empty too. The server refuses it now; this is the dialog that makes the refusal moot.
   */
  const [failing, setFailing] = useState<Record<string, unknown> | null>(null);
  const [deficiencies, setDeficiencies] = useState('');
  const [failSaving, setFailSaving] = useState(false);
  // A visit whose checklist has failed lines already says what failed: leave this empty and the lines are the list.
  const failedFromChecklist = checklistsOn && Number(((failing?.checklist as { failed?: number } | undefined)?.failed) || 0) > 0;
  const submitFail = async () => {
    if (!failing) return;
    setFailSaving(true);
    try {
      await api.inspections.fail(failing.id as string, { deficiencies });
      toast.success('Failed');
      setFailing(null); setDeficiencies(''); load();
    } catch (err) { toast.error((err as Error).message); }
    finally { setFailSaving(false); }
  };

  /** A re-visit is a new inspection linked to the failure, which is left exactly as it was. */
  const [reinspecting, setReinspecting] = useState<Record<string, unknown> | null>(null);
  const [reinspectDate, setReinspectDate] = useState('');
  const submitReinspect = async () => {
    if (!reinspecting) return;
    try {
      const res = await api.inspections.reinspect(reinspecting.id as string, { scheduledDate: reinspectDate || undefined }) as Record<string, any>;
      toast.success(`${res?.inspection?.number || 'Re-inspection'} booked`);
      setReinspecting(null); setReinspectDate(''); load();
    } catch (err) { toast.error((err as Error).message); }
  };

  const openCreate = () => { setEditing(null); setForm({ type: '', projectId: '', scheduledDate: '', inspector: '', notes: '' }); setModalOpen(true); };
  const openEdit = (item: Record<string, unknown>) => { setEditing(item); setForm({ type: item.type as string, projectId: item.projectId as string, scheduledDate: (item.scheduledDate as string)?.split('T')[0] || '', inspector: (item.inspector as string) || '', notes: (item.notes as string) || '' }); setModalOpen(true); };

  const columns = [
    { key: 'number', label: '#', render: (v: unknown) => <span className="font-mono text-sm">{v as string}</span> },
    { key: 'type', label: 'Type', render: (v: unknown) => <span className="font-medium">{v as string}</span> },
    { key: 'project', label: 'Project', render: (v: unknown) => (v as Record<string, unknown>)?.name as string || '-' },
    { key: 'status', label: 'Status', render: (v: unknown) => <StatusBadge status={v as string} statusColors={{ scheduled: 'bg-blue-100 text-blue-700 dark:text-blue-300 dark:bg-blue-950/40', passed: 'bg-green-100 text-green-700 dark:text-green-300 dark:bg-green-950/40', failed: 'bg-red-100 text-red-700 dark:text-red-400 dark:bg-red-950/40' }} /> },
    { key: 'scheduledDate', label: 'Scheduled', render: (v: unknown) => v ? formatDate(v as string) : '-' },
    { key: 'inspector', label: 'Inspector' },
    ...(checklistsOn ? [{ key: 'checklist', label: 'Checklist', render: (v: unknown) => { const c = v as { total: number; answered: number; failed: number } | undefined; return c && c.total ? `${c.answered} of ${c.total} answered${c.failed ? ` · ${c.failed} failed` : ''}` : '-'; } }] : []),
  ];

  return (
    <div>
      <PageHeader title="Inspections" action={<div className="flex gap-2">{checklistsOn && <Button variant="secondary" onClick={() => setTemplatesOpen(true)}><ListChecks className="w-4 h-4 mr-2 inline"/>Checklists</Button>}{can('inspections:create') ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Schedule Inspection</Button> : null}</div>} />
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage}
        emptyMessage='No inspections yet'
        emptyHint="Schedule permit and quality inspections and record whether each one passed."
        emptyAction={can('inspections:create') ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Schedule Inspection</Button> : undefined}
        actions={[
        // A result is recorded once, so Pass and Fail are offered only while there is no result.
        { label: 'Checklist', icon: ListChecks, onClick: (r: Record<string, unknown>) => setChecklistFor(r), show: () => checklistsOn },
        { label: 'Edit', icon: Edit, onClick: openEdit, show: (r: Record<string, unknown>) => can('inspections:update') && AWAITING.includes(r.status as string) },
        { label: 'Pass', icon: Check, onClick: handlePass, show: (r: Record<string, unknown>) => can('inspections:update') && AWAITING.includes(r.status as string) },
        { label: 'Fail', icon: XIcon, onClick: (r: Record<string, unknown>) => { setDeficiencies(''); setFailing(r); }, show: (r: Record<string, unknown>) => can('inspections:update') && AWAITING.includes(r.status as string) },
        { label: 'Book re-inspection', icon: RotateCcw, onClick: (r: Record<string, unknown>) => { setReinspectDate(''); setReinspecting(r); }, show: (r: Record<string, unknown>) => can('inspections:create') && r.status === 'failed' },
        { label: 'Delete', icon: Trash2, onClick: (r: Record<string, unknown>) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600', show: () => can('inspections:delete') },
      ]} />
      {checklistsOn && <ChecklistModal inspection={checklistFor} canEdit={can('inspections:update') && !!checklistFor && AWAITING.includes(checklistFor.status as string)} onClose={() => setChecklistFor(null)} onChanged={load} />}
      {checklistsOn && <ChecklistTemplatesModal isOpen={templatesOpen} onClose={() => setTemplatesOpen(false)} types={inspectionTypes} canCreate={can('inspections:create')} canUpdate={can('inspections:update')} canDelete={can('inspections:delete')} />}
      <Modal isOpen={!!failing} onClose={() => setFailing(null)} title={`Fail ${(failing?.number as string) || 'inspection'}`} size="md">
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">What failed? *</label>
            <textarea
              value={deficiencies}
              onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setDeficiencies(e.target.value)}
              rows={5}
              placeholder="e.g. Two joist hangers missing at grid C. Firestopping incomplete above the third-floor ceiling."
              className="w-full px-3 py-2 border rounded-lg"
            />
            <p className="mt-1 text-xs text-gray-500 dark:text-slate-400">
              The re-inspection is booked against this list, so it is what the crew works from.
            </p>
            {failedFromChecklist && <p className="mt-1 text-xs text-gray-600 dark:text-slate-400">The failed lines on the checklist are used if you leave this empty.</p>}
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setFailing(null)}>Cancel</Button>
            <Button onClick={submitFail} disabled={failSaving || (deficiencies.trim().length < 10 && !failedFromChecklist)}>{failSaving ? 'Saving…' : 'Record failure'}</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!reinspecting} onClose={() => setReinspecting(null)} title="Book re-inspection" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-slate-300">
            A new inspection is created, linked to {(reinspecting?.number as string) || 'the failure'}, carrying its
            deficiency list. The failed record is left exactly as it is — it is the evidence of what was found.
          </p>
          <div>
            <label className="block text-sm font-medium mb-1">Scheduled date</label>
            <input type="date" value={reinspectDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReinspectDate(e.target.value)} className="w-full px-3 py-2 border rounded-lg" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setReinspecting(null)}>Cancel</Button>
            <Button onClick={submitReinspect}>Book it</Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Inspection' : 'Schedule Inspection'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Type *</label><select value={form.type} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, type: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{inspectionTypes.map(t => <option key={t} value={t}>{codeLabel(t)}</option>)}</select></div>
          <div><label className="block text-sm font-medium mb-1">Project *</label><select value={form.projectId} onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setForm({...form, projectId: e.target.value})} className="w-full px-3 py-2 border rounded-lg"><option value="">Select...</option>{projects.map((p: Record<string, unknown>) => <option key={p.id as string} value={p.id as string}>{p.name as string}</option>)}</select></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium mb-1">Scheduled Date</label><input type="date" value={form.scheduledDate} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, scheduledDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
            <div><label className="block text-sm font-medium mb-1">Inspector</label><input value={form.inspector} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setForm({...form, inspector: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Notes</label><textarea value={form.notes} onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setForm({...form, notes: e.target.value})} rows={3} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 dark:hover:bg-slate-800 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Inspection" message={`Delete ${toDelete?.number as string}?`} confirmText="Delete" />
    </div>
  );
}
