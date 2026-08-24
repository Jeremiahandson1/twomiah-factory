import { toast } from '../Toast';
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

// Settings → Users. The care CRM had no Settings area and no way to manage staff
// logins; this surfaces company info plus office (admin/owner) and caregiver
// users, with add / activate / deactivate / reset-password backed by the existing
// /api/users endpoints.
const UserManagement = () => {
  const { token, company, user } = useAuth();
  const [admins, setAdmins] = useState([]);
  const [caregivers, setCaregivers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);

  const authHeaders = { 'Authorization': `Bearer ${token}` };
  const jsonHeaders = { 'Content-Type': 'application/json', ...authHeaders };

  const loadUsers = async () => {
    setLoading(true);
    try {
      const [adminRes, cgRes] = await Promise.all([
        fetch(`${API_BASE_URL}/api/users/admins`, { headers: authHeaders }),
        fetch(`${API_BASE_URL}/api/users/caregivers?isActive=all`, { headers: authHeaders }),
      ]);
      const adminData = await adminRes.json();
      const cgData = await cgRes.json();
      setAdmins(Array.isArray(adminData) ? adminData : (adminData.users || []));
      setCaregivers(Array.isArray(cgData) ? cgData : (cgData.caregivers || []));
    } catch (error) {
      toast('Failed to load users: ' + error.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadUsers(); }, []);

  const toggleActive = async (id) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${id}/toggle-active`, {
        method: 'PATCH', headers: authHeaders,
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      loadUsers();
    } catch (error) {
      toast('Failed to update: ' + error.message, 'error');
    }
  };

  const resetPassword = async (id, name) => {
    const password = prompt(`Enter a new password for ${name} (min 8 characters):`);
    if (password === null) return;
    if (password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/${id}/reset-password`, {
        method: 'PUT', headers: jsonHeaders, body: JSON.stringify({ password }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('Password reset.', 'success');
    } catch (error) {
      toast('Failed to reset password: ' + error.message, 'error');
    }
  };

  const promoteToAdmin = async (id, name) => {
    if (!confirm(`Give ${name} office (admin) access? They will be able to manage the whole CRM.`)) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/convert-to-admin`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify({ userId: id }),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed');
      toast('User promoted to admin.', 'success');
      loadUsers();
    } catch (error) {
      toast('Failed to promote: ' + error.message, 'error');
    }
  };

  const renderRow = (u, opts = { canPromote: false }) => {
    const active = u.is_active !== false && u.isActive !== false;
    const name = `${u.first_name || u.firstName || ''} ${u.last_name || u.lastName || ''}`.trim();
    const isSelf = u.id === user?.id;
    return (
      <tr key={u.id} style={active ? undefined : { opacity: 0.55 }}>
        <td><strong>{name || '—'}</strong></td>
        <td>{u.email}</td>
        <td>{u.phone || '—'}</td>
        <td><span className="badge badge-info">{(u.role || 'caregiver')}</span></td>
        <td>
          {active
            ? <span className="badge badge-success">Active</span>
            : <span className="badge badge-danger">Deactivated</span>}
        </td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn btn-sm btn-secondary" onClick={() => resetPassword(u.id, name)}>Reset Password</button>
          {opts.canPromote && (
            <button className="btn btn-sm btn-secondary" style={{ marginLeft: '0.5rem' }} onClick={() => promoteToAdmin(u.id, name)}>Make Admin</button>
          )}
          {!isSelf && (
            <button
              className={`btn btn-sm ${active ? 'btn-danger' : 'btn-success'}`}
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
          <p style={{ margin: '0.25rem 0 0', color: '#666' }}>
            {company?.name ? `${company.name} · ` : ''}Manage staff logins and access.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowAdd(true)}>+ Add Office User</button>
      </div>

      {loading ? (
        <div className="loading"><div className="spinner"></div></div>
      ) : (
        <>
          <div className="card" style={{ marginBottom: '1.5rem' }}>
            <h3 style={{ marginTop: 0 }}>Office / Admins</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {admins.length === 0
                    ? (<tr><td colSpan={6} style={{ textAlign: 'center', color: '#666' }}>No office users yet.</td></tr>)
                    : admins.map(u => renderRow(u))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <h3 style={{ marginTop: 0 }}>Caregivers</h3>
            <div style={{ overflowX: 'auto' }}>
              <table className="table">
                <thead>
                  <tr><th>Name</th><th>Email</th><th>Phone</th><th>Role</th><th>Status</th><th>Actions</th></tr>
                </thead>
                <tbody>
                  {caregivers.length === 0
                    ? (<tr><td colSpan={6} style={{ textAlign: 'center', color: '#666' }}>No caregivers yet. Add them under Caregivers.</td></tr>)
                    : caregivers.map(u => renderRow(u, { canPromote: true }))}
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
          jsonHeaders={jsonHeaders}
        />
      )}
    </div>
  );
};

const AddOfficeUserModal = ({ onClose, onSaved, jsonHeaders }) => {
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', phone: '', password: '' });
  const [saving, setSaving] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName || !form.lastName || !form.email || !form.password) {
      toast('Name, email and password are required', 'error'); return;
    }
    if (form.password.length < 8) { toast('Password must be at least 8 characters', 'error'); return; }
    setSaving(true);
    try {
      const res = await fetch(`${API_BASE_URL}/api/users/admins`, {
        method: 'POST', headers: jsonHeaders, body: JSON.stringify(form),
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to create user');
      toast('Office user created.', 'success');
      onSaved();
    } catch (error) {
      toast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h3>Add Office User</h3>
          <button className="modal-close" onClick={onClose}>×</button>
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
            <small style={{ color: '#666' }}>Share this with the user; they can change it after signing in.</small>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end', marginTop: '1rem' }}>
            <button type="button" className="btn btn-secondary" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Creating…' : 'Create User'}</button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserManagement;
