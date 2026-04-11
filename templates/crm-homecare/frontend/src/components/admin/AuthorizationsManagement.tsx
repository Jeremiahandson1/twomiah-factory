import { confirm } from '../ConfirmModal';
import { toast } from '../Toast';
// src/components/admin/AuthorizationsManagement.tsx
// Client authorizations management with CRUD
import React, { useState, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';

const parseDate = (dateStr) => {
  if (!dateStr) return null;
  if (typeof dateStr === 'string' && dateStr.match(/^\d{4}-\d{2}-\d{2}$/)) {
    const [year, month, day] = dateStr.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  if (typeof dateStr === 'string' && dateStr.includes('T')) {
    const [datePart] = dateStr.split('T');
    const [year, month, day] = datePart.split('-').map(Number);
    return new Date(year, month - 1, day);
  }
  return new Date(dateStr);
};

const formatDate = (dateStr) => {
  const date = parseDate(dateStr);
  if (!date || isNaN(date.getTime())) return '';
  return date.toLocaleDateString('en-US');
};

const AuthorizationsManagement = () => {
  const { token } = useAuth();
  const [authorizations, setAuthorizations] = useState([]);
  const [clients, setClients] = useState([]);
  const [payers, setPayers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState({ status: '', clientId: '', payerId: '' });
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState(null);

  const [form, setForm] = useState({
    clientId: '', payerId: '', authNumber: '', procedureCode: '', modifier: '',
    authorizedUnits: '', unitType: 'hours', usedUnits: '0',
    startDate: '', endDate: '', status: 'active', lowUnitsAlertThreshold: '10', notes: ''
  });

  useEffect(() => {
    loadAuthorizations();
    loadClients();
    loadPayers();
  }, [filter]);

  const loadAuthorizations = async () => {
    try {
      const params = new URLSearchParams();
      if (filter.status) params.append('status', filter.status);
      if (filter.clientId) params.append('clientId', filter.clientId);
      if (filter.payerId) params.append('payerId', filter.payerId);

      const res = await fetch(`${API_BASE_URL}/api/authorizations?${params}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setAuthorizations(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load authorizations:', error);
    } finally {
      setLoading(false);
    }
  };

  const loadClients = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/clients`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setClients(Array.isArray(data) ? data : (data.clients || []));
    } catch (error) {
      console.error('Failed to load clients:', error);
    }
  };

  const loadPayers = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/payers`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await res.json();
      setPayers(Array.isArray(data) ? data : []);
    } catch (error) {
      console.error('Failed to load payers:', error);
    }
  };

  const saveAuthorization = async (e) => {
    e.preventDefault();
    try {
      const url = editing
        ? `${API_BASE_URL}/api/authorizations/${editing.id}`
        : `${API_BASE_URL}/api/authorizations`;
      const payload = {
        ...form,
        authorizedUnits: form.authorizedUnits ? parseFloat(form.authorizedUnits) : 0,
        usedUnits: form.usedUnits ? parseFloat(form.usedUnits) : 0,
        lowUnitsAlertThreshold: form.lowUnitsAlertThreshold ? parseFloat(form.lowUnitsAlertThreshold) : null,
      };
      const res = await fetch(url, {
        method: editing ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(payload)
      });
      if (res.ok) {
        toast(editing ? 'Authorization updated' : 'Authorization created', 'success');
        setShowModal(false);
        setEditing(null);
        resetForm();
        loadAuthorizations();
      } else {
        const err = await res.json();
        toast(err.error || 'Failed to save', 'error');
      }
    } catch (error) {
      toast('Failed to save authorization: ' + error.message, 'error');
    }
  };

  const cancelAuthorization = async (auth) => {
    const ok = await confirm(`Cancel authorization ${auth.authNumber || auth.id}?`, 'This will mark it as cancelled.');
    if (!ok) return;
    try {
      const res = await fetch(`${API_BASE_URL}/api/authorizations/${auth.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (res.ok) {
        toast('Authorization cancelled', 'success');
        loadAuthorizations();
      }
    } catch (error) {
      toast('Failed to cancel: ' + error.message, 'error');
    }
  };

  const resetForm = () => {
    setForm({
      clientId: '', payerId: '', authNumber: '', procedureCode: '', modifier: '',
      authorizedUnits: '', unitType: 'hours', usedUnits: '0',
      startDate: '', endDate: '', status: 'active', lowUnitsAlertThreshold: '10', notes: ''
    });
  };

  const openEdit = (auth) => {
    setEditing(auth);
    setForm({
      clientId: auth.clientId || '', payerId: auth.payerId || '',
      authNumber: auth.authNumber || '', procedureCode: auth.procedureCode || '',
      modifier: auth.modifier || '',
      authorizedUnits: auth.authorizedUnits?.toString() || '',
      unitType: auth.unitType || 'hours',
      usedUnits: auth.usedUnits?.toString() || '0',
      startDate: auth.startDate ? auth.startDate.split('T')[0] : '',
      endDate: auth.endDate ? auth.endDate.split('T')[0] : '',
      status: auth.status || 'active',
      lowUnitsAlertThreshold: auth.lowUnitsAlertThreshold?.toString() || '10',
      notes: auth.notes || ''
    });
    setShowModal(true);
  };

  const getStatusBadge = (status) => {
    const colors = {
      active: '#4caf50', pending: '#ff9800', expired: '#f44336',
      cancelled: '#9e9e9e', exhausted: '#b71c1c'
    };
    return (
      <span style={{
        padding: '4px 8px', borderRadius: '4px', fontSize: '0.8rem',
        fontWeight: 'bold', color: 'white', backgroundColor: colors[status] || '#9e9e9e'
      }}>
        {status?.toUpperCase() || 'N/A'}
      </span>
    );
  };

  const getUtilizationBar = (used, authorized) => {
    const usedNum = parseFloat(used) || 0;
    const authNum = parseFloat(authorized) || 0;
    if (authNum === 0) return null;
    const pct = Math.min((usedNum / authNum) * 100, 100);
    const remaining = authNum - usedNum;
    const color = pct > 90 ? '#f44336' : pct > 75 ? '#ff9800' : '#4caf50';
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <div style={{ flex: 1, background: '#e0e0e0', borderRadius: '4px', height: '8px', minWidth: '60px' }}>
          <div style={{ width: `${pct}%`, background: color, borderRadius: '4px', height: '8px' }} />
        </div>
        <span style={{ fontSize: '0.8rem', color: '#666', whiteSpace: 'nowrap' }}>
          {remaining.toFixed(1)} left
        </span>
      </div>
    );
  };

  if (loading) return <div className="loading"><div className="spinner"></div></div>;

  return (
    <div>
      <div className="page-header">
        <h2>📋 Authorizations</h2>
        <button className="btn btn-primary" onClick={() => { resetForm(); setEditing(null); setShowModal(true); }}>
          + New Authorization
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', marginBottom: '1rem' }}>
        <div className="stat-card">
          <h4>Total</h4>
          <div className="value">{authorizations.length}</div>
        </div>
        <div className="stat-card">
          <h4>Active</h4>
          <div className="value" style={{ color: '#4caf50' }}>{authorizations.filter(a => a.status === 'active').length}</div>
        </div>
        <div className="stat-card">
          <h4>Expiring Soon</h4>
          <div className="value" style={{ color: '#ff9800' }}>
            {authorizations.filter(a => {
              if (a.status !== 'active' || !a.endDate) return false;
              const end = parseDate(a.endDate);
              const now = new Date();
              const diff = (end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
              return diff >= 0 && diff <= 30;
            }).length}
          </div>
          <small>Within 30 days</small>
        </div>
        <div className="stat-card">
          <h4>Low Units</h4>
          <div className="value" style={{ color: '#f44336' }}>
            {authorizations.filter(a => {
              if (a.status !== 'active') return false;
              const used = parseFloat(a.usedUnits) || 0;
              const auth = parseFloat(a.authorizedUnits) || 0;
              return auth > 0 && ((auth - used) / auth) < 0.15;
            }).length}
          </div>
          <small>&lt; 15% remaining</small>
        </div>
      </div>

      {/* Filters */}
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Status</label>
            <select value={filter.status} onChange={(e) => setFilter({ ...filter, status: e.target.value })}>
              <option value="">All Statuses</option>
              <option value="active">Active</option>
              <option value="pending">Pending</option>
              <option value="expired">Expired</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Client</label>
            <select value={filter.clientId} onChange={(e) => setFilter({ ...filter, clientId: e.target.value })}>
              <option value="">All Clients</option>
              {clients.map(c => (
                <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
              ))}
            </select>
          </div>
          <div className="form-group" style={{ margin: 0 }}>
            <label>Payer</label>
            <select value={filter.payerId} onChange={(e) => setFilter({ ...filter, payerId: e.target.value })}>
              <option value="">All Payers</option>
              {payers.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card" style={{ overflowX: 'auto' }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>Client</th>
              <th>Payer</th>
              <th>Auth #</th>
              <th>Procedure</th>
              <th>Authorized</th>
              <th>Used</th>
              <th>Utilization</th>
              <th>Start</th>
              <th>End</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {authorizations.length === 0 ? (
              <tr><td colSpan={11} style={{ textAlign: 'center', padding: '2rem', color: '#999' }}>No authorizations found</td></tr>
            ) : authorizations.map(auth => (
              <tr key={auth.id}>
                <td style={{ fontWeight: 600 }}>
                  {auth.client ? `${auth.client.firstName || ''} ${auth.client.lastName || ''}`.trim() : '—'}
                </td>
                <td>{auth.payer?.name || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{auth.authNumber || '—'}</td>
                <td style={{ fontFamily: 'monospace' }}>{auth.procedureCode || '—'}{auth.modifier ? `:${auth.modifier}` : ''}</td>
                <td>{auth.authorizedUnits || 0} {auth.unitType || ''}</td>
                <td>{auth.usedUnits || 0}</td>
                <td style={{ minWidth: '120px' }}>{getUtilizationBar(auth.usedUnits, auth.authorizedUnits)}</td>
                <td>{formatDate(auth.startDate)}</td>
                <td>{formatDate(auth.endDate)}</td>
                <td>{getStatusBadge(auth.status)}</td>
                <td>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button className="btn btn-sm" onClick={() => openEdit(auth)}>Edit</button>
                    {auth.status === 'active' && (
                      <button className="btn btn-sm" style={{ color: '#f44336' }} onClick={() => cancelAuthorization(auth)}>Cancel</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* MODAL */}
      {showModal && (
        <div className="modal-overlay" onClick={() => setShowModal(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '650px' }}>
            <div className="modal-header">
              <h3>{editing ? 'Edit Authorization' : 'New Authorization'}</h3>
              <button className="modal-close" onClick={() => setShowModal(false)}>&times;</button>
            </div>
            <form onSubmit={saveAuthorization}>
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Client *</label>
                    <select value={form.clientId} onChange={(e) => setForm({ ...form, clientId: e.target.value })} required>
                      <option value="">Select client...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.firstName} {c.lastName}</option>
                      ))}
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Payer *</label>
                    <select value={form.payerId} onChange={(e) => setForm({ ...form, payerId: e.target.value })} required>
                      <option value="">Select payer...</option>
                      {payers.map(p => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Auth Number</label>
                    <input type="text" value={form.authNumber} onChange={(e) => setForm({ ...form, authNumber: e.target.value })} />
                  </div>
                  <div className="form-group">
                    <label>Procedure Code</label>
                    <input type="text" value={form.procedureCode} onChange={(e) => setForm({ ...form, procedureCode: e.target.value })} placeholder="e.g. T1019" />
                  </div>
                  <div className="form-group">
                    <label>Modifier</label>
                    <input type="text" value={form.modifier} onChange={(e) => setForm({ ...form, modifier: e.target.value })} placeholder="e.g. U3" />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Authorized Units *</label>
                    <input type="number" step="0.01" value={form.authorizedUnits} onChange={(e) => setForm({ ...form, authorizedUnits: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Unit Type</label>
                    <select value={form.unitType} onChange={(e) => setForm({ ...form, unitType: e.target.value })}>
                      <option value="hours">Hours</option>
                      <option value="15min">15-Minute Units</option>
                      <option value="visits">Visits</option>
                      <option value="days">Days</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>Used Units</label>
                    <input type="number" step="0.01" value={form.usedUnits} onChange={(e) => setForm({ ...form, usedUnits: e.target.value })} />
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1rem' }}>
                  <div className="form-group">
                    <label>Start Date *</label>
                    <input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>End Date *</label>
                    <input type="date" value={form.endDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label>Status</label>
                    <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                      <option value="active">Active</option>
                      <option value="pending">Pending</option>
                      <option value="expired">Expired</option>
                      <option value="cancelled">Cancelled</option>
                    </select>
                  </div>
                </div>
                <div className="form-group">
                  <label>Low Units Alert Threshold</label>
                  <input type="number" step="1" value={form.lowUnitsAlertThreshold} onChange={(e) => setForm({ ...form, lowUnitsAlertThreshold: e.target.value })} />
                </div>
                <div className="form-group">
                  <label>Notes</label>
                  <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} />
                </div>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-secondary" onClick={() => setShowModal(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">{editing ? 'Update' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default AuthorizationsManagement;
