// Moved from templates/crm-homecare/frontend/src/components/admin/UserManagement.tsx — Users & Access (/crm/users).
// The agency's logins: the office (admin and owner) and the caregivers, with add, activate / deactivate, reset
// password and Make Admin, on home care's /api/users routes (server/crm/homecare/hr/caregivers.ts). Not the shared
// Team page (/crm/team: the roster of team members, /api/team), which home care's menu hides.
//   · Lists are { data, pagination } (rows()); rows are camelCase (firstName, isActive) — the template read either case.
//   · Each control is offered to whoever the server lets use it: Add Office User asks team:create, Reset Password and
//     Make Admin team:update, Deactivate / Reactivate care-hr:update. The template showed every button to everyone
//     it rendered for. The owner's own login is the owner's (the server's owner_only), as before.
//   · The password is asked in the app's own dialog (usePrompt), the promotion confirmed in its own (useConfirm); the
//     template used window.prompt and window.confirm.
//   · "Signed in as" is user.id (the shared session's user), so your own row has no Deactivate, as before.
//   · Both themes: the grey sentences take the frame's muted token.
//   · The seat in the agency's words — Caregiver, Office Manager — the server's (crm/viewAs.tsx roleWord), never the stored
//     id ("caregiver", "manager"); and "View as <person>" on each row, as on Settings › Users (live re-test 3, 2026-10-24).
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useAuth, useConfirm, usePermissions, usePrompt, useToast } from '../../../../shared';
import { api, errorMessage, rows } from '../lib/http';
import { ViewAsUserButton, roleWord } from '../../../viewAs';

interface Login {
  id: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  phone?: string | null;
  role?: string | null;
  isActive?: boolean | null;
}

