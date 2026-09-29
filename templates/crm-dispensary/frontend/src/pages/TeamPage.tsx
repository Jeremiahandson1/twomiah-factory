import { useState, useEffect, useCallback } from 'react';
import { Plus, Edit, Trash2 } from 'lucide-react';
import api from '../services/api';
import { useToast } from '../contexts/ToastContext';
import { usePermissions } from '../contexts/PermissionsContext';
import { DataTable, PageHeader, Button } from '../components/ui/DataTable';
import { Modal, ConfirmModal } from '../components/ui/Modal';

/**
 * What this shop calls each rung. Mirrors the server's ROLE_MAPPING and ROLE_HIERARCHY
 * (backend/src/middleware/permissions.ts), where `user` and `field` both normalise to budtender —
 * the two names the roster showed raw. Presentation only: the stored value never changes.
 */
const DISPENSARY_ROLE_LABELS: Record<string, string> = {
  owner: 'Owner', admin: 'Admin', manager: 'Manager',
  budtender: 'Budtender', user: 'Budtender', field: 'Budtender',
  driver: 'Driver', viewer: 'Viewer',
};

export default function TeamPage() {
  const toast = useToast();
  // The same three permissions team.ts enforces: team:create, team:update, team:delete.
  const { can } = usePermissions() as any;
  const canCreate = can ? can('team:create') : true;
  const canUpdate = can ? can('team:update') : true;
  const canDelete = can ? can('team:delete') : true;
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pagination, setPagination] = useState(null);
  const [page, setPage] = useState(1);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' });
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [toDelete, setToDelete] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try { const res = await api.team.list({ page, limit: 25 }); setData(res.data); setPagination(res.pagination); }
    catch (err) { toast.error('Failed to load team'); }
    finally { setLoading(false); }
  }, [page]);

  useEffect(() => { load(); }, [load]);

  const handleSave = async () => {
    if (!form.name) { toast.error('Name required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, hourlyRate: form.hourlyRate ? Number(form.hourlyRate) : undefined };
      if (editing) { await api.team.update(editing.id, payload); toast.success('Updated'); }
      else { await api.team.create(payload); toast.success('Created'); }
      setModalOpen(false); load();
    } catch (err) { toast.error(err.message); }
    finally { setSaving(false); }
  };

  const handleDelete = async () => { try { await api.team.delete(toDelete.id); toast.success('Deleted'); setDeleteOpen(false); load(); } catch (err) { toast.error(err.message); } };

  const openCreate = () => { setEditing(null); setForm({ name: '', email: '', phone: '', role: '', department: '', hourlyRate: '' }); setModalOpen(true); };
  const openEdit = (item) => { setEditing(item); setForm({ name: item.name, email: item.email || '', phone: item.phone || '', role: item.role || '', department: item.department || '', hourlyRate: item.hourlyRate ? String(item.hourlyRate) : '' }); setModalOpen(true); };

  const columns = [
    { key: 'name', label: 'Name', render: (v) => <span className="font-medium">{v}</span> },
    // The hierarchy's stored ids are named for the trades it was built for, so this column read
    // "field" and "user" at a dispensary — words nobody there uses and the Role dropdown two lines up
    // does not offer. Shown in this shop's own vocabulary; the stored value is untouched. (T43 N11)
    { key: 'role', label: 'Role', render: (v) => DISPENSARY_ROLE_LABELS[String(v || '').toLowerCase()] || (v || '-') },
    { key: 'department', label: 'Department' },
    { key: 'email', label: 'Email' },
    { key: 'phone', label: 'Phone' },
    { key: 'hourlyRate', label: 'Rate', render: (v) => {
      const n = Number(v);
      return (v != null && v !== '' && Number.isFinite(n))
        ? `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}/hr`
        : '-';
    } },
  ];

  const tableActions = [
    ...(canUpdate ? [{ label: 'Edit', icon: Edit, onClick: openEdit }] : []),
    ...(canDelete ? [{ label: 'Delete', icon: Trash2, onClick: (r: any) => { setToDelete(r); setDeleteOpen(true); }, className: 'text-red-600' }] : []),
  ];

  return (
    <div>
      {/* T45 M19: this page offered a manager "Add Member", and team:create is admin and up — so
          the button opened a dialog, took a name, an email and a role, and answered 403 on Save.
          A control that cannot work is a promise the product does not keep; the same three
          permissions the server enforces decide what is on the screen. (T45 M19) */}
      <PageHeader
        title="Team"
        action={canCreate ? <Button onClick={openCreate}><Plus className="w-4 h-4 mr-2 inline"/>Add Member</Button> : undefined}
      />
      {!canCreate && (
        <p className="text-sm text-gray-500 mb-4 dark:text-slate-400">
          Adding and removing people is an admin or owner job. Ask one of them.
        </p>
      )}
      <DataTable data={data} columns={columns} loading={loading} pagination={pagination} onPageChange={setPage} actions={tableActions} />
      <Modal isOpen={modalOpen} onClose={() => setModalOpen(false)} title={editing ? 'Edit Member' : 'Add Member'} size="md">
        <div className="space-y-4">
          <div><label className="block text-sm font-medium mb-1">Name *</label><input value={form.name} onChange={(e) => setForm({...form, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div className="grid grid-cols-2 gap-4">
            {/* A role this list does not know about is still SHOWN, rather than falling through to
                "Select a role…" as though the person had none. T47 P7 opened Edit on a member and saw
                no role preselected; a select whose value matches no option renders empty, and then
                saving quietly rewrites whatever was there. Whatever the server says the role is,
                that is what the box shows. */}
            <div><label className="block text-sm font-medium mb-1">Role</label><select value={form.role} onChange={(e) => setForm({...form, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg dark:bg-slate-800 dark:border-slate-700 dark:text-slate-100"><option value="">Select a role…</option><option value="budtender">Budtender</option><option value="driver">Driver</option><option value="manager">Manager</option><option value="admin">Admin</option><option value="owner">Owner</option><option value="viewer">Viewer</option>{form.role && !['budtender','driver','manager','admin','owner','viewer'].includes(form.role) && <option value={form.role}>{form.role}</option>}</select></div>
            <div><label className="block text-sm font-medium mb-1">Department</label><input value={form.department} onChange={(e) => setForm({...form, department: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          </div>
          <div><label className="block text-sm font-medium mb-1">Email</label><input type="email" value={form.email} onChange={(e) => setForm({...form, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Phone</label><input value={form.phone} onChange={(e) => setForm({...form, phone: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
          <div><label className="block text-sm font-medium mb-1">Hourly Rate</label><input type="number" value={form.hourlyRate} onChange={(e) => setForm({...form, hourlyRate: e.target.value})} className="w-full px-3 py-2 border rounded-lg" /></div>
        </div>
        <div className="flex justify-end gap-3 mt-6"><button onClick={() => setModalOpen(false)} className="px-4 py-2 hover:bg-gray-100 rounded-lg">Cancel</button><Button onClick={handleSave} disabled={saving}>{saving ? 'Saving...' : 'Save'}</Button></div>
      </Modal>
      <ConfirmModal isOpen={deleteOpen} onClose={() => setDeleteOpen(false)} onConfirm={handleDelete} title="Delete Member" message={`Delete ${toDelete?.name}?`} confirmText="Delete" />
    </div>
  );
}