export default function UserManagement() {
  const { company, user } = useAuth();
  const { can } = usePermissions();
  const toast = useToast();
  const confirm = useConfirm();
  const prompt = usePrompt();
  const [admins, setAdmins] = useState<Login[]>([]);
  const [caregivers, setCaregivers] = useState<Login[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const mayAdd = can('team:create');
  const mayResetOrPromote = can('team:update');
  const mayToggle = can('care-hr:update');

  const loadUsers = useCallback(async () => {
    setLoading(true);
    try {
      const [adminData, cgData] = await Promise.all([
        api.get('/api/users/admins', { limit: 200 }),
        api.get('/api/users/caregivers', { isActive: 'all' }),
      ]);
      setAdmins(rows<Login>(adminData));
      setCaregivers(rows<Login>(cgData));
    } catch (error) {
      toast.error('Failed to load users: ' + errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadUsers(); }, [loadUsers]);

  const toggleActive = async (id: string) => {
    try {
      await api.patch(`/api/users/${id}/toggle-active`, {});
      loadUsers();
    } catch (error) {
      toast.error('Failed to update: ' + errorMessage(error));
    }
  };

  const resetPassword = async (id: string, name: string) => {
    const password = await prompt(`Enter a new password for ${name} (min 8 characters):`, { title: 'Reset password', confirmText: 'Reset Password' });
    if (password === null) return;
    if (password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    try {
      await api.put(`/api/users/${id}/reset-password`, { password });
      toast.success('Password reset.');
    } catch (error) {
      toast.error('Failed to reset password: ' + errorMessage(error));
    }
  };

  const promoteToAdmin = async (id: string, name: string) => {
    if (!(await confirm(`Give ${name} office (admin) access? They will be able to manage the whole CRM.`, { title: 'Make Admin', confirmText: 'Make Admin', danger: false }))) return;
    try {
      await api.post('/api/users/convert-to-admin', { userId: id });
      toast.success('User promoted to admin.');
      loadUsers();
    } catch (error) {
      toast.error('Failed to promote: ' + errorMessage(error));
    }
  };

  const renderRow = (u: Login, opts: { canPromote: boolean } = { canPromote: false }) => {
    const active = u.isActive !== false;
    const name = `${u.firstName || ''} ${u.lastName || ''}`.trim();
    const isSelf = u.id === user?.id;
    // The owner's login is changed only by the owner (the server refuses anyone else: owner_only).
    const mayChange = u.role !== 'owner' || user?.role === 'owner';
    return (
      <tr key={u.id} style={active ? undefined : { opacity: 0.55 }}>
        <td><strong>{name || '—'}</strong></td>
        <td>{u.email}</td>
        <td>{u.phone || '—'}</td>
        <td><span className="hc-badge hc-badge-info">{roleWord(u.role || 'caregiver')}</span></td>
        <td>
          {active
            ? <span className="hc-badge hc-badge-success">Active</span>
            : <span className="hc-badge hc-badge-danger">Deactivated</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          {!isSelf && <ViewAsUserButton person={u} />}
          {mayChange && mayResetOrPromote && (
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" onClick={() => resetPassword(u.id, name)}>Reset Password</button>
          )}
          {opts.canPromote && mayResetOrPromote && (
            <button type="button" className="hc-btn hc-btn-sm hc-btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => promoteToAdmin(u.id, name)}>Make Admin</button>
          )}
          {!isSelf && mayChange && mayToggle && (
            <button
              type="button"
              className={`hc-btn hc-btn-sm ${active ? 'hc-btn-danger' : 'hc-btn-success'}`}
              style={{ marginLeft: '0.5rem' }}
              onClick={() => toggleActive(u.id)}
            >
              {active ? 'Deactivate' : 'Reactivate'}
            </button>
          )}
        </td>
      </tr>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap', gap: '0.5rem' }}>
        <div>
          <h2 style={{ margin: 0 }}>Settings &amp; Users</h2>
          <p style={{ margin: '0.25rem 0 0', color: 'var(--hc-muted)' }}>
            {company?.name ? `${company.name} · ` : ''}Manage staff logins and access.
          </p>
        </div>
        {mayAdd && <button type="button" className="hc-btn hc-btn-primary" onClick={() => setShowAdd(true)}>+ Add Office User</button>}
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : (
        <>
          <div className="hc-card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>Office / Admins</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="hc-table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {admins.length === 0
                    ? (<tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--hc-muted)' }}>No office users yet.</td></tr>)
                    : admins.map((u) => renderRow(u))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="hc-card">
            <h3 style={{ marginTop: 0 }}>Caregivers</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="hc-table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {caregivers.length === 0
                    ? (<tr><td colSpan={6} style={{ textAlign: 'center', color: 'var(--hc-muted)' }}>No caregivers yet. Add them under Caregivers.</td></tr>)
                    : caregivers.map((u) => renderRow(u, { canPromote: true }))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {showAdd && (
        <AddOfficeUserModal
          onClose={() => setShowAdd(false)}
          onSaved={() => { setShowAdd(false); loadUsers(); }}
        />
      )}
    </div>
  );
}

interface AddOfficeUserProps {
  onClose: () => void;
  onSaved: () => void;
}

function AddOfficeUserModal({ onClose, onSaved }: AddOfficeUserProps) {
  const toast = useToast();
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.password) {
      toast.error('Name, email and password are required'); return;
    }
    if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setSaving(true);
    try {
      // POST /api/users/admins: always an admin seat (the server never honours a role in the body).
      await api.post('/api/users/admins', form);
      toast.success('Office user created.');
      onSaved();
    } catch (error) {
      toast.error(errorMessage(error, 'Failed to create user'));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal active" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Office User</h3>
          <button type="button" className="modal-close" onClick={onClose}>×</button>
        </div>
        <form onSubmit={submit} style={{ padding: '1rem' }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            <div className="form-group">
              <label>First Name *</label>
              <input value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} required />
            </div>
            <div className="form-group">
              <label>Last Name *</label>
              <input value={form.lastName} onChange={(e) => setForm({ ...form, lastName: e.target.value })} required />
            </div>
          </div>
          <div className="form-group">
            <label>Email *</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} required />
          </div>
          <div className="form-group">
            <label>Phone</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </div>
          <div className="form-group">
            <label>Temporary Password * (min 8 characters)</label>
            <input type="text" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} required />
            <small style={{ color: 'var(--hc-muted)' }}>Share this with the user; they can change it after signing in.</small>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="button" className="hc-btn hc-btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="hc-btn hc-btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}
